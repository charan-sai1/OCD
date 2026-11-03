package server

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"ocd/internal/hashx"
	"ocd/internal/media"
	"ocd/internal/volume"
)

// upload.go is the phone-to-drive path.
//
// The phone says what it is about to send, PUTs the bytes, and asks the server
// to finish. The server writes into a hidden .ocd-incoming folder on the same
// drive, hashes what arrived, and only then moves it into
// <Library>/Phone/YYYY/MM/. A file that fails the hash or the size check never
// reaches the library, so a dropped Wi-Fi connection cannot leave a half photo
// among the real ones.
//
// The upload is the unit of verification, not the phone: the phone does not
// need to hash a 130 MB video before sending it. If the phone does send a
// SHA-256, it is checked against the bytes that landed.

const maxUploadBytes = int64(8) << 30 // 8 GB covers a long 4K video
const uploadTTL = 30 * time.Minute

type uploadSession struct {
	mu sync.Mutex

	id          string
	name        string
	libraryID   string
	libraryPath string
	volumeID    string
	volumeRoot  string
	label       string

	dest string // absolute final path
	temp string // absolute .part path
	rel  string // volume-relative final path, slash separated

	size     int64
	received int64
	takenAt  int64
	kind     string
	width    int
	height   int
	duration float64

	clientSHA string
	created   time.Time
}

type uploadStartRequest struct {
	LibraryID string  `json:"libraryId"`
	VolumeID  string  `json:"volumeId"`
	Name      string  `json:"name"`
	Size      int64   `json:"size"`
	TakenAt   int64   `json:"takenAt"` // unix seconds
	MTime     int64   `json:"mtime"`   // unix seconds, optional
	SHA256    string  `json:"sha256"`  // optional
	Kind      string  `json:"kind"`    // "image" or "video"
	Width     int     `json:"width"`
	Height    int     `json:"height"`
	Duration  float64 `json:"duration"`
}

// uploadStart reserves a place on the drive and either opens a session or
// reports that an identical file is already there.
func (s *Server) uploadStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req uploadStartRequest
	if err := decode(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid request"})
		return
	}
	name := safeUploadName(req.Name)
	if name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "the file needs a name"})
		return
	}
	if !media.IsMedia(strings.ToLower(path.Ext(name))) {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "that is not a photo or video"})
		return
	}
	if req.Size <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "the file size is missing"})
		return
	}
	if req.Size > maxUploadBytes {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"error": "that file is larger than 8 GB"})
		return
	}

	lib, info, err := s.pickUploadLibrary(req.LibraryID, req.VolumeID)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]any{"error": err.Error()})
		return
	}
	s.sweepUploads()

	stamp := time.Now()
	if req.TakenAt > 0 {
		stamp = time.Unix(req.TakenAt, 0)
	}
	if stamp.Year() < 1990 || stamp.After(time.Now().AddDate(1, 0, 0)) {
		stamp = time.Now()
	}
	stamp = stamp.Local()
	dir := filepath.Join(lib.Path, "Phone", stamp.Format("2006"), stamp.Format("01"))
	dest := filepath.Join(dir, name)

	if fi, statErr := os.Stat(dest); statErr == nil {
		if fi.Size() == req.Size {
			rel, relErr := volumeRel(info.Root, dest)
			if relErr != nil {
				rel = name
			}
			writeJSON(w, http.StatusOK, map[string]any{
				"existingPath": rel,
				"size":         fi.Size(),
				"libraryId":    lib.ID,
				"volumeId":     info.ID,
				"label":        info.Label,
			})
			return
		}
		dest = uniqueUploadPath(dest)
	} else if !os.IsNotExist(statErr) {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "cannot read the destination folder"})
		return
	}

	if err := os.MkdirAll(dir, 0o755); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "cannot create the destination folder on that drive"})
		return
	}
	tempDir := filepath.Join(lib.Path, ".ocd-incoming")
	if err := os.MkdirAll(tempDir, 0o755); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "cannot create a temporary folder on that drive"})
		return
	}

	id := newUploadID()
	temp := filepath.Join(tempDir, id+".part")
	f, err := os.OpenFile(temp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "cannot prepare the upload on that drive"})
		return
	}
	f.Close()

	rel, err := volumeRel(info.Root, dest)
	if err != nil {
		os.Remove(temp)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "the destination is outside the drive"})
		return
	}

	kind := string(media.KindOf(strings.ToLower(path.Ext(name))))
	if kind == string(media.KindOther) {
		kind = string(media.KindImage)
	}

	sess := &uploadSession{
		id:          id,
		name:        name,
		libraryID:   lib.ID,
		libraryPath: lib.Path,
		volumeID:    info.ID,
		volumeRoot:  info.Root,
		label:       info.Label,
		dest:        dest,
		temp:        temp,
		rel:         rel,
		size:        req.Size,
		takenAt:     req.TakenAt,
		kind:        kind,
		width:       req.Width,
		height:      req.Height,
		duration:    req.Duration,
		clientSHA:   strings.ToLower(strings.TrimSpace(req.SHA256)),
		created:     time.Now(),
	}
	s.uploadMu.Lock()
	s.uploads[id] = sess
	s.uploadMu.Unlock()

	writeJSON(w, http.StatusOK, map[string]any{
		"uploadId":  id,
		"offset":    0,
		"size":      sess.size,
		"path":      rel,
		"libraryId": lib.ID,
		"volumeId":  info.ID,
		"label":     info.Label,
	})
}

// uploadItem routes /api/upload/{id}, /{id}/finish, and /{id}/abort.
func (s *Server) uploadItem(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/api/upload/")
	id, action := rest, ""
	if i := strings.IndexByte(rest, '/'); i >= 0 {
		id, action = rest[:i], rest[i+1:]
	}
	sess, ok := s.findUpload(id)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "that upload has expired"})
		return
	}
	switch {
	case action == "" && r.Method == http.MethodGet:
		s.uploadStatus(w, sess)
	case action == "" && r.Method == http.MethodPut:
		s.uploadPut(w, r, sess)
	case action == "finish" && r.Method == http.MethodPost:
		s.uploadFinish(w, r, sess)
	case action == "abort" && r.Method == http.MethodPost:
		s.uploadAbort(w, sess)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) uploadStatus(w http.ResponseWriter, sess *uploadSession) {
	sess.mu.Lock()
	defer sess.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{
		"uploadId":  sess.id,
		"received":  sess.received,
		"size":      sess.size,
		"offset":    sess.received,
		"libraryId": sess.libraryID,
		"volumeId":  sess.volumeID,
	})
}

func (s *Server) uploadPut(w http.ResponseWriter, r *http.Request, sess *uploadSession) {
	sess.mu.Lock()
	defer sess.mu.Unlock()

	if sess.received >= sess.size {
		writeJSON(w, http.StatusConflict, map[string]any{"error": "that upload has already finished"})
		return
	}
	offset, _ := strconv.ParseInt(r.URL.Query().Get("offset"), 10, 64)
	if offset != sess.received {
		writeJSON(w, http.StatusConflict, map[string]any{
			"error":  "the upload is at a different offset",
			"offset": sess.received,
		})
		return
	}

	f, err := os.OpenFile(sess.temp, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "cannot write to the drive"})
		return
	}
	remaining := sess.size - sess.received
	// One extra byte tells us a client sent more than it declared, instead of
	// silently accepting a truncated file that happens to match the size.
	n, copyErr := io.Copy(f, http.MaxBytesReader(w, r.Body, remaining+1))
	syncErr := f.Sync()
	closeErr := f.Close()
	sess.received += n

	if sess.received > sess.size {
		os.Remove(sess.temp)
		sess.received = 0
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"error": "more bytes arrived than the file size"})
		return
	}
	if copyErr != nil || syncErr != nil || closeErr != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error":    "the upload was interrupted",
			"received": sess.received,
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"received": sess.received,
		"offset":   sess.received,
		"size":     sess.size,
	})
}

func (s *Server) uploadFinish(w http.ResponseWriter, r *http.Request, sess *uploadSession) {
	sess.mu.Lock()
	defer sess.mu.Unlock()

	if sess.received != sess.size {
		writeJSON(w, http.StatusConflict, map[string]any{
			"error":   "the upload is incomplete",
			"offset":  sess.received,
			"size":    sess.size,
			"missing": sess.size - sess.received,
		})
		return
	}
	sum, err := hashx.File(sess.temp)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "cannot verify the uploaded file"})
		return
	}
	if sess.clientSHA != "" && sess.clientSHA != sum {
		os.Remove(sess.temp)
		s.deleteUpload(sess.id)
		writeJSON(w, http.StatusConflict, map[string]any{
			"error": "the file changed while it was being sent",
			"code":  "hash-mismatch",
		})
		return
	}

	// Someone may have written the same name while we were uploading.
	dest := sess.dest
	existing := false
	if fi, statErr := os.Stat(dest); statErr == nil {
		if fi.Size() == sess.size {
			existing = true
		} else {
			dest = uniqueUploadPath(dest)
		}
	}
	if !existing {
		if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "cannot create the destination folder"})
			return
		}
		if err := moveFile(sess.temp, dest); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "cannot move the file onto the drive"})
			return
		}
	} else {
		os.Remove(sess.temp)
	}

	fi, err := os.Stat(dest)
	if err != nil || fi.Size() != sess.size {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "the file on the drive does not match what was sent"})
		return
	}

	rel, err := volumeRel(sess.volumeRoot, dest)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "the destination is outside the drive"})
		return
	}
	libRel, err := filepath.Rel(sess.libraryPath, dest)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "the destination is outside the folder"})
		return
	}

	shot := sess.takenAt
	if shot <= 0 {
		shot = fi.ModTime().Unix()
	}
	item := media.Item{
		Lib:      sess.libraryID,
		Rel:      filepath.ToSlash(libRel),
		Name:     filepath.Base(dest),
		Ext:      strings.ToLower(filepath.Ext(dest)),
		Kind:     media.Kind(sess.kind),
		Size:     fi.Size(),
		ModTime:  fi.ModTime().Unix(),
		ShotAt:   shot,
		W:        sess.width,
		H:        sess.height,
		Duration: sess.duration,
	}
	s.index.Put(item)
	s.touchPersist()
	s.auditImport(r, sess, rel, sum, fi.Size())

	writeJSON(w, http.StatusOK, map[string]any{
		"verified":  true,
		"sha256":    sum,
		"path":      rel,
		"size":      fi.Size(),
		"existing":  existing,
		"itemId":    item.Key(),
		"libraryId": sess.libraryID,
		"volumeId":  sess.volumeID,
		"label":     sess.label,
	})
	s.deleteUpload(sess.id)
}

func (s *Server) uploadAbort(w http.ResponseWriter, sess *uploadSession) {
	sess.mu.Lock()
	os.Remove(sess.temp)
	sess.mu.Unlock()
	s.deleteUpload(sess.id)
	writeJSON(w, http.StatusOK, map[string]any{"aborted": true})
}

/* ---------- import bookkeeping ---------- */

// touchPersist batches index and catalog writes. Without it, sending 100 photos
// would rewrite the 63,000-entry index and every drive catalog 100 times.
func (s *Server) touchPersist() {
	s.persistMu.Lock()
	defer s.persistMu.Unlock()
	if s.persistTimer != nil {
		s.persistTimer.Stop()
	}
	s.persistTimer = time.AfterFunc(3*time.Second, s.persistNow)
}

// persistNow stops the timer and flushes immediately. The upload handler uses
// the delayed path; tests and shutdown use this one.
func (s *Server) persistNow() {
	s.persistMu.Lock()
	if s.persistTimer != nil {
		s.persistTimer.Stop()
		s.persistTimer = nil
	}
	s.persistMu.Unlock()
	s.flushPersist()
}

func (s *Server) flushPersist() {
	s.saveMu.Lock()
	defer s.saveMu.Unlock()
	if err := s.index.Save(); err != nil {
		log.Printf("index after import: %v", err)
		return
	}
	s.writeCatalogs(s.libMedia())
	s.drives.refresh(s.libs.list())
	s.emitJSON("imported", s.index.Len(), 0, "")
}

func (s *Server) auditImport(r *http.Request, sess *uploadSession, rel, sum string, size int64) {
	device := strings.TrimSpace(r.Header.Get("X-OCD-Device"))
	if device == "" {
		device = r.UserAgent()
	}
	if len(device) > 120 {
		device = device[:120]
	}
	rec := map[string]any{
		"ts":        time.Now().UTC().Format(time.RFC3339),
		"op":        "import",
		"device":    device,
		"volumeId":  sess.volumeID,
		"libraryId": sess.libraryID,
		"src":       sess.name,
		"dst":       rel,
		"bytes":     size,
		"sha256":    sum,
		"verified":  true,
	}
	line, err := json.Marshal(rec)
	if err != nil {
		return
	}
	dir := filepath.Join(sess.volumeRoot, ".ocd")
	if s.sysRoot != "" && strings.EqualFold(filepath.Clean(sess.volumeRoot), filepath.Clean(s.sysRoot)) {
		dir = s.cfg.DataDir
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		log.Printf("audit %s: %v", sess.volumeRoot, err)
		return
	}
	f, err := os.OpenFile(filepath.Join(dir, "audit.jsonl"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		log.Printf("audit %s: %v", sess.volumeRoot, err)
		return
	}
	defer f.Close()
	if _, err := f.Write(append(line, '\n')); err != nil {
		log.Printf("audit %s: %v", sess.volumeRoot, err)
		return
	}
	_ = f.Sync()
}

/* ---------- helpers ---------- */

func (s *Server) findUpload(id string) (*uploadSession, bool) {
	s.uploadMu.Lock()
	defer s.uploadMu.Unlock()
	sess, ok := s.uploads[id]
	return sess, ok
}

func (s *Server) deleteUpload(id string) {
	s.uploadMu.Lock()
	delete(s.uploads, id)
	s.uploadMu.Unlock()
}

func (s *Server) sweepUploads() {
	cutoff := time.Now().Add(-uploadTTL)
	s.uploadMu.Lock()
	defer s.uploadMu.Unlock()
	for id, sess := range s.uploads {
		if sess.created.Before(cutoff) {
			os.Remove(sess.temp)
			delete(s.uploads, id)
		}
	}
}

// pickUploadLibrary chooses where a phone import lands. A library id wins; a
// volume id picks the first folder on that drive; otherwise the first
// connected folder is used.
func (s *Server) pickUploadLibrary(libraryID, volumeID string) (Library, volume.Info, error) {
	for _, l := range s.libs.list() {
		if !l.Available {
			continue
		}
		if libraryID != "" && l.ID != libraryID {
			continue
		}
		info, err := s.drives.volumeOf(l.Path)
		if err != nil {
			continue
		}
		if volumeID != "" && info.ID != volumeID {
			continue
		}
		return l, info, nil
	}
	switch {
	case libraryID != "":
		return Library{}, volume.Info{}, errors.New("that drive is not connected")
	case volumeID != "":
		return Library{}, volume.Info{}, errors.New("that drive is not connected")
	default:
		return Library{}, volume.Info{}, errors.New("add a drive folder first, or plug the drive in")
	}
}

func newUploadID() string {
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		return strconv.FormatInt(time.Now().UnixNano(), 16)
	}
	return hex.EncodeToString(b)
}

// safeUploadName keeps the phone's file name but never lets it choose a path.
// Windows-invalid characters are replaced rather than rejected, so a photo
// called "a:b.jpg" still arrives.
func safeUploadName(raw string) string {
	raw = strings.TrimSpace(raw)
	raw = strings.ReplaceAll(raw, "\\", "/")
	name := path.Base(raw)
	if name == "" || name == "." || name == ".." || name == "/" {
		return ""
	}
	name = strings.Map(func(r rune) rune {
		switch {
		case r < 0x20 || r == 0x7f:
			return -1
		case strings.ContainsRune(`<>:"|?*`, r):
			return '_'
		}
		return r
	}, name)
	name = strings.TrimSpace(name)
	ext := path.Ext(name)
	stem := strings.TrimRight(strings.TrimSuffix(name, ext), ". ")
	if stem == "" {
		stem = "photo"
	}
	switch strings.ToUpper(stem) {
	case "CON", "PRN", "AUX", "NUL",
		"COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
		"LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9":
		stem = "_" + stem
	}
	if len(stem) > 160 {
		r := []rune(stem)
		if len(r) > 160 {
			stem = string(r[:160])
		}
	}
	return stem + ext
}

func uniqueUploadPath(p string) string {
	if _, err := os.Stat(p); os.IsNotExist(err) {
		return p
	}
	dir, base := filepath.Dir(p), filepath.Base(p)
	ext := filepath.Ext(base)
	stem := strings.TrimSuffix(base, ext)
	for i := 1; i < 10000; i++ {
		cand := filepath.Join(dir, fmt.Sprintf("%s (%d)%s", stem, i, ext))
		if _, err := os.Stat(cand); os.IsNotExist(err) {
			return cand
		}
	}
	return filepath.Join(dir, fmt.Sprintf("%s-%d%s", stem, time.Now().UnixNano(), ext))
}

func volumeRel(root, abs string) (string, error) {
	rel, err := filepath.Rel(root, abs)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", errors.New("path is outside the volume")
	}
	return filepath.ToSlash(rel), nil
}

// moveFile renames on the same drive and falls back to a copy when the
// temporary folder and the destination somehow live on different volumes.
func moveFile(src, dst string) error {
	if err := os.Rename(src, dst); err == nil {
		return nil
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		os.Remove(dst)
		return err
	}
	if err := out.Sync(); err != nil {
		out.Close()
		os.Remove(dst)
		return err
	}
	if err := out.Close(); err != nil {
		os.Remove(dst)
		return err
	}
	return os.Remove(src)
}
