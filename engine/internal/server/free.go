package server

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// free.go records phone-side deletions in the drive's audit log. The phone has
// already verified, hashed copies on the drive before it deletes anything; this
// endpoint only adds the row that says how much was freed, so the Activity
// screen and the desktop's own log agree about what happened.
//
// Nothing is deleted or moved here. The drive copies stay exactly as they are.

type freeRecordRequest struct {
	LibraryID string `json:"libraryId"`
	VolumeID  string `json:"volumeId"`
	Count     int    `json:"count"`
	Bytes     int64  `json:"bytes"`
	// Name is set only when one item was deleted, so the row can name it.
	Name string `json:"name"`
}

func (s *Server) freeRecord(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req freeRecordRequest
	if err := decode(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid request"})
		return
	}
	if req.Count <= 0 || req.Bytes < 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "there is nothing to record"})
		return
	}

	lib, info, err := s.pickUploadLibrary(req.LibraryID, req.VolumeID)
	if err != nil {
		// The drive is unplugged. The deletion already happened on the phone,
		// so this is a missing log line, not a failed delete.
		writeJSON(w, http.StatusConflict, map[string]any{"error": err.Error()})
		return
	}

	name := strings.TrimSpace(req.Name)
	if len(name) > 200 {
		name = name[:200]
	}
	rec := map[string]any{
		"ts":        time.Now().UTC().Format(time.RFC3339),
		"op":        "delete",
		"device":    deviceName(r),
		"volumeId":  info.ID,
		"libraryId": lib.ID,
		"bytes":     req.Bytes,
		"count":     req.Count,
		"verified":  true,
	}
	if req.Count == 1 && name != "" {
		rec["src"] = name
	}
	if err := s.appendAudit(info.Root, rec); err != nil {
		log.Printf("free record %s: %v", info.Root, err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "cannot write to the drive's log"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"recorded":  true,
		"volumeId":  info.ID,
		"libraryId": lib.ID,
	})
}

// deviceName is the phone's own label, falling back to its user agent. Kept
// short enough for one activity row.
func deviceName(r *http.Request) string {
	device := strings.TrimSpace(r.Header.Get("X-OCD-Device"))
	if device == "" {
		device = r.UserAgent()
	}
	if len(device) > 120 {
		device = device[:120]
	}
	return device
}

// auditDir is the folder that holds one drive's audit log. The system drive's
// root may not be writable, so its log lives beside the app's data instead.
func (s *Server) auditDir(volumeRoot string) string {
	dir := filepath.Join(volumeRoot, ".ocd")
	if s.sysRoot != "" && strings.EqualFold(filepath.Clean(volumeRoot), filepath.Clean(s.sysRoot)) {
		dir = s.cfg.DataDir
	}
	return dir
}

// appendAudit adds one JSON line and syncs it, so a later read sees the row.
func (s *Server) appendAudit(volumeRoot string, rec map[string]any) error {
	line, err := json.Marshal(rec)
	if err != nil {
		return err
	}
	dir := s.auditDir(volumeRoot)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	f, err := os.OpenFile(filepath.Join(dir, "audit.jsonl"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	if _, err := f.Write(append(line, '\n')); err != nil {
		return err
	}
	return f.Sync()
}
