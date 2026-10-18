package server

import (
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
)

// fsEntry is one row in the folder browser.
type fsEntry struct {
	Name  string `json:"name"`
	Path  string `json:"path"`
	IsDir bool   `json:"isDir"`
	Size  int64  `json:"size,omitempty"`
	Items int    `json:"items,omitempty"` // hint for folders
}

// fsRoots lists the starting points a user can pick from: drives on Windows,
// "/" elsewhere, plus the home folder and common media folders.
func (s *Server) fsRoots(w http.ResponseWriter, r *http.Request) {
	var roots []fsEntry

	if runtime.GOOS == "windows" {
		for c := 'A'; c <= 'Z'; c++ {
			p := string(c) + ":\\"
			if fi, err := os.Stat(p); err == nil && fi.IsDir() {
				roots = append(roots, fsEntry{Name: string(c) + ":", Path: p, IsDir: true})
			}
		}
	} else {
		roots = append(roots, fsEntry{Name: "Computer", Path: "/", IsDir: true})
		// Common mount points for external drives.
		if vols, err := os.ReadDir("/media"); err == nil {
			for _, v := range vols {
				if v.IsDir() {
					roots = append(roots, fsEntry{Name: v.Name(), Path: "/media/" + v.Name(), IsDir: true})
				}
			}
		}
	}

	home, _ := os.UserHomeDir()
	if home != "" {
		roots = append(roots, fsEntry{Name: "Home", Path: home, IsDir: true})
		for _, sub := range []string{"Pictures", "Photos", "Downloads", "DCIM", "Desktop"} {
			p := filepath.Join(home, sub)
			if fi, err := os.Stat(p); err == nil && fi.IsDir() {
				roots = append(roots, fsEntry{Name: sub, Path: p, IsDir: true})
			}
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"roots": roots,
		"home":  home,
		"sep":   string(os.PathSeparator),
	})
}

// fsList lists the folders (and files) inside a directory for the browser.
func (s *Server) fsList(w http.ResponseWriter, r *http.Request) {
	raw := strings.TrimSpace(r.URL.Query().Get("path"))
	if raw == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "path is required"})
		return
	}

	abs, err := filepath.Abs(raw)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}
	abs = filepath.Clean(abs)

	items, err := os.ReadDir(abs)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"path":    abs,
			"parent":  parentOf(abs),
			"entries": []fsEntry{},
			"error":   "cannot read this folder (permission or not connected)",
		})
		return
	}

	var dirs, files []fsEntry
	for _, e := range items {
		name := e.Name()
		// Hide noisy system/hidden folders unless the user asks for them.
		if shouldHide(name) {
			continue
		}
		full := filepath.Join(abs, name)
		if e.IsDir() {
			dirs = append(dirs, fsEntry{Name: name, Path: full, IsDir: true})
		} else {
			var size int64
			if fi, err := e.Info(); err == nil {
				size = fi.Size()
			}
			files = append(files, fsEntry{Name: name, Path: full, Size: size})
		}
	}
	byName := func(a, b fsEntry) bool { return strings.ToLower(a.Name) < strings.ToLower(b.Name) }
	sort.Slice(dirs, func(i, j int) bool { return byName(dirs[i], dirs[j]) })
	sort.Slice(files, func(i, j int) bool { return byName(files[i], files[j]) })

	entries := append(dirs, files...)
	if len(entries) > 2000 {
		entries = entries[:2000]
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"path":    abs,
		"parent":  parentOf(abs),
		"entries": entries,
		"dirs":    len(dirs),
		"files":   len(files),
	})
}

func parentOf(p string) string {
	parent := filepath.Dir(p)
	if parent == p {
		return "" // at a drive root or "/"
	}
	return parent
}

func shouldHide(name string) bool {
	// Anything starting with "$" is OS housekeeping ($RECYCLE.BIN, $WinREAgent…).
	if strings.HasPrefix(name, "$") {
		return true
	}
	switch strings.ToLower(name) {
	case "system volume information",
		".spotlight-v100", ".trashes", ".fseventsd",
		"node_modules", "__pycache__":
		return true
	}
	return false
}
