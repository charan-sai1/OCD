package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ocd/internal/catalog"
	"ocd/internal/volume"
)

func writeCatalogFor(t *testing.T, root, id, label string, entries []catalog.Entry) {
	t.Helper()
	if err := catalog.Write(root, catalog.Snapshot{
		Header:  catalog.Header{VolumeID: id, Label: label},
		Entries: entries,
	}); err != nil {
		t.Fatal(err)
	}
}

func TestImportCheckMatchesMetadata(t *testing.T) {
	rootA := t.TempDir()
	libA := filepath.Join(rootA, "Photos")
	rootB := t.TempDir()
	libB := filepath.Join(rootB, "Photos")
	for _, p := range []string{libA, libB} {
		if err := os.MkdirAll(p, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	writeCatalogFor(t, rootA, "win:A", "A Drive", []catalog.Entry{
		{Path: "Photos/IMG_0001.JPG", Size: 111},
		{Path: "Photos/old.jpg", Size: 333, ShotAt: 1700000000},
	})
	writeCatalogFor(t, rootB, "win:B", "B Drive", []catalog.Entry{
		{Path: "Photos/renamed.jpg", Size: 222, ShotAt: 1800000000},
	})

	s := New(Config{DataDir: t.TempDir(), Version: "test"})
	if _, err := s.libs.add("A Drive", libA); err != nil {
		t.Fatal(err)
	}
	if _, err := s.libs.add("B Drive", libB); err != nil {
		t.Fatal(err)
	}
	s.drives.volumeOf = func(p string) (volume.Info, error) {
		if strings.HasPrefix(p, rootA) {
			return volume.Info{ID: "win:A", Label: "A Drive", Root: rootA}, nil
		}
		return volume.Info{ID: "win:B", Label: "B Drive", Root: rootB}, nil
	}
	s.drives.refresh(s.libs.list())

	req := importCheckRequest{Items: []importItem{
		{Name: "IMG_0001.JPG", Size: 111},
		{Name: "a-different-name.mov", Size: 222, TakenAt: 1800000000 + 130},
		{Name: "missing.jpg", Size: 999},
	}}
	raw, err := json.Marshal(req)
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/import/check", bytes.NewReader(raw)))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	var got importCheckResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Matches) != 3 {
		t.Fatalf("matches = %d, want 3", len(got.Matches))
	}
	if !got.Matches[0].OnDrive || got.Matches[0].How != "name+size" || got.Matches[0].Volume != "win:A" {
		t.Fatalf("first match = %+v", got.Matches[0])
	}
	if !got.Matches[1].OnDrive || got.Matches[1].How != "size+date" || got.Matches[1].Path != "Photos/renamed.jpg" {
		t.Fatalf("second match = %+v", got.Matches[1])
	}
	if got.Matches[2].OnDrive {
		t.Fatalf("missing item matched: %+v", got.Matches[2])
	}
	if got.Scanned != 3 {
		t.Fatalf("scanned = %d, want 3", got.Scanned)
	}

	// Restricting to one drive must not use the other drive's catalog.
	req.VolumeID = "win:A"
	raw, err = json.Marshal(req)
	if err != nil {
		t.Fatal(err)
	}
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/import/check", bytes.NewReader(raw)))
	if rec.Code != http.StatusOK {
		t.Fatalf("filtered status = %d: %s", rec.Code, rec.Body.String())
	}
	got = importCheckResponse{}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Matches[1].OnDrive {
		t.Fatalf("filtered request matched the wrong drive: %+v", got.Matches[1])
	}
	if got.Scanned != 2 {
		t.Fatalf("filtered scanned = %d, want 2", got.Scanned)
	}
}
