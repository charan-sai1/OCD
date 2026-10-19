package server

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func writeFile(t *testing.T, path string, size int, when time.Time) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, make([]byte, size), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(path, when, when); err != nil {
		t.Fatal(err)
	}
}

// Copying a folder into itself would make the copies look like fresh arrivals
// and import them again, forever, so the guard that refuses it is worth pinning
// down.
func TestFolderAndDriveCannotSitInsideEachOther(t *testing.T) {
	base := filepath.Join(t.TempDir(), "drive")
	inbox := filepath.Join(base, "Phone")
	sep := string(filepath.Separator)

	cases := []struct {
		name          string
		parent, child string
		want          bool
	}{
		{"the same folder", inbox, inbox, true},
		{"the drive sits under the inbox", inbox, filepath.Join(inbox, "Photos"), true},
		{"the inbox sits under the drive", base, inbox, true},
		{"a trailing separator still counts", inbox + sep, inbox, true},
		{"siblings are fine", filepath.Join(base, "A"), filepath.Join(base, "B"), false},
		{"a shared name prefix is not a parent", base, base + "2", false},
		{"nothing chosen is never inside anything", "", inbox, false},
		{"and neither is the other way round", inbox, "", false},
	}
	for _, c := range cases {
		if got := sameOrInside(c.parent, c.child); got != c.want {
			t.Errorf("%s: sameOrInside(%q, %q) = %v, want %v",
				c.name, c.parent, c.child, got, c.want)
		}
	}
}

// An empty choice means "not set yet". Reading it as a path would make it the
// current folder, which is a real folder that could then be imported from.
func TestAnEmptyChoiceDoesNotBecomeTheCurrentFolder(t *testing.T) {
	empty := ""
	blank := "   "
	if got := cleanPath(&empty); got != "" {
		t.Errorf("cleanPath(\"\") = %q, want empty", got)
	}
	if got := cleanPath(&blank); got != "" {
		t.Errorf("cleanPath(\"   \") = %q, want empty", got)
	}
	if got := cleanPath(nil); got != "" {
		t.Errorf("cleanPath(nil) = %q, want empty", got)
	}
	messy := filepath.Join(t.TempDir(), "a", "..", "b")
	if got, want := cleanPath(&messy), filepath.Join(filepath.Dir(messy), "b"); got != want {
		t.Errorf("cleanPath(%q) = %q, want %q", messy, got, want)
	}
}

// The number on the button has to be the number of files that actually move, so
// the count applies the same filter the import does.
func TestInboxCountsOnlyTheFilesTheImportWouldMove(t *testing.T) {
	box := t.TempDir()
	old := time.Date(2026, 1, 1, 9, 0, 0, 0, time.Local)
	newer := old.Add(time.Hour)

	writeFile(t, filepath.Join(box, "a.jpg"), 10, old)
	writeFile(t, filepath.Join(box, "sub", "b.mp4"), 20, newer)
	writeFile(t, filepath.Join(box, "notes.txt"), 5, newer)         // not a photo
	writeFile(t, filepath.Join(box, "Thumbs.db"), 5, newer)         // junk, and not a photo
	writeFile(t, filepath.Join(box, ".hidden", "c.jpg"), 10, newer) // hidden folder
	writeFile(t, filepath.Join(box, ".DS_Store"), 5, newer)         // junk file
	writeFile(t, filepath.Join(box, "nested", "deep", "d.png"), 3, old)

	got := countInbox(box)
	if !got.Ready {
		t.Fatalf("a real folder should be ready, got note %q", got.Note)
	}
	if got.Count != 3 {
		t.Errorf("counted %d files, want 3 (a.jpg, b.mp4, d.png)", got.Count)
	}
	if got.Bytes != 33 {
		t.Errorf("counted %d bytes, want 33", got.Bytes)
	}
	if got.Newest != "b.mp4" {
		t.Errorf("newest is %q, want b.mp4", got.Newest)
	}
	if got.Human == "" {
		t.Error("the size should have a readable form too")
	}
}

// A folder that is not there yet is a normal state — the user may not have
// chosen one, or the phone may be off — and must say so rather than report zero
// files as if that were good news.
func TestInboxSaysWhenItHasNothingToLookAt(t *testing.T) {
	if got := countInbox(""); got.Ready || got.Note == "" {
		t.Errorf("no folder chosen: got ready=%v note=%q", got.Ready, got.Note)
	}
	missing := filepath.Join(t.TempDir(), "not-here")
	if got := countInbox(missing); got.Ready || got.Note == "" {
		t.Errorf("a missing folder: got ready=%v note=%q", got.Ready, got.Note)
	}
}
