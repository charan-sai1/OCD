//go:build !windows

package server

import (
	"os/exec"
	"path/filepath"
	"runtime"
)

// revealFile shows a file in the desktop's file manager. Windows has its own
// version next door because it asks the shell to do it rather than starting a
// file-manager process.
func revealFile(path string) error {
	if runtime.GOOS == "darwin" {
		return exec.Command("open", "-R", path).Start()
	}
	// Linux and the BSDs have no agreed way to open a folder with one file
	// highlighted, so the folder itself is opened.
	return exec.Command("xdg-open", filepath.Dir(path)).Start()
}
