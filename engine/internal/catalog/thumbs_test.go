package catalog

import (
	"path/filepath"
	"strings"
	"testing"
)

// TestThumbNameIsStable pins the preview name to the exact value the phone
// computes in TypeScript. If either side changes its hash, phones stop finding
// previews on the drive, so the expected string is deliberately literal.
func TestThumbNameIsStable(t *testing.T) {
	got := ThumbName("win:ABC", "Photos/2024/a.mov", 123456789, 1712345678)
	want := "thumbs/dbedc4dfe1ab3b52.jpg"
	if got != want {
		t.Fatalf("ThumbName = %q, want %q", got, want)
	}
}

func TestThumbPathJoinsVolumeRoot(t *testing.T) {
	root := filepath.Join("D:", "drive")
	got := ThumbPath(root, "win:ABC", "Photos/a.jpg", 5, 6)
	if dir := filepath.Dir(got); dir != filepath.Join(root, ".ocd", "thumbs") {
		t.Fatalf("ThumbPath dir = %q", dir)
	}
	if !strings.HasSuffix(got, ".jpg") {
		t.Fatalf("ThumbPath = %q, want a .jpg", got)
	}
}

func TestThumbRelAcceptsFlatAndNested(t *testing.T) {
	for _, in := range []string{"dbedc4dfe1ab3b52.jpg", "thumbs/dbedc4dfe1ab3b52.jpg"} {
		h, ok := ThumbRel(in)
		if !ok || h != "dbedc4dfe1ab3b52" {
			t.Fatalf("ThumbRel(%q) = %q, %v", in, h, ok)
		}
	}
	if _, ok := ThumbRel("catalog.gz"); ok {
		t.Fatal("ThumbRel accepted a non-preview")
	}
}
