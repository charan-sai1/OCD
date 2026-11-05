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
	"strconv"
	"strings"
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

	// runFFmpeg and runFFprobe exist so tests can inspect the commands
	// without a real decoder. probe is the optional duration override tests
	// inject; nil means "ask ffprobe, then the index probe".
	runFFmpeg  func(bin string, args ...string) ([]byte, error)
	runFFprobe func(bin string, args ...string) ([]byte, error)
	probe      func(src string) (float64, error)

	mu   sync.Mutex
	busy map[string]chan struct{}
}

// thumbVersion bumps the cache key whenever the preview pipeline changes, so
// tiles rendered by an old, buggy version are rebuilt instead of reused.
const thumbVersion = 3

// NewThumbs prepares a cache rooted at dir.
func NewThumbs(dir string, ffmpeg func() string) *Thumbs {
	return &Thumbs{
		dir:    dir,
		ffmpeg: ffmpeg,
		runFFmpeg: func(bin string, args ...string) ([]byte, error) {
			return exec.Command(bin, args...).CombinedOutput()
		},
		runFFprobe: func(bin string, args ...string) ([]byte, error) {
			return exec.Command(bin, args...).CombinedOutput()
		},
		busy: map[string]chan struct{}{},
	}
}

// ffmpegSibling returns the ffprobe binary that lives beside ffmpeg.
func ffmpegSibling(ffmpeg, name string) string {
	// ffprobe lives next to ffmpeg when bundled, e.g. tools/ffmpeg/ffmpeg.exe
	// -> tools/ffmpeg/ffprobe(.exe).
	if ffmpeg == "" {
		return ""
	}
	cand := filepath.Join(filepath.Dir(ffmpeg), name)
	if st, err := os.Stat(cand); err != nil || st.IsDir() {
		return ""
	}
	return cand
}

func thumbKey(src string, size, mtime int64, maxDim int) string {
	h := sha1.Sum([]byte(fmt.Sprintf("%s\x00%d\x00%d\x00%d\x00%d", src, size, mtime, maxDim, thumbVersion)))
	s := hex.EncodeToString(h[:])
	return s[:2] + "/" + s[2:4] + "/" + s[4:]
}

// Path is where a thumbnail for src would live.
func (t *Thumbs) Path(src string, maxDim int) (string, error) {
	st, err := os.Stat(src)
	if err != nil {
		return "", err
	}
	if st.Size() == 0 {
		// A zero-byte file has nothing to show, and passing it to the shell
		// thumbnail provider can leave a decode spinning forever.
		return "", fmt.Errorf("%s is empty", filepath.Base(src))
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

// frameUsable reports whether a generated preview contains a real picture. A
// near-black frame — common for exports that open on a black title card — is
// useless as a tile, so it counts as a miss and the caller tries another seek.
func frameUsable(p string) bool {
	f, err := os.Open(p)
	if err != nil {
		return false
	}
	defer f.Close()
	img, err := jpeg.Decode(f)
	if err != nil {
		return false
	}
	b := img.Bounds()
	if b.Dx() <= 0 || b.Dy() <= 0 {
		return false
	}
	// Sample a coarse grid, not every pixel of a big tile.
	stepX, stepY := 1, 1
	if b.Dx() > 64 {
		stepX = b.Dx() / 64
	}
	if b.Dy() > 64 {
		stepY = b.Dy() / 64
	}
	var total, lit, n int64
	for y := b.Min.Y; y < b.Max.Y; y += stepY {
		for x := b.Min.X; x < b.Max.X; x += stepX {
			r, g, bl, _ := img.At(x, y).RGBA()
			v := int64(r>>8) + int64(g>>8) + int64(bl>>8)
			total += v
			n++
			if v > 24 { // not pure black
				lit++
			}
		}
	}
	if n == 0 {
		return false
	}
	if lit*100 < n { // fewer than 1% of sampled pixels are lit
		return false
	}
	return true
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

// render tries the built-in decoder first, then ffmpeg, then the operating
// system's. That keeps the common case (JPEG from a camera or phone)
// dependency-free, covers videos and HEIC with ffmpeg, and still finds a
// picture for formats only Windows can decode.
func (t *Thumbs) render(src, out string, maxDim int, video bool) error {
	if !video {
		if err := decodeAndWrite(src, out, maxDim); err == nil {
			return nil
		}
	}
	ffmpegErr := t.ffmpegPreview(src, out, maxDim, video)
	if ffmpegErr == nil {
		return nil
	}
	if video {
		return ffmpegErr
	}
	raw, w, h, shellErr := shellPreview(src, maxDim*2)
	if shellErr != nil {
		return describePreviewFailure(src, ffmpegErr, shellErr)
	}
	img, convErr := rawToImage(raw, w, h)
	if convErr != nil {
		return describePreviewFailure(src, ffmpegErr, convErr)
	}
	if err := writeJPEG(out, resizeOriented(img, 1, maxDim)); err != nil {
		return describePreviewFailure(src, ffmpegErr, err)
	}
	return nil
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

// probeDuration returns how long the video runs, so the thumbnail seek lands on
// a real frame instead of a black opening card.
func (t *Thumbs) probeDuration(src string) (float64, error) {
	if t.probe != nil {
		return t.probe(src)
	}
	var bin string
	if t.ffmpeg != nil {
		bin = ffmpegSibling(t.ffmpeg(), "ffprobe")
	}
	if bin == "" {
		// No ffprobe next to ffmpeg: fall back to the header-only index probe,
		// which reads the mvhd box and covers MOV/MP4.
		if m, err := Probe(src); err == nil && m.Duration > 0 {
			return m.Duration, nil
		}
		return 0, fmt.Errorf("ffprobe is not installed")
	}
	run := t.runFFprobe
	if run == nil {
		run = func(b string, args ...string) ([]byte, error) {
			return exec.Command(b, args...).CombinedOutput()
		}
	}
	out, err := run(bin, "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", src)
	if err != nil {
		return 0, err
	}
	s := strings.TrimSpace(string(out))
	f, err := strconv.ParseFloat(s, 64)
	if err != nil || f < 0 {
		return 0, fmt.Errorf("no duration in ffprobe output")
	}
	return f, nil
}

// ffmpegPreview asks ffmpeg for a single frame. For videos it seeks a little
// way into the file first and rejects near-black frames, because exports
// frequently start black; stills decode from the start.
func (t *Thumbs) ffmpegPreview(src, out string, maxDim int, video bool) error {
	bin := ""
	if t.ffmpeg != nil {
		bin = t.ffmpeg()
	}
	if bin == "" {
		return fmt.Errorf("no preview available for %s (ffmpeg is not installed)", filepath.Base(src))
	}
	run := t.runFFmpeg
	if run == nil {
		run = func(b string, args ...string) ([]byte, error) {
			return exec.Command(b, args...).CombinedOutput()
		}
	}

	// HEIC files are not videos and have no duration; seeking into one
	// makes ffmpeg fail before it decodes anything, so only seek when the
	// caller asked for a frame from a moving picture.
	seeks := []string{""}
	if video {
		dur, derr := t.probeDuration(src)
		if derr == nil && dur > 0 {
			seeks = []string{
				strconv.FormatFloat(dur*0.25, 'f', 2, 64),
				strconv.FormatFloat(dur*0.5, 'f', 2, 64),
				"0",
			}
		} else {
			seeks = []string{"1", "0"}
		}
	}

	var last string
	for _, ss := range seeks {
		args := []string{"-v", "error", "-nostdin"}
		if ss != "" {
			args = append(args, "-ss", ss)
		}
		args = append(args,
			"-i", src,
			"-frames:v", "1",
			// A complex filtergraph is used because some decoders (HEIC tile
			// grids among them) cannot take a simple -vf next to it, and the
			// select keeps a single frame.
			"-filter_complex", fmt.Sprintf("select=eq(n\\,0),scale=%d:%d:force_original_aspect_ratio=decrease[v]", maxDim, maxDim),
			"-map", "[v]",
			// The output is a temporary file with a .tmp suffix, which ffmpeg
			// cannot use to guess a format, so name it explicitly.
			"-c:v", "mjpeg", "-q:v", "4", "-f", "image2", "-update", "1", "-y", out,
		)
		combined, err := run(bin, args...)
		if err != nil {
			last = string(combined)
			continue
		}
		if ok, _ := usable(out); ok && frameUsable(out) {
			return nil
		}
		if ok, _ := usable(out); !ok {
			last = "ffmpeg produced no output"
		}
	}
	if last == "" {
		last = "every frame was black or missing"
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
