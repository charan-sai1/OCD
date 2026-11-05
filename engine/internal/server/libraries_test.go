package server

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"ocd/internal/volume"
)

// A drive that comes back under a new letter must find its library again,
// rather than waiting for a human to re-add it and losing every item key.
func TestRemapPointsLibraryAtAnotherLetter(t *testing.T) {
	oldRoot := t.TempDir() // library was saved on this root
	newRoot := t.TempDir() // the same volume, mounted elsewhere now
	if err := os.MkdirAll(filepath.Join(newRoot, "Photos"), 0o755); err != nil {
		t.Fatal(err)
	}

	lib := filepath.Join(oldRoot, "Photos")
	st := &libraryStore{
		file: filepath.Join(t.TempDir(), "libraries.json"),
		items: []Library{{
			ID:        "lib",
			Name:      "Photos",
			Path:      lib, // not reachable: the old root is gone
			VolumeID: "win:0000DEAD",
			Rel:       "Photos",
		}},
	}

	oldVolumeOf := volumeOfPath
	defer func() { volumeOfPath = oldVolumeOf }()
	volumeOfPath = func(p string) (volume.Info, error) {
		if p == newRoot {
			return volume.Info{ID: "win:0000DEAD", Root: newRoot, Label: "New Root"}, nil
		}
		return volume.Info{}, errors.New("unknown volume")
	}

	st.remapLocked([]string{newRoot})

	got := st.items[0].Path
	want := filepath.Join(newRoot, "Photos")
	if got != want {
		t.Fatalf("library path = %q, want %q", got, want)
	}
}

// Legacy libraries carry no volume identity yet; once they are reachable
// again, remap backfills it so a later letter change can be survived.
func TestRemapBackfillsVolumeIdentity(t *testing.T) {
	root := t.TempDir()
	libDir := filepath.Join(root, "Photos")
	if err := os.MkdirAll(libDir, 0o755); err != nil {
		t.Fatal(err)
	}
	st := &libraryStore{
		file: filepath.Join(t.TempDir(), "libraries.json"),
		items: []Library{{
			ID:   "lib",
			Name: "Photos",
			Path: libDir,
		}},
	}

	oldVolumeOf := volumeOfPath
	defer func() { volumeOfPath = oldVolumeOf }()
	volumeOfPath = func(p string) (volume.Info, error) {
		if p == libDir {
			return volume.Info{ID: "win:0000BEEF", Root: root, Label: "Root"}, nil
		}
		return volume.Info{}, errors.New("unknown volume")
	}

	st.remapLocked([]string{root})

	got := st.items[0]
	if got.VolumeID != "win:0000BEEF" {
		t.Fatalf("volume id = %q, want win:0000BEEF", got.VolumeID)
	}
	if got.Rel != "Photos" {
		t.Fatalf("rel = %q, want %q", got.Rel, "Photos")
	}
}
