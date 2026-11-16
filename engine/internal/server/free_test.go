package server

import (
	"bufio"
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// readAuditRows reads the drive's audit log as parsed JSON rows.
func readAuditRows(t *testing.T, root string) []map[string]any {
	t.Helper()
	f, err := os.Open(filepath.Join(root, ".ocd", "audit.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	var rows []map[string]any
	scan := bufio.NewScanner(f)
	for scan.Scan() {
		var row map[string]any
		if err := json.Unmarshal(scan.Bytes(), &row); err != nil {
			t.Fatalf("audit row is not JSON: %q", scan.Text())
		}
		rows = append(rows, row)
	}
	if err := scan.Err(); err != nil {
		t.Fatal(err)
	}
	return rows
}

func TestFreeRecordWritesOneDeleteRow(t *testing.T) {
	s, root, _ := newUploadTestServer(t)
	lib := s.libs.list()[0]
	body, _ := json.Marshal(freeRecordRequest{
		LibraryID: lib.ID,
		Count:     3,
		Bytes:     4096,
	})
	rec := doUpload(t, s, http.MethodPost, "/api/free/record", body)
	if rec.Code != http.StatusOK {
		t.Fatalf("free record = %d: %s", rec.Code, rec.Body.String())
	}
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out["recorded"] != true || out["libraryId"] != lib.ID {
		t.Fatalf("response = %+v", out)
	}

	rows := readAuditRows(t, root)
	if len(rows) != 1 {
		t.Fatalf("rows = %d, want 1", len(rows))
	}
	row := rows[0]
	if row["op"] != "delete" {
		t.Fatalf("op = %v, want delete", row["op"])
	}
	if row["count"] != float64(3) || row["bytes"] != float64(4096) {
		t.Fatalf("count/bytes = %v/%v", row["count"], row["bytes"])
	}
	if row["verified"] != true {
		t.Fatalf("verified = %v", row["verified"])
	}
	if row["libraryId"] != lib.ID {
		t.Fatalf("libraryId = %v", row["libraryId"])
	}
	if _, ok := row["src"]; ok {
		t.Fatalf("a multi-item delete should not name one file: %+v", row)
	}
}

func TestFreeRecordNamesASingleItemAndKeepsDevice(t *testing.T) {
	s, root, _ := newUploadTestServer(t)
	body, _ := json.Marshal(freeRecordRequest{
		LibraryID: s.libs.list()[0].ID,
		Count:     1,
		Bytes:     12,
		Name:      "IMG_0042.JPG",
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/free/record", bytes.NewReader(body))
	req.Header.Set("X-OCD-Device", "Pixel 9")
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("free record = %d: %s", rec.Code, rec.Body.String())
	}

	rows := readAuditRows(t, root)
	if len(rows) != 1 {
		t.Fatalf("rows = %d, want 1", len(rows))
	}
	if rows[0]["src"] != "IMG_0042.JPG" {
		t.Fatalf("src = %v", rows[0]["src"])
	}
	if rows[0]["device"] != "Pixel 9" {
		t.Fatalf("device = %v", rows[0]["device"])
	}
}

func TestFreeRecordRefusesEmptyOrUnknownTarget(t *testing.T) {
	s, root, _ := newUploadTestServer(t)
	lib := s.libs.list()[0]

	empty, _ := json.Marshal(freeRecordRequest{LibraryID: lib.ID, Count: 0, Bytes: 0})
	rec := doUpload(t, s, http.MethodPost, "/api/free/record", empty)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("empty record = %d: %s", rec.Code, rec.Body.String())
	}

	unknown, _ := json.Marshal(freeRecordRequest{LibraryID: "nope", Count: 1, Bytes: 5})
	rec = doUpload(t, s, http.MethodPost, "/api/free/record", unknown)
	if rec.Code != http.StatusConflict {
		t.Fatalf("unknown library = %d: %s", rec.Code, rec.Body.String())
	}

	if _, err := os.Stat(filepath.Join(root, ".ocd", "audit.jsonl")); err == nil {
		t.Fatalf("a rejected record must not write an audit row")
	}
}
