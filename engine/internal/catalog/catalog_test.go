package catalog

import (
	"compress/gzip"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func sample() Snapshot {
	return Snapshot{
		Header: Header{
			VolumeID:     "win:1A2B3C4D",
			Label:        "Elements",
			IndexVersion: 4,
		},
		Entries: []Entry{
			{Path: "Photos/2024/IMG_0001.HEIC", Size: 4213948, MTime: 1712345678, ShotAt: 1712340000, Kind: "image", Width: 5712, Height: 4284},
			{Path: "Photos/2024/IMG_0001.MOV", Size: 90123456, MTime: 1712345679, ShotAt: 1712340000, Kind: "video", Duration: 3.2},
			{Path: "Videos/Clip.mp4", Size: 130472027, MTime: 1712345680, ShotAt: 1712340000, Kind: "video", Duration: 49.5},
		},
	}
}

func TestRoundTrip(t *testing.T) {
	dir := t.TempDir()
	snap := sample()
	if err := Write(dir, snap); err != nil {
		t.Fatalf("write: %v", err)
	}
	got, src, err := Read(dir)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if src != SourceCurrent {
		t.Fatalf("source = %q, want %q", src, SourceCurrent)
	}
	if got.Header.Format != Format || got.Header.Version != Version {
		t.Fatalf("header = %+v", got.Header)
	}
	if got.Header.Count != len(snap.Entries) {
		t.Fatalf("count = %d, want %d", got.Header.Count, len(snap.Entries))
	}
	if got.Header.VolumeID != snap.Header.VolumeID {
		t.Fatalf("volume = %q", got.Header.VolumeID)
	}
	if len(got.Entries) != len(snap.Entries) {
		t.Fatalf("entries = %d, want %d", len(got.Entries), len(snap.Entries))
	}
	for i := range got.Entries {
		if got.Entries[i] != snap.Entries[i] {
			t.Fatalf("entry %d = %+v, want %+v", i, got.Entries[i], snap.Entries[i])
		}
	}
	if got.Header.Generated.IsZero() {
		t.Fatal("generated timestamp was not stamped")
	}
	if !got.Header.Generated.Before(time.Now().Add(time.Minute)) {
		t.Fatal("generated timestamp is in the future")
	}
}

func TestBackupSurvivesCorruption(t *testing.T) {
	dir := t.TempDir()
	first := sample()
	if err := Write(dir, first); err != nil {
		t.Fatalf("first write: %v", err)
	}
	second := sample()
	second.Entries = second.Entries[:2]
	if err := Write(dir, second); err != nil {
		t.Fatalf("second write: %v", err)
	}
	// Corrupt the current file the way a yanked drive might.
	if err := os.WriteFile(Path(dir), []byte("not gzip at all"), 0o644); err != nil {
		t.Fatal(err)
	}

	got, src, err := Read(dir)
	if err != nil {
		t.Fatalf("read with backup: %v", err)
	}
	if src != SourceBackup {
		t.Fatalf("source = %q, want backup", src)
	}
	if len(got.Entries) != len(first.Entries) {
		t.Fatalf("backup entries = %d, want %d", len(got.Entries), len(first.Entries))
	}
}

func TestReadMissing(t *testing.T) {
	if _, _, err := Read(t.TempDir()); err == nil {
		t.Fatal("expected an error for a missing catalog")
	}
}

func TestRejectNewerVersion(t *testing.T) {
	dir := t.TempDir()
	writeRaw(t, Path(dir), Header{
		Format: Format, Version: Version + 1, VolumeID: "win:1", Count: 0,
	}, nil)
	if _, _, err := Read(dir); err == nil {
		t.Fatal("expected an error for a newer catalog version")
	}
}

func TestRejectUnsafePath(t *testing.T) {
	dir := t.TempDir()
	writeRaw(t, Path(dir), Header{
		Format: Format, Version: Version, VolumeID: "win:1", Count: 1,
	}, []Entry{{Path: "../secret.jpg", Size: 1}})
	if _, _, err := Read(dir); err == nil {
		t.Fatal("expected an error for a path escaping the volume")
	}
}

func TestRejectWrongFormat(t *testing.T) {
	dir := t.TempDir()
	writeRaw(t, Path(dir), Header{
		Format: "something-else", Version: 1, VolumeID: "win:1",
	}, nil)
	if _, _, err := Read(dir); err == nil {
		t.Fatal("expected an error for a foreign file")
	}
}

// writeRaw builds a catalog by hand so tests can exercise files the writer
// would never produce.
func writeRaw(t *testing.T, p string, h Header, entries []Entry) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	f, err := os.Create(p)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	gz := gzip.NewWriter(f)
	enc := json.NewEncoder(gz)
	if err := enc.Encode(&h); err != nil {
		t.Fatal(err)
	}
	for i := range entries {
		if err := enc.Encode(&entries[i]); err != nil {
			t.Fatal(err)
		}
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
}
