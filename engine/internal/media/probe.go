package media

import (
	"bytes"
	"encoding/binary"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// Kind splits the library into things you look at and things you play.
type Kind string

const (
	KindImage Kind = "image"
	KindVideo Kind = "video"
	KindOther Kind = "other"
)

var imageExts = map[string]bool{
	".jpg": true, ".jpeg": true, ".jpe": true, ".jfif": true, ".png": true,
	".gif": true, ".bmp": true, ".webp": true, ".heic": true, ".heif": true,
	".avif": true, ".tif": true, ".tiff": true, ".dng": true, ".cr2": true,
	".cr3": true, ".nef": true, ".arw": true, ".raf": true, ".rw2": true,
	".orf": true, ".pef": true, ".srw": true, ".raw": true, ".jxl": true,
}

// videoExts deliberately has no entry for ".ts". It is a transport-stream
// extension, but every TypeScript project on a drive contains .ts sources and
// .d.ts declarations, and a photo library that lists those as videos is far
// worse than one that cannot play an occasional DVR recording.
var videoExts = map[string]bool{
	".mp4": true, ".m4v": true, ".mov": true, ".3gp": true, ".3g2": true,
	".avi": true, ".mkv": true, ".webm": true, ".wmv": true, ".flv": true,
	".mpg": true, ".mpeg": true, ".mts": true, ".m2ts": true,
	".vob": true, ".ogv": true, ".divx": true, ".asf": true, ".rm": true,
}

// tiffExts are RAW/scan formats whose file starts with a TIFF header, so the
// same EXIF parser can read them directly.
var tiffExts = map[string]bool{
	".tif": true, ".tiff": true, ".dng": true, ".cr2": true, ".nef": true,
	".arw": true, ".rw2": true, ".orf": true, ".pef": true, ".srw": true,
}

// KindOf classifies a file purely by its extension.
func KindOf(ext string) Kind {
	ext = strings.ToLower(ext)
	switch {
	case imageExts[ext]:
		return KindImage
	case videoExts[ext]:
		return KindVideo
	}
	return KindOther
}

// IsMedia reports whether a file is something the library should show.
func IsMedia(ext string) bool { return KindOf(ext) != KindOther }

// Meta is everything the index learns from a single file.
type Meta struct {
	Kind     Kind
	Width    int
	Height   int
	Duration float64
	Exif     Exif
}

// Probe reads just enough of a file to describe it: dimensions, duration, and
// EXIF.
func Probe(path string) (Meta, error) {
	ext := strings.ToLower(filepath.Ext(path))
	m := Meta{Kind: KindOf(ext)}

	if m.Kind == KindVideo {
		// A video is described by walking its box headers, which costs a
		// handful of tiny reads wherever the index happens to sit.
		probeVideo(path, &m)
		return m, nil
	}

	// EXIF lives in one APP1 segment, which the JPEG specification caps at
	// 64 KiB, so a still image is fully described by a small read.
	head, err := readHead(path, 64<<10)
	if err != nil {
		return m, err
	}
	if m.Kind == KindImage {
		probeImage(head, ext, &m)
	}
	return m, nil
}

func probeImage(b []byte, ext string, m *Meta) {
	switch ext {
	case ".jpg", ".jpeg", ".jpe", ".jfif":
		if ex, ok := parseJPEGExif(b); ok {
			m.Exif = ex
			m.Width, m.Height = ex.Width, ex.Height
		}
		if w, h := jpegSize(b); w > 0 {
			m.Width, m.Height = w, h
		}
	case ".png":
		m.Width, m.Height = pngSize(b)
	case ".gif":
		m.Width, m.Height = gifSize(b)
	case ".bmp":
		m.Width, m.Height = bmpSize(b)
	case ".webp":
		m.Width, m.Height = webpSize(b)
	case ".heic", ".heif", ".avif":
		m.Width, m.Height = ispeSize(b)
	}
	if tiffExts[ext] {
		if ex, ok := parseTIFF(b); ok {
			m.Exif = ex
			if ex.Width > 0 && ex.Height > 0 {
				m.Width, m.Height = ex.Width, ex.Height
			}
		}
	}
}

// probeVideo describes a clip by walking its box headers. The movie header is
// often at the very end of the file — and can be over a megabyte when a phone
// has tucked motion-photo metadata inside it — so nothing but box headers is
// ever read, and nothing about the media data matters.
func probeVideo(path string, m *Meta) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()
	fi, err := f.Stat()
	if err != nil {
		return
	}

	moovOff, moovLen, ok := locateBox(f, 0, fi.Size(), "moov")
	if !ok {
		return
	}

	var w, h int
	var dur float64

	if off, n, ok := locateBox(f, moovOff, moovOff+moovLen, "mvhd"); ok {
		if b := readAtMost(f, off, n); len(b) > 0 {
			dur = mvhdDuration(b)
		}
	}

	// The video track is whichever one reports a real size; an audio track
	// reports zero and must not overwrite it.
	for off := moovOff; off < moovOff+moovLen; {
		tOff, tLen, ok := locateBox(f, off, moovOff+moovLen, "trak")
		if !ok {
			break
		}
		if kOff, kLen, ok := locateBox(f, tOff, tOff+tLen, "tkhd"); ok {
			if b := readAtMost(f, kOff, kLen); len(b) > 0 {
				if ww, hh := tkhdSize(b); ww > 0 && w == 0 {
					w, h = ww, hh
				}
			}
		}
		off = tOff + tLen
	}

	m.Width, m.Height, m.Duration = w, h, dur
}

// locateBox finds the body of the first direct child of the wanted type within
// [start, end), stepping over each sibling using its declared size. Read from a
// distance and it costs one small read per box, never one per byte.
func locateBox(f *os.File, start, end int64, want string) (off, length int64, ok bool) {
	hdr := make([]byte, 16)
	for at := start; at+8 <= end; {
		if _, err := f.ReadAt(hdr[:8], at); err != nil {
			return 0, 0, false
		}
		size := int64(binary.BigEndian.Uint32(hdr[:4]))
		typ := string(hdr[4:8])
		head := int64(8)
		if size == 1 {
			if _, err := f.ReadAt(hdr[8:16], at+8); err != nil {
				return 0, 0, false
			}
			size = int64(binary.BigEndian.Uint64(hdr[8:16]))
			head = 16
		}
		if size == 0 {
			size = end - at
		}
		if size < head {
			return 0, 0, false
		}
		if typ == want {
			return at + head, size - head, true
		}
		at += size
	}
	return 0, 0, false
}

// readAtMost reads a header, never a whole box: the fields we want are at the
// front.
func readAtMost(f *os.File, off, n int64) []byte {
	if n <= 0 || off < 0 {
		return nil
	}
	if n > 4096 {
		n = 4096
	}
	buf := make([]byte, n)
	read, _ := f.ReadAt(buf, off)
	return buf[:read]
}

/* ---------- still-image headers ---------- */

func jpegSize(b []byte) (int, int) {
	if len(b) < 4 || b[0] != 0xFF || b[1] != 0xD8 {
		return 0, 0
	}
	i := 2
	for i+9 <= len(b) {
		if b[i] != 0xFF {
			i++
			continue
		}
		mk := b[i+1]
		if mk == 0xD8 || mk == 0x01 || (mk >= 0xD0 && mk <= 0xD7) {
			i += 2
			continue
		}
		if mk == 0xDA || mk == 0xD9 {
			return 0, 0
		}
		segLen := int(b[i+2])<<8 | int(b[i+3])
		if segLen < 2 {
			return 0, 0
		}
		// SOF0..SOF15 except the non-frame markers carry the real dimensions.
		if mk >= 0xC0 && mk <= 0xCF && mk != 0xC4 && mk != 0xC8 && mk != 0xCC {
			h := int(b[i+5])<<8 | int(b[i+6])
			w := int(b[i+7])<<8 | int(b[i+8])
			if w > 0 && h > 0 {
				return w, h
			}
			return 0, 0
		}
		i += 2 + segLen
	}
	return 0, 0
}

func pngSize(b []byte) (int, int) {
	sig := []byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A}
	if len(b) < 24 || !bytes.Equal(b[:8], sig) {
		return 0, 0
	}
	return int(binary.BigEndian.Uint32(b[16:20])), int(binary.BigEndian.Uint32(b[20:24]))
}

func gifSize(b []byte) (int, int) {
	if len(b) < 10 || (string(b[:6]) != "GIF87a" && string(b[:6]) != "GIF89a") {
		return 0, 0
	}
	return int(binary.LittleEndian.Uint16(b[6:8])), int(binary.LittleEndian.Uint16(b[8:10]))
}

func bmpSize(b []byte) (int, int) {
	if len(b) < 26 || b[0] != 'B' || b[1] != 'M' {
		return 0, 0
	}
	w := int(int32(binary.LittleEndian.Uint32(b[18:22])))
	h := int(int32(binary.LittleEndian.Uint32(b[22:26])))
	if h < 0 {
		h = -h
	}
	return w, h
}

func webpSize(b []byte) (int, int) {
	if len(b) < 30 || string(b[:4]) != "RIFF" || string(b[8:12]) != "WEBP" {
		return 0, 0
	}
	switch string(b[12:16]) {
	case "VP8X":
		w := int(uint32(b[24])|uint32(b[25])<<8|uint32(b[26])<<16) + 1
		h := int(uint32(b[27])|uint32(b[28])<<8|uint32(b[29])<<16) + 1
		return w, h
	case "VP8L":
		if len(b) < 25 {
			return 0, 0
		}
		bits := uint32(b[21]) | uint32(b[22])<<8 | uint32(b[23])<<16 | uint32(b[24])<<24
		w := int(bits&0x3FFF) + 1
		h := int((bits>>14)&0x3FFF) + 1
		return w, h
	case "VP8 ":
		if len(b) < 30 {
			return 0, 0
		}
		w := int(binary.LittleEndian.Uint16(b[26:28]) & 0x3FFF)
		h := int(binary.LittleEndian.Uint16(b[28:30]) & 0x3FFF)
		return w, h
	}
	return 0, 0
}

// ispeSize returns the largest ispe box in the head of an ISO-BMFF (HEIC/AVIF)
// file. Several are present — thumbnails included — so the biggest one wins.
func ispeSize(b []byte) (int, int) {
	var bw, bh int
	for i := 0; ; {
		j := bytes.Index(b[i:], []byte("ispe"))
		if j < 0 {
			break
		}
		i += j + 4
		if i+12 > len(b) {
			break
		}
		w := int(binary.BigEndian.Uint32(b[i+4 : i+8]))
		h := int(binary.BigEndian.Uint32(b[i+8 : i+12]))
		if w*h > bw*bh {
			bw, bh = w, h
		}
	}
	return bw, bh
}

/* ---------- ISO base media (MP4/MOV/3GP) ---------- */

// tkhdSize reads the track's display size, stored as 16.16 fixed point.
func tkhdSize(b []byte) (int, int) {
	off := 76
	if len(b) > 0 && b[0] == 1 {
		off = 88
	}
	if len(b) < off+8 {
		return 0, 0
	}
	w := int(binary.BigEndian.Uint32(b[off:off+4]) >> 16)
	h := int(binary.BigEndian.Uint32(b[off+4:off+8]) >> 16)
	return w, h
}

func mvhdDuration(b []byte) float64 {
	if len(b) < 20 {
		return 0
	}
	if b[0] == 1 {
		if len(b) < 32 {
			return 0
		}
		ts := binary.BigEndian.Uint32(b[20:24])
		d := binary.BigEndian.Uint64(b[24:32])
		if ts == 0 {
			return 0
		}
		return float64(d) / float64(ts)
	}
	ts := binary.BigEndian.Uint32(b[12:16])
	d := binary.BigEndian.Uint32(b[16:20])
	if ts == 0 {
		return 0
	}
	return float64(d) / float64(ts)
}

/* ---------- capture date from the file name ---------- */

var (
	// IMG_20210617_133337.jpg, VID_20210617_133337.mp4, PXL_20210617_133337123.jpg
	reCompact = regexp.MustCompile(`(19|20)\d{2}[01]\d[0-3]\d[_\-][0-2]\d[0-5]\d[0-5]\d`)
	// Screenshot_2026-05-22-00-56-13-493_... .jpg, 2026-05-22 00-56-13
	reDashed = regexp.MustCompile(`(19|20)\d{2}-[01]\d-[0-3]\d[-_ ][0-2]\d[-.][0-5]\d[-.][0-5]\d`)
	// A bare 14-digit stamp with no separators, e.g. Firefly 20250225205732.png
	reStamp = regexp.MustCompile(`(19|20)\d{2}[01]\d[0-3]\d[0-2]\d[0-5]\d[0-5]\d`)
	// A bare date, as in WhatsApp's IMG-20261001-WA0000.jpg
	reDate = regexp.MustCompile(`(19|20)\d{2}-?[01]\d-?[0-3]\d`)
)

// DateFromName guesses the capture time from common camera and screenshot file
// names. It is used when a file carries no usable EXIF.
//
// File names are full of numbers that are not dates — a Snapchat id looks
// remarkably like a timestamp — so a match only counts when it forms a whole
// number, or a whole number followed only by the milliseconds some camera apps
// append.
func DateFromName(name string) (time.Time, bool) {
	if m, ok := betweenNonDigits(name, reCompact, 3); ok {
		// The compact form keeps the date and time either side of a separator.
		parts := strings.FieldsFunc(m, func(r rune) bool { return r == '_' || r == '-' })
		if len(parts) == 2 {
			d, tm := digitsOf(parts[0]), digitsOf(parts[1])
			if len(d) == 8 && len(tm) >= 6 {
				if ts, err := time.ParseInLocation("20060102150405", d+tm[:6], time.Local); err == nil {
					return ts, true
				}
			}
		}
	}
	if m, ok := betweenNonDigits(name, reDashed, 0); ok {
		if d := digitsOf(m); len(d) >= 14 {
			if ts, err := time.ParseInLocation("20060102150405", d[:14], time.Local); err == nil {
				return ts, true
			}
		}
	}
	// A run of digits with no separators: 20250225205732, or a longer
	// millisecond stamp whose first fourteen digits are the time.
	if m, ok := wholeNumber(name, reStamp, 14, 17); ok {
		if ts, err := time.ParseInLocation("20060102150405", m[:14], time.Local); err == nil {
			return ts, true
		}
	}
	// A bare date, as in WhatsApp's IMG-20261001-WA0000.jpg.
	if m, ok := wholeNumber(name, reDate, 8, 8); ok {
		if ts, err := time.ParseInLocation("20060102", m[:8], time.Local); err == nil {
			return ts, true
		}
	}
	return time.Time{}, false
}

// betweenNonDigits accepts a match only when it starts at a digit boundary and
// is followed by at most extra more digits, which is how much room a camera app
// needs for its milliseconds.
func betweenNonDigits(s string, re *regexp.Regexp, extra int) (string, bool) {
	loc := re.FindStringIndex(s)
	if loc == nil {
		return "", false
	}
	if loc[0] > 0 && isDigit(s[loc[0]-1]) {
		return "", false
	}
	tail := 0
	for i := loc[1]; i < len(s) && isDigit(s[i]); i++ {
		tail++
	}
	if tail > extra {
		return "", false
	}
	return s[loc[0]:loc[1]], true
}

// wholeNumber accepts a match only when the digits it found form a complete
// number of an expected length. This is what stops the eight digits of a
// ten-digit Snapchat id being read as a date.
func wholeNumber(s string, re *regexp.Regexp, min, max int) (string, bool) {
	loc := re.FindStringIndex(s)
	if loc == nil {
		return "", false
	}
	start, end := loc[0], loc[1]
	for start > 0 && isDigit(s[start-1]) {
		start--
	}
	for end < len(s) && isDigit(s[end]) {
		end++
	}
	if n := end - start; n < min || n > max {
		return "", false
	}
	return s[start:end], true
}

func digitsOf(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		if isDigit(s[i]) {
			b.WriteByte(s[i])
		}
	}
	return b.String()
}

func isDigit(c byte) bool { return c >= '0' && c <= '9' }

// plausibleTime rejects capture times that cannot be genuine. A wrong clock in
// a camera, or a random number read out of a file name, would otherwise sort
// the whole timeline around itself.
func plausibleTime(t time.Time) bool {
	if t.IsZero() || t.Year() < 1970 {
		return false
	}
	return t.Before(time.Now().AddDate(1, 0, 0))
}

// CaptureTime is the priority chain for "when was this taken": EXIF, then the
// file name, then the file's own timestamp.
func CaptureTime(e Exif, name string, mod time.Time) time.Time {
	if e.HasShotAt && plausibleTime(e.ShotAt) {
		return e.ShotAt
	}
	if ts, ok := DateFromName(name); ok && plausibleTime(ts) {
		return ts
	}
	return mod
}
