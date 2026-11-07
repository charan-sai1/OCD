package catalog

import (
	"path/filepath"
	"testing"
)

// The phone writes catalogs itself, using its own gzip encoder. This fixture
// was produced by that encoder, so the test fails if the reader ever grows a
// requirement the phone does not satisfy.
func TestReadCatalogWrittenByPhone(t *testing.T) {
	snap, src, err := Read(filepath.Join("testdata", "phone"))
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if src != SourceCurrent {
		t.Fatalf("source = %q, want the primary catalog", src)
	}
	if snap.Header.VolumeID != "win:6EC7679B" {
		t.Errorf("volume = %q", snap.Header.VolumeID)
	}
	if snap.Header.Label != "Charan" {
		t.Errorf("label = %q", snap.Header.Label)
	}
	if snap.Header.Count != 2 || len(snap.Entries) != 2 {
		t.Fatalf("count = %d, entries = %d", snap.Header.Count, len(snap.Entries))
	}
	if got := snap.Entries[0]; got.Path != "Photos/2024/a.jpg" || got.Size != 123456 ||
		got.MTime != 1712345678 || got.ShotAt != 1700000000 ||
		got.Width != 5712 || got.Height != 4284 {
		t.Errorf("first entry = %+v", got)
	}
	if got := snap.Entries[1]; got.Path != "Clips/b.MOV" || got.Kind != "video" ||
		got.Duration != 12.5 || got.ShotAt != 1712345000 {
		t.Errorf("second entry = %+v", got)
	}
}

// Preview names are hashed from the catalog's own fields, and the phone
// computes the same names. These values are the contract between the two.
func TestPhonePreviewNames(t *testing.T) {
	want := map[string]string{
		"Photos/2024/a.jpg": "thumbs/1bdcb1833287f0b8.jpg",
		"Clips/b.MOV":       "thumbs/b4f2ee536b6c5551.jpg",
	}
	got := map[string]string{
		"Photos/2024/a.jpg": ThumbName("win:6EC7679B", "Photos/2024/a.jpg", 123456, 1712345678),
		"Clips/b.MOV":       ThumbName("win:6EC7679B", "Clips/b.MOV", 987654321, 1712345999),
	}
	for path, name := range want {
		if got[path] != name {
			t.Errorf("%s: got %q, want %q", path, got[path], name)
		}
	}
}
