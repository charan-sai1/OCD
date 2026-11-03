package server

import "testing"

// The browser and the phone both decide whether they can play a file from the
// Content-Type header alone, so an extension that comes back as text/plain or
// application/octet-stream means "this will not play".
func TestVideoExtensionsGetAPlayableContentType(t *testing.T) {
	cases := map[string]string{
		".mov":  "video/quicktime",
		".MOV":  "video/quicktime",
		".mp4":  "video/mp4",
		".m4v":  "video/mp4",
		".webm": "video/webm",
		".jpg":  "image/jpeg",
	}
	for ext, want := range cases {
		if got := contentType(ext); got != want {
			t.Errorf("contentType(%q) = %q, want %q", ext, got, want)
		}
	}
}
