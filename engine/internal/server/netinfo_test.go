package server

import (
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOnlyAddressesAPhoneCouldReachAreOffered(t *testing.T) {
	unreachable := []string{
		"127.0.0.1",       // this machine talking to itself
		"169.254.235.153", // what an adapter reports when nothing is plugged in
		"0.0.0.0",         // no address at all
		"224.0.0.1",       // multicast
	}
	for _, s := range unreachable {
		if reachableFromAPhone(net.ParseIP(s).To4()) {
			t.Errorf("%s was offered as an address a phone could open", s)
		}
	}
	reachable := []string{"192.168.1.10", "10.0.0.5", "172.16.4.4"}
	for _, s := range reachable {
		if !reachableFromAPhone(net.ParseIP(s).To4()) {
			t.Errorf("%s was not offered, but a phone on the same network could open it", s)
		}
	}
}

func TestTheAddressComesWithACodeToScan(t *testing.T) {
	s := &Server{cfg: Config{Port: 8090}}
	rec := httptest.NewRecorder()
	s.netInfo(rec, httptest.NewRequest(http.MethodGet, "/api/net", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("asked for the address and got %d", rec.Code)
	}
	var got struct {
		Port int        `json:"port"`
		URLs []phoneURL `json:"urls"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Port != 8090 {
		t.Errorf("the address should carry the port the app is on, got %d", got.Port)
	}
	if len(got.URLs) > 0 && !got.URLs[0].Primary {
		t.Error("the first address should be the one the phone is told to use")
	}
	for _, u := range got.URLs {
		if strings.HasPrefix(u.Address, "127.") || strings.HasPrefix(u.Address, "169.254.") {
			t.Errorf("%s is not an address a phone could open", u.Address)
		}
		if want := "http://" + net.JoinHostPort(u.Address, "8090") + "/"; u.URL != want {
			t.Errorf("address given as %q, expected %q", u.URL, want)
		}
		if !strings.Contains(u.QR, "<svg") {
			t.Errorf("%s came without a code to scan", u.URL)
		}
		// The code has to be for the address it sits next to.
		if !strings.Contains(u.QR, u.URL) {
			t.Errorf("the code beside %s is for something else", u.URL)
		}
	}
}
