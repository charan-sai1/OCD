// Package dedupe finds duplicate files by content (not just name) and can
// move the redundant copies into a quarantine folder. It never hard-deletes:
// the default action is a non-destructive move, and every destructive step
// must be opted into explicitly by the caller.
package dedupe

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"ocd/internal/hashx"
)

// Options controls a duplicate scan.
type Options struct {
	Dirs     []string // roots to scan
	MinSize  int64    // ignore files smaller than this (bytes); default 1
	Exclude  []string // directory base-names to skip anywhere
	Partial  int64    // partial-hash window; default 64 KiB
	Progress func(Progress)
}

// Progress is emitted during scanning/hashing.
type Progress struct {
	Phase   string // "scan", "partial", "full", "done"
	Done    int
	Total   int
	Message string
}

// File is a scanned file.
type File struct {
	Path    string    `json:"path"`
	Root    string    `json:"root"`
	Size    int64     `json:"size"`
	ModTime time.Time `json:"modTime"`
}

// Group is a set of files with identical content.
type Group struct {
	Hash  string `json:"hash"`
	Size  int64  `json:"size"`
	Files []File `json:"files"`
}

// Result is the outcome of FindDuplicates.
type Result struct {
	Groups           []Group `json:"groups"`
	TotalFiles       int     `json:"totalFiles"`
	DuplicateFiles   int     `json:"duplicateFiles"`  // files that have at least one twin
	RedundantCopies  int     `json:"redundantCopies"` // files beyond the first in each group
	ReclaimableBytes int64   `json:"reclaimableBytes"`
}

var defaultExclude = []string{
	"$RECYCLE.BIN", "System Volume Information", ".Spotlight-V100", ".Trashes",
	".fseventsd", "@eaDir", "#recycle", ".git", "node_modules",
}

func (o Options) excludedDir(name string) bool {
	for _, e := range append(defaultExclude, o.Exclude...) {
		if strings.EqualFold(name, e) {
			return true
		}
	}
	return false
}

// Scan walks the roots and returns candidate files (size >= MinSize).
func Scan(opts Options, progress func(Progress)) ([]File, error) {
	if opts.MinSize <= 0 {
		opts.MinSize = 1
	}
	emit := func(p Progress) {
		if progress != nil {
			progress(p)
		}
	}

	var files []File
	for _, root := range opts.Dirs {
		rootAbs, err := filepath.Abs(root)
		if err != nil {
			rootAbs = root
		}
		walkErr := filepath.WalkDir(rootAbs, func(path string, d os.DirEntry, err error) error {
			if err != nil {
				return nil // skip unreadable entries
			}
			if d.IsDir() {
				if path != rootAbs && opts.excludedDir(d.Name()) {
					return filepath.SkipDir
				}
				return nil
			}
			info, err := d.Info()
			if err != nil {
				return nil
			}
			if info.Size() < opts.MinSize {
				return nil
			}
			files = append(files, File{
				Path:    path,
				Root:    rootAbs,
				Size:    info.Size(),
				ModTime: info.ModTime(),
			})
			if len(files)%2000 == 0 {
				emit(Progress{Phase: "scan", Done: len(files), Message: path})
			}
			return nil
		})
		if walkErr != nil {
			return files, walkErr
		}
	}
	emit(Progress{Phase: "scan", Done: len(files)})
	return files, nil
}

// FindDuplicates returns content-identical groups using a 3-stage pipeline:
// size -> partial hash -> full hash. This avoids reading files that cannot match.
func FindDuplicates(opts Options, progress func(Progress)) (Result, error) {
	emit := func(p Progress) {
		if progress != nil {
			progress(p)
		}
	}
	if opts.Partial <= 0 {
		opts.Partial = 64 * 1024
	}

	files, err := Scan(opts, progress)
	if err != nil {
		return Result{}, err
	}
	res := Result{TotalFiles: len(files)}

	// Stage 1: group by size (only sizes with >1 file can be duplicates).
	bySize := map[int64][]File{}
	for _, f := range files {
		bySize[f.Size] = append(bySize[f.Size], f)
	}
	var cand []File
	for _, fs := range bySize {
		if len(fs) > 1 {
			cand = append(cand, fs...)
		}
	}

	// Stage 2: partial hash within size groups.
	byPartial := map[string][]File{}
	for i, f := range cand {
		if i%200 == 0 {
			emit(Progress{Phase: "partial", Done: i, Total: len(cand), Message: f.Path})
		}
		h, err := hashx.Partial(f.Path, opts.Partial)
		if err != nil {
			continue
		}
		key := fmt.Sprintf("%d:%s", f.Size, h)
		byPartial[key] = append(byPartial[key], f)
	}

	// Stage 3: full hash for partial matches only.
	byFull := map[string][]File{}
	n := 0
	for _, fs := range byPartial {
		if len(fs) < 2 {
			continue
		}
		for _, f := range fs {
			n++
			emit(Progress{Phase: "full", Done: n, Message: f.Path})
			h, err := hashx.File(f.Path)
			if err != nil {
				continue
			}
			byFull[h] = append(byFull[h], f)
		}
	}

	for h, fs := range byFull {
		if len(fs) < 2 {
			continue
		}
		sort.Slice(fs, func(i, j int) bool { return fs[i].Path < fs[j].Path })
		res.Groups = append(res.Groups, Group{Hash: h, Size: fs[0].Size, Files: fs})
		res.DuplicateFiles += len(fs)
		res.RedundantCopies += len(fs) - 1
		res.ReclaimableBytes += int64(len(fs)-1) * fs[0].Size
	}
	sort.Slice(res.Groups, func(i, j int) bool {
		return res.Groups[i].Size*int64(len(res.Groups[i].Files)) >
			res.Groups[j].Size*int64(len(res.Groups[j].Files))
	})
	emit(Progress{Phase: "done", Done: res.DuplicateFiles})
	return res, nil
}

// QuarantineOptions controls how redundant copies are handled.
type QuarantineOptions struct {
	QuarantineDir string // where redundant copies are moved
	Keep          string // keeper strategy: "first" (default), "shortest", "oldest"
	DryRun        bool
	Progress      func(Progress)
}

// QuarantineResult summarises a quarantine run.
type QuarantineResult struct {
	Moved  []MovedFile `json:"moved"`
	Errors []string    `json:"errors"`
	Freed  int64       `json:"freed"`
}

// MovedFile records a single quarantined file.
type MovedFile struct {
	From  string `json:"from"`
	To    string `json:"to"`
	Size  int64  `json:"size"`
	Group string `json:"group"`
}

// flatDest returns a free path for a copy inside dir. Duplicates are dropped
// straight into the chosen folder, so names collide easily: the file's own name
// is tried first, then "name (1).jpg", "name (2).jpg" and so on, skipping names
// already on disk and names claimed earlier in the same batch.
func flatDest(dir, name string, claimed map[string]bool) string {
	ext := filepath.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	cand := filepath.Join(dir, name)
	for i := 1; ; i++ {
		if !claimed[pathKey(cand)] {
			if _, err := os.Stat(cand); os.IsNotExist(err) {
				claimed[pathKey(cand)] = true
				return cand
			}
		}
		cand = filepath.Join(dir, fmt.Sprintf("%s (%d)%s", stem, i, ext))
	}
}

// caseInsensitiveFS reports whether this system compares paths
// case-insensitively, which decides how samePath is checked.
const caseInsensitiveFS = runtime.GOOS == "windows" || runtime.GOOS == "darwin"

// pathKey normalises a path for use as a map key on this system.
func pathKey(p string) string {
	p = filepath.Clean(p)
	if caseInsensitiveFS {
		return strings.ToLower(p)
	}
	return p
}

// samePath reports whether two paths point at the same location.
func samePath(a, b string) bool {
	ca, err1 := filepath.Abs(a)
	cb, err2 := filepath.Abs(b)
	if err1 != nil || err2 != nil {
		return filepath.Clean(a) == filepath.Clean(b)
	}
	return pathKey(ca) == pathKey(cb)
}

// Quarantine moves the non-keeper copies of each group into opts.QuarantineDir.
// Every copy lands directly in that folder, keeping only its own file name; if
// a name is already taken the usual " (1)", " (2)" suffix is added. The whole
// batch is planned before anything moves, so a preview and the move it
// previews agree on every destination. Non-destructive.
func Quarantine(groups []Group, opts QuarantineOptions) (QuarantineResult, error) {
	var out QuarantineResult
	if opts.Keep == "" {
		opts.Keep = "first"
	}
	if !opts.DryRun {
		if err := os.MkdirAll(opts.QuarantineDir, 0o755); err != nil {
			return out, err
		}
	}

	claimed := map[string]bool{}
	for _, g := range groups {
		keeper := pickKeeper(g.Files, opts.Keep)
		for _, f := range g.Files {
			if f.Path == keeper.Path {
				continue
			}
			if samePath(opts.QuarantineDir, filepath.Dir(f.Path)) {
				out.Errors = append(out.Errors, fmt.Sprintf("%s: already sits in the quarantine folder - choose a different folder", f.Path))
				continue
			}
			dest := flatDest(opts.QuarantineDir, filepath.Base(f.Path), claimed)
			if opts.DryRun {
				out.Moved = append(out.Moved, MovedFile{From: f.Path, To: dest, Size: f.Size, Group: g.Hash})
				out.Freed += f.Size
				continue
			}
			moved, err := moveFile(f.Path, dest)
			if err != nil {
				out.Errors = append(out.Errors, fmt.Sprintf("%s: %v", f.Path, err))
				continue
			}
			out.Moved = append(out.Moved, MovedFile{From: f.Path, To: moved, Size: f.Size, Group: g.Hash})
			out.Freed += f.Size
		}
	}
	if opts.Progress != nil {
		opts.Progress(Progress{Phase: "done", Done: len(out.Moved)})
	}
	return out, nil
}

func pickKeeper(files []File, strategy string) File {
	best := files[0]
	for _, f := range files[1:] {
		switch strategy {
		case "shortest":
			if len(f.Path) < len(best.Path) {
				best = f
			}
		case "oldest":
			if f.ModTime.Before(best.ModTime) {
				best = f
			}
		default: // "first" — files are pre-sorted by path
			if f.Path < best.Path {
				best = f
			}
		}
	}
	return best
}

// moveFile relocates src to dst and returns the path actually used. It refuses
// to move a file onto itself, and confirms every move afterwards: if the source
// is still there, or the destination is missing, it reports an error instead of
// letting the caller count the file as freed.
func moveFile(src, dst string) (string, error) {
	if samePath(src, dst) {
		return "", fmt.Errorf("refusing to move a file onto itself")
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return "", err
	}
	// Avoid clobbering an existing quarantined file with the same name.
	dst = uniquePath(dst)
	if err := os.Rename(src, dst); err == nil {
		if err := confirmMoved(src, dst); err != nil {
			return "", err
		}
		return dst, nil
	}
	// Cross-device: copy, verify, then remove the source.
	sh, err := hashx.File(src)
	if err != nil {
		return "", err
	}
	if err := copyFile(src, dst); err != nil {
		return "", err
	}
	dh, err := hashx.File(dst)
	if err != nil {
		return "", err
	}
	if sh != dh {
		return "", fmt.Errorf("verification failed for %s", src)
	}
	if err := os.Remove(src); err != nil {
		return "", err
	}
	if err := confirmMoved(src, dst); err != nil {
		return "", err
	}
	return dst, nil
}

// confirmMoved checks that a move really happened: the source is gone and the
// destination exists as a file. Without this, a destination that resolved back
// to the source looked like a successful move.
func confirmMoved(src, dst string) error {
	if _, err := os.Stat(src); err == nil {
		return fmt.Errorf("source is still present after the move")
	} else if !os.IsNotExist(err) {
		return err
	}
	info, err := os.Stat(dst)
	if err != nil {
		return fmt.Errorf("destination missing after the move: %w", err)
	}
	if info.IsDir() {
		return fmt.Errorf("destination is a directory")
	}
	return nil
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
	name := strings.TrimSuffix(base, ext)
	for i := 1; ; i++ {
		cand := filepath.Join(dir, fmt.Sprintf("%s (%d)%s", name, i, ext))
		if _, err := os.Stat(cand); os.IsNotExist(err) {
			return cand
		}
	}
}

// MarshalJSON keeps the Result shape stable for the API.
func (r Result) MarshalJSON() ([]byte, error) {
	type alias Result
	return json.Marshal(alias(r))
}
