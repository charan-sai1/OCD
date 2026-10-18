package dedupe

import (
	"os"
	"path/filepath"
	"testing"
)

func write(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// A quarantine folder that sits above the scanned root used to rebuild the
// source path exactly ("F:\test" + "sub\a.jpg" = the original file), so the
// "move" renamed a file next to itself, left it in place, and still counted it
// as moved and freed. The volume name is now kept as a path component, so the
// destination can never collide with the source.
func TestQuarantineNeverLandsOnSource(t *testing.T) {
	tmp := t.TempDir()
	root := filepath.Join(tmp, "test")
	keep := filepath.Join(root, "a.jpg")
	dup := filepath.Join(root, "sub", "a.jpg")
	write(t, keep, "keeper")
	write(t, dup, "duplicate")

	groups := []Group{{
		Hash: "h",
		Size: 9,
		Files: []File{
			{Path: keep, Root: root, Size: 6},
			{Path: dup, Root: root, Size: 9},
		},
	}}

	// Quarantine is the parent of the scanned root: the exact case that broke.
	res, err := Quarantine(groups, QuarantineOptions{QuarantineDir: tmp})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Errors) != 0 {
		t.Fatalf("unexpected errors: %v", res.Errors)
	}
	if len(res.Moved) != 1 {
		t.Fatalf("moved = %d, want 1", len(res.Moved))
	}
	moved := res.Moved[0]

	if !exists(keep) {
		t.Fatalf("keeper was touched: %s", keep)
	}
	if exists(dup) {
		t.Fatalf("duplicate still at its original path: %s", dup)
	}
	if moved.To == dup {
		t.Fatalf("destination equals the source: %s", moved.To)
	}
	if rel, err := filepath.Rel(tmp, moved.To); err != nil || rel == moved.To {
		t.Fatalf("destination is not underneath the quarantine folder: %s", moved.To)
	}
	if !exists(moved.To) {
		t.Fatalf("destination does not exist: %s", moved.To)
	}
	if res.Freed != 9 {
		t.Fatalf("freed = %d, want 9", res.Freed)
	}
}

// A destination that resolves back onto the source must be reported as an
// error, never counted as a move.
func TestMoveFileRefusesSelf(t *testing.T) {
	tmp := t.TempDir()
	f := filepath.Join(tmp, "a.jpg")
	write(t, f, "x")

	if _, err := moveFile(f, f); err == nil {
		t.Fatal("moveFile onto itself should fail")
	}
	if !exists(f) {
		t.Fatal("file disappeared")
	}
}

// A dry run must not touch the disk and must report the same destination the
// real move would use.
func TestQuarantineDryRunIsInert(t *testing.T) {
	tmp := t.TempDir()
	root := filepath.Join(tmp, "test")
	keep := filepath.Join(root, "a.jpg")
	dup := filepath.Join(root, "sub", "a.jpg")
	write(t, keep, "keeper")
	write(t, dup, "duplicate")

	groups := []Group{{Hash: "h", Files: []File{
		{Path: keep, Root: root},
		{Path: dup, Root: root},
	}}}

	dry, err := Quarantine(groups, QuarantineOptions{QuarantineDir: tmp, DryRun: true})
	if err != nil {
		t.Fatal(err)
	}
	if !exists(dup) {
		t.Fatal("dry run moved the file")
	}

	real, err := Quarantine(groups, QuarantineOptions{QuarantineDir: tmp})
	if err != nil {
		t.Fatal(err)
	}
	if len(dry.Moved) != 1 || len(real.Moved) != 1 {
		t.Fatalf("dry moved = %d, real moved = %d", len(dry.Moved), len(real.Moved))
	}
	if dry.Moved[0].To != real.Moved[0].To {
		t.Fatalf("dry destination %q != real destination %q", dry.Moved[0].To, real.Moved[0].To)
	}
}
