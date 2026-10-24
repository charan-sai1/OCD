package server

import (
	"net/http/httptest"
	"testing"
)

func TestIsLoopback(t *testing.T) {
	cases := map[string]bool{
		"127.0.0.1:5000":   true,
		"[::1]:5000":       true,
		"192.168.1.10:500": false,
		"10.0.0.2:500":     false,
	}
	for addr, want := range cases {
		r := httptest.NewRequest("GET", "/", nil)
		r.RemoteAddr = addr
		if got := isLoopback(r); got != want {
			t.Errorf("isLoopback(%q) = %v, want %v", addr, got, want)
		}
	}
}

// A phone on the network must not be able to make the computer download and run
// a new program, so the guard has to run before anything is fetched.
func TestUpdateApplyRefusesOtherMachines(t *testing.T) {
	s := New(Config{DataDir: t.TempDir(), Version: "0.1.0"})
	req := httptest.NewRequest("POST", "/api/update/apply", nil)
	req.RemoteAddr = "192.168.1.44:5555"
	req.Header.Set("X-OCD-Update", "1")
	rec := httptest.NewRecorder()

	s.updateApply(rec, req)

	if rec.Code != 403 {
		t.Errorf("status = %d, want 403", rec.Code)
	}
}

// A page on another site could post a form to localhost; the custom header is
// what stops it, because a form cannot set one.
func TestUpdateApplyNeedsTheHeader(t *testing.T) {
	s := New(Config{DataDir: t.TempDir(), Version: "0.1.0"})
	req := httptest.NewRequest("POST", "/api/update/apply", nil)
	req.RemoteAddr = "127.0.0.1:5555"
	rec := httptest.NewRecorder()

	s.updateApply(rec, req)

	if rec.Code != 403 {
		t.Errorf("status = %d, want 403", rec.Code)
	}
}
