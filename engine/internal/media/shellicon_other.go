//go:build !windows

package media

import "fmt"

// shellThumbnail has no operating-system decoder on this platform yet; the
// previewer reports the reason instead of guessing.
func shellThumbnail(path string, maxDim int) ([]byte, int, int, error) {
	return nil, 0, 0, fmt.Errorf("no built-in decoder for %s on this platform", baseName(path))
}
