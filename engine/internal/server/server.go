// Package server exposes OCD Manager over HTTP with a small embedded web UI.
package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os/exec"
	"path/filepath"
	"sync"

	"ocd/internal/dedupe"
	"ocd/internal/media"
)

// Config holds runtime paths.
type Config struct {
	DataDir        string // where indexes/reports live
	PhotofieldExe  string // optional path to photofield binary
	PhotofieldData string
	AutoScan       bool // refresh the media index shortly after start
}

// Server is the HTTP app.
type Server struct {
	cfg     Config
	mu      sync.Mutex
	clients map[chan string]struct{}

	libs       *libraryStore
	phone      *phoneStore
	lastDedupe []dedupe.Group
	pfCmd      *exec.Cmd

	index  *media.Index
	thumbs *media.Thumbs

	scanMu   sync.Mutex
	scanning bool
	scanProg media.Progress
}

// New creates a server.
func New(cfg Config) *Server {
	s := &Server{cfg: cfg, clients: map[chan string]struct{}{}}

	libsFile := filepath.Join(cfg.DataDir, "libraries.json")
	st, err := newLibraryStore(libsFile)
	if err != nil {
		st = &libraryStore{file: libsFile}
	}
	s.libs = st
	// First run: adopt the collections already configured in Photofield.
	if cfg.PhotofieldData != "" {
		s.libs.seedFromPhotofield(filepath.Join(cfg.PhotofieldData, "configuration.yaml"))
		_ = s.libs.save()
	}

	s.index = media.New(cfg.DataDir)
	s.thumbs = media.NewThumbs(filepath.Join(cfg.DataDir, "thumbs"), ffmpegPath)
	s.phone = newPhoneStore(filepath.Join(cfg.DataDir, "phone.json"))
	return s
}

// ffmpegPath is looked up fresh each time so installing ffmpeg while the app is
// running starts producing video thumbnails without a restart.
func ffmpegPath() string {
	if p, err := exec.LookPath("ffmpeg"); err == nil {
		return p
	}
	return ""
}

// Handler returns the root mux.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/events", s.events)
	mux.HandleFunc("/api/tools", s.tools)
	mux.HandleFunc("/api/fs/roots", s.fsRoots)
	mux.HandleFunc("/api/fs/list", s.fsList)
	mux.HandleFunc("/api/libraries", s.libsRouter)
	mux.HandleFunc("/api/libraries/scan", s.libsScan)
	mux.HandleFunc("/api/photos", s.gallery)
	mux.HandleFunc("/api/item", s.itemInfo)
	mux.HandleFunc("/api/fav", s.favToggle)
	mux.HandleFunc("/api/orig", s.orig)
	mux.HandleFunc("/api/t", s.thumb)
	mux.HandleFunc("/api/reveal", s.reveal)
	mux.HandleFunc("/api/index", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			s.indexRebuild(w, r)
			return
		}
		s.indexStatus(w, r)
	})
	mux.HandleFunc("/api/photofield/status", s.pfStatus)
	mux.HandleFunc("/api/photofield/start", s.pfStart)
	mux.HandleFunc("/api/photofield/stop", s.pfStop)
	mux.HandleFunc("/api/photofield/rescan", s.pfRescan)
	mux.HandleFunc("/api/dedupe/scan", s.dedupeScan)
	mux.HandleFunc("/api/dedupe/quarantine", s.dedupeQuarantine)
	mux.HandleFunc("/api/import/devices", s.importDevices)
	mux.HandleFunc("/api/import/run", s.importRun)
	mux.HandleFunc("/api/phone", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			s.phonePut(w, r)
			return
		}
		s.phoneGet(w, r)
	})
	mux.HandleFunc("/api/phone/import", s.phoneImportRun)
	mux.HandleFunc("/", s.static)
	return mux
}

// ---- SSE broadcaster ----

func (s *Server) emit(msg string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for ch := range s.clients {
		select {
		case ch <- msg:
		default: // drop if the client is slow
		}
	}
}

func (s *Server) emitJSON(phase string, done, total int, message string) {
	b, _ := json.Marshal(map[string]any{"phase": phase, "done": done, "total": total, "message": message})
	s.emit(string(b))
}

// emitIndex reports scan progress. It carries how many files could not be read,
// so the interface can say so instead of quietly showing fewer photos than the
// drive holds.
func (s *Server) emitIndex(phase string, done, total, skipped int, message string) {
	b, _ := json.Marshal(map[string]any{
		"phase": phase, "done": done, "total": total,
		"skipped": skipped, "message": message,
	})
	s.emit(string(b))
}

func (s *Server) events(w http.ResponseWriter, r *http.Request) {
	fl, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	ch := make(chan string, 64)
	s.mu.Lock()
	s.clients[ch] = struct{}{}
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.clients, ch)
		s.mu.Unlock()
	}()

	for {
		select {
		case <-r.Context().Done():
			return
		case msg := <-ch:
			fmt.Fprintf(w, "data: %s\n\n", msg)
			fl.Flush()
		}
	}
}

// ---- helpers ----

// photofieldBase is where the optional gallery engine listens. OCD Manager now
// indexes and serves previews itself, so the engine is only used when someone
// opens its own interface.
const photofieldBase = "http://localhost:8080"

func str(v any) string {
	s, _ := v.(string)
	return s
}

func num(v any) float64 {
	f, _ := v.(float64)
	return f
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func (s *Server) static(w http.ResponseWriter, r *http.Request) {
	// Single embedded page for everything. It is baked into the binary, so
	// never let a browser hold on to an older copy across a rebuild.
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(indexHTML)
}
