package media

import "testing"

// The phone plays what the server labels. A .mov comes back as video/quicktime
// and a .mp4 as video/mp4; if either is mislabelled the player refuses the file
// before it ever reads a byte.
func TestVideoTypesAreLabelledForThePlayer(t *testing.T) {
	cases := map[string]Kind{
		".mov":  KindVideo,
		".MOV":  KindVideo,
		".mp4":  KindVideo,
		".m4v":  KindVideo,
		".webm": KindVideo,
		".JPG":  KindImage,
		".txt":  KindOther,
	}
	for ext, want := range cases {
		if got := KindOf(ext); got != want {
			t.Errorf("KindOf(%q) = %q, want %q", ext, got, want)
		}
	}
}
