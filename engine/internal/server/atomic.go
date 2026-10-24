package server

import (
	"os"
	"path/filepath"
)

// writeFileAtomic replaces path in one step: the bytes go to a temporary file
// beside it, are flushed, and only then renamed over the target. A crash or a
// power cut leaves the previous file intact instead of a half-written one.
//
// The rename is the only moment the file changes, and on Windows it replaces an
// existing file in the same call.
func writeFileAtomic(path string, data []byte, perm os.FileMode) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	f, err := os.CreateTemp(dir, filepath.Base(path)+".*.tmp")
	if err != nil {
		return err
	}
	tmp := f.Name()
	// Harmless after a successful rename; removes the leftovers on every other
	// path out of this function.
	defer os.Remove(tmp)

	if _, err := f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmp, perm); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
