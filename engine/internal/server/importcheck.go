package server

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"

	"ocd/internal/catalog"
)

// Phones ask before sending anything. A metadata match is enough to badge a
// camera-roll item as "already on the drive"; the upload path still hashes the
// bytes before anything is deleted from the phone.
const importDateBucket = 120 // seconds; tolerates clock and EXIF drift

type importItem struct {
	Name    string `json:"name"`
	Size    int64  `json:"size"`
	TakenAt int64  `json:"takenAt"` // unix seconds
}

type importCheckRequest struct {
	VolumeID string       `json:"volumeId"`
	Items    []importItem `json:"items"`
}

type importMatch struct {
	OnDrive bool   `json:"onDrive"`
	Path    string `json:"path,omitempty"`
	Volume  string `json:"volumeId,omitempty"`
	Label   string `json:"label,omitempty"`
	How     string `json:"how,omitempty"`
}

type importCheckResponse struct {
	Matches []importMatch `json:"matches"`
	Scanned int           `json:"scanned"`
	Drives  []string      `json:"drives,omitempty"`
}

// catalogLookup is the compact form of a drive catalog: two maps from metadata
// to the file on the drive, built once per catalog version.
type catalogLookup struct {
	etag     string
	nameSize map[string]string
	sizeDate map[string]string
	entries  int
}

func newCatalogLookup(snap catalog.Snapshot) *catalogLookup {
	l := &catalogLookup{
		nameSize: make(map[string]string, len(snap.Entries)),
		sizeDate: make(map[string]string, len(snap.Entries)),
		entries:  len(snap.Entries),
	}
	for _, e := range snap.Entries {
		if e.Size <= 0 {
			continue
		}
		size := strconv.FormatInt(e.Size, 10)
		if name := strings.ToLower(filepath.Base(e.Path)); name != "" {
			k := name + "\x00" + size
			if _, ok := l.nameSize[k]; !ok {
				l.nameSize[k] = e.Path
			}
		}
		if e.ShotAt > 0 {
			k := size + "\x00" + strconv.FormatInt(e.ShotAt/importDateBucket, 10)
			if _, ok := l.sizeDate[k]; !ok {
				l.sizeDate[k] = e.Path
			}
		}
	}
	return l
}

// find checks the strong name+size key first, then size and capture time for
// files the phone or an editor renamed.
func (l *catalogLookup) find(it importItem) (string, string) {
	if it.Size <= 0 {
		return "", ""
	}
	size := strconv.FormatInt(it.Size, 10)
	name := strings.ToLower(filepath.Base(strings.TrimSpace(it.Name)))
	if name != "" {
		if p, ok := l.nameSize[name+"\x00"+size]; ok {
			return p, "name+size"
		}
	}
	if it.TakenAt > 0 {
		b := it.TakenAt / importDateBucket
		for _, probe := range []int64{b - 1, b, b + 1} {
			k := size + "\x00" + strconv.FormatInt(probe, 10)
			if p, ok := l.sizeDate[k]; ok {
				return p, "size+date"
			}
		}
	}
	return "", ""
}

func (s *Server) lookupCatalog(d driveInfo) *catalogLookup {
	s.importMu.Lock()
	defer s.importMu.Unlock()
	if l, ok := s.importCache[d.VolumeID]; ok && l.etag == d.etag {
		return l
	}
	snap, _, err := catalog.Read(d.Root)
	if err != nil {
		return nil
	}
	l := newCatalogLookup(snap)
	l.etag = d.etag
	if s.importCache == nil {
		s.importCache = map[string]*catalogLookup{}
	}
	s.importCache[d.VolumeID] = l
	return l
}

// importCheck answers "is this camera-roll item already on the drive?" for a
// batch of phone assets. It is metadata only and never touches a file.
func (s *Server) importCheck(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req importCheckRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid JSON"})
		return
	}
	if len(req.Items) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "items is required"})
		return
	}
	if len(req.Items) > 2000 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "at most 2000 items per request"})
		return
	}
	if s.drives.empty() {
		s.drives.refresh(s.libs.list())
	}

	matches := make([]importMatch, len(req.Items))
	scanned := 0
	var drives []string
	for _, d := range s.drives.list() {
		if req.VolumeID != "" && d.VolumeID != req.VolumeID {
			continue
		}
		l := s.lookupCatalog(d)
		if l == nil {
			continue
		}
		scanned += l.entries
		drives = append(drives, d.Label)
		for i, it := range req.Items {
			if matches[i].OnDrive {
				continue
			}
			if p, how := l.find(it); how != "" {
				matches[i] = importMatch{
					OnDrive: true,
					Path:    p,
					Volume:  d.VolumeID,
					Label:   d.Label,
					How:     how,
				}
			}
		}
	}
	writeJSON(w, http.StatusOK, importCheckResponse{Matches: matches, Scanned: scanned, Drives: drives})
}
