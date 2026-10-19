package server

import (
	"fmt"
	"mime"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"ocd/internal/media"
)

// maxThumbDim caps how large a preview the browser can ask for.
const maxThumbDim = 1600

// gridRow is the trimmed shape the grid needs. Keeping it small matters once
// the library runs to tens of thousands of items.
type gridRow struct {
	Key  string  `json:"key"`
	Name string  `json:"name"`
	Dir  string  `json:"dir"`
	Lib  string  `json:"lib"`
	Kind string  `json:"kind"`
	W    int     `json:"w"`
	H    int     `json:"h"`
	Shot int64   `json:"shot"`
	Size int64   `json:"size"`
	Dur  float64 `json:"dur,omitempty"`
	V    int64   `json:"v"`
	Fav  bool    `json:"fav"`
}

func (s *Server) toRow(it media.Item) gridRow {
	dir := filepath.ToSlash(filepath.Dir(it.Rel))
	if dir == "." {
		dir = ""
	}
	return gridRow{
		Key: it.Key(), Name: it.Name, Dir: dir, Lib: it.Lib, Kind: string(it.Kind),
		W: it.W, H: it.H, Shot: it.ShotAt, Size: it.Size, Dur: it.Duration,
		V: it.ModTime, Fav: s.index.IsFavorite(it.Key()),
	}
}

// queryFrom builds a media.Query from the request, accepting either structured
// filters or a free-text box that may itself name a year and month.
func queryFrom(r *http.Request) media.Query {
	q := r.URL.Query()
	query := media.Query{
		Lib:  q.Get("lib"),
		Kind: q.Get("kind"),
		Fav:  q.Get("fav") == "1",
	}
	if txt := strings.TrimSpace(q.Get("q")); txt != "" {
		year, month, rest := media.ParseDateQuery(txt)
		query.Year, query.Month, query.Search = year, month, rest
	}
	if v := q.Get("year"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			query.Year = n
		}
	}
	if v := q.Get("month"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 1 && n <= 12 {
			query.Month = n
		}
	}
	if v := q.Get("before"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			query.Before = n
		}
	}
	query.BefName = q.Get("befname")
	if v := q.Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			query.Limit = n
		}
	}
	return query
}

// gallery serves one page of the library from the index. Unlike the old
// PhotoField-backed handler this paginates, so the grid can scroll forever
// without ever asking a drive for anything.
func (s *Server) gallery(w http.ResponseWriter, r *http.Request) {
	query := queryFrom(r)
	items, more := s.index.Page(query)

	rows := make([]gridRow, 0, len(items))
	for _, it := range items {
		rows = append(rows, s.toRow(it))
	}

	resp := map[string]any{
		"items":    rows,
		"hasMore":  more,
		"indexed":  s.index.Len(),
		"scanned":  s.index.ScannedAt().Unix(),
		"building": s.isScanning(),
	}
	if len(items) > 0 {
		last := items[len(items)-1]
		resp["cursor"] = map[string]any{"before": last.ShotAt, "name": last.Name}
	}
	if r.URL.Query().Get("stats") == "1" {
		st, years := s.index.Summarise(query)
		resp["stats"] = st
		resp["years"] = years
	}
	writeJSON(w, http.StatusOK, resp)
}

// itemInfo returns everything the viewer's information panel shows, plus the
// neighbours to preload.
func (s *Server) itemInfo(w http.ResponseWriter, r *http.Request) {
	it, full, err := s.resolveKey(r.URL.Query().Get("k"))
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": err.Error()})
		return
	}
	query := queryFrom(r)
	prev, next := s.index.Neighbours(query, it.Key())

	type detail struct {
		gridRow
		Path   string  `json:"path"`
		Folder string  `json:"folder"`
		Make   string  `json:"make,omitempty"`
		Model  string  `json:"model,omitempty"`
		ISO    int     `json:"iso,omitempty"`
		FNum   float64 `json:"fnumber,omitempty"`
		Expo   float64 `json:"exposure,omitempty"`
		Focal  float64 `json:"focal,omitempty"`
		Lat    float64 `json:"lat,omitempty"`
		Lon    float64 `json:"lon,omitempty"`
	}
	d := detail{gridRow: s.toRow(it), Path: full, Folder: filepath.Dir(full)}
	d.Make, d.Model = it.Make, it.Model
	d.ISO, d.FNum, d.Expo, d.Focal = it.ISO, it.FNumber, it.Exposure, it.Focal
	d.Lat, d.Lon = it.Lat, it.Lon

	writeJSON(w, http.StatusOK, map[string]any{
		"item": d, "prev": prev, "next": next,
	})
}

// favToggle stars or unstars an item.
func (s *Server) favToggle(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Key string `json:"key"`
		On  bool   `json:"on"`
	}
	if err := decode(r, &req); err != nil || req.Key == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "key is required"})
		return
	}
	if _, ok := s.index.Get(req.Key); !ok {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "unknown item"})
		return
	}
	if err := s.index.SetFavorite(req.Key, req.On); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"key": req.Key, "fav": req.On})
}

// orig serves the untouched original file. http.ServeContent gives us range
// requests for free, which is what makes video seeking work and what makes a
// full-resolution download resumable.
func (s *Server) orig(w http.ResponseWriter, r *http.Request) {
	it, full, err := s.resolveKey(r.URL.Query().Get("k"))
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": err.Error()})
		return
	}
	f, err := os.Open(full)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "the file is not reachable right now"})
		return
	}
	defer f.Close()
	fi, err := f.Stat()
	if err != nil || fi.IsDir() {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "not a file"})
		return
	}
	if ct := contentType(it.Ext); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	w.Header().Set("Cache-Control", "private, max-age=86400")
	if r.URL.Query().Get("dl") == "1" {
		w.Header().Set("Content-Disposition", "attachment; filename=\""+safeFilename(it.Name)+"\"")
	}
	http.ServeContent(w, r, it.Name, fi.ModTime(), f)
}

// thumb serves a cached preview. Unknown formats come back as 415 and the UI
// draws a labelled placeholder instead of a broken image.
func (s *Server) thumb(w http.ResponseWriter, r *http.Request) {
	_, full, err := s.resolveKey(r.URL.Query().Get("k"))
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": err.Error()})
		return
	}
	max := 512
	if v := r.URL.Query().Get("w"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 16 {
			if n > maxThumbDim {
				n = maxThumbDim
			}
			max = n
		}
	}
	p, err := s.thumbs.Get(full, max)
	if err != nil {
		writeJSON(w, http.StatusUnsupportedMediaType, map[string]any{"error": err.Error()})
		return
	}
	w.Header().Set("Content-Type", "image/jpeg")
	// The URL carries the file's timestamp, so this can be cached forever.
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	http.ServeFile(w, r, p)
}

// reveal highlights a file in the desktop's file manager. It is the one action
// that has to leave the app, so it is kept in a single, clearly bounded place.
func (s *Server) reveal(w http.ResponseWriter, r *http.Request) {
	_, full, err := s.resolveKey(r.URL.Query().Get("k"))
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": err.Error()})
		return
	}
	if _, err := os.Stat(full); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "the file is not reachable right now"})
		return
	}
	if err := revealFile(full); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"shown": true})
}

func revealFile(path string) error {
	switch runtime.GOOS {
	case "windows":
		// explorer.exe parses its own command line, so the switch and the path
		// travel as one argument. It always exits non-zero, so start and let go.
		return exec.Command("explorer.exe", "/select,"+path).Start()
	case "darwin":
		return exec.Command("open", "-R", path).Start()
	default:
		return exec.Command("xdg-open", filepath.Dir(path)).Start()
	}
}

// indexStatus reports whether a scan is running and what the index holds.
func (s *Server) indexStatus(w http.ResponseWriter, r *http.Request) {
	s.scanMu.Lock()
	building, prog := s.scanning, s.scanProg
	s.scanMu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{
		"indexed":  s.index.Len(),
		"scanned":  s.index.ScannedAt().Unix(),
		"building": building,
		"done":     prog.Done,
		"message":  prog.Message,
		"libraries": func() int {
			n := 0
			for _, l := range s.libs.list() {
				if l.Available {
					n++
				}
			}
			return n
		}(),
	})
}

// indexRebuild starts a rescan in the background.
func (s *Server) indexRebuild(w http.ResponseWriter, r *http.Request) {
	started := s.startScan("rebuilding the library index")
	writeJSON(w, http.StatusOK, map[string]any{"started": started})
}

// StartBackgroundIndex refreshes the index a short while after launch. The
// delay lets the interface answer its first requests before the drives start
// being read, so the app never feels like it is waiting on a spin-up.
func (s *Server) StartBackgroundIndex() {
	if !s.cfg.AutoScan {
		return
	}
	go func() {
		time.Sleep(12 * time.Second)
		s.startScan("reading the saved folders")
	}()
}

/* ---------- scanning ---------- */

func (s *Server) isScanning() bool {
	s.scanMu.Lock()
	defer s.scanMu.Unlock()
	return s.scanning
}

// libMedia maps the saved folders to the shape the index scanner wants.
func (s *Server) libMedia() []media.Library {
	var out []media.Library
	for _, l := range s.libs.list() {
		if l.Available {
			out = append(out, media.Library{ID: l.ID, Path: l.Path})
		}
	}
	return out
}

// startScan walks every reachable folder and refreshes the index. Only one scan
// runs at a time; a second request is told politely that one is already going.
func (s *Server) startScan(reason string) bool {
	s.scanMu.Lock()
	if s.scanning {
		s.scanMu.Unlock()
		return false
	}
	s.scanning = true
	s.scanProg = media.Progress{Phase: "scan", Message: reason}
	s.scanMu.Unlock()

	go func() {
		defer func() {
			s.scanMu.Lock()
			s.scanning = false
			s.scanMu.Unlock()
		}()

		libs := s.libMedia()
		s.emitJSON("index", 0, 0, reason)

		err := s.index.Build(libs, func(p media.Progress) {
			s.scanMu.Lock()
			s.scanProg = p
			s.scanMu.Unlock()
			s.emitJSON("index", p.Done, 0, p.Message)
		})
		if err != nil {
			s.emitJSON("index-error", 0, 0, err.Error())
			return
		}

		// The main page's per-folder counts come from the index, so showing
		// them costs no extra drive access.
		counts := s.index.CountsByLib()
		for _, l := range libs {
			if c, ok := counts[l.ID]; ok {
				s.libs.setCount(l.ID, c.Count, c.Bytes)
			} else {
				s.libs.setCount(l.ID, 0, 0)
			}
		}
		s.emitJSON("indexed", s.index.Len(), 0, "")
	}()
	return true
}

/* ---------- helpers ---------- */

// resolveKey turns a client key into the indexed item and its absolute path,
// refusing anything the index does not know about. Because membership in the
// index is required, a crafted key cannot reach a file outside a library.
func (s *Server) resolveKey(key string) (media.Item, string, error) {
	if key == "" {
		return media.Item{}, "", fmt.Errorf("missing key")
	}
	it, ok := s.index.Get(key)
	if !ok {
		return media.Item{}, "", fmt.Errorf("unknown item")
	}
	var root string
	for _, l := range s.libs.list() {
		if l.ID == it.Lib {
			root = l.Path
			break
		}
	}
	if root == "" {
		return media.Item{}, "", fmt.Errorf("that folder is no longer saved")
	}
	full, err := media.Resolve(root, it.Rel)
	if err != nil {
		return media.Item{}, "", err
	}
	return it, full, nil
}

// contentType names the formats the browser must not guess at. Windows' mime
// registry is inconsistent, so known extensions win here.
func contentType(ext string) string {
	switch strings.ToLower(ext) {
	case ".jpg", ".jpeg", ".jpe", ".jfif":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".bmp":
		return "image/bmp"
	case ".heic":
		return "image/heic"
	case ".heif":
		return "image/heif"
	case ".avif":
		return "image/avif"
	case ".tif", ".tiff":
		return "image/tiff"
	case ".mp4", ".m4v":
		return "video/mp4"
	case ".mov":
		return "video/quicktime"
	case ".webm":
		return "video/webm"
	case ".mkv":
		return "video/x-matroska"
	case ".avi":
		return "video/x-msvideo"
	case ".3gp":
		return "video/3gpp"
	case ".mts", ".m2ts":
		return "video/mp2t"
	case ".mpg", ".mpeg":
		return "video/mpeg"
	case ".wmv", ".asf":
		return "video/x-ms-wmv"
	}
	return mime.TypeByExtension(strings.ToLower(ext))
}

// safeFilename keeps a download name usable in a Content-Disposition header.
func safeFilename(name string) string {
	var b strings.Builder
	for _, r := range name {
		switch {
		case r == '"' || r == '\\' || r < 32:
			b.WriteRune('_')
		default:
			b.WriteRune(r)
		}
	}
	out := b.String()
	if out == "" {
		out = "download"
	}
	return out
}
