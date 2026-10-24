//go:build !windows

package update

import (
	"os"
	"os/exec"
	"syscall"
)

// swap puts newFile in place of exe. Replacing a running binary is safe on
// Unix: the running process keeps its own inode. The returned function undoes
// the swap if the replacement cannot start.
func swap(exe, newFile string) (func() error, error) {
	old := exe + ".old"
	_ = os.Remove(old)
	if err := os.Rename(exe, old); err != nil {
		return nil, err
	}
	if err := os.Rename(newFile, exe); err != nil {
		_ = os.Rename(old, exe)
		return nil, err
	}
	return func() error {
		if err := os.Remove(exe); err != nil {
			return err
		}
		return os.Rename(old, exe)
	}, nil
}

// restart starts the new binary in its own session so it survives this process
// exiting. It keeps the working directory and environment, and so the same
// --data and --port arguments.
func restart(exe string, args []string) error {
	cmd := exec.Command(exe, args...)
	if dir, err := os.Getwd(); err == nil {
		cmd.Dir = dir
	}
	cmd.Env = os.Environ()
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	return cmd.Start()
}
