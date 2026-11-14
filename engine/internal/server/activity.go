package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"ocd/internal/volume"
)

// Activity is the phone-facing view of the audit logs the app already keeps.
// Nothing new is recorded here: uploads, phone backups and phone tidy runs all
// append one JSON row per file, and this endpoint merges those rows into one
// timeline. It is deliberately read-only.
//
// Rows come in two shapes, because the desktop and the phone wrote them:
//   - desktop upload: {"ts","op":"import","src","dst","bytes","device",...}
//   - phone backup/tidy: {"at","op":"backup"|"dedupe-move","from","to","size",...}
//
// Both are normalised so the client has one shape to render.

const (
	activityDefaultLimit = 120
	activityMaxLimit     = 500
	// auditTailBytes bounds how much of one drive's log is read. An audit file
	// grows forever; the newest rows are the useful ones, so read the tail.
	auditTailBytes = 2 << 20
)

type activityEntry struct {
	At        string `json:"at"`
	Op        string `json:"op"`
	From      string `json:"from,omitempty"`
	To        string `json:"to,omitempty"`
	Bytes     int64  `json:"bytes,omitempty"`
	Verified  bool   `json:"verified,omitempty"`
	SHA256    string `json:"sha256,omitempty"`
	Device    string `json:"device,omitempty"`
	Library   string `json:"library,omitempty"`
	LibraryID string `json:"libraryId,omitempty"`
	VolumeID  string `json:"volumeId,omitempty"`

	when time.Time // parsed At, used only for ordering
}

type activityResponse struct {
	Items []activityEntry `json:"items"`
	Files int             `json:"files"`
	Rows  int             `json:"rows"`
}

// auditFile is one audit log and the human name of the place it describes.
type auditFile struct {
	path      string
	library   string
	libraryID string
	volumeID  string
}

func (s *Server) activity(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	limit := activityDefaultLimit
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	if limit > activityMaxLimit {
		limit = activityMaxLimit
	}

	// One audit per volume, not per library: two libraries on the same drive
	// share the log, so reading it twice would duplicate every row.
	seenRoot := map[string]bool{}
	rootOf := s.rootOf
	if rootOf == nil {
		rootOf = volume.RootOf
	}
	var files []auditFile
	for _, l := range s.libs.list() {
		if !l.Available {
			continue
		}
		root := rootOf(l.Path)
		if root == "" || seenRoot[root] {
			continue
		}
		seenRoot[root] = true
		files = append(files, auditFile{
			path:      filepath.Join(root, ".ocd", "audit.jsonl"),
			library:   l.Name,
			libraryID: l.ID,
			volumeID:  l.VolumeID,
		})
	}
	// Uploads to the system drive are logged under the data folder rather than
	// the drive root (which may not be writable). That log is still activity.
	if s.cfg.DataDir != "" && s.sysRoot != "" {
		files = append(files, auditFile{
			path:    filepath.Join(s.cfg.DataDir, ".ocd", "audit.jsonl"),
			library: "This computer",
		})
	}

	snaps := make([]auditSnapshot, 0, len(files))
	for _, f := range files {
		rows, err := readAudit(f.path, auditTailBytes)
		if err != nil {
			continue
		}
		snaps = append(snaps, auditSnapshot{file: f, rows: rows})
	}
	rows := collectActivity(snaps, limit)
	writeJSON(w, http.StatusOK, activityResponse{
		Items: rows.items,
		Files: len(snaps),
		Rows:  rows.total,
	})
}

// auditSnapshot is one parsed file, kept separate so the merge order is explicit.
type auditSnapshot struct {
	file auditFile
	rows []activityEntry
}

type activityResult struct {
	items []activityEntry
	total int
}

// collectActivity labels, sorts and caps rows from every volume. It is pure so
// the merge rules can be tested without a server.
func collectActivity(snaps []auditSnapshot, limit int) activityResult {
	var all []activityEntry
	for _, snap := range snaps {
		for _, row := range snap.rows {
			if row.Library == "" {
				row.Library = snap.file.library
			}
			if row.LibraryID == "" {
				row.LibraryID = snap.file.libraryID
			}
			if row.VolumeID == "" {
				row.VolumeID = snap.file.volumeID
			}
			all = append(all, row)
		}
	}
	sort.SliceStable(all, func(i, j int) bool {
		// Newest first. Rows with no parseable time keep their file order at
		// the end instead of jumping ahead.
		a, b := all[i].when, all[j].when
		if a.IsZero() {
			return false
		}
		if b.IsZero() {
			return true
		}
		return a.After(b)
	})
	total := len(all)
	if limit > 0 && len(all) > limit {
		all = all[:limit]
	}
	return activityResult{items: all, total: total}
}

// readAudit parses a JSON-lines audit file, reading at most maxTail bytes from
// the end. A partial first line (when the read starts mid-file) is discarded.
func readAudit(path string, maxTail int64) ([]activityEntry, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	fi, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if fi.IsDir() {
		return nil, os.ErrInvalid
	}
	start := int64(0)
	if maxTail > 0 && fi.Size() > maxTail {
		start = fi.Size() - maxTail
	}
	buf := make([]byte, fi.Size()-start)
	if _, err := f.ReadAt(buf, start); err != nil && len(buf) == 0 {
		return nil, err
	}
	if start > 0 {
		if i := bytes.IndexByte(buf, '\n'); i >= 0 {
			buf = buf[i+1:]
		} else {
			buf = nil
		}
	}
	out := make([]activityEntry, 0, 16)
	for _, line := range bytes.Split(buf, []byte{'\n'}) {
		line = bytes.TrimSpace(line)
		if len(line) == 0 {
			continue
		}
		if row, ok := parseAuditLine(line); ok {
			out = append(out, row)
		}
	}
	return out, nil
}

// parseAuditLine accepts either writer's shape and returns the common one.
// Unknown fields are ignored; a row without an operation is skipped.
func parseAuditLine(line []byte) (activityEntry, bool) {
	var raw map[string]any
	if json.Unmarshal(line, &raw) != nil {
		return activityEntry{}, false
	}
	op := str(raw["op"])
	if op == "" {
		return activityEntry{}, false
	}
	at := first(str(raw["ts"]), str(raw["at"]))
	row := activityEntry{
		At:        at,
		Op:        op,
		From:      first(str(raw["src"]), str(raw["from"])),
		To:        first(str(raw["dst"]), str(raw["to"])),
		Bytes:     firstInt(raw["bytes"], raw["size"]),
		Verified:  raw["verified"] == true,
		SHA256:    str(raw["sha256"]),
		Device:    trimLabel(str(raw["device"])),
		Library:   trimLabel(str(raw["library"])),
		LibraryID: str(raw["libraryId"]),
		VolumeID:  str(raw["volumeId"]),
	}
	if at != "" {
		if t, err := time.Parse(time.RFC3339Nano, at); err == nil {
			row.when = t
		}
	}
	return row, true
}

func first(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

func firstInt(values ...any) int64 {
	for _, v := range values {
		switch n := v.(type) {
		case float64:
			if n > 0 {
				return int64(n)
			}
		case int64:
			if n > 0 {
				return n
			}
		case json.Number:
			if i, err := n.Int64(); err == nil && i > 0 {
				return i
			}
		}
	}
	return 0
}

// trimLabel keeps a device or library name short enough for one row.
func trimLabel(s string) string {
	s = strings.TrimSpace(s)
	if len(s) > 80 {
		return s[:80]
	}
	return s
}
