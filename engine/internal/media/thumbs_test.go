package media

import (
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
