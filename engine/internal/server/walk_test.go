package server

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"ocd/internal/media"
)

// A phone player walks a video in big jumps and abandons requests whenever the
// user scrubs. If any of those reads stalls, or the last byte is unreachable,
// the video looks broken even though the network is fine.
func TestAVideoCanBeWalkedInJumps(t *testing.T) {
	const total = 12 << 20
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "walk.mp4"), total, time.Unix(1_700_000_000, 0))
	srv := newReadServer(t, root, "walk.mp4", media.KindVideo)

	starts := []int64{0, 1 << 20, 1<<20 + 256<<10, 3 << 20, 8 << 20}
	deadline := time.Now().Add(20 * time.Second)
	for _, start := range starts {
		got := srv.read(t, "lib:walk.mp4", start, start+(1<<20)-1)
		if int64(len(got)) != 1<<20 {
			t.Fatalf("chunk at %d came back as %d bytes", start, len(got))
		}
		if time.Now().After(deadline) {
			t.Fatal("reading the file took longer than a player would wait")
		}
	}

	// The player probes the very end of the file to find the index of a
	// QuickTime movie; a miss there means the video never starts.
	last := srv.read(t, "lib:walk.mp4", total-1, total-1)
	if len(last) != 1 {
		t.Fatalf("the final byte came back as %d bytes", len(last))
	}

	// Beyond the end must be a clean 416, which players treat as end-of-file.
	rec := srv.rangeRec(t, "lib:walk.mp4", strconv.FormatInt(total+1, 10)+"-"+strconv.FormatInt(total+2048, 10))
	if rec.Code != http.StatusRequestedRangeNotSatisfiable {
		t.Fatalf("a range past the end answered %d, want 416", rec.Code)
	}
}

// A video without ffmpeg has no picture. The app has to be told that clearly:
// a 200 with an empty body renders as a silently blank tile.
func TestAMissingThumbnailIsReportedNotServedEmpty(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "clip.mp4"), 4096, time.Unix(1_700_000_000, 0))
	srv := newReadServer(t, root, "clip.mp4", media.KindVideo)

	rec := httptest.NewRecorder()
	srv.handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/t?k=lib:clip.mp4&w=400", nil))
	if rec.Code == http.StatusOK {
		t.Fatalf("a preview that could not be built was served as success (%d bytes)", rec.Body.Len())
	}
	if !strings.Contains(rec.Header().Get("Content-Type"), "json") {
		t.Fatalf("the failure should be explained in JSON, got %q", rec.Header().Get("Content-Type"))
	}
}

// A key that is in the index but no longer on disk is the ordinary case of a
// drive being unplugged; the answer must be 404 and not a panic or a hang.
func TestAFileThatWentAwayIsNotFound(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "gone.mp4"), 4096, time.Unix(1_700_000_000, 0))
	srv := newReadServer(t, root, "gone.mp4", media.KindVideo)
	if err := os.Remove(filepath.Join(root, "gone.mp4")); err != nil {
		t.Fatal(err)
	}
	rec := srv.rangeRec(t, "lib:gone.mp4", "0-1023")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("unplugged file answered %d, want 404", rec.Code)
	}
}

type readServer struct {
	handler http.Handler
}

func newReadServer(t *testing.T, root, name string, kind media.Kind) *readServer {
	t.Helper()
	s := New(Config{DataDir: t.TempDir()})
	s.libs.items = []Library{{ID: "lib", Name: "Test", Path: root}}
	s.index.Put(media.Item{
		Lib:     "lib",
		Rel:     name,
		Name:    name,
		Ext:     filepath.Ext(name),
		Kind:    kind,
		Size:    4096,
		ShotAt:  1_700_000_000,
		ModTime: 1_700_000_000,
	})
	return &readServer{handler: s.Handler()}
}

func (r *readServer) rangeRec(t *testing.T, key, rng string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/orig?k="+key, nil)
	req.Header.Set("Range", "bytes="+rng)
	r.handler.ServeHTTP(rec, req)
	return rec
}

func (r *readServer) read(t *testing.T, key string, from, to int64) []byte {
	t.Helper()
	rec := r.rangeRec(t, key, strconv.FormatInt(from, 10)+"-"+strconv.FormatInt(to, 10))
	if rec.Code != http.StatusPartialContent {
		t.Fatalf("range %d-%d answered %d", from, to, rec.Code)
	}
	return bytes.Clone(rec.Body.Bytes())
}
