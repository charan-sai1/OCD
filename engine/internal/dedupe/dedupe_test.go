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

// Duplicates must land directly in the chosen folder, keeping only their own
// file name - no drive letter, no copy of the original folder structure.
func TestQuarantineFlattensIntoFolder(t *testing.T) {
	tmp := t.TempDir()
	root := filepath.Join(tmp, "src")
	quar := filepath.Join(tmp, "q")
	keep := filepath.Join(root, "a.jpg")
	dup := filepath.Join(root, "deep", "deeper", "a.jpg")
	write(t, keep, "keeper")
	write(t, dup, "duplicate")

	groups := []Group{{Hash: "h", Files: []File{
		{Path: keep, Root: root, Size: 6},
		{Path: dup, Root: root, Size: 9},
	}}}

	res, err := Quarantine(groups, QuarantineOptions{QuarantineDir: quar})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Errors) != 0 {
		t.Fatalf("unexpected errors: %v", res.Errors)
	}
	if len(res.Moved) != 1 {
		t.Fatalf("moved = %d, want 1", len(res.Moved))
	}
	want := filepath.Join(quar, "a.jpg")
	if !samePath(res.Moved[0].To, want) {
		t.Fatalf("destination = %q, want %q", res.Moved[0].To, want)
	}
	if !exists(want) {
		t.Fatalf("file not in quarantine: %s", want)
	}
	if !exists(keep) {
		t.Fatalf("keeper was touched: %s", keep)
	}
	if exists(dup) {
		t.Fatalf("duplicate still at its original path: %s", dup)
	}
	if res.Freed != 9 {
		t.Fatalf("freed = %d, want 9", res.Freed)
	}
}

// A quarantine folder that sits above the scanned root used to rebuild the
// source path exactly ("F:\test" + "sub\a.jpg" = the original file), so the
// "move" renamed a file next to itself and still reported the bytes as freed.
func TestQuarantineAboveRootStillMoves(t *testing.T) {
	tmp := t.TempDir()
	root := filepath.Join(tmp, "test")
	keep := filepath.Join(root, "a.jpg")
	dup := filepath.Join(root, "sub", "a.jpg")
	write(t, keep, "keeper")
	write(t, dup, "duplicate")

	groups := []Group{{Hash: "h", Files: []File{
		{Path: keep, Root: root, Size: 6},
		{Path: dup, Root: root, Size: 9},
	}}}

	// The quarantine folder is the parent of the scanned root: the case that
	// silently did nothing before.
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
	if exists(dup) {
		t.Fatalf("duplicate still at its original path: %s", dup)
	}
	if !exists(filepath.Join(tmp, "a.jpg")) {
		t.Fatalf("duplicate did not land in the quarantine folder")
	}
}

// Two copies with the same name must not overwrite each other.
func TestQuarantineResolvesNameClashes(t *testing.T) {
	tmp := t.TempDir()
	root := filepath.Join(tmp, "src")
	quar := filepath.Join(tmp, "q")
	keep := filepath.Join(root, "a.jpg")
	one := filepath.Join(root, "one", "a.jpg")
	two := filepath.Join(root, "two", "a.jpg")
	for _, p := range []string{keep, one, two} {
		write(t, p, "same bytes")
	}

	groups := []Group{{Hash: "h", Files: []File{
		{Path: keep, Root: root},
		{Path: one, Root: root},
		{Path: two, Root: root},
	}}}

	res, err := Quarantine(groups, QuarantineOptions{QuarantineDir: quar})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Moved) != 2 {
		t.Fatalf("moved = %d, want 2 (errors: %v)", len(res.Moved), res.Errors)
	}
	for _, want := range []string{"a.jpg", "a (1).jpg"} {
		if !exists(filepath.Join(quar, want)) {
			t.Fatalf("missing %s in quarantine (moved: %v)", want, res.Moved)
		}
	}
}

// If the quarantine folder is the very folder a copy already lives in, the
// move is meaningless and must be reported, not silently mangled.
func TestQuarantineIntoItsOwnFolderIsRefused(t *testing.T) {
	tmp := t.TempDir()
	root := filepath.Join(tmp, "src")
	keep := filepath.Join(root, "a.jpg")
	dup := filepath.Join(root, "a (1).jpg")
	write(t, keep, "keeper")
	write(t, dup, "duplicate")

	groups := []Group{{Hash: "h", Files: []File{
		{Path: keep, Root: root},
		{Path: dup, Root: root},
	}}}
	// Quarantine is the folder the duplicate already sits in.
	res, err := Quarantine(groups, QuarantineOptions{QuarantineDir: root})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Moved) != 0 {
		t.Fatalf("moved = %d, want 0", len(res.Moved))
	}
	if len(res.Errors) == 0 {
		t.Fatal("expected an error explaining the folder is already the quarantine folder")
	}
	if !exists(dup) {
		t.Fatalf("file disappeared: %s", dup)
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

// A dry run must not touch the disk and must name the same destinations the
// real move uses.
func TestQuarantineDryRunMatchesReal(t *testing.T) {
	tmp := t.TempDir()
	root := filepath.Join(tmp, "test")
	quar := filepath.Join(tmp, "q")
	keep := filepath.Join(root, "a.jpg")
	dup := filepath.Join(root, "sub", "a.jpg")
	write(t, keep, "keeper")
	write(t, dup, "duplicate")

	groups := []Group{{Hash: "h", Files: []File{
		{Path: keep, Root: root},
		{Path: dup, Root: root},
	}}}

	dry, err := Quarantine(groups, QuarantineOptions{QuarantineDir: quar, DryRun: true})
	if err != nil {
		t.Fatal(err)
	}
	if !exists(dup) {
		t.Fatal("dry run moved the file")
	}
	if !exists(keep) {
		t.Fatal("dry run touched the keeper")
	}

	real, err := Quarantine(groups, QuarantineOptions{QuarantineDir: quar})
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
