package server

import (
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"log"
	"net/http"
	"path"
	"path/filepath"
	"strings"

	"ocd/internal/catalog"
	"ocd/internal/media"
	"ocd/internal/volume"
)

// The local mirror is a copy of each drive's catalog kept in the data folder.
// The drive is the source of truth; this copy is what lets the gallery stay
// populated when the drive is unplugged, and lets a second computer adopt a
// catalog without walking the disk first.
//
// Mirror files use the same gzip JSON-lines format as the drive, so a damaged
// mirror is detected by the same header and entry validation, and a mirror can
// be copied onto a drive with no conversion.

const mirrorDirName = "catalog"

// mirrorFileName turns a volume id into a safe, collision-free file name. Volume
// ids look like "win:1A2B3C4D" or "uuid:...", which are not usable verbatim on
// every filesystem.
func mirrorFileName(volumeID string) string {
	sum := sha1.Sum([]byte(volumeID))
	var b strings.Builder
	for _, r := range volumeID {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9',
			r == '-', r == '_', r == '.':
			b.WriteRune(r)
		default:
			b.WriteByte('_')
		}
	}
	return b.String() + "-" + hex.EncodeToString(sum[:])[:10] + ".jsonl.gz"
}

func (s *Server) mirrorPath(volumeID string) string {
	return filepath.Join(s.cfg.DataDir, mirrorDirName, mirrorFileName(volumeID))
}

// writeMirror stores the snapshot under the data folder. It is best effort: a
// mirror that cannot be written must never fail the scan that produced it.
func (s *Server) writeMirror(info volume.Info, snap catalog.Snapshot) error {
	if s.cfg.DataDir == "" || info.ID == "" {
		return errors.New("mirror: no data folder or volume id")
	}
	snap.Header.VolumeID = info.ID
	if snap.Header.Label == "" {
		snap.Header.Label = info.Label
	}
	path := s.mirrorPath(info.ID)
	if err := catalog.WriteFile(path, snap); err != nil {
		return err
	}
	return nil
}

// readMirror loads the local copy for a volume. It refuses a mirror that turns
// out to belong to another drive, which can only happen if the file was moved
// by hand.
func (s *Server) readMirror(volumeID string) (catalog.Snapshot, error) {
	if s.cfg.DataDir == "" || volumeID == "" {
		return catalog.Snapshot{}, errors.New("mirror: no data folder or volume id")
	}
	snap, err := catalog.ReadFile(s.mirrorPath(volumeID))
	if err != nil {
		return catalog.Snapshot{}, err
	}
	if snap.Header.VolumeID != volumeID {
		return catalog.Snapshot{}, errors.New("mirror: volume id does not match")
	}
	return snap, nil
}

// LoadMirrors seeds the index from every saved library's local mirror. It runs
// at startup, before the background scan, so an unplugged drive still shows its
// photos and a fresh install starts from the drive's own catalog.
func (s *Server) LoadMirrors() {
	libs := s.libs.list()
	var items []media.Item
	adopted := 0
	for _, l := range libs {
		if l.VolumeID == "" {
			continue
		}
		snap, err := s.readMirror(l.VolumeID)
		if err != nil {
			continue
		}
		list := itemsFromCatalog(snap, l.ID, s.libraryPrefix(l))
		items = append(items, list...)
		adopted++
	}
	if len(items) == 0 {
		return
	}
	added, updated := s.index.Adopt(items)
	if added+updated > 0 {
		log.Printf("catalog mirror: %d libraries, %d new entries, %d refreshed",
			adopted, added, updated)
	}
}

// adoptSeeds reads each connected drive's catalog and turns it into index items.
// The scan adopts them before walking, so unchanged files are never probed: a
// second computer indexes a 60,000-photo drive in the time it takes to list it.
func (s *Server) adoptSeeds(libs []media.Library) []media.Item {
	byID := map[string]Library{}
	for _, l := range s.libs.list() {
		byID[l.ID] = l
	}
	// One catalog read per volume, not per library: two folders on the same
	// drive share the file.
	type volumeGroup struct {
		root string
		libs []Library
	}
	groups := map[string]*volumeGroup{}
	order := []string{}
	for _, ml := range libs {
		l, ok := byID[ml.ID]
		if !ok {
			continue
		}
		root := s.rootFor(l.Path)
		if root == "" {
			continue
		}
		g := groups[root]
		if g == nil {
			g = &volumeGroup{root: root}
			groups[root] = g
			order = append(order, root)
		}
		g.libs = append(g.libs, l)
	}

	var out []media.Item
	for _, root := range order {
		g := groups[root]
		snap, _, err := catalog.Read(root)
		if err != nil {
			// The drive may be readable but its catalog damaged. The local
			// mirror is the documented fallback, and it is still better than
			// probing every file again.
			info, verr := s.drives.volumeOf(root)
			if verr == nil {
				snap, err = s.readMirror(info.ID)
			}
		}
		if err != nil {
			continue
		}
		for _, l := range g.libs {
			out = append(out, itemsFromCatalog(snap, l.ID, s.libraryPrefix(l))...)
		}
	}
	return out
}

// libraryPrefix is the library's folder path inside its volume, as a
// slash-separated prefix. An available library is resolved from its actual
// path; an offline one uses the identity saved when it was last seen.
func (s *Server) libraryPrefix(l Library) string {
	if l.Available {
		if root := s.rootFor(l.Path); root != "" {
			if prefix, ok := relPrefix(root, l.Path); ok {
				return prefix
			}
		}
	}
	return cleanRel(l.Rel)
}

func cleanRel(rel string) string {
	rel = strings.ReplaceAll(rel, `\`, "/")
	rel = strings.Trim(rel, "/")
	if rel == "." {
		return ""
	}
	return rel
}

// relPrefix returns p relative to root in slash form, or false when p is not
// inside root at all.
func relPrefix(root, p string) (string, bool) {
	if root == "" || p == "" {
		return "", false
	}
	rel, err := filepath.Rel(root, p)
	if err != nil {
		return "", false
	}
	rel = filepath.ToSlash(rel)
	if rel == "." {
		return "", true
	}
	if rel == ".." || strings.HasPrefix(rel, "../") {
		return "", false
	}
	return rel, true
}

// stripPrefix matches a catalog path against a library prefix. Windows and
// FAT/exFAT are case-insensitive, and a phone may preserve a different case
// than the computer, so the comparison is folded. The returned path is the part
// below the library.
func stripPrefix(p, prefix string) (string, bool) {
	p = cleanRel(p)
	if prefix == "" {
		return p, p != ""
	}
	if len(p) <= len(prefix) || !strings.EqualFold(p[:len(prefix)], prefix) {
		return "", false
	}
	if p[len(prefix)] != '/' {
		return "", false
	}
	rel := p[len(prefix)+1:]
	if rel == "" || rel == ".." || strings.HasPrefix(rel, "../") {
		return "", false
	}
	for _, seg := range strings.Split(rel, "/") {
		if seg == ".." {
			return "", false
		}
	}
	return rel, true
}

// itemsFromCatalog maps a catalog's volume-relative entries onto one library.
// Entries outside that library are skipped rather than guessed at.
func itemsFromCatalog(snap catalog.Snapshot, libID, prefix string) []media.Item {
	out := make([]media.Item, 0, len(snap.Entries))
	for _, e := range snap.Entries {
		rel, ok := stripPrefix(e.Path, prefix)
		if !ok {
			continue
		}
		ext := strings.ToLower(path.Ext(rel))
		kind := media.KindOf(ext)
		switch e.Kind {
		case string(media.KindVideo):
			kind = media.KindVideo
		case string(media.KindImage):
			kind = media.KindImage
		}
		live := ""
		if e.Live != "" {
			if lrel, ok := stripPrefix(e.Live, prefix); ok {
				live = lrel
			}
		}
		out = append(out, media.Item{
			Lib:      libID,
			Rel:      rel,
			Name:     path.Base(rel),
			Ext:      ext,
			Kind:     kind,
			Size:     e.Size,
			ModTime:  e.MTime,
			ShotAt:   e.ShotAt,
			W:        e.Width,
			H:        e.Height,
			Duration: e.Duration,
			Hash:     e.Hash,
			Live:     live,
		})
	}
	return out
}

// catalogStatus reports, for each saved drive, whether its catalog is present,
// whether it matches the local mirror, and how many entries it holds. It is
// read-only and small enough to refresh on every drive listing.
func (s *Server) catalogStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	type status struct {
		VolumeID  string `json:"volumeId"`
		Library   string `json:"library"`
		Available bool   `json:"available"`
		Source    string `json:"source"` // drive, mirror, none
		Count     int    `json:"count"`
		Mirror    int    `json:"mirrorCount"`
	}
	seen := map[string]bool{}
	var out []status
	for _, l := range s.libs.list() {
		if l.VolumeID == "" || seen[l.VolumeID] {
			continue
		}
		seen[l.VolumeID] = true
		st := status{VolumeID: l.VolumeID, Library: l.Name, Available: l.Available, Source: "none"}
		if l.Available {
			if h, _, err := catalog.HeaderOf(s.rootFor(l.Path)); err == nil {
				st.Source, st.Count = "drive", h.Count
			}
		}
		if m, err := s.readMirror(l.VolumeID); err == nil {
			st.Mirror = len(m.Entries)
			if st.Source == "none" {
				st.Source, st.Count = "mirror", len(m.Entries)
			}
		}
		out = append(out, st)
	}
	writeJSON(w, http.StatusOK, map[string]any{"catalogs": out})
}

// rootFor resolves the drive root for a path with the same seam the rest of the
// server uses, so tests can point it at a temporary folder.
func (s *Server) rootFor(p string) string {
	if s.rootOf != nil {
		return s.rootOf(p)
	}
	return volume.RootOf(p)
}
