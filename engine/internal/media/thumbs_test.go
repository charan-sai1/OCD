package media

import (
	"image"
	"image/jpeg"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// Thumbnails are generated into a file ending in ".tmp", and ffmpeg refuses to
// write there unless the output format is named: without it every video on the
// phone shows an empty tile while the command itself is correct.
func TestThePreviewCommandNamesItsOutputFormat(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "clip.mov")
	if err := os.WriteFile(src, make([]byte, 1024), 0o644); err != nil {
		t.Fatal(err)
	}
	out := filepath.Join(dir, "thumb.jpg.1234.tmp")

	th := NewThumbs(t.TempDir(), func() string { return "ffmpeg" })
	var got []string
	th.runFFmpeg = func(_ string, args ...string) ([]byte, error) {
		got = append([]string(nil), args...)
		return []byte("ffmpeg: not really"), nil
	}

	_ = th.ffmpegPreview(src, out, 400, true)

	if len(got) == 0 {
		t.Fatal("ffmpeg was never invoked")
	}
	joined := strings.Join(got, " ")
	if !strings.Contains(joined, "-f image2") {
		t.Errorf("the output format is unnamed, so a .tmp destination fails: %s", joined)
	}
	if !strings.Contains(joined, out) {
		t.Errorf("the preview was not written to the requested path: %s", joined)
	}
}

// The seek positions matter: a video's first frame is often black, so the
// second attempt asks for the first second instead.
func TestAVideoPreviewTriesPastTheFirstFrame(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "clip.mov")
	if err := os.WriteFile(src, make([]byte, 1024), 0o644); err != nil {
		t.Fatal(err)
	}
	th := NewThumbs(t.TempDir(), func() string { return "ffmpeg" })
	var seeks []string
	th.runFFmpeg = func(_ string, args ...string) ([]byte, error) {
		for i, a := range args {
			if a == "-ss" && i+1 < len(args) {
				seeks = append(seeks, args[i+1])
			}
		}
		return nil, exec.ErrNotFound // every attempt fails; record what it asked for
	}

	_ = th.ffmpegPreview(filepath.Join(dir, "clip.mov"), filepath.Join(dir, "o.tmp"), 400, true)

	if len(seeks) < 2 || seeks[0] == "0" {
		t.Errorf("a video preview only tried %v; the first frame is often black", seeks)
	}
}

func solidJPEG(t *testing.T, path string, r, g, b uint8, w, h int) {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.PixOffset(x, y)
			off := img.PixOffset(x, y)
			img.Pix[off+0] = r
			img.Pix[off+1] = g
			img.Pix[off+2] = b
			img.Pix[off+3] = 255
		}
	}
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if err := jpeg.Encode(f, img, &jpeg.Options{Quality: 85}); err != nil {
		t.Fatal(err)
	}
}

func colorLike(r, g, b uint8) colorRGBA {
	return colorRGBA{r, g, b, 255}
}

// colorRGBA mirrors image/color.RGBA without importing the color package into
// the test body for readability of the cases below.
type colorRGBA struct{ R, G, B, A uint8 }

func (c colorRGBA) RGBA() (r, g, b, a uint32) {
	r = uint32(c.R)
	r |= r << 8
	g = uint32(c.G)
	g |= g << 8
	b = uint32(c.B)
	b |= b << 8
	a = uint32(c.A)
	a |= a << 8
	return
}

// A near-black first frame is a miss, not a tile: the next seek must win.
func TestFrameUsableRejectsBlack(t *testing.T) {
	dir := t.TempDir()
	black := filepath.Join(dir, "black.jpg")
	solidJPEG(t, black, 0, 0, 0, 64, 64)
	if frameUsable(black) {
		t.Fatal("a black frame was accepted as a thumbnail")
	}
	bright := filepath.Join(dir, "bright.jpg")
	solidJPEG(t, bright, 240, 200, 180, 64, 64)
	if !frameUsable(bright) {
		t.Fatal("a bright frame was rejected")
	}
}

// The seek must clear the black opening card of long exports before falling
// back, and the cached tile must be a real picture.
func TestVideoPreviewSkipsBlackFrames(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "clip.mov")
	if err := os.WriteFile(src, make([]byte, 1024), 0o644); err != nil {
		t.Fatal(err)
	}
	black := filepath.Join(dir, "black.jpg")
	solidJPEG(t, black, 0, 0, 0, 80, 45)
	real := filepath.Join(dir, "real.jpg")
	solidJPEG(t, real, 200, 170, 60, 80, 45)

	th := NewThumbs(t.TempDir(), func() string { return "ffmpeg" })
	th.probe = func(string) (float64, error) { return 100, nil }
	th.runFFmpeg = func(_ string, args ...string) ([]byte, error) {
		seek := ""
		for i, a := range args {
			if a == "-ss" && i+1 < len(args) {
				seek = args[i+1]
			}
		}
		out := args[len(args)-1]
		// First two seeks land on the black card; the third is real.
		if seek == "100" || seek == "50.00" || seek == "25.00" {
			if err := copyFile(black, out); err != nil {
				return nil, err
			}
		} else {
			if err := copyFile(real, out); err != nil {
				return nil, err
			}
		}
		return nil, nil
	}
	out := filepath.Join(dir, "thumb.jpg.1.tmp")
	if err := th.ffmpegPreview(src, out, 400, true); err != nil {
		t.Fatalf("preview failed: %v", err)
	}
	if !frameUsable(out) {
		t.Fatal("the preview that survived is still black")
	}
}

func copyFile(src, dst string) error {
	b, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return os.WriteFile(dst, b, 0o644)
}

var _ = math.Pi
