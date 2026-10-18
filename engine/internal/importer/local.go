package importer

import (
	"io"
	"os"
	"path/filepath"
)

// LocalSource reads from any mounted folder — a phone exposed as a drive/MTP
// path, an ifuse-mounted iPhone, or a folder you copied photos into.
type LocalSource struct {
	Root string
}

func (s *LocalSource) Name() string { return "folder:" + s.Root }

func (s *LocalSource) List() ([]RemoteFile, error) {
	var out []RemoteFile
	err := filepath.WalkDir(s.Root, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		info, ierr := d.Info()
		if ierr != nil {
			return nil
		}
		rel, rerr := filepath.Rel(s.Root, p)
		if rerr != nil {
			return nil
		}
		out = append(out, RemoteFile{RelPath: rel, Size: info.Size(), ModTime: info.ModTime()})
		return nil
	})
	return out, err
}

func (s *LocalSource) Open(rel string) (io.ReadCloser, error) {
	return os.Open(filepath.Join(s.Root, rel))
}

func (s *LocalSource) Remove(rel string) error {
	return os.Remove(filepath.Join(s.Root, rel))
}
