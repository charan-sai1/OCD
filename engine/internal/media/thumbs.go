package media

import (
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"image"
	"image/jpeg"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"sync"

	_ "image/gif"
	_ "image/png"
)

// Thumbs generates and caches small JPEG previews beside the index. A preview
// is created once and then served straight from disk, so the grid never waits
// on a slow drive twice for the same picture.
//
// Formats Go can decode natively (JPEG, PNG, GIF) are handled in process. When
// ffmpeg is installed it also covers videos and formats like HEIC.
type Thumbs struct {
	dir    string
	ffmpeg func() string

	mu   sync.Mutex
	busy map[string]chan struct{}
}

// NewThumbs prepares a cache rooted at dir.
func NewThumbs(dir string, ffmpeg func() string) *Thumbs {
	return &Thumbs{dir: dir, ffmpeg: ffmpeg, busy: map[string]chan struct{}{}}
}

func thumbKey(src string, size, mtime int64, maxDim int) string {
	h := sha1.Sum([]byte(fmt.Sprintf("%s\x00%d\x00%d\x00%d", src, size, mtime, maxDim)))
	s := hex.EncodeToString(h[:])
	return s[:2] + "/" + s[2:4] + "/" + s[4:]
}

// Path is where a thumbnail for src would live.
func (t *Thumbs) Path(src string, maxDim int) (string, error) {
	st, err := os.Stat(src)
	if err != nil {
		return "", err
	}
	return filepath.Join(t.dir, filepath.FromSlash(thumbKey(src, st.Size(), st.ModTime().Unix(), maxDim))) + ".jpg", nil
}

// Get returns the path of a cached thumbnail, generating it if this is the
// first time it has been asked for. Concurrent callers for the same image wait
// on one another rather than decoding it several times at once.
func (t *Thumbs) Get(src string, maxDim int) (string, error) {
	dst, err := t.Path(src, maxDim)
	if err != nil {
		return "", err
	}
	if ok, _ := usable(dst); ok {
		return dst, nil
	}

	t.mu.Lock()
	if ch, ok := t.busy[dst]; ok {
		t.mu.Unlock()
		<-ch
		if ok, _ := usable(dst); ok {
			return dst, nil
		}
		return "", fmt.Errorf("could not build a preview for %s", filepath.Base(src))
	}
	ch := make(chan struct{})
	t.busy[dst] = ch
	t.mu.Unlock()

	genErr := t.generate(src, dst, maxDim)
	close(ch)
	t.mu.Lock()
	delete(t.busy, dst)
	t.mu.Unlock()

	if genErr != nil {
		return "", genErr
	}
	return dst, nil
}

func usable(p string) (bool, error) {
	fi, err := os.Stat(p)
	if err != nil {
		return false, err
	}
	return fi.Size() > 0, nil
}

func (t *Thumbs) generate(src, dst string, maxDim int) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	tmp := dst + fmt.Sprintf(".%d.tmp", os.Getpid())
	defer os.Remove(tmp)

	ext := filepath.Ext(src)
	if err := t.render(src, tmp, maxDim, KindOf(ext) == KindVideo); err != nil {
		return err
	}
	if ok, _ := usable(tmp); !ok {
		return fmt.Errorf("empty preview for %s", filepath.Base(src))
	}
	return os.Rename(tmp, dst)
}

// render tries the built-in decoder first and falls back to ffmpeg. That keeps
// the common case (JPEG from a camera or phone) dependency-free while still
// giving videos and HEIC files a real picture when ffmpeg is present.
func (t *Thumbs) render(src, out string, maxDim int, video bool) error {
	if !video {
		if err := decodeAndWrite(src, out, maxDim); err == nil {
			return nil
		}
	}
	return t.ffmpegPreview(src, out, maxDim, video)
}

func decodeAndWrite(src, out string, maxDim int) error {
	f, err := os.Open(src)
	if err != nil {
		return err
	}
	defer f.Close()

	// Read the header once for the rotation tag, then rewind and decode.
	var orient int
	if head, herr := readHead(src, 128<<10); herr == nil {
		if ex, ok := parseJPEGExif(head); ok {
			orient = ex.Orientation
		}
	} else {
		return herr
	}

	img, _, err := image.Decode(f)
	if err != nil {
		return err
	}
	small := resizeOriented(img, orient, maxDim)
	return writeJPEG(out, small)
}

func writeJPEG(path string, img image.Image) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	if err := jpeg.Encode(f, img, &jpeg.Options{Quality: 84}); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}

// fitMax shrinks a width and height to sit inside a square of side max, never
// enlarging.
func fitMax(w, h, max int) (int, int) {
	if w <= 0 || h <= 0 {
		return max, max
	}
	r := math.Min(float64(max)/float64(w), float64(max)/float64(h))
	if r > 1 {
		r = 1
	}
	dw := int(math.Round(float64(w) * r))
	dh := int(math.Round(float64(h) * r))
	if dw < 1 {
		dw = 1
	}
	if dh < 1 {
		dh = 1
	}
	return dw, dh
}

// resizeOriented scales a picture down and applies its EXIF rotation, in that
// order so the expensive work happens on the smaller image.
func resizeOriented(src image.Image, orient, max int) *image.RGBA {
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	swapped := orient >= 5 && orient <= 8

	ow, oh := w, h
	if swapped {
		ow, oh = h, w
	}
	tw, th := fitMax(ow, oh, max)

	preW, preH := tw, th
	if swapped {
		preW, preH = th, tw
	}
	scaled := boxScale(src, preW, preH)
	return applyOrientation(scaled, orient)
}

// boxScale averages source pixels into destination pixels. Downscaling this way
// is both fast and good quality, and it touches each source pixel once.
func boxScale(src image.Image, dw, dh int) *image.RGBA {
	b := src.Bounds()
	sw, sh := b.Dx(), b.Dy()
	if sw <= 0 || sh <= 0 {
		return image.NewRGBA(image.Rect(0, 0, 1, 1))
	}
	dst := image.NewRGBA(image.Rect(0, 0, dw, dh))
	for dy := 0; dy < dh; dy++ {
		y0 := b.Min.Y + dy*sh/dh
		y1 := b.Min.Y + (dy+1)*sh/dh
		if y1 <= y0 {
			y1 = y0 + 1
		}
		for dx := 0; dx < dw; dx++ {
			x0 := b.Min.X + dx*sw/dw
			x1 := b.Min.X + (dx+1)*sw/dw
			if x1 <= x0 {
				x1 = x0 + 1
			}
			var r, g, bl, a, n uint64
			for y := y0; y < y1; y++ {
				for x := x0; x < x1; x++ {
					cr, cg, cb, ca := src.At(x, y).RGBA()
					r += uint64(cr)
					g += uint64(cg)
					bl += uint64(cb)
					a += uint64(ca)
					n++
				}
			}
			if n == 0 {
				n = 1
			}
			i := dst.PixOffset(dx, dy)
			dst.Pix[i+0] = uint8(r / n >> 8)
			dst.Pix[i+1] = uint8(g / n >> 8)
			dst.Pix[i+2] = uint8(bl / n >> 8)
			dst.Pix[i+3] = uint8(a / n >> 8)
		}
	}
	return dst
}

// applyOrientation rewrites pixels according to the EXIF orientation tag, which
// is how phones record that a photo was shot in portrait.
func applyOrientation(src *image.RGBA, o int) *image.RGBA {
	if o <= 1 || o > 8 {
		return src
	}
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	dw, dh := w, h
	if o >= 5 {
		dw, dh = h, w
	}
	dst := image.NewRGBA(image.Rect(0, 0, dw, dh))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			var nx, ny int
			switch o {
			case 2:
				nx, ny = w-1-x, y
			case 3:
				nx, ny = w-1-x, h-1-y
			case 4:
				nx, ny = x, h-1-y
			case 5:
				nx, ny = y, x
			case 6:
				nx, ny = h-1-y, x
			case 7:
				nx, ny = h-1-y, w-1-x
			case 8:
				nx, ny = y, w-1-x
			}
			si := src.PixOffset(x, y)
			di := dst.PixOffset(nx, ny)
			dst.Pix[di+0] = src.Pix[si+0]
			dst.Pix[di+1] = src.Pix[si+1]
			dst.Pix[di+2] = src.Pix[si+2]
			dst.Pix[di+3] = src.Pix[si+3]
		}
	}
	return dst
}

// ffmpegPreview asks ffmpeg for a single frame. Videos seek a second in for a
// more representative frame; stills decode from the start.
func (t *Thumbs) ffmpegPreview(src, out string, maxDim int, video bool) error {
	bin := ""
	if t.ffmpeg != nil {
		bin = t.ffmpeg()
	}
	if bin == "" {
		return fmt.Errorf("no preview available for %s (ffmpeg is not installed)", filepath.Base(src))
	}
	seeks := []string{"0"}
	if video {
		seeks = []string{"1", "0"}
	}
	var last string
	for _, ss := range seeks {
		args := []string{
			"-v", "error", "-nostdin",
			"-ss", ss, "-i", src,
			"-frames:v", "1",
			"-vf", fmt.Sprintf("scale=%d:%d:force_original_aspect_ratio=decrease", maxDim, maxDim),
			"-q:v", "4", "-y", out,
		}
		cmd := exec.Command(bin, args...)
		combined, err := cmd.CombinedOutput()
		if err != nil {
			last = string(combined)
			continue
		}
		if ok, _ := usable(out); ok {
			return nil
		}
	}
	if last == "" {
		last = "ffmpeg produced no output"
	}
	return fmt.Errorf("could not preview %s: %s", filepath.Base(src), trimOutput(last))
}

func trimOutput(s string) string {
	s = string(trimSpaceBytes([]byte(s)))
	if len(s) > 300 {
		s = s[:300] + "…"
	}
	return s
}

func trimSpaceBytes(b []byte) []byte {
	i, j := 0, len(b)
	for i < j && isSpace(b[i]) {
		i++
	}
	for j > i && isSpace(b[j-1]) {
		j--
	}
	return b[i:j]
}

func isSpace(c byte) bool {
	return c == ' ' || c == '\t' || c == '\n' || c == '\r'
}
