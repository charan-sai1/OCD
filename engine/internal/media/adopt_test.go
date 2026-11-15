package media

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAdoptMergesCatalogMetadataWithoutLosingWalkFields(t *testing.T) {
	dir := t.TempDir()
	ix := New(dir)
	ix.Put(Item{
		Lib: "lib1", Rel: "2026/a.jpg", Name: "a.jpg", Ext: ".jpg", Kind: KindImage,
		Size: 10, ModTime: 100, ShotAt: 50, W: 100, H: 80,
		Make: "Canon", Model: "EOS", ISO: 200, Lat: 12.5, Lon: 77.5, HasGPS: true,
	})

	added, updated := ix.Adopt([]Item{{
		Lib: "lib1", Rel: "2026/a.jpg", Kind: KindImage,
		Size: 10, ModTime: 100, ShotAt: 60, W: 120, H: 90,
		Hash: "sha256:abc", Live: "2026/a.mov",
	}})
	if added != 0 || updated != 1 {
		t.Fatalf("added = %d, updated = %d, want 0/1", added, updated)
	}
	got, ok := ix.Get("lib1:2026/a.jpg")
	if !ok {
		t.Fatal("adopted item is missing")
	}
	if got.ShotAt != 60 || got.W != 120 || got.H != 90 {
		t.Fatalf("catalog metadata did not win: %+v", got)
	}
	if got.Hash != "sha256:abc" || got.Live != "2026/a.mov" {
		t.Fatalf("hash/live was lost: %+v", got)
	}
	if got.Make != "Canon" || got.Model != "EOS" || got.ISO != 200 || !got.HasGPS || got.Lat != 12.5 {
		t.Fatalf("walk-only fields were overwritten by a zero in the catalog: %+v", got)
	}

	// A catalog entry that carries only a path still becomes a usable item.
	added, updated = ix.Adopt([]Item{{Lib: "lib1", Rel: "2026/b.MOV", Size: 20, ModTime: 200}})
	if added != 1 || updated != 0 {
		t.Fatalf("added = %d, updated = %d, want 1/0", added, updated)
	}
	got, ok = ix.Get("lib1:2026/b.MOV")
	if !ok {
		t.Fatal("bare catalog entry is missing")
	}
	if got.Name != "b.MOV" || got.Ext != ".mov" || got.Kind != KindVideo {
		t.Fatalf("bare entry was not completed: %+v", got)
	}

	// Adopt persists, so the next launch starts from the same entries.
	again := New(dir)
	if again.Len() != 2 {
		t.Fatalf("reloaded index has %d items, want 2", again.Len())
	}
}

func TestAdoptedEntriesAreNotProbedAgain(t *testing.T) {
	libDir := t.TempDir()
	body := []byte("not a real jpeg, so a probe would find no dimensions")
	if err := os.WriteFile(filepath.Join(libDir, "a.jpg"), body, 0o644); err != nil {
		t.Fatal(err)
	}
	fi, err := os.Stat(filepath.Join(libDir, "a.jpg"))
	if err != nil {
		t.Fatal(err)
	}

	ix := New(t.TempDir())
	ix.Adopt([]Item{{
		Lib: "lib1", Rel: "a.jpg", Name: "a.jpg", Ext: ".jpg", Kind: KindImage,
		Size: fi.Size(), ModTime: fi.ModTime().Unix(), ShotAt: 1700000000,
		W: 4000, H: 3000,
	}})

	if err := ix.Build([]Library{{ID: "lib1", Path: libDir}}, nil); err != nil {
		t.Fatal(err)
	}
	got, ok := ix.Get("lib1:a.jpg")
	if !ok {
		t.Fatal("item disappeared after the walk")
	}
	if got.W != 4000 || got.H != 3000 || got.ShotAt != 1700000000 {
		t.Fatalf("the walk replaced adopted metadata: %+v", got)
	}
}

func TestBuildKeepsADisconnectedLibraryAcrossAVersionChange(t *testing.T) {
	dir := t.TempDir()
	ix := New(dir)
	ix.Put(Item{
		Lib: "offline", Rel: "a.jpg", Name: "a.jpg", Ext: ".jpg", Kind: KindImage,
		Size: 1, ModTime: 1, ShotAt: 1,
	})
	// Pretend the saved index came from an older build. A scan of another
	// library must not throw the disconnected one away.
	if err := os.WriteFile(ix.versionPath(), []byte("1\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := ix.Build([]Library{{ID: "online", Path: t.TempDir()}}, nil); err != nil {
		t.Fatal(err)
	}
	if _, ok := ix.Get("offline:a.jpg"); !ok {
		t.Fatal("a library that was not part of the scan was dropped")
	}
}
