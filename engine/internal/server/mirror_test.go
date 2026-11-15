package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"ocd/internal/catalog"
	"ocd/internal/media"
	"ocd/internal/volume"
)

// setLibraryDrive pins the identity a library would have learned from its
// volume, so tests do not depend on the machine's real drives.
func setLibraryDrive(t *testing.T, s *Server, id, volumeID, rel string) {
	t.Helper()
	s.libs.mu.Lock()
	found := false
	for i := range s.libs.items {
		if s.libs.items[i].ID == id {
			s.libs.items[i].VolumeID = volumeID
			s.libs.items[i].VolumeLabel = "Elements"
			s.libs.items[i].Rel = rel
			found = true
		}
	}
	err := s.libs.saveLocked()
	s.libs.mu.Unlock()
	if !found {
		t.Fatalf("library %q is not in the store", id)
	}
	if err != nil {
		t.Fatal(err)
	}
}

func TestMirrorRoundTripAndRejectsAnotherVolume(t *testing.T) {
	s := New(Config{DataDir: t.TempDir(), Version: "test"})
	info := volume.Info{ID: "win:ABCD", Label: "Elements", Root: `E:\`}
	snap := catalog.Snapshot{Entries: []catalog.Entry{
		{Path: "Photos/a.jpg", Size: 10, MTime: 100, ShotAt: 90, Kind: "image", Hash: "sha256:aa", Width: 4000, Height: 3000, Orient: 6, Make: "Apple", Model: "iPhone 15", ISO: 64, FNumber: 1.78, Exposure: 0.008, Focal: 6.86, Lat: 12.97, Lon: 77.59, HasGPS: true},
		{Path: "Photos/a.mov", Size: 20, Kind: "video", Duration: 1.5},
	}}
	if err := s.writeMirror(info, snap); err != nil {
		t.Fatalf("write mirror: %v", err)
	}

	got, err := s.readMirror(info.ID)
	if err != nil {
		t.Fatalf("read mirror: %v", err)
	}
	if got.Header.VolumeID != info.ID || got.Header.Label != "Elements" {
		t.Fatalf("header = %+v", got.Header)
	}
	if len(got.Entries) != 2 || got.Entries[0].Path != "Photos/a.jpg" {
		t.Fatalf("entries = %+v", got.Entries)
	}
	if got.Entries[0].Hash != "sha256:aa" || got.Entries[0].ShotAt != 90 || got.Entries[1].Duration != 1.5 {
		t.Fatalf("mirror lost entry metadata: %+v", got.Entries)
	}
	photo := got.Entries[0]
	if photo.Orient != 6 || photo.Make != "Apple" || photo.Model != "iPhone 15" ||
		photo.ISO != 64 || photo.FNumber != 1.78 || photo.Exposure != 0.008 ||
		photo.Focal != 6.86 || !photo.HasGPS || photo.Lat != 12.97 || photo.Lon != 77.59 {
		t.Fatalf("mirror lost EXIF/GPS metadata: %+v", photo)
	}

	// A mirror named for one volume but stamped with another is a hand-copied
	// file; reading it back as the first volume would mix two drives' contents.
	foreign := catalog.Snapshot{Header: catalog.Header{VolumeID: "win:OTHER"}}
	if err := catalog.WriteFile(s.mirrorPath(info.ID), foreign); err != nil {
		t.Fatal(err)
	}
	if _, err := s.readMirror(info.ID); err == nil {
		t.Fatal("a mirror with the wrong volume id was accepted")
	}
	if _, err := s.readMirror(""); err == nil {
		t.Fatal("an empty volume id was accepted")
	}
}

func TestAdoptSeedsMapsVolumePathsOntoTheLibrary(t *testing.T) {
	root := t.TempDir()
	libPath := filepath.Join(root, "Photos")
	if err := os.MkdirAll(filepath.Join(libPath, "2024"), 0o755); err != nil {
		t.Fatal(err)
	}
	snap := catalog.Snapshot{
		Header: catalog.Header{VolumeID: "win:ADOPT", Label: "Elements"},
		Entries: []catalog.Entry{
			{Path: "Photos/2024/a.jpg", Size: 10, ShotAt: 1700000000, Kind: "image", Hash: "sha256:bb", Live: "Photos/2024/a.mov", Width: 4000, Height: 3000, Orient: 8, Make: "Samsung", Model: "SM-S918", ISO: 50, FNumber: 2.2, Exposure: 0.004, Focal: 7.0, Lat: -33.86, Lon: 151.2, HasGPS: true},
			{Path: "Photos/2024/a.mov", Size: 20, Kind: "video", Duration: 2},
			// Outside the library, and a name that only starts with the prefix.
			{Path: "Other/b.jpg", Size: 30, Kind: "image"},
			{Path: "Photos-old/c.jpg", Size: 40, Kind: "image"},
		},
	}
	if err := catalog.Write(root, snap); err != nil {
		t.Fatal(err)
	}

	s := New(Config{DataDir: t.TempDir(), Version: "test"})
	rec, err := s.libs.add("Photos", libPath)
	if err != nil {
		t.Fatal(err)
	}
	s.rootOf = func(string) string { return root }
	s.drives.volumeOf = func(string) (volume.Info, error) {
		return volume.Info{ID: "win:ADOPT", Root: root, Label: "Elements"}, nil
	}

	seeds := s.adoptSeeds([]media.Library{{ID: rec.ID, Path: libPath}})
	if len(seeds) != 2 {
		t.Fatalf("seeds = %d, want 2: %+v", len(seeds), seeds)
	}
	byRel := map[string]media.Item{}
	for _, it := range seeds {
		byRel[it.Rel] = it
	}
	photo, ok := byRel["2024/a.jpg"]
	if !ok {
		t.Fatalf("photo was not mapped under the library: %+v", byRel)
	}
	if photo.Lib != rec.ID || photo.Name != "a.jpg" || photo.Ext != ".jpg" || photo.Kind != media.KindImage {
		t.Fatalf("photo = %+v", photo)
	}
	if photo.Hash != "sha256:bb" || photo.Live != "2024/a.mov" || photo.ShotAt != 1700000000 {
		t.Fatalf("photo metadata = %+v", photo)
	}
	if photo.Orient != 8 || photo.Make != "Samsung" || photo.Model != "SM-S918" ||
		photo.ISO != 50 || photo.FNumber != 2.2 || photo.Exposure != 0.004 ||
		photo.Focal != 7.0 || !photo.HasGPS || photo.Lat != -33.86 || photo.Lon != 151.2 {
		t.Fatalf("photo EXIF/GPS = %+v", photo)
	}
	motion, ok := byRel["2024/a.mov"]
	if !ok || motion.Kind != media.KindVideo || motion.Duration != 2 {
		t.Fatalf("motion = %+v", motion)
	}
}

func TestLoadMirrorsFillsAnOfflineLibrary(t *testing.T) {
	root := t.TempDir()
	libPath := filepath.Join(root, "Photos")
	if err := os.MkdirAll(libPath, 0o755); err != nil {
		t.Fatal(err)
	}
	s := New(Config{DataDir: t.TempDir(), Version: "test"})
	rec, err := s.libs.add("Photos", libPath)
	if err != nil {
		t.Fatal(err)
	}
	setLibraryDrive(t, s, rec.ID, "win:OFF", "Photos")

	info := volume.Info{ID: "win:OFF", Label: "Elements"}
	snap := catalog.Snapshot{Entries: []catalog.Entry{
		{Path: "Photos/2025/x.jpg", Size: 11, ShotAt: 1700000001, Kind: "image", Hash: "sha256:cc"},
		// Outside the saved library, so it must not appear under it.
		{Path: "Backup/y.jpg", Size: 12, Kind: "image"},
	}}
	if err := s.writeMirror(info, snap); err != nil {
		t.Fatal(err)
	}
	// Unplug the drive: the library path no longer exists.
	if err := os.RemoveAll(libPath); err != nil {
		t.Fatal(err)
	}

	s.LoadMirrors()

	got, ok := s.index.Get(rec.ID + ":2025/x.jpg")
	if !ok {
		t.Fatalf("offline library was not seeded: %d items", s.index.Len())
	}
	if got.Size != 11 || got.ShotAt != 1700000001 || got.Hash != "sha256:cc" {
		t.Fatalf("adopted item = %+v", got)
	}
	if _, ok := s.index.Get(rec.ID + ":y.jpg"); ok {
		t.Fatal("an entry outside the library was adopted under it")
	}
}

func TestWriteCatalogsWritesMirrorAndKeepsHashAndLive(t *testing.T) {
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
		{"lib": rec.ID, "rel": "2024/one.jpg", "name": "one.jpg", "kind": "image", "size": 111, "mtime": 1700000000, "shot": 1699990000, "w": 4000, "h": 3000, "hash": "sha256:dd", "live": "2024/one.mov", "orient": 6, "make": "Apple", "model": "iPhone 15", "iso": 64, "fnumber": 1.78, "exposure": 0.008, "focal": 6.86, "lat": 12.97, "lon": 77.59, "gps": true},
		{"lib": rec.ID, "rel": "2024/one.mov", "name": "one.mov", "kind": "video", "size": 222, "mtime": 1700000001},
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
	s.drives.volumeOf = func(string) (volume.Info, error) {
		return volume.Info{ID: "win:MIRROR", Label: "Elements", Root: root}, nil
	}
	s.sysRoot = filepath.Join(root, "not-this-volume")
	s.writeCatalogs([]media.Library{{ID: rec.ID, Path: lib}})

	// The drive keeps its catalog...
	onDrive, _, err := catalog.Read(root)
	if err != nil {
		t.Fatalf("drive catalog: %v", err)
	}
	// ...and the computer keeps a copy that works without the drive.
	onDisk, err := s.readMirror("win:MIRROR")
	if err != nil {
		t.Fatalf("mirror: %v", err)
	}
	if len(onDisk.Entries) != 2 || len(onDrive.Entries) != 2 {
		t.Fatalf("drive = %d entries, mirror = %d", len(onDrive.Entries), len(onDisk.Entries))
	}
	if onDisk.Header.VolumeID != "win:MIRROR" || onDisk.Header.Label != "Elements" {
		t.Fatalf("mirror header = %+v", onDisk.Header)
	}
	var photo catalog.Entry
	for _, e := range onDisk.Entries {
		if e.Path == "Photos/2024/one.jpg" {
			photo = e
		}
	}
	if photo.Hash != "sha256:dd" || photo.Live != "Photos/2024/one.mov" || photo.Width != 4000 {
		t.Fatalf("mirror lost metadata: %+v", photo)
	}
	if photo.Orient != 6 || photo.Make != "Apple" || photo.Model != "iPhone 15" ||
		photo.ISO != 64 || photo.FNumber != 1.78 || photo.Exposure != 0.008 ||
		photo.Focal != 6.86 || !photo.HasGPS || photo.Lat != 12.97 || photo.Lon != 77.59 {
		t.Fatalf("mirror lost EXIF/GPS: %+v", photo)
	}
}

func TestCatalogStatusReportsDriveAndMirror(t *testing.T) {
	root := t.TempDir()
	lib := filepath.Join(root, "Photos")
	if err := os.MkdirAll(lib, 0o755); err != nil {
		t.Fatal(err)
	}
	s := New(Config{DataDir: t.TempDir(), Version: "test"})
	rec, err := s.libs.add("Photos", lib)
	if err != nil {
		t.Fatal(err)
	}
	setLibraryDrive(t, s, rec.ID, "win:STATUS", "Photos")
	s.rootOf = func(string) string { return root }

	snap := catalog.Snapshot{
		Header:  catalog.Header{VolumeID: "win:STATUS", Label: "Elements"},
		Entries: []catalog.Entry{{Path: "Photos/a.jpg", Size: 1, Kind: "image"}},
	}
	if err := catalog.Write(root, snap); err != nil {
		t.Fatal(err)
	}
	if err := s.writeMirror(volume.Info{ID: "win:STATUS", Label: "Elements"}, snap); err != nil {
		t.Fatal(err)
	}

	rec2 := doUpload(t, s, http.MethodGet, "/api/catalogs", nil)
	if rec2.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec2.Code, rec2.Body.String())
	}
	var page struct {
		Catalogs []struct {
			VolumeID  string `json:"volumeId"`
			Library   string `json:"library"`
			Available bool   `json:"available"`
			Source    string `json:"source"`
			Count     int    `json:"count"`
			Mirror    int    `json:"mirrorCount"`
		} `json:"catalogs"`
	}
	if err := json.Unmarshal(rec2.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Catalogs) != 1 {
		t.Fatalf("catalogs = %+v", page.Catalogs)
	}
	got := page.Catalogs[0]
	if got.VolumeID != "win:STATUS" || !got.Available || got.Source != "drive" {
		t.Fatalf("status = %+v", got)
	}
	if got.Count != 1 || got.Mirror != 1 {
		t.Fatalf("counts = %+v", got)
	}

	bad := doUpload(t, s, http.MethodPost, "/api/catalogs", nil)
	if bad.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST status = %d, want 405", bad.Code)
	}
}
