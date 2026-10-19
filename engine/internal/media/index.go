// Package media builds and queries a local index of the photos and videos in
// the saved folders. It reads only metadata, so browsing never has to walk a
// slow drive again.
package media

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// indexVersion is raised whenever the way files are read changes. Bumping it
// makes the next scan re-read everything instead of reusing cached entries,
// which is the only way a correction to date or dimension handling reaches
// files that were already indexed.
const indexVersion = 4

// Library is the minimum a scan needs to know about a saved folder.
type Library struct {
	ID   string
	Path string
}

// Item is one photo or video.
type Item struct {
	Lib      string  `json:"lib"`
	Rel      string  `json:"rel"` // slash-separated path inside the library
	Name     string  `json:"name"`
	Ext      string  `json:"ext"`
	Kind     Kind    `json:"kind"`
	Size     int64   `json:"size"`
	ModTime  int64   `json:"mtime"`
	ShotAt   int64   `json:"shot"`
	W        int     `json:"w"`
	H        int     `json:"h"`
	Orient   int     `json:"orient,omitempty"`
	Duration float64 `json:"dur,omitempty"`

	Make     string  `json:"make,omitempty"`
	Model    string  `json:"model,omitempty"`
	ISO      int     `json:"iso,omitempty"`
	FNumber  float64 `json:"fnumber,omitempty"`
	Exposure float64 `json:"exposure,omitempty"`
	Focal    float64 `json:"focal,omitempty"`
	Lat      float64 `json:"lat,omitempty"`
	Lon      float64 `json:"lon,omitempty"`
	HasGPS   bool    `json:"gps,omitempty"`
}

// Key is a stable identity for an item that survives a rescan and a drive
// being reconnected under a different letter.
func (it Item) Key() string { return it.Lib + ":" + it.Rel }

// TakenAt is the capture time as a Time.
func (it Item) TakenAt() time.Time { return time.Unix(it.ShotAt, 0) }

// underRoot turns a path into a slash-separated prefix relative to the library
// root, with a trailing slash, so everything beneath it can be matched with a
// plain string prefix. An unreadable root yields "", which matches everything.
func underRoot(root, p string) (string, bool) {
	if p == root {
		return "", true
	}
	rel, err := filepath.Rel(root, p)
	if err != nil || strings.HasPrefix(rel, "..") {
		return "", false
	}
	return filepath.ToSlash(rel) + "/", true
}

// appendKeptUnder re-adds the previously indexed items that live under a folder
// which could not be read this time. They cannot have been found by the walk,
// so this adds no duplicates, and it means a dropped connection or a bad sector
// shows as a stale entry rather than as photos that have gone missing.
func appendKeptUnder(items []Item, prev map[string]Item, libID string, prefixes []string) []Item {
	for _, it := range prev {
		if it.Lib != libID {
			continue
		}
		for _, pref := range prefixes {
			if strings.HasPrefix(it.Rel, pref) {
				items = append(items, it)
				break
			}
		}
	}
	return items
}

// Progress reports how a scan is going.
type Progress struct {
	Phase   string
	Done    int
	Message string
	// Skipped counts files that could not be read at all. A scan that quietly
	// leaves files out is the one failure a library index must never hide.
	Skipped int
}

// Bucket counts items in one month of one year.
type Bucket struct {
	Year  int `json:"year"`
	Month int `json:"month"`
	Count int `json:"count"`
}

// YearBucket is one year of the timeline, with a count per month so the
// scrubber can draw its density bars without a second request.
type YearBucket struct {
	Year   int     `json:"year"`
	Count  int     `json:"count"`
	Months [12]int `json:"months"`
}

// Stats summarises a filtered view.
type Stats struct {
	Total  int   `json:"total"`
	Images int   `json:"images"`
	Videos int   `json:"videos"`
	Favs   int   `json:"favorites"`
	Bytes  int64 `json:"bytes"`
}

// Query selects a page of the library.
type Query struct {
	Lib     string
	Kind    string // "", "image", "video"
	Fav     bool
	Search  string
	Year    int
	Month   int
	Before  int64  // cursor: capture time of the last item seen
	BefName string // cursor: its name, to break timestamp ties
	Limit   int
}

var skipNames = map[string]bool{
	"$RECYCLE.BIN": true, "System Volume Information": true, ".Spotlight-V100": true,
	".Trashes": true, ".fseventsd": true, "@eaDir": true, "#recycle": true,
	"node_modules": true, ".git": true,
}

func skipDir(name string) bool {
	if skipNames[name] {
		return true
	}
	return strings.HasPrefix(name, ".") && name != "." && name != ".."
}

// junkFiles are the non-media files that still carry a media extension. macOS
// writes "._IMG_0040.JPG" resource-fork stubs next to every real file when a
// card or drive is written from a Mac, and Windows leaves its own droppings.
// Without this filter they show up as broken tiles in the grid.
func junkFile(name string) bool {
	if strings.HasPrefix(name, "._") || strings.HasPrefix(name, "~$") {
		return true
	}
	switch strings.ToLower(name) {
	case "thumbs.db", "ehthumbs.db", "desktop.ini", ".ds_store", "icon\r":
		return true
	}
	return false
}

// Index is the in-memory, disk-backed catalogue of the library.
type Index struct {
	mu      sync.RWMutex
	dir     string
	items   []Item // sorted newest first
	pos     map[string]int
	favs    map[string]bool
	scanned time.Time
}

// New loads the index and favourites from dir, creating them on first run.
func New(dir string) *Index {
	ix := &Index{dir: dir, pos: map[string]int{}, favs: map[string]bool{}}
	_ = ix.load()
	_ = ix.loadFavs()
	return ix
}

func (ix *Index) indexPath() string   { return filepath.Join(ix.dir, "media-index.jsonl") }
func (ix *Index) favPath() string     { return filepath.Join(ix.dir, "favorites.json") }
func (ix *Index) versionPath() string { return filepath.Join(ix.dir, "media-index.version") }

// storedVersion reports the format the index on disk was written with. When it
// does not match the running code the cached entries are discarded rather than
// reused, so an upgrade that changes how files are read actually takes effect.
func (ix *Index) storedVersion() int {
	b, err := os.ReadFile(ix.versionPath())
	if err != nil {
		return 0
	}
	n, err := strconv.Atoi(strings.TrimSpace(string(b)))
	if err != nil {
		return 0
	}
	return n
}

func (ix *Index) writeVersion() error {
	if err := os.MkdirAll(ix.dir, 0o755); err != nil {
		return err
	}
	return os.WriteFile(ix.versionPath(), []byte(strconv.Itoa(indexVersion)+"\n"), 0o644)
}

func (ix *Index) load() error {
	f, err := os.Open(ix.indexPath())
	if err != nil {
		return err
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 1<<20), 1<<20)
	var items []Item
	for sc.Scan() {
		line := sc.Bytes()
		if len(line) == 0 {
			continue
		}
		var it Item
		if json.Unmarshal(line, &it) == nil && it.Rel != "" {
			items = append(items, it)
		}
	}
	ix.items = items
	ix.ready()
	if fi, err := os.Stat(ix.indexPath()); err == nil {
		ix.scanned = fi.ModTime()
	}
	return sc.Err()
}

// ready puts the items into display order and rebuilds the key lookup. The two
// steps belong together and in this order: reindex records where each key sits
// in the slice, so sorting afterwards would leave every lookup pointing at the
// wrong file. Callers hold the write lock.
func (ix *Index) ready() {
	ix.sortItems()
	ix.reindex()
}

// sortItems orders the library newest first, with the file name breaking ties
// so that paging stays stable across rescans.
func (ix *Index) sortItems() {
	sort.SliceStable(ix.items, func(i, j int) bool {
		if ix.items[i].ShotAt != ix.items[j].ShotAt {
			return ix.items[i].ShotAt > ix.items[j].ShotAt
		}
		return ix.items[i].Name < ix.items[j].Name
	})
}

// reindex rebuilds the key lookup. Callers must hold the write lock or be
// single-threaded during construction.
func (ix *Index) reindex() {
	ix.pos = make(map[string]int, len(ix.items))
	for i, it := range ix.items {
		ix.pos[it.Key()] = i
	}
}

// Save writes the index atomically so a crash mid-write cannot corrupt it.
func (ix *Index) Save() error {
	ix.mu.RLock()
	items := ix.items
	ix.mu.RUnlock()
	return ix.write(items)
}

// write persists a set of items atomically. The scan uses it to checkpoint part
// way through, so a drive unplugged in the middle of a long first scan does not
// throw the work away.
func (ix *Index) write(items []Item) error {
	if err := os.MkdirAll(ix.dir, 0o755); err != nil {
		return err
	}
	tmp := ix.indexPath() + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	w := bufio.NewWriterSize(f, 1<<20)
	enc := json.NewEncoder(w)
	for i := range items {
		if err := enc.Encode(&items[i]); err != nil {
			f.Close()
			return err
		}
	}
	if err := w.Flush(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmp, ix.indexPath()); err != nil {
		return err
	}
	// The version is stamped after the items, so a crash in between leaves the
	// older version in place and the next scan simply re-reads.
	return ix.writeVersion()
}

func (ix *Index) loadFavs() error {
	b, err := os.ReadFile(ix.favPath())
	if err != nil {
		return err
	}
	var list []string
	if json.Unmarshal(b, &list) != nil {
		return nil
	}
	ix.mu.Lock()
	for _, k := range list {
		ix.favs[k] = true
	}
	ix.mu.Unlock()
	return nil
}

func (ix *Index) saveFavs() error {
	ix.mu.RLock()
	list := make([]string, 0, len(ix.favs))
	for k := range ix.favs {
		list = append(list, k)
	}
	ix.mu.RUnlock()
	sort.Strings(list)
	b, _ := json.MarshalIndent(list, "", "  ")
	if err := os.MkdirAll(ix.dir, 0o755); err != nil {
		return err
	}
	tmp := ix.favPath() + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, ix.favPath())
}

// IsFavorite reports whether an item is starred.
func (ix *Index) IsFavorite(key string) bool {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	return ix.favs[key]
}

// SetFavorite stars or unstars an item and persists the change.
func (ix *Index) SetFavorite(key string, on bool) error {
	ix.mu.Lock()
	if on {
		ix.favs[key] = true
	} else {
		delete(ix.favs, key)
	}
	ix.mu.Unlock()
	return ix.saveFavs()
}

// Len is how many items the index holds.
func (ix *Index) Len() int {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	return len(ix.items)
}

// ScannedAt is when the index was last written.
func (ix *Index) ScannedAt() time.Time {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	return ix.scanned
}

func (ix *Index) snapshot() map[string]Item {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	out := make(map[string]Item, len(ix.items))
	for _, it := range ix.items {
		out[it.Key()] = it
	}
	return out
}

// Build walks every reachable library and records what it finds. Files whose
// size and timestamp are unchanged keep their cached metadata, so a rescan only
// pays for what is genuinely new. Part way through it checkpoints, which means
// a scan interrupted by an unplugged drive resumes instead of starting over.
func (ix *Index) Build(libs []Library, progress func(Progress)) error {
	prev := ix.snapshot()
	if ix.storedVersion() != indexVersion {
		// Written by an older build: re-read everything rather than trust it.
		prev = nil
	}

	scanning := map[string]bool{}
	for _, l := range libs {
		if l.ID != "" && l.Path != "" {
			scanning[l.ID] = true
		}
	}
	// Items belonging to folders that are not part of this scan are kept as
	// they are, so a checkpoint never drops a disconnected drive's contents.
	var carried []Item
	for _, it := range prev {
		if !scanning[it.Lib] {
			carried = append(carried, it)
		}
	}

	var items []Item
	seen, sinceSave, skipped := 0, 0, 0
	checkpoint := func() {
		all := make([]Item, 0, len(items)+len(carried))
		all = append(all, items...)
		all = append(all, carried...)
		sort.SliceStable(all, func(i, j int) bool {
			if all[i].ShotAt != all[j].ShotAt {
				return all[i].ShotAt > all[j].ShotAt
			}
			return all[i].Name < all[j].Name
		})
		_ = ix.write(all)
		sinceSave = 0
	}

	for _, lib := range libs {
		if lib.ID == "" || lib.Path == "" {
			continue
		}
		if fi, err := os.Stat(lib.Path); err != nil || !fi.IsDir() {
			continue
		}
		root := lib.Path
		var unreadable []string
		err := filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
			if err != nil {
				// An unreadable folder or file is skipped so that one bad spot
				// cannot abort a whole drive, but it is counted, reported, and
				// remembered: whatever lives underneath keeps its previous
				// entry, so a momentary read error never empties part of the
				// library. A scan that quietly leaves things out is the one
				// failure an index must not hide.
				skipped++
				if pref, ok := underRoot(root, p); ok {
					unreadable = append(unreadable, pref)
				}
				if progress != nil {
					progress(Progress{Phase: "scan", Done: seen, Skipped: skipped,
						Message: "cannot read " + filepath.Base(p)})
				}
				return nil
			}
			if d.IsDir() {
				if p != root && skipDir(d.Name()) {
					return filepath.SkipDir
				}
				return nil
			}
			ext := strings.ToLower(filepath.Ext(d.Name()))
			if !IsMedia(ext) || junkFile(d.Name()) {
				return nil
			}
			fi, err := d.Info()
			if err != nil {
				skipped++
				return nil
			}
			rel, err := filepath.Rel(root, p)
			if err != nil {
				return nil
			}
			rel = filepath.ToSlash(rel)
			key := lib.ID + ":" + rel
			seen++
			sinceSave++
			if old, ok := prev[key]; ok && old.Size == fi.Size() && old.ModTime == fi.ModTime().Unix() {
				items = append(items, old)
			} else {
				it := Item{
					Lib: lib.ID, Rel: rel, Name: d.Name(), Ext: ext,
					Kind: KindOf(ext), Size: fi.Size(), ModTime: fi.ModTime().Unix(),
				}
				if m, perr := Probe(p); perr == nil {
					it.W, it.H = m.Width, m.Height
					it.Duration = m.Duration
					e := m.Exif
					it.Make, it.Model = e.Make, e.Model
					it.ISO = e.ISO
					it.FNumber = e.FNumber
					it.Exposure = e.Exposure
					it.Focal = e.FocalLength
					it.Lat, it.Lon, it.HasGPS = e.Lat, e.Lon, e.HasGPS
					it.Orient = e.Orientation
					it.ShotAt = CaptureTime(e, d.Name(), fi.ModTime()).Unix()
				}
				if it.ShotAt == 0 {
					it.ShotAt = fi.ModTime().Unix()
				}
				// Phone photos are often stored sideways with a rotation tag;
				// report the shape the viewer will actually show.
				switch it.Orient {
				case 5, 6, 7, 8:
					it.W, it.H = it.H, it.W
				}
				items = append(items, it)
			}
			if seen%400 == 0 && progress != nil {
				progress(Progress{Phase: "scan", Done: seen, Message: d.Name(), Skipped: skipped})
			}
			if sinceSave >= 4000 {
				checkpoint()
			}
			return nil
		})
		if err != nil {
			return err
		}
		if len(unreadable) > 0 {
			items = appendKeptUnder(items, prev, lib.ID, unreadable)
		}
	}

	if skipped > 0 && progress != nil {
		progress(Progress{Phase: "scan", Done: seen, Skipped: skipped,
			Message: fmt.Sprintf("%d files could not be read", skipped)})
	}

	ix.mu.Lock()
	ix.items = append(items, carried...)
	ix.scanned = time.Now()
	ix.ready()
	ix.mu.Unlock()
	return ix.Save()
}

/* ---------- querying ---------- */

func (ix *Index) matches(it Item, q Query, favs map[string]bool) bool {
	if q.Lib != "" && it.Lib != q.Lib {
		return false
	}
	if q.Kind != "" && string(it.Kind) != q.Kind {
		return false
	}
	if q.Fav && !favs[it.Key()] {
		return false
	}
	if q.Year != 0 {
		t := it.TakenAt()
		if t.Year() != q.Year {
			return false
		}
		if q.Month != 0 && int(t.Month()) != q.Month {
			return false
		}
	}
	if q.Search != "" && !it.matchesText(q.Search) {
		return false
	}
	return true
}

func (it Item) matchesText(s string) bool {
	s = strings.ToLower(strings.TrimSpace(s))
	if s == "" {
		return true
	}
	if strings.Contains(strings.ToLower(it.Name), s) {
		return true
	}
	if strings.Contains(strings.ToLower(it.Rel), s) {
		return true
	}
	if it.Model != "" && strings.Contains(strings.ToLower(it.Model), s) {
		return true
	}
	if it.Make != "" && strings.Contains(strings.ToLower(it.Make), s) {
		return true
	}
	return false
}

// pastCursor reports whether an item comes after the last one the client saw.
// Items are ordered by capture time descending, then by name, so both parts of
// the cursor are needed to avoid skipping or repeating same-second shots.
func pastCursor(it Item, q Query) bool {
	if q.Before == 0 {
		return true
	}
	if it.ShotAt < q.Before {
		return true
	}
	return it.ShotAt == q.Before && it.Name > q.BefName
}

// Page returns one page of results and whether more remain.
func (ix *Index) Page(q Query) ([]Item, bool) {
	if q.Limit <= 0 || q.Limit > 1000 {
		q.Limit = 200
	}
	ix.mu.RLock()
	items := ix.items
	favs := ix.favs
	ix.mu.RUnlock()

	out := make([]Item, 0, q.Limit)
	for _, it := range items {
		if !pastCursor(it, q) {
			continue
		}
		if !ix.matches(it, q, favs) {
			continue
		}
		out = append(out, it)
		if len(out) == q.Limit {
			break
		}
	}
	// Any further match means there is another page.
	more := false
	if len(out) == q.Limit {
		last := out[len(out)-1]
		next := q
		next.Before, next.BefName = last.ShotAt, last.Name
		for _, it := range items {
			if !pastCursor(it, next) {
				continue
			}
			if ix.matches(it, q, favs) {
				more = true
				break
			}
		}
	}
	return out, more
}

// Summarise counts a filtered view and buckets it by year and month, which is
// what the timeline scrubber and the header totals are built from.
func (ix *Index) Summarise(q Query) (Stats, []YearBucket) {
	ix.mu.RLock()
	items := ix.items
	favs := ix.favs
	ix.mu.RUnlock()

	var st Stats
	byYear := map[int]*YearBucket{}
	for _, it := range items {
		if !ix.matches(it, q, favs) {
			continue
		}
		st.Total++
		st.Bytes += it.Size
		if it.Kind == KindVideo {
			st.Videos++
		} else {
			st.Images++
		}
		if favs[it.Key()] {
			st.Favs++
		}
		t := it.TakenAt()
		b := byYear[t.Year()]
		if b == nil {
			b = &YearBucket{Year: t.Year()}
			byYear[t.Year()] = b
		}
		b.Count++
		b.Months[int(t.Month())-1]++
	}
	years := make([]YearBucket, 0, len(byYear))
	for _, b := range byYear {
		years = append(years, *b)
	}
	sort.Slice(years, func(i, j int) bool { return years[i].Year > years[j].Year })
	return st, years
}

// Get returns one item by key.
func (ix *Index) Get(key string) (Item, bool) {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	if i, ok := ix.pos[key]; ok {
		return ix.items[i], true
	}
	return Item{}, false
}

// LibCount is how much one library contributes to the index.
type LibCount struct {
	Count int
	Bytes int64
}

// CountsByLib totals the index per library, which is what the main page shows
// on each saved folder. Because it comes from the index, the main page never
// has to touch the drives.
func (ix *Index) CountsByLib() map[string]LibCount {
	ix.mu.RLock()
	defer ix.mu.RUnlock()
	out := map[string]LibCount{}
	for _, it := range ix.items {
		c := out[it.Lib]
		c.Count++
		c.Bytes += it.Size
		out[it.Lib] = c
	}
	return out
}

// ForgetLibrary drops a removed folder's items so the grid stops offering files
// that are no longer part of the library.
func (ix *Index) ForgetLibrary(id string) error {
	ix.mu.Lock()
	kept := ix.items[:0]
	for _, it := range ix.items {
		if it.Lib != id {
			kept = append(kept, it)
		}
	}
	ix.items = kept
	ix.reindex()
	ix.mu.Unlock()
	return ix.Save()
}

// Neighbours returns the keys either side of an item within a filter, so the
// viewer can preload what comes next.
func (ix *Index) Neighbours(q Query, key string) (prev, next string) {
	ix.mu.RLock()
	items := ix.items
	favs := ix.favs
	ix.mu.RUnlock()

	idx := -1
	for i := range items {
		if items[i].Key() == key {
			idx = i
			break
		}
	}
	if idx < 0 {
		return "", ""
	}
	for i := idx - 1; i >= 0; i-- {
		if ix.matches(items[i], q, favs) {
			prev = items[i].Key()
			break
		}
	}
	for i := idx + 1; i < len(items); i++ {
		if ix.matches(items[i], q, favs) {
			next = items[i].Key()
			break
		}
	}
	return prev, next
}

// ParseDateQuery lifts a year and month out of a search box entry, leaving the
// rest as free text: "june 2021 beach" -> June 2021, "beach".
func ParseDateQuery(s string) (year, month int, rest string) {
	fields := strings.Fields(s)
	var keep []string
	for _, f := range fields {
		lf := strings.ToLower(strings.Trim(f, ","))
		if m, ok := monthNames[lf]; ok {
			month = m
			continue
		}
		if len(lf) == 4 {
			if y := atoiSafe(lf); y >= 1900 && y <= 2100 {
				year = y
				continue
			}
		}
		keep = append(keep, f)
	}
	return year, month, strings.Join(keep, " ")
}

var monthNames = map[string]int{
	"january": 1, "jan": 1, "february": 2, "feb": 2, "march": 3, "mar": 3,
	"april": 4, "apr": 4, "may": 5, "june": 6, "jun": 6, "july": 7, "jul": 7,
	"august": 8, "aug": 8, "september": 9, "sep": 9, "sept": 9, "october": 10,
	"oct": 10, "november": 11, "nov": 11, "december": 12, "dec": 12,
}

func atoiSafe(s string) int {
	n := 0
	for _, r := range s {
		if r < '0' || r > '9' {
			return 0
		}
		n = n*10 + int(r-'0')
	}
	return n
}

// Resolve turns a library id and relative path into an absolute path, refusing
// anything that tries to escape the library root. A key arriving from a client
// is untrusted, so this is the gate that keeps browsing inside the folders the
// user actually saved.
func Resolve(root, rel string) (string, error) {
	if root == "" || rel == "" {
		return "", fmt.Errorf("missing path")
	}
	clean := filepath.Clean(filepath.FromSlash(rel))
	sep := string(filepath.Separator)
	switch {
	case clean == "." || clean == "..":
		return "", fmt.Errorf("path outside the library")
	case filepath.IsAbs(clean):
		return "", fmt.Errorf("path outside the library")
	case filepath.VolumeName(clean) != "":
		// A drive-qualified relative path such as "C:photo.jpg".
		return "", fmt.Errorf("path outside the library")
	case strings.HasPrefix(clean, sep):
		// A rooted-without-a-volume path such as "\photo.jpg".
		return "", fmt.Errorf("path outside the library")
	case strings.HasPrefix(clean, ".."+sep):
		return "", fmt.Errorf("path outside the library")
	}
	full := filepath.Join(root, clean)
	rp, err := filepath.Rel(root, full)
	if err != nil || rp == ".." || strings.HasPrefix(rp, ".."+sep) {
		return "", fmt.Errorf("path outside the library")
	}
	return full, nil
}
