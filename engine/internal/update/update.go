// Package update checks the project's GitHub releases for a newer build and
// installs it: download, verify against the published checksum, swap the file,
// start the new process. It never touches the data directory.
package update

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	// Repo is the source of truth for released binaries.
	Repo = "charan-sai1/OCD"
	// DefaultAPI is the latest-release endpoint for that repository.
	DefaultAPI = "https://api.github.com/repos/" + Repo + "/releases/latest"
	// maxDownload caps an update download. Binaries are about 8 MB; anything
	// far above that is not the file we asked for.
	maxDownload = 64 << 20
)

// Asset is one downloadable file attached to a release.
type Asset struct {
	Name string `json:"name"`
	URL  string `json:"url"`
	Size int64  `json:"size"`
}

// Release is the part of a GitHub release this program cares about.
type Release struct {
	Tag    string
	Notes  string
	Page   string
	Assets []Asset
}

// State is what the interface shows: the version running, the newest one
// published, and whether the last look succeeded.
type State struct {
	Current   string `json:"current"`
	Latest    string `json:"latest,omitempty"`
	Available bool   `json:"available"`
	Page      string `json:"page,omitempty"`
	Checked   int64  `json:"checked"`
	Error     string `json:"error,omitempty"`
}

// Manager holds the last answer so the page does not hit GitHub on every load.
type Manager struct {
	current string
	apiURL  string
	client  *http.Client

	mu    sync.Mutex
	state State
	rel   Release
}

// New returns a manager for a running version such as "0.1.2".
func New(current string) *Manager {
	m := &Manager{
		current: current,
		apiURL:  DefaultAPI,
		client:  &http.Client{Timeout: 45 * time.Second},
		state:   State{Current: current},
	}
	// A development hook: point the check at a local server to exercise the
	// whole download-and-swap path without publishing a release.
	if v := os.Getenv("OCD_UPDATE_API"); v != "" {
		m.apiURL = v
	}
	return m
}

// State returns the last known answer.
func (m *Manager) State() State {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.state
}

// Check asks GitHub for the latest release. A failure is recorded in the state
// rather than returned, so a flaky network never blocks the rest of the app.
func (m *Manager) Check(ctx context.Context) State {
	rel, err := m.fetch(ctx)
	m.mu.Lock()
	defer m.mu.Unlock()

	m.state.Checked = time.Now().Unix()
	if err != nil {
		m.state.Error = friendlyError(err)
		return m.state
	}
	m.rel = rel
	m.state.Latest = rel.Tag
	m.state.Page = rel.Page
	m.state.Available = Compare(rel.Tag, m.current) > 0
	m.state.Error = ""
	return m.state
}

func (m *Manager) fetch(ctx context.Context) (Release, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, m.apiURL, nil)
	if err != nil {
		return Release{}, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "ocd-manager/"+m.current)

	resp, err := m.client.Do(req)
	if err != nil {
		return Release{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusTooManyRequests {
		return Release{}, fmt.Errorf("GitHub is limiting checks right now")
	}
	if resp.StatusCode != http.StatusOK {
		return Release{}, fmt.Errorf("GitHub answered %s", resp.Status)
	}

	var body struct {
		Tag    string `json:"tag_name"`
		Notes  string `json:"body"`
		Page   string `json:"html_url"`
		Assets []struct {
			Name string `json:"name"`
			URL  string `json:"browser_download_url"`
			Size int64  `json:"size"`
		} `json:"assets"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&body); err != nil {
		return Release{}, fmt.Errorf("could not read the release: %w", err)
	}
	rel := Release{Tag: body.Tag, Notes: body.Notes, Page: body.Page}
	for _, a := range body.Assets {
		rel.Assets = append(rel.Assets, Asset{Name: a.Name, URL: a.URL, Size: a.Size})
	}
	return rel, nil
}

// AssetName is the file a release publishes for this platform, or "" when the
// tag does not look like a version.
func AssetName(tag, goos, goarch string) string {
	tag = strings.TrimSpace(tag)
	if tag == "" || !strings.HasPrefix(tag, "v") {
		return ""
	}
	ext := ""
	if goos == "windows" {
		ext = ".exe"
	}
	return fmt.Sprintf("ocd-%s-%s-%s%s", tag, goos, goarch, ext)
}

// Install downloads the release for this platform, checks it against the
// published SHA-256 list, swaps it in for the running binary, and starts the
// new process. It returns once the replacement is on disk and running; the
// caller is expected to exit shortly afterwards.
func (m *Manager) Install(ctx context.Context) error {
	m.mu.Lock()
	rel := m.rel
	current := m.current
	m.mu.Unlock()

	if rel.Tag == "" || Compare(rel.Tag, current) <= 0 {
		return fmt.Errorf("there is no newer version to install")
	}
	name := AssetName(rel.Tag, runtime.GOOS, runtime.GOARCH)
	if name == "" {
		return fmt.Errorf("this build cannot tell which file belongs to it")
	}
	asset, ok := findAsset(rel, name)
	if !ok {
		return fmt.Errorf("%s is not attached to %s", name, rel.Tag)
	}
	sums, ok := findAsset(rel, "SHA256SUMS.txt")
	if !ok {
		return fmt.Errorf("the release has no checksums, so the download cannot be trusted")
	}

	exe, err := executablePath()
	if err != nil {
		return err
	}
	dir := filepath.Dir(exe)

	body, err := m.download(ctx, asset.URL, maxDownload)
	if err != nil {
		return err
	}
	if asset.Size > 0 && int64(len(body)) != asset.Size {
		return fmt.Errorf("the download is %d bytes, the release says %d", len(body), asset.Size)
	}
	if !looksLikeExecutable(body, runtime.GOOS) {
		return fmt.Errorf("the download is not a %s program", runtime.GOOS)
	}

	sumText, err := m.download(ctx, sums.URL, 64<<10)
	if err != nil {
		return fmt.Errorf("could not fetch the checksums: %w", err)
	}
	want, ok := checksumFor(string(sumText), name)
	if !ok {
		return fmt.Errorf("the checksum list does not mention %s", name)
	}
	got := sha256.Sum256(body)
	if hex.EncodeToString(got[:]) != want {
		return fmt.Errorf("the download does not match its checksum")
	}

	tmp, err := os.CreateTemp(dir, ".ocd-update-*")
	if err != nil {
		return fmt.Errorf("cannot write next to the program: %w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if _, err := tmp.Write(body); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmpName, 0o755); err != nil {
		return err
	}

	restore, err := swap(exe, tmpName)
	if err != nil {
		return err
	}
	if err := restart(exe, os.Args[1:]); err != nil {
		_ = restore()
		return fmt.Errorf("the new version could not start: %w", err)
	}
	return nil
}

func (m *Manager) download(ctx context.Context, url string, limit int64) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "ocd-manager/"+m.current)
	resp, err := m.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("download answered %s", resp.Status)
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(b)) > limit {
		return nil, fmt.Errorf("the download is larger than expected")
	}
	return b, nil
}

// executablePath is the file to replace, with symlinks resolved so an update
// does not overwrite a link and leave the real binary old.
func executablePath() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	return exe, nil
}

// CleanupOld removes the previous binary left behind by an update. It runs at
// start, when that file is definitely not executing.
func CleanupOld() {
	exe, err := executablePath()
	if err != nil {
		return
	}
	_ = os.Remove(exe + ".old")
}

func findAsset(rel Release, name string) (Asset, bool) {
	for _, a := range rel.Assets {
		if a.Name == name {
			return a, true
		}
	}
	return Asset{}, false
}

// checksumFor reads a "sha256  name" list and returns the hash for one file.
func checksumFor(list, name string) (string, bool) {
	for _, line := range strings.Split(list, "\n") {
		fields := strings.Fields(line)
		if len(fields) != 2 {
			continue
		}
		if strings.TrimPrefix(fields[1], "*") == name {
			return strings.ToLower(fields[0]), true
		}
	}
	return "", false
}

// Compare orders versions: negative when a is older, zero when equal. A leading
// "v" and a "-something" suffix are ignored, so "v0.1.2" and "0.1.2-dev" both
// read as 0.1.2.
func Compare(a, b string) int {
	pa, pb := versionParts(a), versionParts(b)
	for i := 0; i < len(pa) || i < len(pb); i++ {
		var x, y int
		if i < len(pa) {
			x = pa[i]
		}
		if i < len(pb) {
			y = pb[i]
		}
		if x != y {
			if x < y {
				return -1
			}
			return 1
		}
	}
	return 0
}

func versionParts(v string) []int {
	v = strings.TrimSpace(v)
	v = strings.TrimPrefix(v, "v")
	if i := strings.IndexAny(v, "-+"); i >= 0 {
		v = v[:i]
	}
	if v == "" {
		return nil
	}
	fields := strings.Split(v, ".")
	out := make([]int, 0, len(fields))
	for _, f := range fields {
		n, err := strconv.Atoi(f)
		if err != nil {
			return out
		}
		out = append(out, n)
	}
	return out
}

// looksLikeExecutable rejects an HTML error page that arrived with a 200.
func looksLikeExecutable(b []byte, goos string) bool {
	if len(b) < 4 {
		return false
	}
	switch goos {
	case "windows":
		return b[0] == 'M' && b[1] == 'Z'
	case "linux":
		return b[0] == 0x7f && b[1] == 'E' && b[2] == 'L' && b[3] == 'F'
	case "darwin":
		// Mach-O 64-bit, either byte order.
		return (b[0] == 0xcf && b[1] == 0xfa && b[2] == 0xed && b[3] == 0xfe) ||
			(b[0] == 0xfe && b[1] == 0xed && b[2] == 0xfa && b[3] == 0xcf)
	}
	return true
}

func friendlyError(err error) string {
	msg := err.Error()
	switch {
	case strings.Contains(msg, "no such host"):
		return "no internet connection"
	case strings.Contains(msg, "limiting"):
		return "GitHub is limiting checks right now"
	default:
		return msg
	}
}
