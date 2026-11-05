// Package volume identifies a disk independently of the drive letter it is
// mounted under. A catalog keyed by volume id survives the drive coming back as
// F: instead of E:, which is the point of keeping the catalog on the disk.
package volume

import (
	"crypto/rand"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Info describes the volume a path lives on.
type Info struct {
	ID     string `json:"id"`
	Label  string `json:"label,omitempty"`
	Root   string `json:"root"`
	Native bool   `json:"native"`
}

// ErrNoVolume is returned for a path that does not sit on a mountable volume.
var ErrNoVolume = errors.New("volume: cannot determine the volume for this path")

// Of resolves the volume containing p. It prefers the filesystem's own serial
// number and falls back to a uuid file written into <root>/.ocd, which is
// stable on drives and shares that do not expose one.
func Of(p string) (Info, error) {
	root := RootOf(p)
	if root == "" {
		return Info{}, ErrNoVolume
	}
	// A drive indexed on a phone carries its identity in .ocd/volume.json.
	// Honour it before asking the platform, so the phone and the PC derive one
	// id for the drive instead of two, which would split its preview names.
	if id, ok := readFallback(filepath.Join(root, fallbackDir, "volume.json")); ok {
		return Info{ID: id, Label: fallbackLabel(root), Root: root}, nil
	}
	if id, label, err := nativeID(root); err == nil && id != "" {
		return Info{ID: id, Label: label, Root: root, Native: true}, nil
	}
	id, err := fallbackID(root)
	if err != nil {
		return Info{}, err
	}
	return Info{ID: id, Label: fallbackLabel(root), Root: root}, nil
}

// RootOf returns the mount point that contains p. A drive path such as
// E:\Photos\2024 returns E:\, and a network share returns its share root.
func RootOf(p string) string {
	if strings.TrimSpace(p) == "" {
		return ""
	}
	if abs, err := filepath.Abs(p); err == nil {
		p = abs
	}
	vol := filepath.VolumeName(p)
	if vol == "" {
		return string(filepath.Separator)
	}
	return vol + string(filepath.Separator)
}

// fallbackID keeps a small identity file on the volume itself. If the volume is
// read-only (or gone) it derives an id from the mount path, which is stable for
// this session but not across a drive-letter change. That is the honest limit
// of a read-only disk.
func fallbackID(root string) (string, error) {
	dir := filepath.Join(root, fallbackDir)
	file := filepath.Join(dir, "volume.json")
	if id, ok := readFallback(file); ok {
		return id, nil
	}
	id, err := randomID()
	if err != nil {
		return pathID(root), nil
	}
	b, _ := json.MarshalIndent(map[string]string{
		"id":      id,
		"created": time.Now().UTC().Format(time.RFC3339),
	}, "", "  ")
	wrote := false
	if err := os.MkdirAll(dir, 0o755); err == nil {
		tmp := file + ".tmp"
		if err := os.WriteFile(tmp, b, 0o644); err == nil {
			wrote = os.Rename(tmp, file) == nil
		}
	}
	if wrote {
		// Another process may have won the race; read back what is on disk.
		if id, ok := readFallback(file); ok {
			return id, nil
		}
	}
	return pathID(root), nil
}

func readFallback(file string) (string, bool) {
	b, err := os.ReadFile(file)
	if err != nil {
		return "", false
	}
	var f struct {
		ID string `json:"id"`
	}
	if json.Unmarshal(b, &f) != nil {
		return "", false
	}
	if !strings.HasPrefix(f.ID, "vol_") || len(f.ID) != len("vol_")+16 {
		return "", false
	}
	return f.ID, true
}

func randomID() (string, error) {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return "vol_" + hex.EncodeToString(b[:]), nil
}

func pathID(root string) string {
	h := sha1.Sum([]byte(strings.ToLower(filepath.Clean(root))))
	return "path:" + hex.EncodeToString(h[:])[:12]
}

func fallbackLabel(root string) string {
	clean := strings.TrimRight(root, `/\`)
	if clean == "" {
		return root
	}
	if base := filepath.Base(clean); base != "." && base != string(filepath.Separator) {
		return base
	}
	return clean
}

// fallbackDir is the same directory the catalog lives in, so a drive carries
// both its identity and its index in one place.
const fallbackDir = ".ocd"

func (i Info) String() string {
	return fmt.Sprintf("%s (%s)", i.ID, i.Root)
}
