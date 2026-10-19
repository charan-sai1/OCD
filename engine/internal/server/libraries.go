package server

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"ocd/internal/importer"
)

// Library is a folder the user has saved in the app. It is the unit shown on
// the main page: a name, a path, whether it is currently reachable, and a
// cached photo count.
type Library struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	Path         string    `json:"path"`
	Available    bool      `json:"available"`
	Count        int       `json:"count"`
	Bytes        int64     `json:"bytes"`
	CollectionID string    `json:"collectionId,omitempty"`
	CountedAt    time.Time `json:"countedAt,omitempty"`
}

// libraryStore is the persisted, ordered set of libraries.
type libraryStore struct {
	mu    sync.Mutex
	file  string
	items []Library
}

type libraryFile struct {
	Items []Library `json:"items"`
}

func newLibraryStore(file string) (*libraryStore, error) {
	st := &libraryStore{file: file}
	b, err := os.ReadFile(file)
	if err == nil && len(b) > 2 {
		var lf libraryFile
		if json.Unmarshal(b, &lf) == nil {
			st.items = lf.Items
		}
	}
	return st, nil
}

func (st *libraryStore) save() error {
	st.mu.Lock()
	defer st.mu.Unlock()
	if err := os.MkdirAll(filepath.Dir(st.file), 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(libraryFile{Items: st.items}, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(st.file, b, 0o644)
}

// list returns the libraries with availability refreshed.
func (st *libraryStore) list() []Library {
	st.mu.Lock()
	defer st.mu.Unlock()
	out := make([]Library, len(st.items))
	copy(out, st.items)
	for i := range out {
		out[i].Available = pathAvailable(out[i].Path)
	}
	return out
}

// available returns only the reachable libraries (used to configure browsing).
func (st *libraryStore) available() []Library {
	var out []Library
	for _, l := range st.list() {
		if l.Available {
			out = append(out, l)
		}
	}
	return out
}

func pathAvailable(p string) bool {
	if p == "" {
		return false
	}
	fi, err := os.Stat(p)
	return err == nil && fi.IsDir()
}

func (st *libraryStore) add(name, path string) (Library, error) {
	path = filepath.Clean(path)
	st.mu.Lock()
	for _, l := range st.items {
		if strings.EqualFold(l.Path, path) {
			l.Available = pathAvailable(l.Path)
			st.mu.Unlock()
			return l, nil // already saved
		}
	}
	if name == "" {
		name = defaultNameFor(path)
	}
	lib := Library{ID: newID(path), Name: name, Path: path}
	st.items = append(st.items, lib)
	st.mu.Unlock()
	return lib, st.save()
}

func (st *libraryStore) remove(id string) error {
	st.mu.Lock()
	filtered := st.items[:0]
	for _, l := range st.items {
		if l.ID != id {
			filtered = append(filtered, l)
		}
	}
	st.items = filtered
	st.mu.Unlock()
	return st.save()
}

func (st *libraryStore) setCount(id string, count int, bytes int64) {
	st.mu.Lock()
	for i := range st.items {
		if st.items[i].ID == id {
			st.items[i].Count = count
			st.items[i].Bytes = bytes
			st.items[i].CountedAt = time.Now()
		}
	}
	st.mu.Unlock()
	_ = st.save()
}

// seedFromPhotofield imports the collections already in Photofield's config so
// the first run shows the drives the user had set up.
func (st *libraryStore) seedFromPhotofield(configPath string) {
	if len(st.list()) > 0 {
		return
	}
	b, err := os.ReadFile(configPath)
	if err != nil {
		return
	}
	lines := strings.Split(string(b), "\n")
	var pending string
	for _, ln := range lines {
		t := strings.TrimSpace(ln)
		switch {
		case strings.HasPrefix(t, "- name:"):
			pending = strings.Trim(strings.TrimSpace(strings.TrimPrefix(t, "- name:")), `"'`)
		case strings.HasPrefix(t, "- ") && pending != "":
			p := strings.Trim(strings.TrimSpace(strings.TrimPrefix(t, "- ")), `"'`)
			st.add(pending, p)
			pending = ""
		}
	}
}

func defaultNameFor(path string) string {
	clean := strings.TrimRight(filepath.ToSlash(path), "/")
	if clean == "" {
		return path
	}
	if strings.Count(clean, "/") == 0 {
		return clean // a drive root like "E:"
	}
	return filepath.Base(clean)
}

func newID(seed string) string {
	h := sha1.Sum([]byte(strings.ToLower(seed)))
	return hex.EncodeToString(h[:])[:12]
}

/* ---------- HTTP handlers ---------- */

func (s *Server) libsList(w http.ResponseWriter, r *http.Request) {
	items := s.libs.list()
	s.attachCollectionIDs(items)
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// attachCollectionIDs maps each saved folder to its PhotoField collection so the
// UI can filter the photo grid and show a cover per folder. Best effort: when the
// gallery is not running the field is simply left empty.
func (s *Server) attachCollectionIDs(items []Library) {
	root, err := httpGetJSON(photofieldBase + "/api/collections")
	if err != nil {
		return
	}
	cols, _ := root["items"].([]any)
	norm := func(p string) string {
		return strings.TrimRight(strings.ToLower(strings.ReplaceAll(filepath.Clean(p), "\\", "/")), "/")
	}
	for i := range items {
		want := norm(items[i].Path)
		for _, c := range cols {
			cm, ok := c.(map[string]any)
			if !ok {
				continue
			}
			dirs, _ := cm["dirs"].([]any)
			for _, d := range dirs {
				if norm(str(d)) == want {
					items[i].CollectionID = str(cm["id"])
					break
				}
			}
			if items[i].CollectionID != "" {
				break
			}
		}
	}
}

func (s *Server) libsAdd(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
		Path string `json:"path"`
	}
	_ = decode(r, &req)
	if strings.TrimSpace(req.Path) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "path is required"})
		return
	}
	lib, err := s.libs.add(req.Name, req.Path)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, lib)
	go s.countLibrary(lib.ID)
}

func (s *Server) libsRemove(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "id is required"})
		return
	}
	if err := s.libs.remove(id); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	// Drop the folder's items from the index too, so the grid stops offering
	// files from a folder the user just removed.
	go func() {
		if err := s.index.ForgetLibrary(id); err != nil {
			s.emitJSON("index-error", 0, 0, err.Error())
		}
	}()
	writeJSON(w, http.StatusOK, map[string]any{"removed": id, "items": s.libs.list()})
}

// libsScan recounts the given library, or all of them, in the background.
func (s *Server) libsScan(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID string `json:"id"`
	}
	_ = decode(r, &req)
	if req.ID != "" {
		go s.countLibrary(req.ID)
	} else {
		go func() {
			for _, l := range s.libs.list() {
				if l.Available {
					s.countLibrary(l.ID)
				}
			}
			s.emitJSON("done", 0, 0, "")
		}()
	}
	writeJSON(w, http.StatusOK, map[string]any{"started": true})
}

// countLibrary walks a library and caches how many media files it holds.
func (s *Server) countLibrary(id string) {
	var target *Library
	for _, l := range s.libs.list() {
		if l.ID == id {
			cp := l
			target = &cp
		}
	}
	if target == nil || !target.Available {
		return
	}
	exts := importer.DefaultMediaExts()
	isMedia := func(name string) bool {
		e := strings.ToLower(filepath.Ext(name))
		for _, m := range exts {
			if m == e {
				return true
			}
		}
		return false
	}

	count := 0
	var bytes int64
	_ = filepath.WalkDir(target.Path, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if shouldHide(d.Name()) {
				return filepath.SkipDir
			}
			return nil
		}
		if !isMedia(p) {
			return nil
		}
		if fi, e := d.Info(); e == nil {
			bytes += fi.Size()
		}
		count++
		if count%1000 == 0 {
			s.emitJSON("counting", count, 0, target.Name)
		}
		return nil
	})
	s.libs.setCount(id, count, bytes)
	s.emitJSON("counted", count, 0, target.Name)
}

func (s *Server) libsRouter(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.libsList(w, r)
	case http.MethodPost:
		s.libsAdd(w, r)
	case http.MethodDelete:
		s.libsRemove(w, r)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// libraryNames is a stable, sorted view used by the UI.
func sortedNames(items []Library) []string {
	names := make([]string, 0, len(items))
	for _, l := range items {
		names = append(names, l.Name)
	}
	sort.Strings(names)
	return names
}
