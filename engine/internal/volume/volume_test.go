package volume

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestRootOf(t *testing.T) {
	root := RootOf(t.TempDir())
	if root == "" {
		t.Fatal("empty root")
	}
	if runtime.GOOS == "windows" {
		if !strings.HasSuffix(root, `\`) || len(root) != 3 {
			t.Fatalf("root = %q, want a drive root like E:\\", root)
		}
	} else if root != "/" {
		t.Fatalf("root = %q, want /", root)
	}
}

func TestFallbackIsStable(t *testing.T) {
	dir := t.TempDir()
	first, err := fallbackID(dir)
	if err != nil {
		t.Fatalf("first: %v", err)
	}
	if !strings.HasPrefix(first, "vol_") {
		t.Fatalf("id = %q, want a vol_ id", first)
	}
	if _, err := os.Stat(filepath.Join(dir, fallbackDir, "volume.json")); err != nil {
		t.Fatalf("identity file was not written: %v", err)
	}
	second, err := fallbackID(dir)
	if err != nil {
		t.Fatalf("second: %v", err)
	}
	if first != second {
		t.Fatalf("id changed between calls: %q then %q", first, second)
	}
}

func TestFallbackRejectsGarbage(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, fallbackDir), 0o755); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(dir, fallbackDir, "volume.json")
	if err := os.WriteFile(file, []byte(`{"id":"not-a-volume"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	id, err := fallbackID(dir)
	if err != nil {
		t.Fatal(err)
	}
	if strings.HasPrefix(id, "path:") {
		t.Fatalf("id = %q, a garbage file should have been replaced", id)
	}
}

func TestOf(t *testing.T) {
	info, err := Of(t.TempDir())
	if err != nil {
		t.Fatalf("of: %v", err)
	}
	if info.ID == "" || info.Root == "" {
		t.Fatalf("info = %+v", info)
	}
	if runtime.GOOS == "windows" {
		if !strings.HasPrefix(info.ID, "win:") || !info.Native {
			t.Fatalf("windows volume = %+v, want a native serial", info)
		}
	}
}

func TestOfMissingDriveUsesPathID(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("drive letter paths are a Windows concept")
	}
	info, err := Of(`Z:\`)
	if err != nil {
		t.Fatalf("of: %v", err)
	}
	if !strings.HasPrefix(info.ID, "path:") {
		t.Fatalf("id = %q, want a path fallback for a missing drive", info.ID)
	}
}
