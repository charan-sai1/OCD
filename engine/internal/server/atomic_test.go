package server

import (
	"os"
	"path/filepath"
	"testing"
)

// A settings file must survive being replaced: the new bytes are what a reader
// sees, and no temporary file is left behind to confuse the next load.
func TestWriteFileAtomicReplacesContent(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "libraries.json")

	if err := writeFileAtomic(path, []byte("first"), 0o644); err != nil {
		t.Fatalf("first write: %v", err)
	}
	if err := writeFileAtomic(path, []byte("second"), 0o644); err != nil {
		t.Fatalf("second write: %v", err)
	}

	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if string(got) != "second" {
		t.Errorf("content = %q, want %q", got, "second")
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read dir: %v", err)
	}
	if len(entries) != 1 || entries[0].Name() != "libraries.json" {
		names := make([]string, 0, len(entries))
		for _, e := range entries {
			names = append(names, e.Name())
		}
		t.Errorf("leftover files in %s: %v", dir, names)
	}
}

// The helper creates the folder it needs, so a first save into a data directory
// that does not exist yet still works.
func TestWriteFileAtomicCreatesFolder(t *testing.T) {
	path := filepath.Join(t.TempDir(), "engine-data", "phone.json")
	if err := writeFileAtomic(path, []byte("{}"), 0o600); err != nil {
		t.Fatalf("write into missing folder: %v", err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Errorf("file was not created: %v", err)
	}
}
