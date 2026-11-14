package server

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestParseAuditLineReadsBothWriters(t *testing.T) {
	desktop := []byte(`{"ts":"2026-11-14T10:00:00Z","op":"import","device":"Pixel 8","src":"a.jpg","dst":"Photos/a.jpg","bytes":123,"sha256":"abc","verified":true,"volumeId":"vol_1","libraryId":"lib1"}`)
	row, ok := parseAuditLine(desktop)
	if !ok {
		t.Fatal("desktop row was rejected")
	}
	if row.Op != "import" || row.From != "a.jpg" || row.To != "Photos/a.jpg" {
		t.Fatalf("desktop row = %+v", row)
	}
	if row.Bytes != 123 || !row.Verified || row.Device != "Pixel 8" || row.SHA256 != "abc" {
		t.Fatalf("desktop fields = %+v", row)
	}
	if row.when.IsZero() {
		t.Fatal("desktop timestamp was not parsed")
	}

	phone := []byte(`{"at":"2026-11-14T11:00:00Z","op":"backup","from":"b.jpg","to":"Phone/2026/b.jpg","size":456}`)
	row, ok = parseAuditLine(phone)
	if !ok {
		t.Fatal("phone row was rejected")
	}
	if row.From != "b.jpg" || row.To != "Phone/2026/b.jpg" || row.Bytes != 456 {
		t.Fatalf("phone row = %+v", row)
	}
	if row.Verified {
		t.Fatal("a phone backup row must not claim desktop verification")
	}

	for _, bad := range []string{`not json`, `{"op":""}`, `{"at":"2026-11-14T11:00:00Z"}`} {
		if _, ok := parseAuditLine([]byte(bad)); ok {
			t.Fatalf("bad row accepted: %s", bad)
		}
	}
}

func TestCollectActivityMergesLabelsAndCaps(t *testing.T) {
	at := func(s string) time.Time {
		v, err := time.Parse(time.RFC3339Nano, s)
		if err != nil {
			t.Fatalf("bad test time %q: %v", s, err)
		}
		return v
	}
	snaps := []auditSnapshot{
		{
			file: auditFile{library: "Photos", libraryID: "lib1", volumeID: "vol_1"},
			rows: []activityEntry{
				{At: "2026-11-14T09:00:00Z", when: at("2026-11-14T09:00:00Z"), Op: "backup"},
				{At: "2026-11-14T12:00:00Z", when: at("2026-11-14T12:00:00Z"), Op: "import", Library: "Named"},
			},
		},
		{
			file: auditFile{library: "Archive"},
			rows: []activityEntry{
				{At: "", Op: "dedupe-move"},
				{At: "2026-11-14T10:00:00Z", when: at("2026-11-14T10:00:00Z"), Op: "dedupe-move"},
			},
		},
	}

	got := collectActivity(snaps, 0)
	if got.total != 4 || len(got.items) != 4 {
		t.Fatalf("total = %d, items = %d", got.total, len(got.items))
	}
	order := []string{"import", "dedupe-move", "backup", "dedupe-move"}
	for i, op := range order {
		if got.items[i].Op != op {
			t.Fatalf("item %d = %q, want %q (all: %+v)", i, got.items[i].Op, op, got.items)
		}
	}
	if got.items[3].At != "" {
		t.Fatal("a row with no time must sort last")
	}
	if got.items[2].Library != "Photos" {
		t.Fatalf("unlabelled row library = %q, want Photos", got.items[2].Library)
	}
	if got.items[2].LibraryID != "lib1" || got.items[2].VolumeID != "vol_1" {
		t.Fatalf("identity not filled in: %+v", got.items[2])
	}
	if got.items[0].Library != "Named" {
		t.Fatalf("a row's own library label was overwritten: %q", got.items[0].Library)
	}

	capped := collectActivity(snaps, 2)
	if capped.total != 4 || len(capped.items) != 2 {
		t.Fatalf("capped total = %d, items = %d", capped.total, len(capped.items))
	}
	if capped.items[0].Op != "import" || capped.items[1].Op != "dedupe-move" {
		t.Fatalf("capped rows = %+v", capped.items)
	}
}

func TestReadAuditDropsThePartialFirstLine(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "audit.jsonl")
	lines := []string{
		`{"at":"2026-11-14T09:00:00Z","op":"backup","from":"a.jpg","to":"A/a.jpg","size":1}` + "\n",
		`{"at":"2026-11-14T10:00:00Z","op":"backup","from":"b.jpg","to":"B/b.jpg","size":2}` + "\n",
		`{"at":"2026-11-14T11:00:00Z","op":"dedupe-move","from":"c.jpg","to":"Q/c.jpg","size":3}` + "\n",
	}
	body := ""
	for _, l := range lines {
		body += l
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}

	// Start inside the first line; that fragment must not become a row.
	rows, err := readAudit(path, int64(len(body)-len(lines[0])/2))
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 {
		t.Fatalf("rows = %d, want 2: %+v", len(rows), rows)
	}
	if rows[0].From != "b.jpg" || rows[1].From != "c.jpg" {
		t.Fatalf("tail rows = %+v", rows)
	}

	all, err := readAudit(path, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 3 {
		t.Fatalf("full read rows = %d, want 3", len(all))
	}

	if _, err := readAudit(filepath.Join(dir, "missing.jsonl"), 0); err == nil {
		t.Fatal("a missing audit file must return an error")
	}
}

// The handler is worth one test of its own: it walks the libraries, resolves
// each drive root, reads the tail of every log and labels the rows. Stubbing
// rootOf keeps the reads inside t.TempDir() instead of the real drive root.
func TestActivityHandlerMergesDriveAndComputerLogs(t *testing.T) {
	root := t.TempDir()
	libDir := filepath.Join(root, "Photos")
	if err := os.MkdirAll(libDir, 0o755); err != nil {
		t.Fatal(err)
	}
	dataDir := t.TempDir()
	s := New(Config{DataDir: dataDir, Version: "test"})
	if _, err := s.libs.add("A Drive", libDir); err != nil {
		t.Fatal(err)
	}
	s.rootOf = func(string) string { return root }

	writeLines := func(path string, lines ...string) {
		t.Helper()
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		body := ""
		for _, l := range lines {
			body += l + "\n"
		}
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	writeLines(filepath.Join(root, ".ocd", "audit.jsonl"),
		`{"at":"2026-11-14T09:00:00Z","op":"backup","from":"a.jpg","to":"Phone/2026/a.jpg","size":10}`,
		`{"at":"2026-11-14T11:00:00Z","op":"dedupe-move","from":"b.jpg","to":"_OCD Duplicates/b.jpg","size":20}`,
	)
	writeLines(filepath.Join(dataDir, ".ocd", "audit.jsonl"),
		`{"ts":"2026-11-14T10:00:00Z","op":"import","src":"c.jpg","dst":"Photos/c.jpg","bytes":30,"verified":true,"device":"Pixel"}`,
	)

	rec := doUpload(t, s, http.MethodGet, "/api/activity?limit=2", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	var page activityResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if page.Rows != 3 {
		t.Fatalf("rows = %d, want 3", page.Rows)
	}
	if page.Files != 2 {
		t.Fatalf("files = %d, want 2 (drive + computer)", page.Files)
	}
	if len(page.Items) != 2 {
		t.Fatalf("items = %d, want 2: %+v", len(page.Items), page.Items)
	}
	if page.Items[0].Op != "dedupe-move" || page.Items[1].Op != "import" {
		t.Fatalf("order = %q, %q", page.Items[0].Op, page.Items[1].Op)
	}
	if page.Items[0].Library != "A Drive" {
		t.Fatalf("drive row library = %q", page.Items[0].Library)
	}
	if page.Items[1].Library != "This computer" || !page.Items[1].Verified {
		t.Fatalf("computer row = %+v", page.Items[1])
	}

	bad := doUpload(t, s, http.MethodPost, "/api/activity", nil)
	if bad.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST status = %d, want 405", bad.Code)
	}
}
