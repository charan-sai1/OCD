package media

import (
	"encoding/binary"
	"io"
	"os"
	"strings"
	"time"
)

// Exif is the metadata the app surfaces: when a photo was taken, what took it,
// and where. Everything is read straight from the file, with no helper tools.
type Exif struct {
	Make, Model   string
	Width, Height int
	ShotAt        time.Time
	HasShotAt     bool
	Orientation   int
	ISO           int
	FNumber       float64
	Exposure      float64 // seconds
	FocalLength   float64 // mm
	Lat, Lon      float64
	HasGPS        bool
}

// readHead reads up to n bytes from the start of a file. Every probe below
// works from this one read, so indexing a drive costs one open per file.
func readHead(path string, n int64) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	buf := make([]byte, n)
	m, err := io.ReadFull(f, buf)
	if err != nil && err != io.ErrUnexpectedEOF && err != io.EOF {
		return nil, err
	}
	return buf[:m], nil
}

/* ---------- TIFF / EXIF ---------- */

type tiffReader struct {
	b     []byte
	order binary.ByteOrder
}

type ifdEntry struct {
	typ  uint16
	n    uint32
	data []byte
}

func typeSize(t uint16) int {
	switch t {
	case 1, 2, 6, 7:
		return 1
	case 3, 8:
		return 2
	case 4, 9, 11:
		return 4
	case 5, 10, 12:
		return 8
	}
	return 0
}

// ifd reads one image file directory and returns the offset of the next one.
func (t tiffReader) ifd(off int) (map[uint16]ifdEntry, int, bool) {
	out := map[uint16]ifdEntry{}
	if off < 0 || off+2 > len(t.b) {
		return out, 0, false
	}
	n := int(t.order.Uint16(t.b[off : off+2]))
	pos := off + 2
	for i := 0; i < n; i++ {
		if pos+12 > len(t.b) {
			break
		}
		e := t.b[pos : pos+12]
		tag := t.order.Uint16(e[0:2])
		typ := t.order.Uint16(e[2:4])
		cnt := t.order.Uint32(e[4:8])
		sz := typeSize(typ) * int(cnt)
		var data []byte
		switch {
		case sz > 0 && sz <= 4:
			data = e[8 : 8+sz]
		case sz > 4:
			if o := int(t.order.Uint32(e[8:12])); o >= 0 && o+sz <= len(t.b) {
				data = t.b[o : o+sz]
			}
		}
		if data != nil {
			out[tag] = ifdEntry{typ: typ, n: cnt, data: data}
		}
		pos += 12
	}
	next := 0
	if pos+4 <= len(t.b) {
		next = int(t.order.Uint32(t.b[pos : pos+4]))
	}
	return out, next, true
}

func (t tiffReader) uints(e ifdEntry) []uint32 {
	var out []uint32
	switch e.typ {
	case 1, 6, 7:
		for _, b := range e.data {
			out = append(out, uint32(b))
		}
	case 3, 8:
		for i := 0; i+2 <= len(e.data); i += 2 {
			out = append(out, uint32(t.order.Uint16(e.data[i:i+2])))
		}
	case 4, 9:
		for i := 0; i+4 <= len(e.data); i += 4 {
			out = append(out, t.order.Uint32(e.data[i:i+4]))
		}
	}
	return out
}

// ratio reads the first rational of an entry as a float.
func (t tiffReader) ratio(e ifdEntry) float64 {
	if e.typ != 5 && e.typ != 10 {
		return 0
	}
	if len(e.data) < 8 {
		return 0
	}
	num := int32(t.order.Uint32(e.data[0:4]))
	den := int32(t.order.Uint32(e.data[4:8]))
	if den == 0 {
		return 0
	}
	return float64(num) / float64(den)
}

func (t tiffReader) str(e ifdEntry) string {
	if e.typ != 2 {
		return ""
	}
	return strings.TrimSpace(strings.TrimRight(string(e.data), "\x00"))
}

func (t tiffReader) num(e ifdEntry) int {
	if u := t.uints(e); len(u) > 0 {
		return int(u[0])
	}
	return 0
}

// exifTime accepts the several spellings cameras use for the same moment.
func exifTime(s string) (time.Time, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}, false
	}
	for _, layout := range []string{
		"2006:01:02 15:04:05",
		"2006-01-02 15:04:05",
		"2006:01:02 15:04:05.000",
		"2006:01:02T15:04:05",
	} {
		if t, err := time.ParseInLocation(layout, s, time.Local); err == nil && t.Year() > 1970 {
			return t, true
		}
	}
	return time.Time{}, false
}

func dms(v [][2]uint32) float64 {
	if len(v) < 3 {
		return 0
	}
	f := func(p [2]uint32) float64 {
		if p[1] == 0 {
			return 0
		}
		return float64(p[0]) / float64(p[1])
	}
	return f(v[0]) + f(v[1])/60 + f(v[2])/3600
}

func (t tiffReader) rationals(e ifdEntry) [][2]uint32 {
	if e.typ != 5 && e.typ != 10 {
		return nil
	}
	var out [][2]uint32
	for i := 0; i+8 <= len(e.data); i += 8 {
		out = append(out, [2]uint32{t.order.Uint32(e.data[i : i+4]), t.order.Uint32(e.data[i+4 : i+8])})
	}
	return out
}

// parseTIFF walks the IFD chain of an "Exif\0\0" payload.
func parseTIFF(b []byte) (Exif, bool) {
	var out Exif
	if len(b) < 8 {
		return out, false
	}
	var order binary.ByteOrder
	switch {
	case b[0] == 'I' && b[1] == 'I':
		order = binary.LittleEndian
	case b[0] == 'M' && b[1] == 'M':
		order = binary.BigEndian
	default:
		return out, false
	}
	if order.Uint16(b[2:4]) != 0x2A {
		return out, false
	}
	t := tiffReader{b: b, order: order}
	ifd0, _, ok := t.ifd(int(order.Uint32(b[4:8])))
	if !ok {
		return out, false
	}

	out.Make = t.str(ifd0[0x010F])
	out.Model = t.str(ifd0[0x0110])
	out.Orientation = t.num(ifd0[0x0112])
	out.Width = t.num(ifd0[0x0100])
	out.Height = t.num(ifd0[0x0101])

	// DateTimeOriginal lives in the Exif sub-IFD; fall back to IFD0's DateTime.
	sub := map[uint16]ifdEntry{}
	if e, ok := ifd0[0x8769]; ok {
		if off := int(order.Uint32(pad4(e.data))); off > 0 && off < len(b) {
			sub, _, _ = t.ifd(off)
		}
	}
	for _, tag := range []uint16{0x9003, 0x9004} {
		if e, ok := sub[tag]; ok {
			if ts, ok2 := exifTime(t.str(e)); ok2 {
				out.ShotAt, out.HasShotAt = ts, true
				break
			}
		}
	}
	if !out.HasShotAt {
		if e, ok := ifd0[0x0132]; ok {
			if ts, ok2 := exifTime(t.str(e)); ok2 {
				out.ShotAt, out.HasShotAt = ts, true
			}
		}
	}

	if e, ok := sub[0x8827]; ok {
		out.ISO = t.num(e)
	}
	if e, ok := sub[0x829D]; ok {
		out.FNumber = t.ratio(e)
	}
	if e, ok := sub[0x829A]; ok {
		out.Exposure = t.ratio(e)
	}
	if e, ok := sub[0x920A]; ok {
		out.FocalLength = t.ratio(e)
	}
	if w, h := t.num(sub[0xA002]), t.num(sub[0xA003]); w > 0 && h > 0 {
		out.Width, out.Height = w, h
	}

	if e, ok := ifd0[0x8825]; ok {
		if off := int(order.Uint32(pad4(e.data))); off > 0 && off < len(b) {
			if gps, _, ok2 := t.ifd(off); ok2 {
				lat := dms(t.rationals(gps[0x0002]))
				lon := dms(t.rationals(gps[0x0004]))
				if lat != 0 || lon != 0 {
					if ref := t.str(gps[0x0001]); ref == "S" {
						lat = -lat
					}
					if ref := t.str(gps[0x0003]); ref == "W" {
						lon = -lon
					}
					out.Lat, out.Lon, out.HasGPS = lat, lon, true
				}
			}
		}
	}
	return out, true
}

// pad4 returns exactly four bytes, which is how IFD pointer values are stored
// whether the entry used the inline slot or a long.
func pad4(b []byte) []byte {
	if len(b) >= 4 {
		return b[:4]
	}
	out := make([]byte, 4)
	copy(out, b)
	return out
}

// parseJPEGExif finds the APP1 segment and parses it.
func parseJPEGExif(b []byte) (Exif, bool) {
	if len(b) < 4 || b[0] != 0xFF || b[1] != 0xD8 {
		return Exif{}, false
	}
	i := 2
	for i+4 <= len(b) {
		if b[i] != 0xFF {
			i++
			continue
		}
		marker := b[i+1]
		switch {
		case marker == 0xD8 || marker == 0x01 || (marker >= 0xD0 && marker <= 0xD7):
			i += 2
			continue
		case marker == 0xDA || marker == 0xD9: // scan data begins
			return Exif{}, false
		}
		segLen := int(b[i+2])<<8 | int(b[i+3])
		if segLen < 2 || i+2+segLen > len(b) {
			return Exif{}, false
		}
		seg := b[i+4 : i+2+segLen]
		if marker == 0xE1 && len(seg) >= 6 && string(seg[:6]) == "Exif\x00\x00" {
			return parseTIFF(seg[6:])
		}
		i += 2 + segLen
	}
	return Exif{}, false
}
