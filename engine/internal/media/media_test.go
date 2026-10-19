package media

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"testing"
	"time"
)

/* ---------- video indexing ---------- */

func cat(parts ...[]byte) []byte {
	var out []byte
	for _, p := range parts {
		out = append(out, p...)
	}
	return out
}

func box(typ string, body []byte) []byte {
	b := make([]byte, 8+len(body))
	binary.BigEndian.PutUint32(b, uint32(8+len(body)))
	copy(b[4:], typ)
	copy(b[8:], body)
	return b
}

// box64 writes a box using the 64-bit size form, which large recordings use.
func box64(typ string, body []byte) []byte {
	b := make([]byte, 16+len(body))
	binary.BigEndian.PutUint32(b, 1)
	copy(b[4:], typ)
	binary.BigEndian.PutUint64(b[8:], uint64(16+len(body)))
	copy(b[16:], body)
	return b
}

func mvhdBody(timescale, duration uint32) []byte {
	b := make([]byte, 100)
	b[0] = 0
	binary.BigEndian.PutUint32(b[12:], timescale)
	binary.BigEndian.PutUint32(b[16:], duration)
	return b
}

func tkhdBody(w, h int) []byte {
	b := make([]byte, 84)
	b[0] = 0
	binary.BigEndian.PutUint32(b[76:], uint32(w)<<16)
	binary.BigEndian.PutUint32(b[80:], uint32(h)<<16)
	return b
}

func testMovie(width, height, timescale, duration uint32) []byte {
	return box("moov", cat(
		box("mvhd", mvhdBody(timescale, duration)),
		box("trak", cat(box("tkhd", tkhdBody(int(width), int(height))), box("mdia", nil))),
	))
}

// writeMP4 lays out a plausible clip: a header, some media data of the given
// size, and then the index — which is where phones usually put it.
func writeMP4(t *testing.T, path string, movie []byte, mediaBytes int) {
	t.Helper()
	file := cat(box("ftyp", []byte("isomisomiso2")), box("mdat", make([]byte, mediaBytes)), movie)
	if err := os.WriteFile(path, file, 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestVideoReadsSizeAndDuration(t *testing.T) {
	path := filepath.Join(t.TempDir(), "clip.mp4")
	writeMP4(t, path, testMovie(1920, 1080, 1000, 12345), 4096)

	m, err := Probe(path)
	if err != nil {
		t.Fatal(err)
	}
	if m.Kind != KindVideo {
		t.Fatalf("kind: got %q", m.Kind)
	}
	if m.Width != 1920 || m.Height != 1080 {
		t.Errorf("size: got %dx%d, want 1920x1080", m.Width, m.Height)
	}
	if m.Duration < 12.3 || m.Duration > 12.4 {
		t.Errorf("duration: got %v, want about 12.345", m.Duration)
	}
}

// Phones routinely leave the index at the very end of the clip, after many
// megabytes of media data, so a small read of the start of the file must not be
// the only way this is found.
func TestVideoFindsIndexAtTheEndOfALargeFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "long.mp4")
	writeMP4(t, path, testMovie(1080, 1920, 600, 6000), 3<<20)

	m, err := Probe(path)
	if err != nil {
		t.Fatal(err)
	}
	if m.Width != 1080 || m.Height != 1920 {
		t.Errorf("size: got %dx%d, want 1080x1920", m.Width, m.Height)
	}
	if m.Duration < 9.9 || m.Duration > 10.1 {
		t.Errorf("duration: got %v, want 10", m.Duration)
	}
}

func TestVideoHandlesSixtyFourBitBoxSizes(t *testing.T) {
	path := filepath.Join(t.TempDir(), "big.mp4")
	file := cat(box("ftyp", []byte("isomisomiso2")), box64("mdat", make([]byte, 2048)), testMovie(3840, 2160, 1000, 2500))
	if err := os.WriteFile(path, file, 0o644); err != nil {
		t.Fatal(err)
	}
	m, err := Probe(path)
	if err != nil {
		t.Fatal(err)
	}
	if m.Width != 3840 || m.Height != 2160 {
		t.Errorf("size: got %dx%d", m.Width, m.Height)
	}
}

func TestVideoAudioTrackDoesNotOverrideVideoSize(t *testing.T) {
	path := filepath.Join(t.TempDir(), "withsound.mp4")
	movie := box("moov", cat(
		box("mvhd", mvhdBody(600, 3000)),
		box("trak", box("tkhd", tkhdBody(0, 0))), // audio
		box("trak", box("tkhd", tkhdBody(720, 1280))),
	))
	writeMP4(t, path, movie, 512)

	m, err := Probe(path)
	if err != nil {
		t.Fatal(err)
	}
	if m.Width != 720 || m.Height != 1280 {
		t.Errorf("size: got %dx%d, want 720x1280", m.Width, m.Height)
	}
	if m.Duration < 4.9 || m.Duration > 5.1 {
		t.Errorf("duration: got %v, want 5", m.Duration)
	}
}

// A clip the prober cannot describe must still be listed, with whatever the
// file name and the file timestamp can tell us.
func TestVideoWithoutAnIndexIsStillListed(t *testing.T) {
	path := filepath.Join(t.TempDir(), "VID_20210617_133337.mp4")
	if err := os.WriteFile(path, cat(box("ftyp", []byte("isomisomiso2")), box("mdat", make([]byte, 300))), 0o644); err != nil {
		t.Fatal(err)
	}
	m, err := Probe(path)
	if err != nil {
		t.Fatalf("a clip with no index should not be an error: %v", err)
	}
	if m.Kind != KindVideo {
		t.Errorf("kind: got %q", m.Kind)
	}
	if m.Width != 0 || m.Duration != 0 {
		t.Errorf("nothing should have been invented: %dx%d, %v", m.Width, m.Height, m.Duration)
	}
	ct, ok := DateFromName(filepath.Base(path))
	if !ok || ct.Format(time.DateTime) != "2021-06-17 13:33:37" {
		t.Errorf("the file name should still supply the date, got %v (%v)", ct, ok)
	}
}

/* ---------- the bytes win over the file name ---------- */

func TestImageWithTheWrongExtensionIsStillRead(t *testing.T) {
	// Messaging apps save PNGs with a .jpg name, so the name cannot be trusted
	// by anything that actually reads the picture.
	dir := t.TempDir()
	path := filepath.Join(dir, "IMG-20260924-WA0002.jpg")
	newTestImage(t, path, 1080, 1466, time.Now())

	m, err := Probe(path)
	if err != nil {
		t.Fatal(err)
	}
	if m.Kind != KindImage {
		t.Fatalf("kind: got %q", m.Kind)
	}
	if m.Width != 1080 || m.Height != 1466 {
		t.Errorf("size: got %dx%d, want 1080x1466", m.Width, m.Height)
	}
}

func TestSniffFormat(t *testing.T) {
	cases := []struct {
		name string
		head []byte
		want string
	}{
		{"jpeg", []byte{0xFF, 0xD8, 0xFF, 0xE0}, ".jpg"},
		{"png", []byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A}, ".png"},
		{"gif 87a", []byte("GIF87a"), ".gif"},
		{"gif 89a", []byte("GIF89a"), ".gif"},
		{"bmp", []byte("BM"), ".bmp"},
		{"webp", []byte("RIFF\x00\x00\x00\x00WEBPVP8 "), ".webp"},
		{"tiff little endian", []byte("II*\x00"), ".tiff"},
		{"tiff big endian", []byte("MM\x00*"), ".tiff"},
		{"jpeg xl", []byte{0xFF, 0x0A}, ".jxl"},
		{"not a picture", []byte("hello there"), ""},
		{"too short to tell", []byte{0xFF}, ""},
		{"empty", nil, ""},
	}
	for _, c := range cases {
		if got := sniffFormat(c.head); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}

func TestSniffFormatReadsTheIsoBrand(t *testing.T) {
	iso := func(brand, compatible string) []byte {
		return cat([]byte{0, 0, 0, 24}, []byte("ftyp"+brand), []byte(compatible))
	}
	if got := sniffFormat(iso("heic", "mif1heic")); got != ".heic" {
		t.Errorf("heic: got %q", got)
	}
	if got := sniffFormat(iso("mif1", "mif1heic")); got != ".heif" {
		t.Errorf("heif: got %q", got)
	}
	if got := sniffFormat(iso("avif", "avifmif1")); got != ".avif" {
		t.Errorf("avif: got %q", got)
	}
	// A video brand must not be claimed as a picture.
	if got := sniffFormat(iso("isom", "isomiso2")); got != "" {
		t.Errorf("mp4: got %q, want nothing", got)
	}
}

func TestHeicDimensionsAreFoundWhenTheMetadataIsAtTheEnd(t *testing.T) {
	// Most writers put the image properties box near the front, but some leave
	// it after the picture data, out of reach of a fixed read of the start.
	ispe := box("ispe", cat([]byte{0, 0, 0, 0}, be32(4032), be32(3024)))
	file := cat(
		box("ftyp", []byte("heicmif1heic")),
		box("mdat", make([]byte, 160<<10)),
		box("meta", box("iprp", box("ipco", ispe))),
	)
	path := filepath.Join(t.TempDir(), "IMG_0001.heic")
	if err := os.WriteFile(path, file, 0o644); err != nil {
		t.Fatal(err)
	}

	m, err := Probe(path)
	if err != nil {
		t.Fatal(err)
	}
	if m.Width != 4032 || m.Height != 3024 {
		t.Errorf("size: got %dx%d, want 4032x3024", m.Width, m.Height)
	}
}

func be32(v uint32) []byte {
	b := make([]byte, 4)
	binary.BigEndian.PutUint32(b, v)
	return b
}

func TestEmptyFileIsListedWithoutInventingAnything(t *testing.T) {
	// A transfer that died half way leaves a zero byte file behind. It should
	// still be listed, and clearly have nothing known about it.
	dir := t.TempDir()
	path := filepath.Join(dir, "IMG_20250218_161928.jpg")
	if err := os.WriteFile(path, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	m, err := Probe(path)
	if err != nil {
		t.Fatalf("an empty file should not be an error: %v", err)
	}
	if m.Width != 0 || m.Height != 0 || m.Duration != 0 {
		t.Errorf("nothing should have been invented: %dx%d, %v", m.Width, m.Height, m.Duration)
	}
}

/* ---------- capture dates from file names ---------- */

func TestDateFromName(t *testing.T) {
	cases := []struct {
		name string
		want string
	}{
		{"IMG_20210617_133337.jpg", "2021-06-17 13:33:37"},
		{"PXL_20210617_133337123.jpg", "2021-06-17 13:33:37"},
		{"VID_20210617_133337.mp4", "2021-06-17 13:33:37"},
		{"Screenshot_2026-05-22-00-56-13-493_com.app.jpg", "2026-05-22 00:56:13"},
		{"Firefly 20250225205732.png", "2025-02-25 20:57:32"},
		{"2d-board-white-flex-with-iron--20250516141308404.jpeg", "2025-05-16 14:13:08"},
		{"IMG-20261001-WA0000.jpg", "2026-10-01 00:00:00"},
		{"2021-06-17 10-20-30.jpg", "2021-06-17 10:20:30"},
		{"received_1234567890.jpg", ""},
		{"DSC_0042.JPG", ""},
		{"IMG_0040.JPG", ""},
		// Numbers that look like timestamps but are not. Snapchat ids are ten
		// digits and were previously being read as a date, which threw those
		// files to the top of the timeline.
		{"Snapchat-2068033118.mp4", ""},
		{"Snapchat-2035052896.jpg", ""},
		{"received_2024010112.jpg", ""},
	}
	for _, c := range cases {
		got, ok := DateFromName(c.name)
		if c.want == "" {
			if ok {
				t.Errorf("%s: expected no date, got %s", c.name, got.Format(time.DateTime))
			}
			continue
		}
		if !ok {
			t.Errorf("%s: expected %s, got nothing", c.name, c.want)
			continue
		}
		if g := got.Format(time.DateTime); g != c.want {
			t.Errorf("%s: expected %s, got %s", c.name, c.want, g)
		}
	}
}

func TestCaptureTimePrefersExifThenNameThenModTime(t *testing.T) {
	mod := time.Date(2020, 1, 1, 0, 0, 0, 0, time.Local)
	exifWhen := time.Date(2019, 5, 4, 3, 2, 1, 0, time.Local)

	if got := CaptureTime(Exif{HasShotAt: true, ShotAt: exifWhen}, "IMG_20210617_133337.jpg", mod); !got.Equal(exifWhen) {
		t.Errorf("EXIF should win, got %s", got)
	}
	if got := CaptureTime(Exif{}, "IMG_20210617_133337.jpg", mod); got.Year() != 2021 {
		t.Errorf("file name should be the fallback, got %s", got)
	}
	if got := CaptureTime(Exif{}, "DSC_0042.jpg", mod); !got.Equal(mod) {
		t.Errorf("modification time should be the last resort, got %s", got)
	}

	// A camera with a dead clock writes a date far in the future; that must not
	// be allowed to sort the whole library around itself.
	future := time.Now().AddDate(30, 0, 0)
	if got := CaptureTime(Exif{HasShotAt: true, ShotAt: future}, "DSC_0042.jpg", mod); !got.Equal(mod) {
		t.Errorf("an implausible EXIF date should fall through to the file time, got %s", got)
	}
	if got := CaptureTime(Exif{}, "IMG_20990101_120000.jpg", mod); !got.Equal(mod) {
		t.Errorf("an implausible name date should fall through to the file time, got %s", got)
	}
}

/* ---------- search box parsing ---------- */

func TestParseDateQuery(t *testing.T) {
	cases := []struct {
		in          string
		year, month int
		rest        string
	}{
		{"june 2021 beach", 2021, 6, "beach"},
		{"2019", 2019, 0, ""},
		{"sunsets", 0, 0, "sunsets"},
		{"Dec 2023", 2023, 12, ""},
		{"birthday party", 0, 0, "birthday party"},
		{"3199", 0, 0, "3199"}, // outside the plausible range
	}
	for _, c := range cases {
		y, m, rest := ParseDateQuery(c.in)
		if y != c.year || m != c.month || rest != c.rest {
			t.Errorf("%q: got (%d, %d, %q), want (%d, %d, %q)", c.in, y, m, rest, c.year, c.month, c.rest)
		}
	}
}

/* ---------- path safety ---------- */

func TestResolveRefusesTraversal(t *testing.T) {
	root := filepath.Join("C:", "photos")
	good := []string{"a.jpg", "sub/a.jpg", "sub/deep/a.jpg"}
	for _, rel := range good {
		if _, err := Resolve(root, rel); err != nil {
			t.Errorf("%s should resolve: %v", rel, err)
		}
	}
	bad := []string{"", "..", "../a.jpg", "sub/../../a.jpg", `..\a.jpg`, "/abs.jpg", `C:\windows\x.jpg`}
	for _, rel := range bad {
		if _, err := Resolve(root, rel); err == nil {
			t.Errorf("%s should have been refused", rel)
		}
	}
}

/* ---------- junk files ---------- */

func TestJunkFileDetection(t *testing.T) {
	junk := []string{"._IMG_0040.JPG", "._ADHAR.jpg", "Thumbs.db", "desktop.ini", ".DS_Store", "~$doc.jpg"}
	for _, n := range junk {
		if !junkFile(n) {
			t.Errorf("%s should be treated as junk", n)
		}
	}
	real := []string{"IMG_0040.JPG", "photo.jpg", "My_Thumbs.jpg"}
	for _, n := range real {
		if junkFile(n) {
			t.Errorf("%s is a real photo", n)
		}
	}
}

/* ---------- EXIF ---------- */

// buildTIFF lays out a little-endian TIFF header with the handful of tags the
// app reads. Writing it by hand here keeps the EXIF test self-contained.
func buildTIFF() []byte {
	makeStr := "TestMake\x00"
	modelStr := "TestModel\x00"
	dateStr := "2021:06:17 13:33:37\x00"

	var (
		ifd0Off   = 8
		ifd0Len   = 2 + 5*12 + 4
		makeOff   = ifd0Off + ifd0Len
		modelOff  = makeOff + len(makeStr)
		exifOff   = modelOff + len(modelStr)
		exifLen   = 2 + 5*12 + 4
		dateOff   = exifOff + exifLen
		widthVal  = 4032
		heightVal = 3024
		orientVal = 6
	)

	buf := make([]byte, dateOff+len(dateStr))
	copy(buf[0:], "II")
	binary.LittleEndian.PutUint16(buf[2:], 0x002A)
	binary.LittleEndian.PutUint32(buf[4:], uint32(ifd0Off))

	writeIFD := func(off, count int, entries [][4]uint32) {
		binary.LittleEndian.PutUint16(buf[off:], uint16(count))
		p := off + 2
		for _, e := range entries {
			binary.LittleEndian.PutUint16(buf[p:], uint16(e[0]))
			binary.LittleEndian.PutUint16(buf[p+2:], uint16(e[1]))
			binary.LittleEndian.PutUint32(buf[p+4:], e[2])
			binary.LittleEndian.PutUint32(buf[p+8:], e[3])
			p += 12
		}
		binary.LittleEndian.PutUint32(buf[p:], 0) // no next IFD
	}

	const ascii = 2
	const short = 3
	const long = 4

	writeIFD(ifd0Off, 5, [][4]uint32{
		{0x010F, ascii, uint32(len(makeStr)), uint32(makeOff)},
		{0x0110, ascii, uint32(len(modelStr)), uint32(modelOff)},
		{0x0112, short, 1, uint32(orientVal)},
		{0x8769, long, 1, uint32(exifOff)},
		{0x0132, ascii, uint32(len(dateStr)), uint32(dateOff)},
	})
	writeIFD(exifOff, 5, [][4]uint32{
		{0x9003, ascii, uint32(len(dateStr)), uint32(dateOff)},
		{0x829D, 5, 1, 0}, // FNumber rational left at zero offset
		{0xA002, long, 1, uint32(widthVal)},
		{0xA003, long, 1, uint32(heightVal)},
		{0x8827, short, 1, 400},
	})
	copy(buf[makeOff:], makeStr)
	copy(buf[modelOff:], modelStr)
	copy(buf[dateOff:], dateStr)
	return buf
}

// buildJPEG wraps a TIFF payload in a minimal JPEG: SOI, the APP1 EXIF segment,
// and an SOF0 frame carrying the pixel dimensions.
func buildJPEG(tiff []byte, w, h int) []byte {
	var b bytes.Buffer
	b.Write([]byte{0xFF, 0xD8})

	payload := append([]byte("Exif\x00\x00"), tiff...)
	segLen := len(payload) + 2
	b.Write([]byte{0xFF, 0xE1, byte(segLen >> 8), byte(segLen)})
	b.Write(payload)

	sof := make([]byte, 15)
	binary.BigEndian.PutUint16(sof[0:], 17)
	sof[2] = 8
	binary.BigEndian.PutUint16(sof[3:], uint16(h))
	binary.BigEndian.PutUint16(sof[5:], uint16(w))
	sof[7] = 3
	b.Write([]byte{0xFF, 0xC0})
	b.Write(sof)

	b.Write([]byte{0xFF, 0xD9})
	return b.Bytes()
}

func TestParseJPEGExif(t *testing.T) {
	ex, ok := parseJPEGExif(buildJPEG(buildTIFF(), 640, 480))
	if !ok {
		t.Fatal("EXIF should have been found")
	}
	if ex.Make != "TestMake" || ex.Model != "TestModel" {
		t.Errorf("make/model: got %q/%q", ex.Make, ex.Model)
	}
	if !ex.HasShotAt || ex.ShotAt.Format(time.DateTime) != "2021-06-17 13:33:37" {
		t.Errorf("shot time: got %v (has=%v)", ex.ShotAt, ex.HasShotAt)
	}
	if ex.Orientation != 6 {
		t.Errorf("orientation: got %d", ex.Orientation)
	}
	if ex.ISO != 400 {
		t.Errorf("iso: got %d", ex.ISO)
	}
	// PixelXDimension/PixelYDimension should beat IFD0's values.
	if ex.Width != 4032 || ex.Height != 3024 {
		t.Errorf("dimensions: got %dx%d", ex.Width, ex.Height)
	}
}

func TestJPEGSizeReadsFrameHeader(t *testing.T) {
	w, h := jpegSize(buildJPEG(buildTIFF(), 640, 480))
	if w != 640 || h != 480 {
		t.Errorf("got %dx%d, want 640x480", w, h)
	}
}

func TestPNGSize(t *testing.T) {
	var b bytes.Buffer
	img := image.NewRGBA(image.Rect(0, 0, 37, 91))
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	w, h := pngSize(b.Bytes())
	if w != 37 || h != 91 {
		t.Errorf("got %dx%d, want 37x91", w, h)
	}
}

/* ---------- image geometry ---------- */

// solid builds a test image where every pixel records its own coordinates.
func solid(w, h int) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.SetRGBA(x, y, color.RGBA{R: uint8(x * 8), G: uint8(y * 8), B: 200, A: 255})
		}
	}
	return img
}

func TestFitMaxKeepsAspectAndNeverEnlarges(t *testing.T) {
	if w, h := fitMax(4000, 3000, 800); w != 800 || h != 600 {
		t.Errorf("landscape: got %dx%d, want 800x600", w, h)
	}
	if w, h := fitMax(3000, 4000, 800); w != 600 || h != 800 {
		t.Errorf("portrait: got %dx%d, want 600x800", w, h)
	}
	if w, h := fitMax(100, 80, 800); w != 100 || h != 80 {
		t.Errorf("small images must not be enlarged: got %dx%d", w, h)
	}
}

func TestBoxScaleAveragesRatherThanSampling(t *testing.T) {
	// Three source pixels collapsing into one must give their mean. A
	// nearest-neighbour resize would return one of the ends instead.
	src := image.NewRGBA(image.Rect(0, 0, 3, 1))
	src.SetRGBA(0, 0, color.RGBA{R: 0, G: 0, B: 0, A: 255})
	src.SetRGBA(1, 0, color.RGBA{R: 0, G: 0, B: 0, A: 255})
	src.SetRGBA(2, 0, color.RGBA{R: 255, G: 255, B: 255, A: 255})

	out := boxScale(src, 1, 1)
	if got := out.RGBAAt(0, 0).R; got != 85 {
		t.Errorf("averaged pixel: got %d, want 85", got)
	}

	// Halving a two-tone image must give one dark and one light pixel, not a
	// smear of the whole row.
	row := image.NewRGBA(image.Rect(0, 0, 4, 1))
	for x := 0; x < 4; x++ {
		v := uint8(0)
		if x >= 2 {
			v = 255
		}
		row.SetRGBA(x, 0, color.RGBA{R: v, G: v, B: v, A: 255})
	}
	half := boxScale(row, 2, 1)
	if half.RGBAAt(0, 0).R != 0 || half.RGBAAt(1, 0).R != 255 {
		t.Errorf("halved row: got %d and %d, want 0 and 255",
			half.RGBAAt(0, 0).R, half.RGBAAt(1, 0).R)
	}
}

func TestApplyOrientationSwapsDimensions(t *testing.T) {
	src := solid(4, 2)

	// 6 means the camera was rotated 90 degrees clockwise.
	out := applyOrientation(src, 6)
	if b := out.Bounds(); b.Dx() != 2 || b.Dy() != 4 {
		t.Errorf("orientation 6 should swap width and height, got %dx%d", b.Dx(), b.Dy())
	}
	// The top-left of the source moves to the top-right.
	if got, want := out.RGBAAt(1, 0), src.RGBAAt(0, 0); got != want {
		t.Errorf("corner moved wrongly: got %v, want %v", got, want)
	}

	// 8 is the opposite rotation and must also swap.
	if b := applyOrientation(src, 8).Bounds(); b.Dx() != 2 || b.Dy() != 4 {
		t.Errorf("orientation 8 should swap width and height, got %dx%d", b.Dx(), b.Dy())
	}

	// 3 is a half turn: same shape, opposite corner.
	half := applyOrientation(src, 3)
	if b := half.Bounds(); b.Dx() != 4 || b.Dy() != 2 {
		t.Errorf("orientation 3 should not swap, got %dx%d", b.Dx(), b.Dy())
	}
	if got, want := half.RGBAAt(3, 1), src.RGBAAt(0, 0); got != want {
		t.Errorf("half turn moved wrongly: got %v, want %v", got, want)
	}

	// 1 is normal and must be returned untouched.
	if applyOrientation(src, 1) != src {
		t.Error("orientation 1 should not copy the image")
	}
}

func TestResizeOriented(t *testing.T) {
	out := resizeOriented(solid(400, 200), 6, 100)
	// 400x200 rotated becomes 200x400, then fits inside 100 -> 50x100.
	if b := out.Bounds(); b.Dx() != 50 || b.Dy() != 100 {
		t.Errorf("got %dx%d, want 50x100", b.Dx(), b.Dy())
	}
}

/* ---------- thumbnails ---------- */

func TestThumbsCacheAndServeAJPEG(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "photo.png")
	f, err := os.Create(src)
	if err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(f, solid(800, 400)); err != nil {
		t.Fatal(err)
	}
	f.Close()

	cache := NewThumbs(filepath.Join(dir, "thumbs"), func() string { return "" })
	first, err := cache.Get(src, 100)
	if err != nil {
		t.Fatalf("generating a thumbnail failed: %v", err)
	}
	rf, err := os.Open(first)
	if err != nil {
		t.Fatal(err)
	}
	img, err := jpeg.Decode(rf)
	rf.Close()
	if err != nil {
		t.Fatalf("the generated thumbnail is not a JPEG: %v", err)
	}
	if b := img.Bounds(); b.Dx() != 100 || b.Dy() != 50 {
		t.Errorf("thumbnail is %dx%d, want 100x50", b.Dx(), b.Dy())
	}

	// Asking again must return the same cached file, not a new one.
	second, err := cache.Get(src, 100)
	if err != nil {
		t.Fatal(err)
	}
	if second != first {
		t.Errorf("expected the cached path, got a new one")
	}

	// A different size is a different cache entry.
	other, err := cache.Get(src, 32)
	if err != nil {
		t.Fatal(err)
	}
	if other == first {
		t.Error("different sizes should not share a cache file")
	}
}

func TestThumbsReportsUnsupportedFormats(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "clip.mp4")
	if err := os.WriteFile(src, []byte("not really a video"), 0o644); err != nil {
		t.Fatal(err)
	}
	cache := NewThumbs(filepath.Join(dir, "thumbs"), func() string { return "" })
	if _, err := cache.Get(src, 100); err == nil {
		t.Error("a video without ffmpeg should report that no preview is possible")
	}
}

/* ---------- the index ---------- */

// newTestImage writes a real PNG so the index can read its dimensions.
func newTestImage(t *testing.T, path string, w, h int, mtime time.Time) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(f, image.NewRGBA(image.Rect(0, 0, w, h))); err != nil {
		t.Fatal(err)
	}
	f.Close()
	if err := os.Chtimes(path, mtime, mtime); err != nil {
		t.Fatal(err)
	}
}

func TestIndexBuildOrderPageAndFilters(t *testing.T) {
	root := t.TempDir()
	lib := filepath.Join(root, "drive")
	base := time.Date(2024, 3, 1, 12, 0, 0, 0, time.Local)

	newTestImage(t, filepath.Join(lib, "a.png"), 10, 20, base)
	newTestImage(t, filepath.Join(lib, "b.png"), 30, 40, base.Add(time.Hour))
	newTestImage(t, filepath.Join(lib, "sub", "c.png"), 50, 60, base.Add(2*time.Hour))
	// Decoys that must never reach the grid.
	newTestImage(t, filepath.Join(lib, "._a.png"), 10, 10, base.Add(3*time.Hour))
	os.WriteFile(filepath.Join(lib, "Thumbs.db"), []byte("junk"), 0o644)
	newTestImage(t, filepath.Join(lib, ".hidden", "d.png"), 10, 10, base.Add(4*time.Hour))
	os.WriteFile(filepath.Join(lib, "notes.txt"), []byte("hi"), 0o644)

	ix := New(filepath.Join(root, "data"))
	if err := ix.Build([]Library{{ID: "lib1", Path: lib}}, nil); err != nil {
		t.Fatal(err)
	}
	if got := ix.Len(); got != 3 {
		t.Fatalf("indexed %d items, want 3", got)
	}

	// Newest first.
	items, more := ix.Page(Query{Limit: 10})
	if more {
		t.Error("there should not be another page")
	}
	want := []string{"c.png", "b.png", "a.png"}
	for i, w := range want {
		if items[i].Name != w {
			t.Errorf("position %d: got %s, want %s", i, items[i].Name, w)
		}
	}
	if items[2].W != 10 || items[2].H != 20 {
		t.Errorf("dimensions were not recorded: %dx%d", items[2].W, items[2].H)
	}

	// Paging with a cursor must cover everything exactly once.
	seen := map[string]bool{}
	q := Query{Limit: 2}
	for {
		page, more := ix.Page(q)
		for _, it := range page {
			if seen[it.Name] {
				t.Fatalf("%s came back twice", it.Name)
			}
			seen[it.Name] = true
		}
		if !more || len(page) == 0 {
			break
		}
		last := page[len(page)-1]
		q.Before, q.BefName = last.ShotAt, last.Name
	}
	if len(seen) != 3 {
		t.Errorf("paging returned %d distinct items, want 3", len(seen))
	}

	// Filters.
	if got, _ := ix.Page(Query{Lib: "nope", Limit: 10}); len(got) != 0 {
		t.Error("an unknown library should match nothing")
	}
	if got, _ := ix.Page(Query{Kind: "video", Limit: 10}); len(got) != 0 {
		t.Error("there are no videos in this fixture")
	}
	if got, _ := ix.Page(Query{Search: "c.png", Limit: 10}); len(got) != 1 {
		t.Errorf("search matched %d items, want 1", len(got))
	}
	if got, _ := ix.Page(Query{Year: 2024, Limit: 10}); len(got) != 3 {
		t.Errorf("year filter matched %d items, want 3", len(got))
	}
	if got, _ := ix.Page(Query{Year: 2020, Limit: 10}); len(got) != 0 {
		t.Error("the wrong year should match nothing")
	}
}

// Asking for one file by key must hand back that same file. The index is stored
// in display order, which is never the order the drives were walked in, so the
// key lookup and the order have to be rebuilt together — otherwise the grid
// shows one picture and the viewer opens a different one.
func TestLookupByKeyReturnsTheItemThatWasStored(t *testing.T) {
	root := t.TempDir()
	lib := filepath.Join(root, "drive")
	base := time.Date(2024, 5, 1, 9, 0, 0, 0, time.Local)
	// Walked a, b, c; shown newest first as c, b, a.
	newTestImage(t, filepath.Join(lib, "a.png"), 10, 10, base)
	newTestImage(t, filepath.Join(lib, "b.png"), 20, 20, base.Add(time.Hour))
	newTestImage(t, filepath.Join(lib, "c.png"), 30, 30, base.Add(2*time.Hour))

	data := filepath.Join(root, "data")
	ix := New(data)
	if err := ix.Build([]Library{{ID: "lib1", Path: lib}}, nil); err != nil {
		t.Fatal(err)
	}

	check := func(ix *Index, when string) {
		t.Helper()
		for _, name := range []string{"a.png", "b.png", "c.png"} {
			it, ok := ix.Get("lib1:" + name)
			if !ok {
				t.Fatalf("%s: %s is missing from the index", when, name)
			}
			if it.Rel != name {
				t.Errorf("%s: looking up %s returned %s", when, name, it.Rel)
			}
		}
	}
	check(ix, "after a scan")
	// The same has to hold once the index is read back from disk.
	check(New(data), "after a reload")
}

func TestIndexIsIncrementalAndPersistsFavourites(t *testing.T) {
	root := t.TempDir()
	lib := filepath.Join(root, "drive")
	stamp := time.Date(2024, 1, 2, 3, 4, 5, 0, time.Local)
	newTestImage(t, filepath.Join(lib, "one.png"), 8, 8, stamp)

	data := filepath.Join(root, "data")
	ix := New(data)
	if err := ix.Build([]Library{{ID: "lib1", Path: lib}}, nil); err != nil {
		t.Fatal(err)
	}
	key := "lib1:one.png"
	if _, ok := ix.Get(key); !ok {
		t.Fatal("the item should be indexed")
	}
	if err := ix.SetFavorite(key, true); err != nil {
		t.Fatal(err)
	}

	// A second scan of unchanged files must keep the cached metadata.
	item, _ := ix.Get(key)
	if err := ix.Build([]Library{{ID: "lib1", Path: lib}}, nil); err != nil {
		t.Fatal(err)
	}
	again, _ := ix.Get(key)
	if again.ShotAt != item.ShotAt || again.Size != item.Size {
		t.Error("an unchanged file should have been reused, not re-probed")
	}

	// A brand new Index over the same folder sees the index and the favourite.
	reloaded := New(data)
	if reloaded.Len() != 1 {
		t.Errorf("reloaded index holds %d items, want 1", reloaded.Len())
	}
	if !reloaded.IsFavorite(key) {
		t.Error("the favourite should have survived a reload")
	}

	// Removing a library clears its items.
	if err := reloaded.ForgetLibrary("lib1"); err != nil {
		t.Fatal(err)
	}
	if reloaded.Len() != 0 {
		t.Errorf("after forgetting the library the index holds %d items", reloaded.Len())
	}
}

// A drive that is unplugged between scans must not lose its entries, or the
// grid would empty itself every time someone unplugged a portable disk.
func TestBuildKeepsItemsFromFoldersThatAreNotConnected(t *testing.T) {
	root := t.TempDir()
	a := filepath.Join(root, "a")
	b := filepath.Join(root, "b")
	stamp := time.Date(2024, 5, 5, 5, 5, 5, 0, time.Local)
	newTestImage(t, filepath.Join(a, "one.png"), 6, 6, stamp)
	newTestImage(t, filepath.Join(b, "two.png"), 6, 6, stamp.Add(time.Hour))

	ix := New(filepath.Join(root, "data"))
	if err := ix.Build([]Library{{ID: "A", Path: a}, {ID: "B", Path: b}}, nil); err != nil {
		t.Fatal(err)
	}
	if ix.Len() != 2 {
		t.Fatalf("expected 2 items, got %d", ix.Len())
	}

	// Now rescan with only the first folder reachable.
	if err := ix.Build([]Library{{ID: "A", Path: a}}, nil); err != nil {
		t.Fatal(err)
	}
	if ix.Len() != 2 {
		t.Errorf("the unreachable folder's items were dropped: %d left", ix.Len())
	}
	if _, ok := ix.Get("B:two.png"); !ok {
		t.Error("the item on the disconnected drive should still be indexed")
	}
}

func TestIndexSummariseBucketsByYearAndMonth(t *testing.T) {
	root := t.TempDir()
	lib := filepath.Join(root, "drive")
	newTestImage(t, filepath.Join(lib, "jan.png"), 4, 4, time.Date(2023, 1, 15, 0, 0, 0, 0, time.Local))
	newTestImage(t, filepath.Join(lib, "jun.png"), 4, 4, time.Date(2023, 6, 15, 0, 0, 0, 0, time.Local))
	newTestImage(t, filepath.Join(lib, "old.png"), 4, 4, time.Date(2020, 6, 15, 0, 0, 0, 0, time.Local))

	ix := New(filepath.Join(root, "data"))
	if err := ix.Build([]Library{{ID: "l", Path: lib}}, nil); err != nil {
		t.Fatal(err)
	}
	st, years := ix.Summarise(Query{})
	if st.Total != 3 || st.Images != 3 {
		t.Errorf("stats: %+v", st)
	}
	if len(years) != 2 || years[0].Year != 2023 || years[1].Year != 2020 {
		t.Fatalf("years: %+v", years)
	}
	if years[0].Count != 2 || years[0].Months[0] != 1 || years[0].Months[5] != 1 {
		t.Errorf("2023 buckets are wrong: %+v", years[0])
	}
}

func TestIndexNeighboursRespectFilters(t *testing.T) {
	root := t.TempDir()
	lib := filepath.Join(root, "drive")
	base := time.Date(2024, 6, 1, 0, 0, 0, 0, time.Local)
	newTestImage(t, filepath.Join(lib, "1.png"), 4, 4, base)
	newTestImage(t, filepath.Join(lib, "2.png"), 4, 4, base.Add(time.Hour))
	newTestImage(t, filepath.Join(lib, "3.png"), 4, 4, base.Add(2*time.Hour))

	ix := New(filepath.Join(root, "data"))
	if err := ix.Build([]Library{{ID: "l", Path: lib}}, nil); err != nil {
		t.Fatal(err)
	}
	// Newest first, so the middle item's neighbours are 3 and 1.
	prev, next := ix.Neighbours(Query{}, "l:2.png")
	if prev != "l:3.png" || next != "l:1.png" {
		t.Errorf("got prev=%s next=%s", prev, next)
	}
}
