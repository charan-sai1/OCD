package importer

import (
	"bufio"
	"bytes"
	"fmt"
	"io"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// AdbSource imports from an Android device over USB debugging (adb).
// It is the reliable, cross-platform path for Android: binary-safe reads via
// `adb exec-out`, and reliable deletion via `adb shell rm`.
type AdbSource struct {
	Serial string
	Root   string // e.g. "/sdcard/DCIM"
}

func adbArgs(serial string, args ...string) []string {
	if serial != "" {
		args = append([]string{"-s", serial}, args...)
	}
	return args
}

func (s *AdbSource) Name() string { return "adb:" + s.Serial + s.Root }

// ListDevices returns connected Android serial numbers.
func ListDevices() ([]string, error) {
	out, err := exec.Command("adb", "devices").Output()
	if err != nil {
		return nil, err
	}
	var serials []string
	sc := bufio.NewScanner(bytes.NewReader(out))
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "List of devices") {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) >= 2 && parts[1] == "device" {
			serials = append(serials, parts[0])
		}
	}
	return serials, nil
}

// List enumerates files under Root. It uses `find -printf` when available
// (GNU/toybox variants that support it) and falls back to plain `find -type f`.
func (s *AdbSource) List() ([]RemoteFile, error) {
	if out, err := exec.Command("adb", adbArgs(s.Serial, "shell", "find", s.Root, "-type", "f", "-printf", "%s\t%T@\t%p\n")...).Output(); err == nil {
		files := parseFind(out, s.Root)
		if len(files) > 0 {
			return files, nil
		}
	}
	out, err := exec.Command("adb", adbArgs(s.Serial, "shell", "find", s.Root, "-type", "f")...).Output()
	if err != nil {
		return nil, err
	}
	var files []RemoteFile
	sc := bufio.NewScanner(bytes.NewReader(out))
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	for sc.Scan() {
		p := strings.TrimSpace(sc.Text())
		if p == "" {
			continue
		}
		rel := strings.TrimPrefix(strings.TrimPrefix(p, s.Root), "/")
		files = append(files, RemoteFile{RelPath: rel})
	}
	return files, nil
}

func parseFind(out []byte, root string) []RemoteFile {
	var files []RemoteFile
	sc := bufio.NewScanner(bytes.NewReader(out))
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	for sc.Scan() {
		parts := strings.SplitN(sc.Text(), "\t", 3)
		if len(parts) != 3 {
			continue
		}
		size, _ := strconv.ParseInt(parts[0], 10, 64)
		epoch, _ := strconv.ParseFloat(parts[1], 64)
		rel := strings.TrimPrefix(strings.TrimPrefix(parts[2], root), "/")
		files = append(files, RemoteFile{
			RelPath: rel,
			Size:    size,
			ModTime: time.Unix(int64(epoch), 0),
		})
	}
	return files
}

func (s *AdbSource) Open(rel string) (io.ReadCloser, error) {
	cmd := exec.Command("adb", adbArgs(s.Serial, "exec-out", "cat", s.full(rel))...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	return &cmdReader{r: stdout, cmd: cmd}, nil
}

func (s *AdbSource) Remove(rel string) error {
	return exec.Command("adb", adbArgs(s.Serial, "shell", "rm", "-f", s.full(rel))...).Run()
}

func (s *AdbSource) full(rel string) string {
	return strings.TrimSuffix(s.Root, "/") + "/" + strings.TrimPrefix(rel, "/")
}

// cmdReader closes the process pipe and waits for the command on Close.
type cmdReader struct {
	r   io.ReadCloser
	cmd *exec.Cmd
}

func (c *cmdReader) Read(p []byte) (int, error) { return c.r.Read(p) }

func (c *cmdReader) Close() error {
	err := c.r.Close()
	if werr := c.cmd.Wait(); werr != nil && err == nil {
		err = fmt.Errorf("adb command failed: %w", werr)
	}
	return err
}
