package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"ocd/internal/importer"
)

// phone.go is the wire between a phone and the drive.
//
// Every way of getting photos off a phone onto a PC ends up doing the same
// thing: dropping files into a folder. Quick Share writes into a folder, Phone
// Link writes into a folder, a cable copy writes into a folder. So this
// remembers which folder that is and which drive the photos belong on, watches
// it, and hands the whole lot to the importer in one tap — the phone never
// needs to be plugged into anything, and the phone's browser can drive it
// because the settings live on the server rather than in the page.

// phoneSettings is what the user chose, kept next to the saved libraries.
type phoneSettings struct {
	Inbox string `json:"inbox"`
	Dest  string `json:"dest"`
	Watch bool   `json:"watch"`
}

// phoneImport is the last run, remembered so that the answer to "is the phone
// safe to clear now?" survives a page reload — which matters most when the page
// is open on the phone itself.
type phoneImport struct {
	At       int64    `json:"at"`
	Imported int      `json:"imported"`
	Skipped  int      `json:"skipped"`
	Removed  int      `json:"removed"` // files taken out of the folder after verifying
	Bytes    int64    `json:"bytes"`
	Human    string   `json:"human"`
	Cleared  bool     `json:"cleared"` // the run was asked to empty the folder
	DryRun   bool     `json:"dryRun"`
	Errors   []string `json:"errors"`
}

type phoneFile struct {
	Settings   phoneSettings `json:"settings"`
	LastImport *phoneImport  `json:"lastImport,omitempty"`
}

type phoneStore struct {
	mu   sync.Mutex
	file string
	set  phoneSettings
	last *phoneImport
}

func newPhoneStore(file string) *phoneStore {
	st := &phoneStore{file: file}
	if b, err := os.ReadFile(file); err == nil && len(b) > 2 {
		var pf phoneFile
		if json.Unmarshal(b, &pf) == nil {
			st.set = pf.Settings
			st.last = pf.LastImport
		}
	}
	return st
}

func (st *phoneStore) get() phoneSettings {
	st.mu.Lock()
	defer st.mu.Unlock()
	return st.set
}

func (st *phoneStore) lastImport() *phoneImport {
	st.mu.Lock()
	defer st.mu.Unlock()
	return st.last
}

func (st *phoneStore) update(inbox, dest *string, watch *bool) phoneSettings {
	st.mu.Lock()
	if inbox != nil {
		st.set.Inbox = *inbox
	}
	if dest != nil {
		st.set.Dest = *dest
	}
	if watch != nil {
		st.set.Watch = *watch
	}
	next := st.set
	st.mu.Unlock()
	_ = st.save()
	return next
}

func (st *phoneStore) remember(res *phoneImport) {
	st.mu.Lock()
	st.last = res
	st.mu.Unlock()
	_ = st.save()
}

func (st *phoneStore) save() error {
	st.mu.Lock()
	b, err := json.MarshalIndent(phoneFile{Settings: st.set, LastImport: st.last}, "", "  ")
	st.mu.Unlock()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(st.file), 0o755); err != nil {
		return err
	}
	return os.WriteFile(st.file, b, 0o644)
}

// inboxWatch is what the arrival folder holds at this moment.
type inboxWatch struct {
	Ready  bool   `json:"ready"`
	Count  int    `json:"count"`
	Bytes  int64  `json:"bytes"`
	Human  string `json:"human"`
	Newest string `json:"newest"`
	Note   string `json:"note,omitempty"`
}

// countInbox counts the photos and videos waiting in a folder. It counts
// exactly the kinds of file the import will move, so the number on the button
// and the number of files that move can never disagree.
func countInbox(box string) inboxWatch {
	var out inboxWatch
	if box == "" {
		out.Note = "no folder chosen yet"
		return out
	}
	fi, err := os.Stat(box)
	if err != nil || !fi.IsDir() {
		out.Note = "that folder is not reachable right now"
		return out
	}
	out.Ready = true
	wanted := mediaExtensions()
	var newest time.Time
	_ = filepath.WalkDir(box, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil // a folder we cannot read is skipped, never fatal
		}
		if d.IsDir() {
			if p != box && phoneSkipFolder(d.Name()) {
				return filepath.SkipDir
			}
			return nil
		}
		if !wanted[strings.ToLower(filepath.Ext(d.Name()))] {
			return nil
		}
		info, ierr := d.Info()
		if ierr != nil {
			return nil
		}
		out.Count++
		out.Bytes += info.Size()
		if info.ModTime().After(newest) {
			newest, out.Newest = info.ModTime(), d.Name()
		}
		return nil
	})
	out.Human = human(out.Bytes)
	return out
}

func mediaExtensions() map[string]bool {
	out := map[string]bool{}
	for _, e := range importer.DefaultMediaExts() {
		out[e] = true
	}
	return out
}

// phoneSkipFolder names the folders a phone never means to send.
func phoneSkipFolder(name string) bool {
	if strings.HasPrefix(name, ".") {
		return true
	}
	switch name {
	case "$RECYCLE.BIN", "System Volume Information", "@eaDir", "#recycle":
		return true
	}
	return false
}

// StartPhoneWatch keeps the phone card honest without anyone pressing refresh:
// it looks in the arrival folder every few seconds and tells every open page
// when the count changes. Watching a folder properly needs a platform-specific
// API, and this folder only ever holds a handful of files, so a poll is the
// smaller thing to carry.
func (s *Server) StartPhoneWatch() {
	go func() {
		last := ""
		for {
			set := s.phone.get()
			wait := 4 * time.Second
			if set.Watch && set.Inbox != "" {
				started := time.Now()
				found := countInbox(set.Inbox)
				if time.Since(started) > 1500*time.Millisecond {
					// A very large folder was pointed at by mistake: do not
					// walk it again in a hurry.
					wait = 30 * time.Second
				}
				key := fmt.Sprintf("%d/%d/%v", found.Count, found.Bytes, found.Ready)
				if key != last {
					last = key
					s.emitPhone(found)
				}
			} else {
				last = ""
			}
			time.Sleep(wait)
		}
	}()
}

func (s *Server) emitPhone(found inboxWatch) {
	b, _ := json.Marshal(map[string]any{
		"phase": "inbox", "done": found.Count, "total": found.Bytes,
		"ready": found.Ready, "human": found.Human, "newest": found.Newest,
		"message": found.Note,
	})
	s.emit(string(b))
}

// phoneState is everything the interface needs to draw the phone card.
func (s *Server) phoneState() map[string]any {
	set := s.phone.get()
	found := countInbox(set.Inbox)
	return map[string]any{
		"inbox":       set.Inbox,
		"dest":        set.Dest,
		"watch":       set.Watch,
		"ready":       found.Ready,
		"count":       found.Count,
		"bytes":       found.Bytes,
		"countHuman":  found.Human,
		"newest":      found.Newest,
		"note":        found.Note,
		"destReady":   pathAvailable(set.Dest),
		"lastImport":  s.phone.lastImport(),
		"destChoices": s.phoneDestChoices(),
	}
}

// phoneDestChoices offers the drives already saved in the app as one-click
// destinations, so the folder that photos belong in is picked from what the app
// already knows rather than typed.
func (s *Server) phoneDestChoices() []map[string]any {
	var out []map[string]any
	for _, l := range s.libs.list() {
		out = append(out, map[string]any{
			"id": l.ID, "name": l.Name, "path": l.Path,
			"available": l.Available, "count": l.Count,
		})
	}
	if out == nil {
		out = []map[string]any{}
	}
	return out
}

func (s *Server) phoneGet(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.phoneState())
}

// phonePut changes the arrival folder, the drive, or whether to watch.
func (s *Server) phonePut(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Inbox *string `json:"inbox"`
		Dest  *string `json:"dest"`
		Watch *bool   `json:"watch"`
	}
	if err := decode(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}
	inbox, dest := cleanPath(req.Inbox), cleanPath(req.Dest)

	// Copying a folder into itself would mean the copies showing up as new
	// arrivals and being imported again, forever. Refuse it plainly.
	current := s.phone.get()
	checkInbox, checkDest := current.Inbox, current.Dest
	if req.Inbox != nil {
		checkInbox = inbox
	}
	if req.Dest != nil {
		checkDest = dest
	}
	if checkInbox != "" && checkDest != "" &&
		(sameOrInside(checkInbox, checkDest) || sameOrInside(checkDest, checkInbox)) {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": "the arrival folder and the drive cannot sit inside each other",
		})
		return
	}

	// Only the fields the caller actually sent are changed.
	var inboxArg, destArg *string
	if req.Inbox != nil {
		inboxArg = &inbox
	}
	if req.Dest != nil {
		destArg = &dest
	}
	set := s.phone.update(inboxArg, destArg, req.Watch)
	state := s.phoneState()
	state["saved"] = map[string]any{"inbox": set.Inbox, "dest": set.Dest, "watch": set.Watch}
	writeJSON(w, http.StatusOK, state)
}

// phoneImportRun moves what is waiting onto the drive.
func (s *Server) phoneImportRun(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Clear  bool `json:"clear"`
		DryRun bool `json:"dryRun"`
	}
	_ = decode(r, &req)
	set := s.phone.get()
	if set.Inbox == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "choose the folder your phone sends to first"})
		return
	}
	if set.Dest == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "choose the drive these photos belong on first"})
		return
	}

	out, err := s.doImport(importRequest{
		Source:            set.Inbox,
		DestRoot:          set.Dest,
		DryRun:            req.DryRun,
		DeleteAfterVerify: req.Clear,
		DupCheck:          "content",
		DupAction:         "skip",
		MediaExts:         importer.DefaultMediaExts(),
	})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	// The run is reported in exactly the shape it is remembered in, so the page
	// has one thing to draw whether the answer is fresh or from last week.
	run := phoneImport{
		At: time.Now().Unix(), Imported: out.Imported, Skipped: out.Skipped,
		Removed: out.Deleted, Bytes: out.Bytes, Human: human(out.Bytes),
		Cleared: req.Clear, DryRun: req.DryRun, Errors: out.Errors,
	}
	if !req.DryRun {
		s.phone.remember(&run)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"result": run,
		"state":  s.phoneState(),
	})
}

// cleanPath tidies a path safely: an empty choice means "not set", not the
// current directory, which is what filepath.Clean would say.
func cleanPath(p *string) string {
	if p == nil || strings.TrimSpace(*p) == "" {
		return ""
	}
	return filepath.Clean(*p)
}

// sameOrInside reports whether child is path itself or sits underneath it. An
// empty choice is not a path at all — treating it as "the current folder" is
// how filepath.Clean would read it, and that would compare the wrong things.
func sameOrInside(parent, child string) bool {
	if parent == "" || child == "" {
		return false
	}
	p, c := filepath.Clean(parent), filepath.Clean(child)
	if strings.EqualFold(p, c) {
		return true
	}
	rel, err := filepath.Rel(p, c)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}
