package qr

import (
	"bytes"
	"fmt"
	"strings"
	"testing"
)

// The worked example from the specification: version 1-M, numeric "01234567",
// whose error correction codewords are printed in the standard itself.
func TestErrorCorrectionMatchesTheWorkedExample(t *testing.T) {
	data := []byte{0x10, 0x20, 0x0C, 0x56, 0x61, 0x80, 0xEC, 0x11,
		0xEC, 0x11, 0xEC, 0x11, 0xEC, 0x11, 0xEC, 0x11}
	want := []byte{0xA5, 0x24, 0xD4, 0xC1, 0xED, 0x36, 0xC7, 0x87, 0x2C, 0x55}
	if got := rsEncode(data, 10); !bytes.Equal(got, want) {
		t.Errorf("error correction codewords\n got  % X\n want % X", got, want)
	}
}

// Pinned output from an unrelated encoder (the qrcode-generator package, told to
// use plain byte mode and error correction level L), so that a change to the
// layout, the error correction or the format bits cannot slip through. The mask
// is not pinned: a different mask is still a valid code, and this package is
// allowed to prefer a different one, so any of the eight matching is enough.
var (
	refV1 = []string{
		"111111100100101111111",
		"100000101101001000001",
		"101110101101101011101",
		"101110100101001011101",
		"101110101001001011101",
		"100000101000001000001",
		"111111101010101111111",
		"000000001110000000000",
		"110100110111001110110",
		"001101000110110110001",
		"010000100000101100101",
		"100100001000011011011",
		"110111111110100101000",
		"000000001100111100001",
		"111111101011101011110",
		"100000100111000010001",
		"101110100010010111000",
		"101110101101111110011",
		"101110100110100010101",
		"100000101011100101000",
		"111111101111011000010",
	}
	refV3 = []string{
		"11111110100001111100101111111",
		"10000010100110001111101000001",
		"10111010110010111100001011101",
		"10111010111011111000101011101",
		"10111010011011111100101011101",
		"10000010111001000011101000001",
		"11111110101010101010101111111",
		"00000000001100100100000000000",
		"11001110001010010111000101111",
		"00001000000001011000111011111",
		"11011010111001010100001000001",
		"01001101010010011101010100011",
		"10100011000101100111000100010",
		"11101001001010111100111011011",
		"01110010110111110100010110101",
		"10101101100101010111111010011",
		"01111110101011010110100001010",
		"10011101001001111000101010011",
		"00001111011000010100000111101",
		"00111101110010110100010100011",
		"11010010100101110111111111001",
		"00000000101010010110100010001",
		"11111110000111111011101011101",
		"10000010110101010110100010000",
		"10111010111011000101111110010",
		"10111010011001111111100101101",
		"10111010010000010010000101011",
		"10000010100010101111111000011",
		"11111110101101100101110000010",
	}
)

func TestAPictureAnIndependentEncoderWouldAgreeWith(t *testing.T) {
	for _, c := range []struct {
		text    string
		version int
		ref     []string
	}{
		{"http://a.b:8090", 1, refV1},
		{"http://192.168.100.200:8090/ocd-manager", 3, refV3},
	} {
		matched := -1
		for mask := 0; mask < 8; mask++ {
			grid, err := matrixWithMask(c.text, c.version, mask)
			if err != nil {
				t.Fatal(err)
			}
			if sameAs(grid, c.ref) {
				matched = mask
				break
			}
		}
		if matched < 0 {
			t.Errorf("version %d: no mask of ours reproduces the reference picture", c.version)
			continue
		}
		t.Logf("version %d agrees with the reference under mask %d", c.version, matched)
	}
}

func sameAs(grid [][]bool, ref []string) bool {
	if len(grid) != len(ref) {
		return false
	}
	for r := range grid {
		if len(grid[r]) != len(ref[r]) {
			return false
		}
		for c := range grid[r] {
			if grid[r][c] != (ref[r][c] == '1') {
				return false
			}
		}
	}
	return true
}

// The picture has to say which level and which mask it used, twice, in the two
// rows and columns that meet the corner squares.
func TestThePictureSaysWhichMaskItUsed(t *testing.T) {
	const text = "http://192.168.1.10:8090"
	for mask := 0; mask < 8; mask++ {
		grid, err := matrixWithMask(text, 2, mask)
		if err != nil {
			t.Fatal(err)
		}
		bits := 0
		put := func(i, row, col int) {
			if grid[row][col] {
				bits |= 1 << i
			}
		}
		for i := 0; i <= 5; i++ {
			put(i, i, 8)
		}
		put(6, 7, 8)
		put(7, 8, 8)
		put(8, 8, 7)
		for i := 9; i < 15; i++ {
			put(i, 8, 14-i)
		}
		if got, want := (bits^0x5412)>>10, 1<<3|mask; got != want {
			t.Errorf("mask %d: the picture records %#05b as its level and mask, expected %#05b", mask, got, want)
		}
	}
}

func TestTheChosenPictureIsOneOfTheEight(t *testing.T) {
	const text = "http://192.168.1.10:8090"
	size, chosen, err := Matrix(text)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for mask := 0; mask < 8; mask++ {
		grid, err := matrixWithMask(text, (size-17)/4, mask)
		if err != nil {
			t.Fatal(err)
		}
		if sameAs(grid, rowsOf(chosen)) {
			found = true
			break
		}
	}
	if !found {
		t.Error("the picture handed back is not one of the eight masks")
	}
}

func rowsOf(grid [][]bool) []string {
	out := make([]string, len(grid))
	for r := range grid {
		var sb strings.Builder
		for c := range grid[r] {
			if grid[r][c] {
				sb.WriteByte('1')
			} else {
				sb.WriteByte('0')
			}
		}
		out[r] = sb.String()
	}
	return out
}

func TestTheCornerSquaresTimingAndDarkModuleAreThere(t *testing.T) {
	size, grid, err := Matrix("http://a.b:8090")
	if err != nil {
		t.Fatal(err)
	}
	for _, corner := range []struct{ row, col int }{{0, 0}, {0, size - 7}, {size - 7, 0}} {
		for dr := 0; dr < 7; dr++ {
			for dc := 0; dc < 7; dc++ {
				ring := dr == 0 || dr == 6 || dc == 0 || dc == 6
				core := dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4
				if grid[corner.row+dr][corner.col+dc] != (ring || core) {
					t.Fatalf("the corner square at (%d,%d) is wrong at (%d,%d)",
						corner.row, corner.col, dr, dc)
				}
			}
		}
	}
	for i := 8; i < size-8; i++ {
		if grid[6][i] != (i%2 == 0) || grid[i][6] != (i%2 == 0) {
			t.Fatalf("the timing patterns are wrong at %d", i)
		}
	}
	if !grid[size-8][8] {
		t.Error("the module that is always dark came out light")
	}
}

func TestAnAddressThatIsTooLongIsRefused(t *testing.T) {
	if _, _, err := Matrix(strings.Repeat("a", MaxText)); err != nil {
		t.Errorf("an address of exactly the longest length was refused: %v", err)
	}
	if _, _, err := Matrix(strings.Repeat("a", MaxText+1)); err == nil {
		t.Error("an address longer than can be drawn was accepted")
	}
	// Each version should take exactly what its table says and no more.
	for v := 1; v < len(msgCodewords); v++ {
		fit := strings.Repeat("a", msgCodewords[v]-2)
		size, _, err := Matrix(fit)
		if err != nil {
			t.Fatalf("version %d should hold %d bytes: %v", v, len(fit), err)
		}
		if want := 4*v + 17; size != want {
			t.Errorf("version %d drew %d modules a side, expected %d", v, size, want)
		}
		over := strings.Repeat("a", msgCodewords[v]-1)
		if size, _, err := Matrix(over); err == nil && size == 4*v+17 {
			t.Errorf("version %d accepted %d bytes, which is one too many", v, len(over))
		}
	}
}

func TestTheDrawingHasAQuietBorderAndOneSquarePerDarkModule(t *testing.T) {
	const text = "http://192.168.1.10:8090"
	const module = 4
	size, grid, err := Matrix(text)
	if err != nil {
		t.Fatal(err)
	}
	svg, err := SVG(text, module)
	if err != nil {
		t.Fatal(err)
	}

	dark := 0
	for r := range grid {
		for c := range grid[r] {
			if grid[r][c] {
				dark++
			}
		}
	}
	squares := strings.Count(svg, fmt.Sprintf("h%dv%dh-%dz", module, module, module))
	if squares != dark {
		t.Errorf("drew %d squares for %d dark modules", squares, dark)
	}
	side := (size + 8) * module // the four modules of border on each side
	if !strings.Contains(svg, fmt.Sprintf(`width="%d" height="%d"`, side, side)) {
		t.Errorf("expected a picture %d pixels across with room for the border:\n%s", side, svg[:min(120, len(svg))])
	}
	if !strings.Contains(svg, `fill="#fff"`) || !strings.Contains(svg, `fill="#000"`) {
		t.Error("the picture should be dark squares on a light background")
	}
}

func TestAnAddressTooLongForTheDrawingIsReportedNotDrawn(t *testing.T) {
	if _, err := SVG(strings.Repeat("a", MaxText+1), 4); err == nil {
		t.Error("a drawing was produced for an address that cannot be encoded")
	}
}
