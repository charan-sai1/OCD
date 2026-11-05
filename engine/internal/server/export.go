package server

import (
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"ocd/internal/catalog"
	"ocd/internal/volume"
)

// export.go moves the previews this machine has already built onto the drives
// that own the originals, and can build the missing ones as it goes. A phone
// reading the drive directly then finds its grid pre-rendered, with no
// computer in sight. Everything is keyed by the catalog entry's
// volume-relative path, so it never lingers across a letter change.
//
// Generation is done once per catalog: a small marker next to the previews
// records which catalog pass was fully exported, so restarting the app or
// reconnecting a drive never repeats hours of work.

const exportThumbDim = 400

type exportResult struct {
	VolumeID  string   `json:"volumeId"`
	Label     string   `json:"label,omitempty"`
	Copied    int      `json:"copied"`
	Generated int      `json:"generated"`
	Missing   int      `json:"missing"`
	Skipped   int      `json:"skipped"`
	Thumbs    int      `json:"thumbs"`
	Errors    []string `json:"errors,omitempty"`
}

func exportStatePath(root string) string {
	return filepath.Join(root, catalog.DirName(), "thumbs.state")
}

// exportThumbsToDrives expects the caller to hold exportMu. generate builds
// previews this machine has not made yet; limit caps the work for a trial run.
func (s *Server) exportThumbsToDrives(generate bool, limit int) []exportResult {
	libs := s.libs.available()
	// Group the available libraries by volume, like writeCatalogs does, so a
	// drive with two saved folders exports each catalog once.
	type group struct {
		info  volume.Info
		paths []string // library paths on that volume
	}
	groups := map[string]*group{}
	for _, l := range libs {
		info, err := s.drives.volumeOf(l.Path)
		if err != nil {
			continue
		}
		if s.sysRoot != "" && strings.EqualFold(filepath.Clean(info.Root), filepath.Clean(s.sysRoot)) {
			continue
		}
		g := groups[info.Root]
		if g == nil {
			g = &group{info: info}
			groups[info.Root] = g
		}
		g.paths = append(g.paths, l.Path)
	}
	// An export needs the catalog's entries, which live on the drive itself.
	// Re-read it here rather than trusting the cache so the copy matches the
	// exact file the phone will read.
	out := make([]exportResult, 0, len(groups))
	for _, g := range groups {
		res := exportResult{VolumeID: g.info.ID, Label: g.info.Label}
		snap, _, err := catalog.Read(g.info.Root)
		if err != nil {
			res.Errors = append(res.Errors, err.Error())
			out = append(out, res)
			continue
		}
		thumbDir := filepath.Join(g.info.Root, catalog.DirName(), catalog.ThumbDir())
		if err := os.MkdirAll(thumbDir, 0o755); err != nil {
			res.Errors = append(res.Errors, err.Error())
			out = append(out, res)
			continue
		}

		// Build missing previews only when asked. A marker survives restarts and
		// drive letters and suppresses repeat passes over an unchanged catalog.
		stamp := snap.Header.Generated.Format(time.RFC3339Nano)
		needGenerate := generate
		if needGenerate && limit == 0 {
			if b, err := os.ReadFile(exportStatePath(g.info.Root)); err == nil &&
				strings.TrimSpace(string(b)) == stamp {
				needGenerate = false
			}
		}

		// The catalog entry's path is volume-relative, so joining it with the
		// volume root is all that is needed to reach the original on this PC.
		done := 0
		aborted := false
		for i, e := range snap.Entries {
			if limit > 0 && done >= limit {
				break
			}
			// A drive unplugged mid-pass must stop the walk instead of filling
			// the log with a failure for every remaining entry.
			if i%200 == 0 {
				if _, err := os.Stat(g.info.Root); err != nil {
					aborted = true
					res.Errors = append(res.Errors, "the drive went away")
					break
				}
			}
			if e.Size == 0 {
				res.Skipped++
				continue
			}
			started := time.Now()
			abs := filepath.Join(g.info.Root, filepath.FromSlash(e.Path))
			dst := catalog.ThumbPath(g.info.Root, g.info.ID, e.Path, e.Size, e.MTime)
			if _, err := os.Stat(dst); err == nil {
				if limit == 0 {
					res.Copied++
				}
				continue
			}

			src, err := s.thumbs.Path(abs, exportThumbDim)
			if err != nil {
				src = ""
			} else if _, err := os.Stat(src); err != nil {
				src = ""
			}
			built := false
			if src == "" && needGenerate {
				p, gerr := s.thumbs.Get(abs, exportThumbDim)
				if gerr != nil {
					res.Errors = append(res.Errors, gerr.Error())
					continue
				}
				src, built = p, true
			}
			if src == "" {
				res.Missing++ // never built here yet and generation is off
				continue
			}
			if err := copyFileCrossVolume(src, dst); err != nil {
				res.Errors = append(res.Errors, err.Error())
				continue
			}
			if built {
				res.Generated++
			} else {
				res.Copied++
			}
			done++
			if d := time.Since(started); d > 15*time.Second {
				log.Printf("export: %s took %s", e.Path, d.Round(time.Second))
			}
		}
		// The pass is resumable from the destination files, so a marker is
		// written even when individual files could not be previewed. That stops
		// every scan from regenerating tens of thousands of health checks.
		if limit == 0 && needGenerate && !aborted {
			_ = os.WriteFile(exportStatePath(g.info.Root), []byte(stamp+"\n"), 0o644)
		}
		res.Thumbs = countFiles(thumbDir)
		log.Printf(
			"export %s: %d new, %d already present, %d skipped, %d unavailable, %d previews on drive",
			g.info.Label, res.Generated, res.Copied, res.Skipped, res.Missing, res.Thumbs,
		)
		out = append(out, res)
	}
	return out
}

// runExport serialises exports: a scan and a manual request must not copy the
// same files into each other's half-written destinations.
func (s *Server) runExport(generate bool, limit int) ([]exportResult, bool) {
	if !s.exportMu.TryLock() {
		return nil, false
	}
	defer s.exportMu.Unlock()
	return s.exportThumbsToDrives(generate, limit), true
}

func countFiles(dir string) int {
	n := 0
	_ = filepath.WalkDir(dir, func(_ string, d os.DirEntry, err error) error {
		if err == nil && d != nil && !d.IsDir() {
			n++
		}
		return nil
	})
	return n
}

func copyFileCrossVolume(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	tmp := dst + ".tmp"
	out, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := io.CopyBuffer(out, in, make([]byte, 128<<10)); err != nil {
		out.Close()
		os.Remove(tmp)
		return err
	}
	if err := out.Sync(); err != nil {
		out.Close()
		os.Remove(tmp)
		return err
	}
	if err := out.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, dst)
}

// exportThumbs runs the export on demand. ?generate=1 builds previews that
// have never been made here, and ?limit=N caps a trial run.
func (s *Server) exportThumbs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	generate := r.URL.Query().Get("generate") == "1"
	limit := 0
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	results, ok := s.runExport(generate, limit)
	if !ok {
		writeJSON(w, http.StatusConflict, map[string]any{"error": "an export is already running"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}
