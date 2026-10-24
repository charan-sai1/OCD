package server

import (
	"context"
	"net"
	"net/http"
	"os"
	"time"
)

// versionInfo tells the page what it is running and whether a newer release
// exists. canApply is false for a phone: only the computer that runs the file
// may replace it.
func (s *Server) versionInfo(w http.ResponseWriter, r *http.Request) {
	st := s.upd.State()
	writeJSON(w, http.StatusOK, map[string]any{
		"current":   st.Current,
		"latest":    st.Latest,
		"available": st.Available,
		"page":      st.Page,
		"checked":   st.Checked,
		"error":     st.Error,
		"canApply":  isLoopback(r),
	})
}

// updateCheck asks GitHub again instead of waiting for the timer.
func (s *Server) updateCheck(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "use POST"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	st := s.upd.Check(ctx)
	writeJSON(w, http.StatusOK, map[string]any{
		"current":   st.Current,
		"latest":    st.Latest,
		"available": st.Available,
		"page":      st.Page,
		"checked":   st.Checked,
		"error":     st.Error,
		"canApply":  isLoopback(r),
	})
}

// updateApply downloads the newer release, verifies it, swaps it in and exits
// so the replacement can take the port. It is deliberately limited to a request
// made on the machine itself: this is code execution, and the server has no
// password to make that safe over a network.
func (s *Server) updateApply(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "use POST"})
		return
	}
	if !isLoopback(r) {
		writeJSON(w, http.StatusForbidden, map[string]any{
			"error": "run the update on the computer that has OCD Manager on it",
		})
		return
	}
	// A custom header cannot be set by a form on another site, so an update
	// cannot be triggered by a page the user happens to have open.
	if r.Header.Get("X-OCD-Update") != "1" {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "missing update header"})
		return
	}

	s.updateMu.Lock()
	if s.updating {
		s.updateMu.Unlock()
		writeJSON(w, http.StatusConflict, map[string]any{"error": "an update is already being installed"})
		return
	}
	s.updating = true
	s.updateMu.Unlock()

	st := s.upd.State()
	if !st.Available {
		s.updateMu.Lock()
		s.updating = false
		s.updateMu.Unlock()
		writeJSON(w, http.StatusConflict, map[string]any{"error": "this is already the newest version"})
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	if err := s.upd.Install(ctx); err != nil {
		s.updateMu.Lock()
		s.updating = false
		s.updateMu.Unlock()
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}

	// The replacement is on disk and running. Give the response time to reach
	// the page, then let go of the port.
	writeJSON(w, http.StatusOK, map[string]any{"restarting": true, "version": s.upd.State().Latest})
	go func() {
		time.Sleep(700 * time.Millisecond)
		os.Exit(0)
	}()
}

// StartUpdateCheck looks for a newer release shortly after start, then every
// six hours. The request contains nothing about the library; a failure is only
// recorded and never interrupts browsing.
func (s *Server) StartUpdateCheck() {
	go func() {
		time.Sleep(20 * time.Second)
		for {
			ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
			s.upd.Check(ctx)
			cancel()
			time.Sleep(6 * time.Hour)
		}
	}()
}

// isLoopback reports whether the request came from this machine.
func isLoopback(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
