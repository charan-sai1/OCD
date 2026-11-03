//go:build windows

package media

import (
	"os"
	"testing"
)

// The HEIC a phone backs up has to become a picture. This asks the real
// Windows decoder for one; on a machine without HEVC support it is skipped
// rather than failed, because that is a missing Windows component and not a
// mistake in this code.
func TestWindowsCanPreviewARealHEIC(t *testing.T) {
	const sample = `E:\Phone\2026\11\IMG_0402.HEIC`
	if _, err := os.Stat(sample); err != nil {
		t.Skip("no sample HEIC on this machine")
	}
	raw, w, h, err := shellThumbnail(sample, 512)
	if err != nil {
		t.Skipf("Windows has no HEVC decoder here: %v", err)
	}
	if w <= 0 || h <= 0 {
		t.Fatalf("the decoder returned a %dx%d picture", w, h)
	}
	if len(raw) < w*h*4 {
		t.Fatalf("the decoder returned %d bytes for a %dx%d picture", len(raw), w, h)
	}
	if w > 512 || h > 512 {
		t.Errorf("the picture is larger than asked for: %dx%d", w, h)
	}
	// A blank picture means the pixels were not really read.
	var lit int
	for i := 0; i+3 < len(raw); i += 4 {
		if raw[i] > 8 || raw[i+1] > 8 || raw[i+2] > 8 {
			lit++
		}
	}
	if lit < len(raw)/16 {
		t.Errorf("only %d of %d pixels are not black", lit, len(raw)/4)
	}
}
