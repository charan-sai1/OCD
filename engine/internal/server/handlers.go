package server

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"ocd/internal/dedupe"
	"ocd/internal/importer"
)

func decode(r *http.Request, v any) error {
	defer r.Body.Close()
	br := bufio.NewReader(r.Body)
	// Windows tools write UTF-8 with a byte-order mark more often than not, and
	// a JSON decoder refuses one outright with a message about the first
	// character. Skip it rather than make the caller work out that the invisible
	// thing at the front of their body is the problem.
	if b, err := br.Peek(3); err == nil && b[0] == 0xEF && b[1] == 0xBB && b[2] == 0xBF {
		_, _ = br.Discard(3)
	}
	return json.NewDecoder(br).Decode(v)
}

func (s *Server) tools(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"tools": importer.ToolsAvailable()})
}

// ---- Photofield management ----

func photofieldUp() bool {
	c := http.Client{Timeout: 1500 * time.Millisecond}
	resp, err := c.Get("http://localhost:8080")
	if err != nil {
		return false
	}
	_ = resp.Body.Close()
	return true
}

func (s *Server) pfStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"running": photofieldUp(),
		"url":     "http://localhost:8080",
	})
}

func (s *Server) pfStart(w http.ResponseWriter, r *http.Request) {
	if photofieldUp() {
		writeJSON(w, http.StatusOK, map[string]any{"running": true, "url": "http://localhost:8080"})
		return
	}
	if s.cfg.PhotofieldExe == "" {
		writeJSON(w, http.StatusOK, map[string]any{"error": "photofield path not configured"})
		return
	}
	// Keep the gallery's collections in step with the folders saved in the app.
	// Safe here because the gallery is not running yet.
	_ = s.syncPhotofieldConfig()

	cmd := exec.Command(s.cfg.PhotofieldExe)
	cmd.Env = append(os.Environ(), "PHOTOFIELD_DATA_DIR="+s.cfg.PhotofieldData)
	cmd.Dir = s.cfg.DataDir
	if err := cmd.Start(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	s.mu.Lock()
	s.pfCmd = cmd
	s.mu.Unlock()
	// give it a moment to bind
	for i := 0; i < 20 && !photofieldUp(); i++ {
		time.Sleep(200 * time.Millisecond)
	}
	writeJSON(w, http.StatusOK, map[string]any{"running": photofieldUp(), "url": "http://localhost:8080"})
}

func (s *Server) pfStop(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	cmd := s.pfCmd
	s.pfCmd = nil
	s.mu.Unlock()
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
	writeJSON(w, http.StatusOK, map[string]any{"running": photofieldUp()})
}

// pfRescan triggers INDEX_FILES for every Photofield collection.
func (s *Server) pfRescan(w http.ResponseWriter, r *http.Request) {
	cols, err := httpGetJSON("http://localhost:8080/api/collections")
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"error": "photofield not running"})
		return
	}
	items, _ := cols["items"].([]any)
	var started []string
	for _, it := range items {
		m, _ := it.(map[string]any)
		id, _ := m["id"].(string)
		if id == "" {
			continue
		}
		body := map[string]string{"type": "INDEX_FILES", "collection_id": id}
		if err := httpPostJSON("http://localhost:8080/api/tasks", body); err == nil {
			started = append(started, id)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"rescan_started": started})
}

// ---- Dedupe ----

func (s *Server) dedupeScan(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Dirs    []string `json:"dirs"`
		MinSize int64    `json:"minSize"`
	}
	_ = decode(r, &req)
	if len(req.Dirs) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "no dirs"})
		return
	}
	res, err := dedupe.FindDuplicates(dedupe.Options{
		Dirs:    req.Dirs,
		MinSize: req.MinSize,
		Progress: func(p dedupe.Progress) {
			s.emitJSON(p.Phase, p.Done, p.Total, p.Message)
		},
	}, nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	s.mu.Lock()
	s.lastDedupe = res.Groups
	s.mu.Unlock()

	// Trim payload for the UI: report groups but cap the file lists.
	type g struct {
		Hash  string   `json:"hash"`
		Size  int64    `json:"size"`
		Count int      `json:"count"`
		Keep  string   `json:"keep"`
		More  []string `json:"more"`
	}
	out := make([]g, 0, len(res.Groups))
	for _, grp := range res.Groups {
		gg := g{Hash: grp.Hash, Size: grp.Size, Count: len(grp.Files), Keep: grp.Files[0].Path}
		for i := 1; i < len(grp.Files) && i <= 20; i++ {
			gg.More = append(gg.More, grp.Files[i].Path)
		}
		out = append(out, gg)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"totalFiles":       res.TotalFiles,
		"duplicateFiles":   res.DuplicateFiles,
		"redundantCopies":  res.RedundantCopies,
		"reclaimableBytes": res.ReclaimableBytes,
		"reclaimableHuman": human(res.ReclaimableBytes),
		"groupCount":       len(res.Groups),
		"groups":           out,
	})
}

func (s *Server) dedupeQuarantine(w http.ResponseWriter, r *http.Request) {
	var req struct {
		DryRun        bool   `json:"dryRun"`
		QuarantineDir string `json:"quarantineDir"`
		Keep          string `json:"keep"`
	}
	_ = decode(r, &req)
	if req.QuarantineDir == "" {
		req.QuarantineDir = filepath.Join(s.cfg.DataDir, "quarantine")
	}
	s.mu.Lock()
	groups := s.lastDedupe
	s.mu.Unlock()
	if len(groups) == 0 {
		writeJSON(w, http.StatusOK, map[string]any{"error": "run a scan first"})
		return
	}
	res, err := dedupe.Quarantine(groups, dedupe.QuarantineOptions{
		QuarantineDir: req.QuarantineDir,
		DryRun:        req.DryRun,
		Keep:          req.Keep,
	})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	if !req.DryRun {
		// The recorded paths go stale the moment files move, so force a fresh
		// scan before anything else can be quarantined. Reusing them made a
		// second click fail with "cannot find the file specified".
		s.mu.Lock()
		s.lastDedupe = nil
		s.mu.Unlock()
	}
	var sample string
	if len(res.Moved) > 0 {
		sample = res.Moved[0].To
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"dryRun":     req.DryRun,
		"moved":      len(res.Moved),
		"freedBytes": res.Freed,
		"freedHuman": human(res.Freed),
		"quarantine": req.QuarantineDir,
		"sample":     sample,
		"errors":     res.Errors,
	})
}

// ---- Import ----

func (s *Server) importDevices(w http.ResponseWriter, r *http.Request) {
	adb, adbErr := importer.ListDevices()
	ios, iosErr := importer.ListIosDevices()
	out := map[string]any{"android": adb, "ios": ios}
	if adbErr != nil {
		out["android_error"] = adbErr.Error()
	}
	if iosErr != nil {
		out["ios_error"] = iosErr.Error()
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) importRun(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SourceType        string `json:"sourceType"`
		Source            string `json:"source"`
		DestRoot          string `json:"destRoot"`
		DryRun            bool   `json:"dryRun"`
		DeleteAfterVerify bool   `json:"deleteAfterVerify"`
		DupCheck          string `json:"dupCheck"`  // "content" | "name"
		DupAction         string `json:"dupAction"` // "skip" | "copy"
	}
	_ = decode(r, &req)
	if req.DestRoot == "" || req.Source == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "source and destRoot are required"})
		return
	}
	if req.DupCheck == "" {
		req.DupCheck = "content"
	}
	if req.DupAction == "" {
		req.DupAction = "skip"
	}

	var src importer.Source
	switch req.SourceType {
	case "adb":
		serial, root := "", req.Source
		if i := strings.Index(req.Source, "|"); i >= 0 {
			serial, root = req.Source[:i], req.Source[i+1:]
		}
		src = &importer.AdbSource{Serial: serial, Root: root}
	default:
		src = &importer.LocalSource{Root: req.Source}
	}

	// Pick the index that matches the chosen duplicate-check mode.
	idxPath := filepath.Join(s.cfg.DataDir,
		req.DupCheck+"index-"+sanitize(req.DestRoot)+".json")
	var (
		idx *importer.Index
		err error
	)
	if req.DupAction == "skip" {
		build := func(n int, msg string) { s.emitJSON("index", n, 0, msg) }
		if req.DupCheck == "name" {
			idx, err = importer.LoadOrBuildNameIndex(idxPath, []string{req.DestRoot}, build)
		} else {
			idx, err = importer.LoadOrBuildIndex(idxPath, []string{req.DestRoot}, build)
		}
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
			return
		}
	}

	res, err := importer.Import(src, importer.Options{
		DestRoot:          req.DestRoot,
		DryRun:            req.DryRun,
		DeleteAfterVerify: req.DeleteAfterVerify,
		DupCheck:          req.DupCheck,
		DupAction:         req.DupAction,
		Index:             idx,
		Progress: func(p importer.Progress) {
			s.emitJSON(p.Phase, p.Done, p.Total, p.Message)
		},
	})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	if !req.DryRun && idx != nil {
		_ = idx.Save()
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"imported":  len(res.Imported),
		"skipped":   len(res.Skipped),
		"deleted":   len(res.Deleted),
		"bytes":     res.Bytes,
		"human":     human(res.Bytes),
		"errors":    res.Errors,
		"dupCheck":  req.DupCheck,
		"dupAction": req.DupAction,
	})
}

// ---- small helpers ----

func sanitize(p string) string {
	r := strings.NewReplacer(":", "", "\\", "_", "/", "_", " ", "_")
	return strings.Trim(r.Replace(p), "_")
}

func human(b int64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := int64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.2f %cB", float64(b)/float64(div), "KMGTPE"[exp])
}

func httpGetJSON(url string) (map[string]any, error) {
	c := http.Client{Timeout: 10 * time.Second}
	resp, err := c.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var m map[string]any
	err = json.NewDecoder(resp.Body).Decode(&m)
	return m, err
}

func httpPostJSON(url string, body any) error {
	b, _ := json.Marshal(body)
	c := http.Client{Timeout: 10 * time.Second}
	resp, err := c.Post(url, "application/json", strings.NewReader(string(b)))
	if err != nil {
		return err
	}
	_ = resp.Body.Close()
	return nil
}
