//go:build !windows

package volume

import "errors"

// nativeID is implemented per platform. On systems without a cheap stable
// serial call the catalog falls back to the uuid file on the volume.
func nativeID(root string) (string, string, error) {
	return "", "", errors.New("volume: no native serial on this platform")
}
