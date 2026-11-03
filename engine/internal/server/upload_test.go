package server

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"ocd/internal/catalog"
	"ocd/internal/volume"
)

func newUploadTestServer(t *testing.T) (s *Server, root, libDir string) {
	t.Helper()
	root = t.TempDir()
	libDir = filepath.Join(root, "Photos")
	if err := os.MkdirAll(libDir, 0o755); err != nil {
		t.Fatal(err)
	}
	s = New(Config{DataDir: t.TempDir(), Version: "test"})
	if _, err := s.libs.add("A Drive", libDir); err != nil {
		t.Fatal(err)
	}
	s.drives.volumeOf = func(p string) (volume.Info, error) {
		return volume.Info{ID: "win:A", Label: "A Drive", Root: root}, nil
	}
	return s, root, libDir
}

func doUpload(t *testing.T, s *Server, method, target string, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(method, target, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	s.Handler().ServeHTTP(rec, req)
	return rec
}

func startUpload(t *testing.T, s *Server, req uploadStartRequest) map[string]any {
	t.Helper()
	raw, err := json.Marshal(req)
	if err != nil {
		t.Fatal(err)
	}
	rec := doUpload(t, s, http.MethodPost, "/api/upload/start", raw)
	if rec.Code != http.StatusOK {
		t.Fatalf("start status = %d: %s", rec.Code, rec.Body.String())
	}
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestUploadPlacesVerifiesAndCatalogs(t *testing.T) {
	s, root, libDir := newUploadTestServer(t)
	content := []byte("pretend this is a photo")
	sum := sha256.Sum256(content)
	taken := time.Date(2026, 11, 3, 12, 0, 0, 0, time.UTC)
	res := startUpload(t, s, uploadStartRequest{
		Name:    "IMG_0001.JPG",
		Size:    int64(len(content)),
		TakenAt: taken.Unix(),
		Kind:    "image",
		Width:   4032,
		Height:  3024,
	})
	id, _ := res["uploadId"].(string)
	if id == "" {
		t.Fatalf("no upload id: %+v", res)
	}

	rec := doUpload(t, s, http.MethodPut, "/api/upload/"+id+"?offset=0", content)
	if rec.Code != http.StatusOK {
		t.Fatalf("put status = %d: %s", rec.Code, rec.Body.String())
	}
	rec = doUpload(t, s, http.MethodPost, "/api/upload/"+id+"/finish", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("finish status = %d: %s", rec.Code, rec.Body.String())
	}
	var fin map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &fin); err != nil {
		t.Fatal(err)
	}
	if fin["verified"] != true || fin["sha256"] != hex.EncodeToString(sum[:]) {
		t.Fatalf("finish = %+v", fin)
	}

	local := time.Unix(taken.Unix(), 0).Local()
	wantRel := "Photos/Phone/" + local.Format("2006") + "/" + local.Format("01") + "/IMG_0001.JPG"
	if fin["path"] != wantRel {
		t.Fatalf("path = %v, want %s", fin["path"], wantRel)
	}
	onDisk := filepath.Join(root, filepath.FromSlash(wantRel))
	got, err := os.ReadFile(onDisk)
	if err != nil || !bytes.Equal(got, content) {
		t.Fatalf("file on disk = %q, %v", got, err)
	}
	if _, err := os.Stat(filepath.Join(libDir, ".ocd-incoming")); err != nil {
		t.Fatalf("incoming folder missing: %v", err)
	}
	leftovers, _ := os.ReadDir(filepath.Join(libDir, ".ocd-incoming"))
	if len(leftovers) != 0 {
		t.Fatalf("temporary files left behind: %d", len(leftovers))
	}

	// The index key is library-relative, not volume-relative.
	libRel := "Phone/" + local.Format("2006") + "/" + local.Format("01") + "/IMG_0001.JPG"
	it, ok := s.index.Get(s.libs.list()[0].ID + ":" + libRel)
	if !ok {
		t.Fatalf("imported item not in the index")
	}
	if it.Size != int64(len(content)) || it.Name != "IMG_0001.JPG" || it.W != 4032 {
		t.Fatalf("indexed item = %+v", it)
	}

	audit, err := os.ReadFile(filepath.Join(root, ".ocd", "audit.jsonl"))
	if err != nil || !strings.Contains(string(audit), `"op":"import"`) || !strings.Contains(string(audit), hex.EncodeToString(sum[:])) {
		t.Fatalf("audit = %s, %v", audit, err)
	}

	s.persistNow()
	snap, _, err := catalog.Read(root)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, e := range snap.Entries {
		if e.Path == wantRel {
			found = true
		}
	}
	if !found {
		t.Fatalf("catalog does not list %s", wantRel)
	}
}

func TestUploadReportsExistingFile(t *testing.T) {
	s, root, _ := newUploadTestServer(t)
	content := []byte("already here")
	local := time.Unix(1800000000, 0).Local()
	dest := filepath.Join(root, "Photos", "Phone", local.Format("2006"), local.Format("01"), "IMG_0002.JPG")
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dest, content, 0o644); err != nil {
		t.Fatal(err)
	}

	res := startUpload(t, s, uploadStartRequest{Name: "IMG_0002.JPG", Size: int64(len(content)), TakenAt: 1800000000})
	if _, ok := res["existingPath"]; !ok {
		t.Fatalf("expected existingPath, got %+v", res)
	}
	if _, ok := res["uploadId"]; ok {
		t.Fatalf("existing file still opened an upload: %+v", res)
	}
}

func TestUploadSanitizesAndAvoidsCollisions(t *testing.T) {
	s, _, libDir := newUploadTestServer(t)
	taken := time.Date(2026, 11, 3, 12, 0, 0, 0, time.UTC)
	local := time.Unix(taken.Unix(), 0).Local()
	dir := filepath.Join(libDir, "Phone", local.Format("2006"), local.Format("01"))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	// Same name, different size: the new file must not overwrite it.
	if err := os.WriteFile(filepath.Join(dir, "evil.jpg"), []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}

	res := startUpload(t, s, uploadStartRequest{Name: `..\..\evil.jpg`, Size: 5, TakenAt: taken.Unix()})
	rel, _ := res["path"].(string)
	if !strings.HasSuffix(rel, "evil (1).jpg") {
		t.Fatalf("path = %q, want a collision-suffixed name", rel)
	}
}

func TestUploadRejectsHashMismatch(t *testing.T) {
	s, _, _ := newUploadTestServer(t)
	content := []byte("some bytes")
	res := startUpload(t, s, uploadStartRequest{
		Name:   "IMG_0003.JPG",
		Size:   int64(len(content)),
		SHA256: strings.Repeat("0", 64),
	})
	id := res["uploadId"].(string)
	doUpload(t, s, http.MethodPut, "/api/upload/"+id, content)
	rec := doUpload(t, s, http.MethodPost, "/api/upload/"+id+"/finish", nil)
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "hash-mismatch") {
		t.Fatalf("finish = %d: %s", rec.Code, rec.Body.String())
	}
	if _, ok := s.findUpload(id); ok {
		t.Fatalf("failed upload was not discarded")
	}
}

func TestUploadIncompleteThenAbort(t *testing.T) {
	s, _, _ := newUploadTestServer(t)
	content := []byte("only part of this")
	res := startUpload(t, s, uploadStartRequest{Name: "IMG_0004.JPG", Size: int64(len(content))})
	id := res["uploadId"].(string)
	doUpload(t, s, http.MethodPut, "/api/upload/"+id, content[:4])
	rec := doUpload(t, s, http.MethodPost, "/api/upload/"+id+"/finish", nil)
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "incomplete") {
		t.Fatalf("finish = %d: %s", rec.Code, rec.Body.String())
	}
	if _, ok := s.findUpload(id); !ok {
		t.Fatalf("incomplete upload was discarded before it could resume")
	}
	rec = doUpload(t, s, http.MethodPost, "/api/upload/"+id+"/abort", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("abort = %d: %s", rec.Code, rec.Body.String())
	}
	if _, ok := s.findUpload(id); ok {
		t.Fatalf("aborted upload still exists")
	}
}

func TestUploadRefusesUnknownDrive(t *testing.T) {
	s, _, _ := newUploadTestServer(t)
	raw, _ := json.Marshal(uploadStartRequest{Name: "x.jpg", Size: 1, VolumeID: "win:NOPE"})
	rec := doUpload(t, s, http.MethodPost, "/api/upload/start", raw)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
}
