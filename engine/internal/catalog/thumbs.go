package catalog

import (
	"fmt"
	"path/filepath"
	"strconv"
	"strings"
)

// ThumbName turns a catalog entry into the file name its preview uses inside
// the drive's .ocd/thumbs directory. It must agree with the phone's decoder
// exactly — the phone finds previews by this name and nothing else — so both
// sides use the same plain 64-bit FNV-1a hash over the same fields.
//
// The name is flat (t/<hash>.jpg) on purpose: a single read of the thumbs
// folder is enough to find them anywhere, whatever the filesystem or the
// Android provider considers a file name.
const thumbDir = "thumbs"

func fnv1a64(s string) uint64 {
	h := uint64(14695981039346656037)
	for i := 0; i < len(s); i++ {
		h ^= uint64(s[i])
		h *= 1099511628211
	}
	return h
}

// ThumbName returns thumbs/<hex16>.jpg for a file that lives at rel inside
// the volume. rel must use slashes and be relative to the volume root.
func ThumbName(volumeID, rel string, size, mtime int64) string {
	h := fnv1a64(volumeID + "\x00" + rel + "\x00" + strconv.FormatInt(size, 10) + "\x00" + strconv.FormatInt(mtime, 10))
	s := fmt.Sprintf("%016x", h)
	return ThumbDir() + "/" + s + ".jpg"
}

// ThumbDir is where previews live on the drive.
func ThumbDir() string { return thumbDir }

// ThumbPath is the absolute path of a preview on volume root.
func ThumbPath(root, volumeID, rel string, size, mtime int64) string {
	return filepath.Join(root, DirName(), filepath.FromSlash(ThumbName(volumeID, rel, size, mtime)))
}

// ThumbRel extracts the hash from a file name found inside the thumbs
// directory, tolerating the two-level layout writes may use.
func ThumbRel(name string) (string, bool) {
	name = strings.TrimPrefix(strings.TrimPrefix(name, "./"), "/")
	if !strings.HasSuffix(strings.ToLower(name), ".jpg") {
		return "", false
	}
	base := filepath.Base(name)
	h := strings.TrimSuffix(base, filepath.Ext(base))
	if len(h) != 16 {
		return "", false
	}
	return h, true
}
