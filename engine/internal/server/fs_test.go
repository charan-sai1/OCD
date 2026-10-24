package server

import "testing"

// A plugged-in drive has to appear in the folder picker where that OS actually
// puts it: /Volumes on a Mac, /media (or /run/media) on Linux, and nowhere on
// Windows because that path is handled by the drive-letter scan.
func TestMountPointsPerOS(t *testing.T) {
	cases := []struct {
		goos string
		want string
	}{
		{"darwin", "/Volumes"},
		{"linux", "/media"},
		{"windows", ""},
	}
	for _, c := range cases {
		got := mountPoints(c.goos)
		if c.want == "" {
			if len(got) != 0 {
				t.Errorf("%s: expected no mount points, got %v", c.goos, got)
			}
			continue
		}
		found := false
		for _, p := range got {
			if p == c.want {
				found = true
			}
		}
		if !found {
			t.Errorf("%s: expected %s in %v", c.goos, c.want, got)
		}
	}
}

// Every mount point must be absolute, or joining it with a volume name would
// produce a path that does not exist.
func TestMountPointsAreAbsolute(t *testing.T) {
	for _, goos := range []string{"darwin", "linux"} {
		for _, p := range mountPoints(goos) {
			if len(p) == 0 || p[0] != '/' {
				t.Errorf("%s: mount point %q is not absolute", goos, p)
			}
		}
	}
}
