package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"ocd/internal/catalog"
	"ocd/internal/media"
	"ocd/internal/volume"
)

// testDrive makes a directory that acts as a drive root with a catalog on it.
func testDrive(t *testing.T, entries []catalog.Entry) (root, lib string) {
	t.Helper()
	root = t.TempDir()
	lib = filepath.Join(root, "Photos")
	if err := os.MkdirAll(lib, 0o755); err != nil {
		t.Fatal(err)
	}
	snap := catalog.Snapshot{
		Header:  catalog.Header{VolumeID: "win:TEST", Label: "Elements"},
		Entries: entries,
	}
	if err := catalog.Write(root, snap); err != nil {
		t.Fatalf("write catalog: %v", err)
	}
	return root, lib
}

func TestDriveCatalogListAndDownload(t *testing.T) {
	root, lib := testDrive(t, []catalog.Entry{
		{Path: "Photos/a.jpg", Size: 10, Kind: "image"},
		{Path: "Photos/b.mov", Size: 20, Kind: "video"},
	})

	s := New(Config{DataDir: t.TempDir(), Version: "test"})
	if _, err := s.libs.add("Photos", lib); err != nil {
		t.Fatal(err)
	}
	s.drives.volumeOf = func(string) (volume.Info, error) {
		return volume.Info{ID: "win:TEST", Label: "Elements", Root: root}, nil
	}
	s.drives.refresh(s.libs.list())

	drives := s.drives.list()
	if len(drives) != 1 {
		t.Fatalf("drives = %d, want 1", len(drives))
	}
	if drives[0].VolumeID != "win:TEST" || drives[0].Count != 2 {
		t.Fatalf("drive = %+v", drives[0])
	}
	if drives[0].Label != "Elements" {
		t.Fatalf("label = %q", drives[0].Label)
	}

	h := s.Handler()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/drives", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("list status = %d", rec.Code)
	}
	var listed struct {
		Drives []driveInfo `json:"drives"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &listed); err != nil {
		t.Fatalf("list json: %v", err)
	}
	if len(listed.Drives) != 1 || listed.Drives[0].VolumeID != "win:TEST" {
		t.Fatalf("listed = %+v", listed.Drives)
	}

	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/catalog?volumeId=win:TEST", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("download status = %d: %s", rec.Code, rec.Body.String())
	}
	want, err := os.ReadFile(catalog.Path(root))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(rec.Body.Bytes(), want) {
		t.Fatalf("downloaded %d bytes, want %d", rec.Body.Len(), len(want))
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/gzip" {
		t.Fatalf("content type = %q", ct)
	}
	etag := rec.Header().Get("ETag")
	if etag == "" {
		t.Fatal("missing etag")
	}

	rec = httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/catalog?volumeId=win:TEST", nil)
	req.Header.Set("If-None-Match", etag)
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotModified {
		t.Fatalf("etag status = %d, want 304", rec.Code)
	}

	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/catalog?volumeId=nope", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("unknown volume status = %d, want 404", rec.Code)
	}
}

func TestWriteCatalogsRebasesPaths(t *testing.T) {
	data := t.TempDir()
	root := t.TempDir()
	lib := filepath.Join(root, "Photos")
	if err := os.MkdirAll(filepath.Join(lib, "2024"), 0o755); err != nil {
		t.Fatal(err)
	}

	setup := New(Config{DataDir: data, Version: "test"})
	rec, err := setup.libs.add("Photos", lib)
	if err != nil {
		t.Fatal(err)
	}
	lines := []map[string]any{
		{"lib": rec.ID, "rel": "2024/one.jpg", "name": "one.jpg", "kind": "image", "size": 111, "mtime": 1700000000, "shot": 1699990000, "w": 4000, "h": 3000},
		{"lib": rec.ID, "rel": "2024/two.mp4", "name": "two.mp4", "kind": "video", "size": 222, "mtime": 1700000001, "shot": 1699990001, "dur": 2.5},
	}
	var buf bytes.Buffer
	for _, line := range lines {
		b, err := json.Marshal(line)
		if err != nil {
			t.Fatal(err)
		}
		buf.Write(b)
		buf.WriteByte('\n')
	}
	if err := os.WriteFile(filepath.Join(data, "media-index.jsonl"), buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}

	s := New(Config{DataDir: data, Version: "test"})
	if s.index.Len() != 2 {
		t.Fatalf("index = %d items, want 2", s.index.Len())
	}
	s.drives.volumeOf = func(string) (volume.Info, error) {
		return volume.Info{ID: "win:TEST2", Root: root}, nil
	}
	s.sysRoot = filepath.Join(root, "not-this-volume")
	s.writeCatalogs([]media.Library{{ID: rec.ID, Path: lib}})

	got, _, err := catalog.Read(root)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if len(got.Entries) != 2 {
		t.Fatalf("entries = %d, want 2", len(got.Entries))
	}
	if got.Entries[0].Path != "Photos/2024/one.jpg" {
		t.Fatalf("first path = %q", got.Entries[0].Path)
	}
	if got.Entries[1].Path != "Photos/2024/two.mp4" {
		t.Fatalf("second path = %q", got.Entries[1].Path)
	}
	if got.Header.VolumeID != "win:TEST2" || got.Header.IndexVersion != media.FormatVersion() {
		t.Fatalf("header = %+v", got.Header)
	}

	// A library on the machine's own volume must not sprout .ocd.
	s.sysRoot = root
	os.RemoveAll(filepath.Join(root, ".ocd"))
	s.writeCatalogs([]media.Library{{ID: rec.ID, Path: lib}})
	if _, _, err := catalog.Read(root); err == nil {
		t.Fatal("catalog was written to the system volume")
	}
}
