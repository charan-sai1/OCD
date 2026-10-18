package importer

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"ocd/internal/hashx"
)

// Index is a persistent set of content hashes known to exist on a destination
// drive. It lets the importer skip files that are already there instead of
// copying them again (zero duplicated data).
type Index struct {
	mu     sync.RWMutex
	path   string
	hashes map[string]string // hash -> file path
}

// LoadIndex loads (or creates) a hash index backed by the given JSON file.
func LoadIndex(path string) (*Index, error) {
	idx := &Index{path: path, hashes: map[string]string{}}
	b, err := os.ReadFile(path)
	if err == nil {
		_ = json.Unmarshal(b, &idx.hashes)
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	return idx, nil
}

// Has reports whether content with this hash is known to exist.
func (i *Index) Has(h string) bool {
	i.mu.RLock()
	defer i.mu.RUnlock()
	_, ok := i.hashes[h]
	return ok
}

// Add records a hash -> path mapping.
func (i *Index) Add(h, path string) {
	i.mu.Lock()
	i.hashes[h] = path
	i.mu.Unlock()
}

// Len returns the number of indexed hashes.
func (i *Index) Len() int {
	i.mu.RLock()
	defer i.mu.RUnlock()
	return len(i.hashes)
}

// Empty reports whether the index holds no entries.
func (i *Index) Empty() bool { return i.Len() == 0 }

// LoadOrBuildIndex loads the content-hash index at path, seeding it from the
// files under roots on first use.
func LoadOrBuildIndex(path string, roots []string, progress func(done int, msg string)) (*Index, error) {
	return loadOrBuild(path, func(idx *Index) error { return idx.Build(roots, progress) })
}

// LoadOrBuildNameIndex is the filename+size variant — much faster to seed
// because it never opens the files.
func LoadOrBuildNameIndex(path string, roots []string, progress func(done int, msg string)) (*Index, error) {
	return loadOrBuild(path, func(idx *Index) error { return idx.BuildNameKeys(roots, progress) })
}

func loadOrBuild(path string, build func(*Index) error) (*Index, error) {
	if st, err := os.Stat(path); err == nil && st.Size() > 2 {
		return LoadIndex(path)
	}
	idx, err := LoadIndex(path)
	if err != nil {
		return nil, err
	}
	if err := build(idx); err != nil {
		return nil, err
	}
	return idx, nil
}

// BuildNameKeys seeds the index with filename+size keys by walking roots.
// Nothing is read, so this is orders of magnitude faster than hashing.
func (i *Index) BuildNameKeys(roots []string, progress func(done int, msg string)) error {
	n := 0
	for _, root := range roots {
		_ = filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return nil
			}
			if strings.Contains(p, ".ocd-incoming") {
				return nil
			}
			info, ierr := d.Info()
			if ierr != nil {
				return nil
			}
			i.Add(nameKey(p, info.Size()), p)
			n++
			if progress != nil && n%2000 == 0 {
				progress(n, p)
			}
			return nil
		})
	}
	return nil
}

// Save writes the index to disk.
func (i *Index) Save() error {
	i.mu.RLock()
	defer i.mu.RUnlock()
	b, err := json.Marshal(i.hashes)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(i.path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(i.path, b, 0o644)
}

// Build seeds the index by hashing every file under the given roots.
func (i *Index) Build(roots []string, progress func(done int, msg string)) error {
	n := 0
	for _, root := range roots {
		_ = filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return nil
			}
			h, herr := hashx.File(p)
			if herr != nil {
				return nil
			}
			i.Add(h, p)
			n++
			if progress != nil && n%500 == 0 {
				progress(n, p)
			}
			return nil
		})
	}
	return nil
}
