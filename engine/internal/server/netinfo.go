package server

import (
	"net"
	"net/http"
	"strconv"

	"ocd/internal/qr"
)

// netinfo.go answers the one question the phone cannot answer for itself: where
// is this app? The address has to be typed into a touch keyboard, and a Windows
// machine reports several addresses, most of which go nowhere at all. So the
// app works out the address a phone on the same network should use, and draws it
// as a code the camera can read instead.

// phoneURL is one way in, with the code that saves typing it.
type phoneURL struct {
	URL     string `json:"url"`
	Address string `json:"address"`
	QR      string `json:"qr,omitempty"`
	Primary bool   `json:"primary"`
}

// howManyAddresses caps the list: a machine with many adapters should not make
// the page carry a screenful of codes for networks nobody is on.
const howManyAddresses = 4

func (s *Server) netInfo(w http.ResponseWriter, r *http.Request) {
	port := s.cfg.Port
	if port <= 0 {
		port = 8090
	}
	urls := make([]phoneURL, 0, howManyAddresses)
	for _, ip := range lanAddresses() {
		u := "http://" + net.JoinHostPort(ip.String(), strconv.Itoa(port)) + "/"
		one := phoneURL{URL: u, Address: ip.String(), Primary: len(urls) == 0}
		if svg, err := qr.SVG(u, 4); err == nil {
			one.QR = svg
		}
		urls = append(urls, one)
		if len(urls) == howManyAddresses {
			break
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"port": port, "urls": urls})
}

// lanAddresses is the addresses a phone on the same network could reach, best
// first.
func lanAddresses() []net.IP {
	var out []net.IP
	seen := map[string]bool{}
	ifaces, err := net.Interfaces()
	if err == nil {
		for _, iface := range ifaces {
			if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
				continue
			}
			addrs, err := iface.Addrs()
			if err != nil {
				continue
			}
			for _, a := range addrs {
				ipnet, ok := a.(*net.IPNet)
				if !ok {
					continue
				}
				ip := ipnet.IP.To4()
				if ip == nil || !reachableFromAPhone(ip) || seen[ip.String()] {
					continue
				}
				seen[ip.String()] = true
				out = append(out, ip)
			}
		}
	}

	// The address Windows would use to reach the network at large goes first:
	// that is the adapter a phone is most likely to share. Dialling out over UDP
	// sends nothing, it only asks Windows to pick.
	if primary := outboundIP(); primary != nil {
		for i, ip := range out {
			if ip.Equal(primary) && i > 0 {
				out = append([]net.IP{ip}, append(out[:i:i], out[i+1:]...)...)
				break
			}
		}
	}
	return out
}

// reachableFromAPhone drops the addresses that look like an address but are not
// one a phone can dial. The important one is 169.254.x.x: every adapter on this
// machine that is not connected still reports one of those, and they lead
// nowhere.
func reachableFromAPhone(ip net.IP) bool {
	if ip.IsLoopback() || ip.IsUnspecified() || ip.IsMulticast() {
		return false
	}
	if ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
		return false
	}
	return true
}

func outboundIP() net.IP {
	c, err := net.Dial("udp4", "8.8.8.8:80")
	if err != nil {
		return nil
	}
	defer c.Close()
	if a, ok := c.LocalAddr().(*net.UDPAddr); ok {
		return a.IP.To4()
	}
	return nil
}
