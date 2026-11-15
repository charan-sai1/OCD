// Package catalog writes the portable index that lives on the drive. It is the
// part of OCD that travels: a second machine can read it without walking the
// disk, and a phone can use it to tell which camera-roll items are already
// backed up.
package catalog

import (
	"bufio"
	"compress/gzip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	// Format is stamped into every catalog so a wrong file is never mistaken
	// for one of ours.
	Format = "ocd-catalog"
	// Version is the catalog schema. Readers refuse anything newer.
	Version = 1

	dirName  = ".ocd"
	fileName = "catalog.gz"
	bakName  = "catalog.bak"
	tmpName  = "catalog.tmp"
)

// Header is the first line of the catalog.
type Header struct {
	Format       string    `json:"format"`
	Version      int       `json:"version"`
	VolumeID     string    `json:"volumeId"`
	Label        string    `json:"label,omitempty"`
	IndexVersion int       `json:"indexVersion,omitempty"`
	Generated    time.Time `json:"generated"`
	Count        int       `json:"count"`
}

// Entry is one media file, with a path relative to the volume root so a drive
// letter change cannot orphan it.
type Entry struct {
	Path     string  `json:"path"`
	Size     int64   `json:"size"`
	MTime    int64   `json:"mtime"`
	ShotAt   int64   `json:"shot,omitempty"`
	Hash     string  `json:"hash,omitempty"`
	Kind     string  `json:"kind,omitempty"`
	Width    int     `json:"width,omitempty"`
	Height   int     `json:"height,omitempty"`
	Duration float64 `json:"duration,omitempty"`
	Orient   int     `json:"orient,omitempty"`
	Live     string  `json:"live,omitempty"`

	// Camera and location details, read from the file's own EXIF by whichever
	// machine wrote the entry. Keeping them in the catalog means a phone can
	// show a date and place without opening the file, and a second computer
	// does not have to re-read a whole drive to learn them.
	Make     string  `json:"make,omitempty"`
	Model    string  `json:"model,omitempty"`
	ISO      int     `json:"iso,omitempty"`
	FNumber  float64 `json:"fnumber,omitempty"`
	Exposure float64 `json:"exposure,omitempty"`
	Focal    float64 `json:"focal,omitempty"`
	Lat      float64 `json:"lat,omitempty"`
	Lon      float64 `json:"lon,omitempty"`
	HasGPS   bool    `json:"gps,omitempty"`
}

// Snapshot is a whole catalog in memory.
type Snapshot struct {
	Header  Header
	Entries []Entry
}

// DirName is the hidden folder every drive carries. Exported for the export
// path, which writes into it directly.
func DirName() string { return dirName }

// Source says which file a read came from.
type Source string

const (
	SourceCurrent Source = fileName
	SourceBackup  Source = bakName
)

// Dir is where the catalog lives for a volume root.
func Dir(root string) string { return filepath.Join(root, dirName) }

// Path is the current catalog file for a volume root.
func Path(root string) string { return filepath.Join(Dir(root), fileName) }

// BackupPath is the previous catalog, kept in case the current one is damaged.
func BackupPath(root string) string { return filepath.Join(Dir(root), bakName) }

// Write saves a snapshot atomically. The previous file is kept as catalog.bak,
// so a yanked drive or a full disk leaves the last good catalog readable.
func Write(root string, snap Snapshot) error {
	dir := Dir(root)
	if strings.TrimSpace(snap.Header.VolumeID) == "" {
		return errors.New("catalog: missing volume id")
	}
	snap.Header.Format = Format
	snap.Header.Version = Version
	snap.Header.Count = len(snap.Entries)
	if snap.Header.Generated.IsZero() {
		snap.Header.Generated = time.Now().UTC()
	}

	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	tmp := filepath.Join(dir, tmpName)
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	ok := false
	defer func() {
		if !ok {
			_ = os.Remove(tmp)
		}
	}()

	gz, err := gzip.NewWriterLevel(f, gzip.BestSpeed)
	if err != nil {
		f.Close()
		return err
	}
	enc := json.NewEncoder(gz)
	if err := enc.Encode(&snap.Header); err != nil {
		gz.Close()
		f.Close()
		return err
	}
	for i := range snap.Entries {
		if err := enc.Encode(&snap.Entries[i]); err != nil {
			gz.Close()
			f.Close()
			return err
		}
	}
	if err := gz.Close(); err != nil {
		f.Close()
		return err
	}
	// Sync before the rename: on a portable drive the rename can reach the
	// directory before the bytes do, and a catalog full of zeroes is worse than
	// no catalog at all.
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}

	cur := filepath.Join(dir, fileName)
	bak := filepath.Join(dir, bakName)
	if _, err := os.Stat(cur); err == nil {
		// Rotate only a catalog that still reads. Promoting a damaged file over
		// catalog.bak would destroy the last good copy at exactly the moment it
		// is needed, so a bad current file is replaced without being kept.
		if _, readErr := readFile(cur); readErr == nil {
			_ = os.Remove(bak)
			if err := os.Rename(cur, bak); err != nil {
				return err
			}
		} else if err := os.Remove(cur); err != nil {
			return err
		}
	}
	if err := os.Rename(tmp, cur); err != nil {
		return err
	}
	ok = true
	return nil
}

// Read loads the catalog, falling back to the backup. The Source tells the
// caller whether the primary file was damaged; that is worth logging but is not
// a failure.
func Read(root string) (Snapshot, Source, error) {
	dir := Dir(root)
	snap, err := readFile(filepath.Join(dir, fileName))
	if err == nil {
		return snap, SourceCurrent, nil
	}
	backup, bakErr := readFile(filepath.Join(dir, bakName))
	if bakErr == nil {
		return backup, SourceBackup, nil
	}
	return Snapshot{}, "", fmt.Errorf("catalog: primary: %v; backup: %v", err, bakErr)
}

// WriteFile saves a snapshot to an arbitrary path, atomically. It is used for
// the computer's local mirror, which is a catalog copy that is not on the drive
// and therefore has no previous version to rotate.
func WriteFile(path string, snap Snapshot) error {
	if strings.TrimSpace(snap.Header.VolumeID) == "" {
		return errors.New("catalog: missing volume id")
	}
	snap.Header.Format = Format
	snap.Header.Version = Version
	snap.Header.Count = len(snap.Entries)
	if snap.Header.Generated.IsZero() {
		snap.Header.Generated = time.Now().UTC()
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	ok := false
	defer func() {
		if !ok {
			_ = os.Remove(tmp)
		}
	}()
	gz, err := gzip.NewWriterLevel(f, gzip.BestSpeed)
	if err != nil {
		f.Close()
		return err
	}
	enc := json.NewEncoder(gz)
	if err := enc.Encode(&snap.Header); err != nil {
		gz.Close()
		f.Close()
		return err
	}
	for i := range snap.Entries {
		if err := enc.Encode(&snap.Entries[i]); err != nil {
			gz.Close()
			f.Close()
			return err
		}
	}
	if err := gz.Close(); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		return err
	}
	ok = true
	return nil
}

// ReadFile loads a catalog from an arbitrary path without a backup fallback.
// The local mirror uses it when the drive itself cannot be read.
func ReadFile(path string) (Snapshot, error) {
	return readFile(path)
}

// VolumeRel maps a slash-separated path inside a library to the
// volume-relative path the catalog stores. It reports false when the path is
// not inside the volume, so a drive that holds a library through a link or a
// junction never gets an entry that cannot be found again.
func VolumeRel(root, libPath, rel string) (string, bool) {
	if strings.TrimSpace(rel) == "" {
		return "", false
	}
	for _, seg := range strings.Split(filepath.ToSlash(rel), "/") {
		if seg == ".." {
			return "", false
		}
	}
	abs := filepath.Join(libPath, filepath.FromSlash(rel))
	r, err := filepath.Rel(root, abs)
	if err != nil || r == "." {
		return "", false
	}
	r = filepath.ToSlash(r)
	if r == ".." || strings.HasPrefix(r, "../") {
		return "", false
	}
	return r, true
}

// HeaderOf reads only the first line of the catalog. Listing drives should not
// pay for decompressing tens of thousands of entries.
func HeaderOf(root string) (Header, Source, error) {
	h, err := readHeader(filepath.Join(Dir(root), fileName))
	if err == nil {
		return h, SourceCurrent, nil
	}
	backup, bakErr := readHeader(filepath.Join(Dir(root), bakName))
	if bakErr == nil {
		return backup, SourceBackup, nil
	}
	return Header{}, "", fmt.Errorf("catalog: primary: %v; backup: %v", err, bakErr)
}

func readHeader(p string) (Header, error) {
	f, err := os.Open(p)
	if err != nil {
		return Header{}, err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return Header{}, err
	}
	defer gz.Close()
	var h Header
	if err := json.NewDecoder(gz).Decode(&h); err != nil {
		return Header{}, err
	}
	if err := validHeader(h); err != nil {
		return Header{}, err
	}
	return h, nil
}

func validHeader(h Header) error {
	if h.Format != Format {
		return fmt.Errorf("not an OCD catalog (format %q)", h.Format)
	}
	if h.Version < 1 {
		return fmt.Errorf("invalid catalog version %d", h.Version)
	}
	if h.Version > Version {
		return fmt.Errorf("catalog version %d is newer than this build (%d)", h.Version, Version)
	}
	if strings.TrimSpace(h.VolumeID) == "" {
		return errors.New("catalog has no volume id")
	}
	return nil
}

func readFile(p string) (Snapshot, error) {
	f, err := os.Open(p)
	if err != nil {
		return Snapshot{}, err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return Snapshot{}, err
	}
	defer gz.Close()

	dec := json.NewDecoder(bufio.NewReaderSize(gz, 1<<20))
	var h Header
	if err := dec.Decode(&h); err != nil {
		return Snapshot{}, err
	}
	if err := validHeader(h); err != nil {
		return Snapshot{}, err
	}

	entries := make([]Entry, 0, h.Count)
	for {
		var e Entry
		err := dec.Decode(&e)
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return Snapshot{}, err
		}
		if err := valid(e); err != nil {
			return Snapshot{}, fmt.Errorf("entry %d: %w", len(entries)+1, err)
		}
		entries = append(entries, e)
	}
	if h.Count != len(entries) {
		return Snapshot{}, fmt.Errorf("header says %d items, found %d", h.Count, len(entries))
	}
	return Snapshot{Header: h, Entries: entries}, nil
}

func valid(e Entry) error {
	if strings.TrimSpace(e.Path) == "" {
		return errors.New("empty path")
	}
	if strings.HasPrefix(e.Path, "/") || strings.HasPrefix(e.Path, `\`) || strings.Contains(e.Path, `\`) {
		return fmt.Errorf("path %q is not slash-relative", e.Path)
	}
	for _, seg := range strings.Split(e.Path, "/") {
		if seg == ".." {
			return fmt.Errorf("path %q escapes the volume", e.Path)
		}
	}
	if e.Size < 0 {
		return fmt.Errorf("path %q has a negative size", e.Path)
	}
	return nil
}
