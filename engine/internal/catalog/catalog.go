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
	Live     string  `json:"live,omitempty"`
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
		_ = os.Remove(bak)
		if err := os.Rename(cur, bak); err != nil {
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
