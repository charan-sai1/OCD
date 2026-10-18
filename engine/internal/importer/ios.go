package importer

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// iOS support uses libimobiledevice. On Windows/macOS/Linux the practical
// model is: mount the Camera Roll with `ifuse`, import from it as a folder,
// and — because iOS does not reliably allow third-party deletion of Camera
// Roll items — leave deletion to the Photos app after verification.
//
// This file provides device discovery and mounting helpers.

// ListIosDevices returns connected iOS UDIDs (via `idevice_id -l`).
func ListIosDevices() ([]string, error) {
	out, err := exec.Command("idevice_id", "-l").Output()
	if err != nil {
		return nil, err
	}
	var udids []string
	for _, l := range bytes.Split(out, []byte("\n")) {
		s := strings.TrimSpace(string(l))
		if s != "" {
			udids = append(udids, s)
		}
	}
	return udids, nil
}

// MountIos mounts the device's media to mountpoint using ifuse.
// Requires ifuse (libimobiledevice) on PATH.
func MountIos(udid, mountpoint string) error {
	if err := os.MkdirAll(mountpoint, 0o755); err != nil {
		return err
	}
	args := []string{}
	if udid != "" {
		args = append(args, "-u", udid)
	}
	args = append(args, mountpoint)
	cmd := exec.Command("ifuse", args...)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("ifuse failed: %v: %s", err, out)
	}
	return nil
}

// UnmountIos unmounts a previously mounted iOS mountpoint.
func UnmountIos(mountpoint string) error {
	// Try platform-appropriate unmount.
	for _, cand := range [][]string{{"fusermount", "-u", mountpoint}, {"umount", mountpoint}} {
		if _, err := exec.LookPath(cand[0]); err == nil {
			if out, err := exec.Command(cand[0], cand[1:]...).CombinedOutput(); err != nil {
				return fmt.Errorf("%s failed: %v: %s", cand[0], err, out)
			}
			return nil
		}
	}
	return fmt.Errorf("no unmount tool found (fusermount/umount)")
}

// ToolsAvailable reports which optional helper binaries are present, so the UI
// can explain what the user needs to install for each phone type.
func ToolsAvailable() map[string]bool {
	names := []string{"adb", "idevice_id", "ifuse", "exiftool", "ffmpeg"}
	out := map[string]bool{}
	for _, n := range names {
		_, err := exec.LookPath(n)
		out[n] = err == nil
	}
	return out
}
