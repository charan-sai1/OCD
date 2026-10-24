package update

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCompare(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"0.1.1", "0.1.0", 1},
		{"0.1.0", "0.1.1", -1},
		{"v0.2.0", "0.1.9", 1},
		{"0.1.2", "v0.1.2", 0},
		{"0.1.2-dev", "0.1.2", 0},
		{"1.0", "0.9.9", 1},
		{"0.10.0", "0.9.0", 1},
		{"", "0.1.0", -1},
	}
	for _, c := range cases {
		if got := Compare(c.a, c.b); got != c.want {
			t.Errorf("Compare(%q, %q) = %d, want %d", c.a, c.b, got, c.want)
		}
	}
}

func TestAssetNameMatchesWhatReleasesPublish(t *testing.T) {
	cases := []struct {
		tag, goos, arch, want string
	}{
		{"v0.2.0", "windows", "amd64", "ocd-v0.2.0-windows-amd64.exe"},
		{"v0.2.0", "windows", "arm64", "ocd-v0.2.0-windows-arm64.exe"},
		{"v0.2.0", "linux", "amd64", "ocd-v0.2.0-linux-amd64"},
		{"v0.2.0", "darwin", "arm64", "ocd-v0.2.0-darwin-arm64"},
	}
	for _, c := range cases {
		if got := AssetName(c.tag, c.goos, c.arch); got != c.want {
			t.Errorf("AssetName(%q, %q, %q) = %q, want %q", c.tag, c.goos, c.arch, got, c.want)
		}
	}
	if got := AssetName("", "linux", "amd64"); got != "" {
		t.Errorf("empty tag should name no asset, got %q", got)
	}
}

func TestChecksumFor(t *testing.T) {
	list := "aaa111  ocd-v0.2.0-linux-amd64\n" +
		"BBB222 *ocd-v0.2.0-windows-amd64.exe\n" +
		"\n"
	if got, ok := checksumFor(list, "ocd-v0.2.0-windows-amd64.exe"); !ok || got != "bbb222" {
		t.Errorf("checksum = %q, %v", got, ok)
	}
	if _, ok := checksumFor(list, "something-else"); ok {
		t.Error("found a checksum for a file that is not listed")
	}
}

func TestLooksLikeExecutable(t *testing.T) {
	cases := []struct {
		name string
		b    []byte
		goos string
		want bool
	}{
		{"windows exe", []byte{'M', 'Z', 0x90, 0x00}, "windows", true},
		{"html page", []byte("<htm"), "windows", false},
		{"linux elf", []byte{0x7f, 'E', 'L', 'F'}, "linux", true},
		{"mac arm64", []byte{0xcf, 0xfa, 0xed, 0xfe}, "darwin", true},
		{"mac intel", []byte{0xcf, 0xfa, 0xed, 0xfe}, "darwin", true},
		{"too short", []byte{'M'}, "windows", false},
	}
	for _, c := range cases {
		if got := looksLikeExecutable(c.b, c.goos); got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}

func releaseJSON(tag string, assetNames ...string) []byte {
	assets := make([]map[string]any, 0, len(assetNames))
	for _, n := range assetNames {
		assets = append(assets, map[string]any{
			"name":                 n,
			"browser_download_url": "https://example.invalid/" + n,
			"size":                 1234,
		})
	}
	b, _ := json.Marshal(map[string]any{
		"tag_name": tag,
		"html_url": "https://example.invalid/release",
		"body":     "notes",
		"assets":   assets,
	})
	return b
}

func TestCheckFindsANewerRelease(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(releaseJSON("v0.2.0", "ocd-v0.2.0-linux-amd64", "SHA256SUMS.txt"))
	}))
	defer srv.Close()

	m := New("0.1.2")
	m.apiURL = srv.URL
	st := m.Check(context.Background())

	if !st.Available {
		t.Fatalf("expected an update to be available, state = %+v", st)
	}
	if st.Latest != "v0.2.0" {
		t.Errorf("latest = %q", st.Latest)
	}
	if st.Current != "0.1.2" {
		t.Errorf("current = %q", st.Current)
	}
	if st.Checked == 0 {
		t.Error("check time was not recorded")
	}
	if st.Error != "" {
		t.Errorf("unexpected error: %s", st.Error)
	}
}

func TestCheckStaysQuietWhenCurrent(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(releaseJSON("v0.1.2"))
	}))
	defer srv.Close()

	m := New("0.1.2")
	m.apiURL = srv.URL
	st := m.Check(context.Background())
	if st.Available {
		t.Errorf("the running version must not be offered: %+v", st)
	}
}

// A rate-limited check is not an error the page should shout about; it is
// recorded so the interface can stay silent.
func TestCheckRecordsAFailureWithoutCrashing(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	defer srv.Close()

	m := New("0.1.2")
	m.apiURL = srv.URL
	st := m.Check(context.Background())
	if st.Available {
		t.Error("a failed check must not report an update")
	}
	if st.Error == "" {
		t.Error("expected the failure to be recorded")
	}
}

func TestInstallRefusesWhenNothingIsNewer(t *testing.T) {
	m := New("0.1.2")
	if err := m.Install(context.Background()); err == nil {
		t.Error("expected an error when no release was checked")
	}
}
