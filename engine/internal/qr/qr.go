// Package qr draws QR codes for the small amount of text this app needs a
// phone to read: the address of the PC on the local network.
//
// It covers exactly that job and no more — byte mode, error correction level L,
// and versions 1 to 5, which hold up to 106 characters. All five are
// single-block codes, so no codeword interleaving is needed, and level L keeps
// the picture as small as it can be. The result is an SVG, so an address costs
// a few hundred bytes of markup rather than a bundled encoder.
package qr

import (
	"fmt"
	"strings"
)

// Level L, versions 1 to 5: how many codewords carry the message and how many
// are spent on error correction, from the tables in the specification.
var (
	msgCodewords = []int{0, 19, 34, 55, 80, 108}
	ecCodewords  = []int{0, 7, 10, 15, 20, 26}
)

// Where the alignment squares sit, as centres, per version. Version 1 has none.
var alignmentCentres = [][]int{
	nil,
	nil,
	{6, 18},
	{6, 22},
	{6, 26},
	{6, 30},
}

// MaxText is the longest address this can draw.
const MaxText = 106 // msgCodewords[5] - 2

// Matrix returns the code for text as a square of modules, true meaning dark,
// along with the number of modules on a side. The mask is chosen the way the
// specification says to, by scoring all eight and keeping the quietest.
func Matrix(text string) (int, [][]bool, error) {
	version, err := pickVersion(text)
	if err != nil {
		return 0, nil, err
	}
	var best [][]bool
	bestScore := 0
	for mask := 0; mask < 8; mask++ {
		grid, err := matrixWithMask(text, version, mask)
		if err != nil {
			return 0, nil, err
		}
		if score := penalty(grid); best == nil || score < bestScore {
			best, bestScore = grid, score
		}
	}
	return 4*version + 17, best, nil
}

// SVG draws the code as an SVG picture with module pixels per square and the
// light border of four squares that the specification asks for, which is what
// lets a camera find the code at all.
func SVG(text string, module int) (string, error) {
	size, grid, err := Matrix(text)
	if err != nil {
		return "", err
	}
	if module < 1 {
		module = 4
	}
	const quiet = 4
	side := (size + quiet*2) * module

	var b strings.Builder
	fmt.Fprintf(&b,
		`<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d"`+
			` shape-rendering="crispEdges" role="img" aria-label="QR code for %s">`,
		side, side, side, side, htmlEscape(text))
	b.WriteString(`<rect width="100%" height="100%" fill="#fff"/><path fill="#000" d="`)
	for r := 0; r < size; r++ {
		for c := 0; c < size; c++ {
			if !grid[r][c] {
				continue
			}
			fmt.Fprintf(&b, "M%d %dh%dv%dh-%dz",
				(c+quiet)*module, (r+quiet)*module, module, module, module)
		}
	}
	b.WriteString(`"/></svg>`)
	return b.String(), nil
}

func htmlEscape(s string) string {
	r := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;")
	return r.Replace(s)
}

func pickVersion(text string) (int, error) {
	for v := 1; v < len(msgCodewords); v++ {
		if len(text) <= msgCodewords[v]-2 {
			return v, nil
		}
	}
	return 0, fmt.Errorf("qr: %d characters is longer than the %d that fit", len(text), MaxText)
}

// matrixWithMask builds one code with a particular mask. Matrix uses it to score
// all eight, and the tests use it to compare a single mask at a time against
// another encoder.
func matrixWithMask(text string, version, mask int) ([][]bool, error) {
	size := 4*version + 17
	grid := newGrid(size)
	reserved := newGrid(size)

	drawFunctionPatterns(grid, reserved, size, version)
	cw := codewords(text, version)
	if want := msgCodewords[version] + ecCodewords[version]; len(cw) != want {
		return nil, fmt.Errorf("qr: built %d codewords, expected %d", len(cw), want)
	}
	drawData(grid, reserved, size, cw)
	applyMask(grid, reserved, size, mask)
	// The format bits are drawn twice: once as part of the function patterns to
	// reserve their squares, and again here once the mask is known.
	drawFormatBits(grid, reserved, size, mask)
	return grid, nil
}

func newGrid(n int) [][]bool {
	g := make([][]bool, n)
	for i := range g {
		g[i] = make([]bool, n)
	}
	return g
}

// set writes a module and records that it belongs to the code's furniture, so
// that data is never placed on top of it and the mask never inverts it.
func set(grid, reserved [][]bool, row, col int, dark bool) {
	grid[row][col] = dark
	reserved[row][col] = true
}

func drawFunctionPatterns(grid, reserved [][]bool, size, version int) {
	// Timing patterns: the alternating lines that let a reader work out how big
	// the squares are. The corner squares overwrite their ends.
	for i := 0; i < size; i++ {
		set(grid, reserved, 6, i, i%2 == 0)
		set(grid, reserved, i, 6, i%2 == 0)
	}
	drawFinder(grid, reserved, size, 0, 0)
	drawFinder(grid, reserved, size, 0, size-7)
	drawFinder(grid, reserved, size, size-7, 0)

	centres := alignmentCentres[version]
	last := len(centres) - 1
	for i, row := range centres {
		for j, col := range centres {
			// The three corners a finder square already occupies.
			if (i == 0 && j == 0) || (i == 0 && j == last) || (i == last && j == 0) {
				continue
			}
			drawAlignment(grid, reserved, row, col)
		}
	}
	drawFormatBits(grid, reserved, size, 0) // a placeholder, replaced with the real mask
}

// drawFinder draws one corner square: a seven-wide ring with a three-wide block
// inside it, and the light separator around both.
func drawFinder(grid, reserved [][]bool, size, r0, c0 int) {
	for dr := -1; dr <= 7; dr++ {
		for dc := -1; dc <= 7; dc++ {
			row, col := r0+dr, c0+dc
			if row < 0 || row >= size || col < 0 || col >= size {
				continue
			}
			dark := false
			if dr >= 0 && dr < 7 && dc >= 0 && dc < 7 {
				ring := dr == 0 || dr == 6 || dc == 0 || dc == 6
				core := dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4
				dark = ring || core
			}
			set(grid, reserved, row, col, dark)
		}
	}
}

// drawAlignment draws one of the small five-wide squares that help a reader
// cope with a photograph taken at an angle.
func drawAlignment(grid, reserved [][]bool, centreRow, centreCol int) {
	for dr := -2; dr <= 2; dr++ {
		for dc := -2; dc <= 2; dc++ {
			edge := max(abs(dr), abs(dc))
			set(grid, reserved, centreRow+dr, centreCol+dc, edge != 1)
		}
	}
}

// drawData lays the codewords out in the two-wide columns that run up and down
// the code, missing out everything the function patterns already took.
func drawData(grid, reserved [][]bool, size int, data []byte) {
	bit := 0
	for right := size - 1; right >= 1; right -= 2 {
		if right == 6 {
			right = 5 // no codeword bits in the vertical timing column
		}
		for step := 0; step < size; step++ {
			for j := 0; j < 2; j++ {
				col := right - j
				row := step
				if (right+1)&2 == 0 {
					row = size - 1 - step
				}
				if reserved[row][col] || bit >= len(data)*8 {
					continue
				}
				grid[row][col] = data[bit>>3]>>(7-(bit&7))&1 == 1
				bit++
			}
		}
	}
}

func applyMask(grid, reserved [][]bool, size, mask int) {
	for row := 0; row < size; row++ {
		for col := 0; col < size; col++ {
			if !reserved[row][col] && maskAt(mask, row, col) {
				grid[row][col] = !grid[row][col]
			}
		}
	}
}

func maskAt(mask, row, col int) bool {
	switch mask {
	case 0:
		return (row+col)%2 == 0
	case 1:
		return row%2 == 0
	case 2:
		return col%3 == 0
	case 3:
		return (row+col)%3 == 0
	case 4:
		return (row/2+col/3)%2 == 0
	case 5:
		return row*col%2+row*col%3 == 0
	case 6:
		return (row*col%2+row*col%3)%2 == 0
	case 7:
		return ((row+col)%2+row*col%3)%2 == 0
	}
	return false
}

// drawFormatBits writes which error correction level and which mask are in use,
// twice, so a reader that starts from any corner can find it.
func drawFormatBits(grid, reserved [][]bool, size, mask int) {
	// Level L is 01, so the five data bits are 01 then the three mask bits; the
	// other ten are a BCH code over them, and the whole lot is masked so that an
	// all-light code cannot occur.
	data := 1<<3 | mask
	rem := data
	for i := 0; i < 10; i++ {
		rem = (rem << 1) ^ ((rem >> 9) * 0x537)
	}
	bits := (data<<10 | rem) ^ 0x5412

	for i := 0; i <= 5; i++ {
		set(grid, reserved, i, 8, bitOf(bits, i))
	}
	set(grid, reserved, 7, 8, bitOf(bits, 6))
	set(grid, reserved, 8, 8, bitOf(bits, 7))
	set(grid, reserved, 8, 7, bitOf(bits, 8))
	for i := 9; i < 15; i++ {
		set(grid, reserved, 8, 14-i, bitOf(bits, i))
	}
	for i := 0; i < 8; i++ {
		set(grid, reserved, 8, size-1-i, bitOf(bits, i))
	}
	for i := 8; i < 15; i++ {
		set(grid, reserved, size-15+i, 8, bitOf(bits, i))
	}
	set(grid, reserved, size-8, 8, true) // always dark
}

func bitOf(v, i int) bool { return v>>i&1 == 1 }

// codewords turns text into the message codewords followed by their error
// correction, ready to be laid out.
func codewords(text string, version int) []byte {
	body := []byte(text)
	w := &bitWriter{}
	w.put(0b0100, 4) // byte mode
	w.put(len(body), 8)
	for _, b := range body {
		w.put(int(b), 8)
	}

	total := msgCodewords[version]
	for i := 0; i < 4 && w.bits < total*8; i++ {
		w.put(0, 1) // terminator
	}
	for w.bits%8 != 0 {
		w.put(0, 1)
	}
	out := w.data
	for i := 0; len(out) < total; i++ {
		if i%2 == 0 {
			out = append(out, 0xEC)
		} else {
			out = append(out, 0x11)
		}
	}
	return append(out, rsEncode(out, ecCodewords[version])...)
}

type bitWriter struct {
	data []byte
	bits int
}

func (w *bitWriter) put(value, width int) {
	for i := width - 1; i >= 0; i-- {
		if w.bits%8 == 0 {
			w.data = append(w.data, 0)
		}
		if value>>i&1 == 1 {
			w.data[len(w.data)-1] |= 1 << (7 - w.bits%8)
		}
		w.bits++
	}
}

/* ---- arithmetic in GF(256), which is what the error correction is built on ---- */

var (
	gfExp [512]byte
	gfLog [256]byte
)

func init() {
	x := 1
	for i := 0; i < 255; i++ {
		gfExp[i] = byte(x)
		gfLog[byte(x)] = byte(i)
		x <<= 1
		if x&0x100 != 0 {
			x ^= 0x11D // the field's polynomial, x^8+x^4+x^3+x^2+1
		}
	}
	for i := 255; i < 512; i++ {
		gfExp[i] = gfExp[i-255]
	}
}

func gfMul(a, b byte) byte {
	if a == 0 || b == 0 {
		return 0
	}
	return gfExp[int(gfLog[a])+int(gfLog[b])]
}

// rsEncode returns the error correction codewords for a message, using the
// Reed-Solomon code the specification names for this size.
func rsEncode(data []byte, count int) []byte {
	gen := rsGenerator(count)
	rem := make([]byte, count)
	for _, b := range data {
		factor := b ^ rem[0]
		copy(rem, rem[1:])
		rem[count-1] = 0
		if factor == 0 {
			continue
		}
		for i := 0; i < count; i++ {
			rem[i] ^= gfMul(gen[i+1], factor)
		}
	}
	return rem
}

// rsGenerator builds the polynomial whose roots are the first count powers of
// the field's generator.
func rsGenerator(count int) []byte {
	gen := []byte{1}
	for i := 0; i < count; i++ {
		next := make([]byte, len(gen)+1)
		root := gfExp[i]
		for j, c := range gen {
			next[j] ^= c
			next[j+1] ^= gfMul(c, root)
		}
		gen = next
	}
	return gen
}

/* ---- mask scoring ---- */

// penalty scores a finished code the way the specification asks, so that the
// quietest of the eight masks can be kept. Lower is better.
func penalty(grid [][]bool) int {
	size := len(grid)
	score := 0

	// Rule 1: long runs of one colour are an invitation to misread the code for
	// a finder square.
	line := func(at func(int) bool) int {
		s, run := 0, 1
		for i := 1; i < size; i++ {
			if at(i) == at(i-1) {
				run++
				continue
			}
			if run >= 5 {
				s += 3 + run - 5
			}
			run = 1
		}
		if run >= 5 {
			s += 3 + run - 5
		}
		return s
	}
	for i := 0; i < size; i++ {
		row, col := i, i
		score += line(func(c int) bool { return grid[row][c] })
		score += line(func(r int) bool { return grid[r][col] })
	}

	// Rule 2: blocks of one colour.
	for r := 0; r < size-1; r++ {
		for c := 0; c < size-1; c++ {
			v := grid[r][c]
			if grid[r][c+1] == v && grid[r+1][c] == v && grid[r+1][c+1] == v {
				score += 3
			}
		}
	}

	// Rule 3: anything that looks like a finder square, which would confuse a
	// reader about where the code actually starts.
	finderish := [11]bool{true, false, true, true, true, false, true, false, false, false, false}
	reversed := [11]bool{}
	for i := range finderish {
		reversed[i] = finderish[len(finderish)-1-i]
	}
	count := func(at func(int) bool) int {
		n := 0
		for i := 0; i+len(finderish) <= size; i++ {
			fwd, rev := true, true
			for j := range finderish {
				v := at(i + j)
				fwd = fwd && v == finderish[j]
				rev = rev && v == reversed[j]
			}
			if fwd {
				n++
			}
			if rev {
				n++
			}
		}
		return n * 40
	}
	for i := 0; i < size; i++ {
		row, col := i, i
		score += count(func(c int) bool { return grid[row][c] })
		score += count(func(r int) bool { return grid[r][col] })
	}

	// Rule 4: how far the balance of dark to light is from even, measured in
	// whole steps of five per cent. ZXing's form is used here because it works
	// from the counts directly instead of rounding the percentage to a whole
	// number first, which is where implementations tend to disagree.
	dark := 0
	for r := 0; r < size; r++ {
		for c := 0; c < size; c++ {
			if grid[r][c] {
				dark++
			}
		}
	}
	total := size * size
	if dark*2 > total {
		score += (dark*2 - total) * 10 / total * 10
	} else {
		score += (total - dark*2) * 10 / total * 10
	}

	return score
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
