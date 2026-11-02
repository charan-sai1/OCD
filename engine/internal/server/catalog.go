package server

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"ocd/internal/catalog"
	"ocd/internal/media"
	"ocd/internal/volume"
)

// driveInfo is what the phone and the desktop UI need to know about a catalog
// that lives on a drive: who it belongs to, how big it is, and where to fetch
// it. The file path stays private.
type driveInfo struct {
	VolumeID     string    `json:"volumeId"`
	Label        string    `json:"label,omitempty"`
	Root         string    `json:"root"`
	Count        int       `json:"count"`
	IndexVersion int       `json:"indexVersion,omitempty"`
	Generated    time.Time `json:"generated"`
	Source       string    `json:"source"`
	Size         int64     `json:"size"`
	Libraries    []string  `json:"libraries,omitempty"`

	file string
	etag string
	mod  time.Time
}

// catalogStore holds the catalogs currently reachable. It is refreshed after a
// scan, when a folder is added or removed, and on demand, so a drive that was
// plugged in after launch shows up without a restart.
type catalogStore struct {
	mu       sync.Mutex
	byID     map[string]*driveInfo
	volumeOf func(string) (volume.Info, error)
}

func newCatalogStore() *catalogStore {
	return &catalogStore{byID: map[string]*driveInfo{}, volumeOf: volume.Of}
}

func (cs *catalogStore) list() []driveInfo {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	out := make([]driveInfo, 0, len(cs.byID))
	for _, d := range cs.byID {
		out = append(out, *d)
	}
	sort.Slice(out, func(i, j int) bool {
		return strings.ToLower(out[i].Root) < strings.ToLower(out[j].Root)
	})
	return out
}

func (cs *catalogStore) find(id string) (driveInfo, bool) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	d, ok := cs.byID[id]
	if !ok {
		return driveInfo{}, false
	}
	return *d, true
}

func (cs *catalogStore) empty() bool {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	return len(cs.byID) == 0
}

// refresh reads the header of each connected drive's catalog. Headers are
// small, so this does not spin up a sleeping disk the way a scan would.
func (cs *catalogStore) refresh(libs []Library) {
	names := map[string][]string{}
	next := map[string]*driveInfo{}
	for _, l := range libs {
		if !l.Available {
			continue
		}
		info, err := cs.volumeOf(l.Path)
		if err != nil {
			continue
		}
		names[info.ID] = append(names[info.ID], l.Name)
		if _, done := next[info.ID]; done {
			continue
		}
		h, src, err := catalog.HeaderOf(info.Root)
		if err != nil {
			continue
		}
		file := catalog.Path(info.Root)
		if src == catalog.SourceBackup {
			file = catalog.BackupPath(info.Root)
		}
		fi, err := os.Stat(file)
		if err != nil {
			continue
		}
		label := info.Label
		if h.Label != "" {
			label = h.Label
		}
		next[info.ID] = &driveInfo{
			VolumeID:     info.ID,
			Label:        label,
			Root:         info.Root,
			Count:        h.Count,
			IndexVersion: h.IndexVersion,
			Generated:    h.Generated,
			Source:       string(src),
			Size:         fi.Size(),
			file:         file,
			etag:         fmt.Sprintf(`"%x-%x-%x"`, fi.ModTime().UnixNano(), fi.Size(), h.Count),
			mod:          fi.ModTime(),
		}
	}
	cs.mu.Lock()
	defer cs.mu.Unlock()
	for id, d := range next {
		d.Libraries = names[id]
	}
	cs.byID = next
}

// drivesList reports the catalogs that are reachable right now.
func (s *Server) drivesList(w http.ResponseWriter, r *http.Request) {
	if s.drives.empty() {
		s.drives.refresh(s.libs.list())
	}
	writeJSON(w, http.StatusOK, map[string]any{"drives": s.drives.list()})
}

// drivesRefresh re-reads the drive headers after the user plugs something in.
func (s *Server) drivesRefresh(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	s.drives.refresh(s.libs.list())
	writeJSON(w, http.StatusOK, map[string]any{"drives": s.drives.list()})
}

// catalogDownload serves the raw catalog so a phone can carry the drive's
// context home without asking the server to re-encode 63,000 entries.
func (s *Server) catalogDownload(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("volumeId")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "volumeId is required"})
		return
	}
	d, ok := s.drives.find(id)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "no catalog for that volume"})
		return
	}
	if match := r.Header.Get("If-None-Match"); match != "" && match == d.etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	f, err := os.Open(d.file)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "the catalog is no longer reachable"})
		return
	}
	defer f.Close()

	w.Header().Set("Content-Type", "application/gzip")
	// The body is already gzip; stop the browser from compressing it twice.
	w.Header().Set("Content-Encoding", "identity")
	w.Header().Set("Content-Disposition", `attachment; filename="catalog.gz"`)
	w.Header().Set("ETag", d.etag)
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-OCD-Volume", d.VolumeID)
	w.Header().Set("X-OCD-Count", strconv.Itoa(d.Count))
	http.ServeContent(w, r, "catalog.gz", d.mod, f)
}

// writeCatalogs mirrors the current index onto each connected drive. It is best
// effort: a full, read-only, or still-spinning drive must not fail the scan.
// The machine's own volume is left alone, so a Pictures folder on C: does not
// sprout a .ocd directory.
func (s *Server) writeCatalogs(libs []media.Library) {
	type group struct {
		info    volume.Info
		entries map[string]catalog.Entry
	}
	groups := map[string]*group{}
	for _, l := range libs {
		info, err := s.drives.volumeOf(l.Path)
		if err != nil {
			continue
		}
		if s.sysRoot != "" && strings.EqualFold(filepath.Clean(info.Root), filepath.Clean(s.sysRoot)) {
			continue
		}
		g := groups[info.Root]
		if g == nil {
			g = &group{info: info, entries: map[string]catalog.Entry{}}
			groups[info.Root] = g
		}
		for _, it := range s.index.ItemsFor(l.ID) {
			abs := filepath.Join(l.Path, filepath.FromSlash(it.Rel))
			rel, err := filepath.Rel(info.Root, abs)
			if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
				continue
			}
			p := filepath.ToSlash(rel)
			if _, seen := g.entries[p]; seen {
				continue
			}
			g.entries[p] = catalog.Entry{
				Path:     p,
				Size:     it.Size,
				MTime:    it.ModTime,
				ShotAt:   it.ShotAt,
				Kind:     string(it.Kind),
				Width:    it.W,
				Height:   it.H,
				Duration: it.Duration,
			}
		}
	}
	for _, g := range groups {
		entries := make([]catalog.Entry, 0, len(g.entries))
		for _, e := range g.entries {
			entries = append(entries, e)
		}
		sort.Slice(entries, func(i, j int) bool { return entries[i].Path < entries[j].Path })
		snap := catalog.Snapshot{
			Header: catalog.Header{
				VolumeID:     g.info.ID,
				Label:        g.info.Label,
				IndexVersion: media.FormatVersion(),
			},
			Entries: entries,
		}
		if err := catalog.Write(g.info.Root, snap); err != nil {
			log.Printf("catalog %s: %v", g.info.Root, err)
			continue
		}
		log.Printf("catalog %s: %d items", catalog.Path(g.info.Root), len(entries))
	}
}
