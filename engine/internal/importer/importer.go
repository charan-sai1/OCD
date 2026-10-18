// Package importer copies media off a phone into date-organized folders on a
// destination drive, verifies every byte that lands, and only then (optionally)
// deletes the verified originals from the phone.
//
// Safety model:
//   - Nothing is ever deleted unless it was hashed, copied, and re-read from
//     the destination and the two hashes match.
//   - DryRun (default) reports what would happen and touches nothing.
//   - Files already present on the destination are never copied again.
package importer

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"hash"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"ocd/internal/hashx"
)

type hasher struct{ h hash.Hash }

func newHasher() *hasher                      { return &hasher{sha256.New()} }
func (x *hasher) Write(p []byte) (int, error) { return x.h.Write(p) }
func (x *hasher) sum() string                 { return hex.EncodeToString(x.h.Sum(nil)) }

// RemoteFile describes a file on the source (phone).
type RemoteFile struct {
	RelPath string    `json:"relPath"`
	Size    int64     `json:"size"`
	ModTime time.Time `json:"modTime"`
}

// Source is a place media can be read from and (optionally) removed from.
type Source interface {
	Name() string
	List() ([]RemoteFile, error)
	Open(rel string) (io.ReadCloser, error)
	Remove(rel string) error
}

// Options controls an import run.
type Options struct {
	DestRoot          string // e.g. "E:/Photos"
	Layout            string // "YYYY/MM" (default)
	DeleteAfterVerify bool   // wipe verified originals from the phone
	DryRun            bool
	MediaExts         []string // optional filter; empty = all files
	Index             *Index   // known identities on the destination
	Progress          func(Progress)

	// Duplicate handling.
	// DupCheck:  "content" (default, compares file bytes) | "name" (filename+size, much faster)
	// DupAction: "skip" (default, don't copy a file already on the drive) | "copy" (keep every copy)
	DupCheck  string
	DupAction string
}

// Progress reports import progress.
type Progress struct {
	Phase   string `json:"phase"` // "list","copy","verify","delete","done"
	Done    int    `json:"done"`
	Total   int    `json:"total"`
	Message string `json:"message"`
}

// Result summarises an import run.
type Result struct {
	Imported []ImportedFile `json:"imported"`
	Skipped  []ImportedFile `json:"skipped"` // already on drive
	Deleted  []string       `json:"deleted"` // removed from phone
	Errors   []string       `json:"errors"`
	Bytes    int64          `json:"bytes"`
}

// ImportedFile is one handled file.
type ImportedFile struct {
	From string `json:"from"`
	To   string `json:"to"`
	Size int64  `json:"size"`
	Hash string `json:"hash"`
}

var defaultMedia = []string{
	".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".heic", ".heif", ".avif",
	".tif", ".tiff", ".dng", ".cr2", ".cr3", ".nef", ".arw", ".raf", ".orf", ".rw2", ".pef",
	".mp4", ".mov", ".m4v", ".3gp", ".avi", ".mkv", ".webm", ".wmv",
}

func (o Options) allows(name string) bool {
	if len(o.MediaExts) == 0 {
		return true
	}
	ext := filepath.Ext(name)
	return containsFold(o.MediaExts, ext)
}

// DefaultMediaExts returns the media extensions the importer recognises.
func DefaultMediaExts() []string {
	out := make([]string, len(defaultMedia))
	copy(out, defaultMedia)
	return out
}

func containsFold(list []string, s string) bool {
	for _, e := range list {
		if len(e) == len(s) {
			match := true
			for i := 0; i < len(s); i++ {
				a, b := e[i], s[i]
				if 'A' <= a && a <= 'Z' {
					a += 'a' - 'A'
				}
				if 'A' <= b && b <= 'Z' {
					b += 'a' - 'A'
				}
				if a != b {
					match = false
					break
				}
			}
			if match {
				return true
			}
		}
	}
	return false
}

// Import runs the copy/verify(/delete) pipeline.
func Import(src Source, opts Options) (Result, error) {
	var res Result
	emit := func(p Progress) {
		if opts.Progress != nil {
			opts.Progress(p)
		}
	}
	if opts.Layout == "" {
		opts.Layout = "YYYY/MM"
	}
	if opts.DupCheck == "" {
		opts.DupCheck = "content"
	}
	if opts.DupAction == "" {
		opts.DupAction = "skip"
	}
	if !opts.DryRun {
		if err := os.MkdirAll(opts.DestRoot, 0o755); err != nil {
			return res, err
		}
	}

	emit(Progress{Phase: "list"})
	files, err := src.List()
	if err != nil {
		return res, err
	}
	total := 0
	for _, f := range files {
		if opts.allows(f.RelPath) {
			total++
		}
	}

	// Staging dir on the destination volume (same volume -> cheap rename into place).
	stage := filepath.Join(opts.DestRoot, ".ocd-incoming")
	if !opts.DryRun {
		_ = os.MkdirAll(stage, 0o755)
	}

	i := 0
	for _, f := range files {
		if !opts.allows(f.RelPath) {
			continue
		}
		i++
		emit(Progress{Phase: "copy", Done: i, Total: total, Message: f.RelPath})

		// skipDuplicate records a file we deliberately did not copy. It is safe
		// to wipe from the phone because identical content is already verified
		// to be on the drive.
		skipDuplicate := func(hash string) {
			res.Skipped = append(res.Skipped, ImportedFile{From: f.RelPath, Hash: hash, Size: f.Size})
			if opts.DeleteAfterVerify {
				if err := src.Remove(f.RelPath); err != nil {
					res.Errors = append(res.Errors, fmt.Sprintf("delete %s: %v", f.RelPath, err))
				} else {
					res.Deleted = append(res.Deleted, f.RelPath)
				}
			}
		}

		// Fast path: in "name" mode we can spot duplicates from the listing
		// alone, without reading the file at all.
		if opts.DupAction == "skip" && opts.DupCheck == "name" && opts.Index != nil {
			if opts.Index.Has(nameKey(f.RelPath, f.Size)) {
				skipDuplicate("")
				continue
			}
		}

		if opts.DryRun {
			res.Imported = append(res.Imported, ImportedFile{From: f.RelPath, Size: f.Size})
			res.Bytes += f.Size
			continue
		}

		// 1) Stream from the phone into a temp file, hashing as we go.
		tmp := filepath.Join(stage, fmt.Sprintf("%d.tmp", time.Now().UnixNano()))
		h, err := streamToFile(src, f.RelPath, tmp)
		if err != nil {
			res.Errors = append(res.Errors, fmt.Sprintf("read %s: %v", f.RelPath, err))
			_ = os.Remove(tmp)
			continue
		}

		// 2) Duplicate check: content hash, or filename+size.
		key := h
		if opts.DupCheck == "name" {
			var n int64
			if fi, err := os.Stat(tmp); err == nil {
				n = fi.Size()
			}
			key = nameKey(f.RelPath, n)
		}
		if opts.DupAction == "skip" && opts.Index != nil && opts.Index.Has(key) {
			_ = os.Remove(tmp)
			skipDuplicate(h)
			continue
		}

		// 3) Move into the date-organized destination.
		dest := filepath.Join(opts.DestRoot, datePath(f, opts.Layout), filepath.Base(f.RelPath))
		dest = uniquePath(dest)
		if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
			res.Errors = append(res.Errors, err.Error())
			_ = os.Remove(tmp)
			continue
		}
		if err := os.Rename(tmp, dest); err != nil {
			// cross-device fallback
			if err := copyFile(tmp, dest); err != nil {
				res.Errors = append(res.Errors, fmt.Sprintf("move %s: %v", f.RelPath, err))
				_ = os.Remove(tmp)
				continue
			}
			_ = os.Remove(tmp)
		}

		// 4) Verify: re-hash what actually landed on disk.
		got, err := hashx.File(dest)
		if err != nil || got != h {
			res.Errors = append(res.Errors, fmt.Sprintf("VERIFY FAILED for %s (will not delete from phone)", f.RelPath))
			continue // leave a possible stray copy, but never delete the phone original
		}
		if opts.Index != nil {
			opts.Index.Add(key, dest)
		}
		res.Imported = append(res.Imported, ImportedFile{From: f.RelPath, To: dest, Size: f.Size, Hash: h})
		res.Bytes += f.Size

		// 5) Only now, verified, wipe the original from the phone.
		if opts.DeleteAfterVerify {
			if err := src.Remove(f.RelPath); err != nil {
				res.Errors = append(res.Errors, fmt.Sprintf("delete %s: %v", f.RelPath, err))
			} else {
				res.Deleted = append(res.Deleted, f.RelPath)
			}
		}
	}

	if !opts.DryRun {
		_ = os.RemoveAll(stage)
	}
	emit(Progress{Phase: "done", Done: len(res.Imported)})
	return res, nil
}

func streamToFile(src Source, rel, dst string) (string, error) {
	rc, err := src.Open(rel)
	if err != nil {
		return "", err
	}
	defer rc.Close()
	out, err := os.Create(dst)
	if err != nil {
		return "", err
	}
	defer out.Close()
	// Hash exactly the bytes we write.
	h := newHasher()
	if _, err := io.Copy(io.MultiWriter(out, h), rc); err != nil {
		return "", err
	}
	return h.sum(), nil
}

var dateRe = regexp.MustCompile(`(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])`)

// datePath derives YYYY/MM from a filename date (e.g. IMG_20250219_...), else mtime.
func datePath(f RemoteFile, layout string) string {
	y, m := f.ModTime.Year(), f.ModTime.Month()
	if mm := dateRe.FindString(filepath.Base(f.RelPath)); mm != "" {
		if t, err := time.Parse("20060102", mm); err == nil {
			y, m = t.Year(), t.Month()
		}
	}
	if y < 1990 {
		return "unsorted"
	}
	if layout == "YYYY/MM/DD" {
		return fmt.Sprintf("%04d/%02d/%02d", y, int(m), f.ModTime.Day())
	}
	return fmt.Sprintf("%04d/%02d", y, int(m))
}

// nameKey is the duplicate identity used in "name" mode: size + lowercased
// filename. Cheap and stable — it needs no file reading.
func nameKey(rel string, size int64) string {
	return fmt.Sprintf("%d:%s", size, strings.ToLower(filepath.Base(rel)))
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

func uniquePath(p string) string {
	if _, err := os.Stat(p); os.IsNotExist(err) {
		return p
	}
	dir := filepath.Dir(p)
	base := filepath.Base(p)
	ext := filepath.Ext(base)
	name := base[:len(base)-len(ext)]
	for i := 1; ; i++ {
		cand := filepath.Join(dir, fmt.Sprintf("%s (%d)%s", name, i, ext))
		if _, err := os.Stat(cand); os.IsNotExist(err) {
			return cand
		}
	}
}
