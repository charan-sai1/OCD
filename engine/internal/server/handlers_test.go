package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Windows tools routinely save JSON as UTF-8 with a byte-order mark. The mark is
// invisible, and a decoder that refuses it complains about the first character
// of the body, which tells the caller nothing useful.
func TestARequestWithAByteOrderMarkIsStillRead(t *testing.T) {
	body := "\ufeff{\"inbox\":\"C:\\\\Phone\"}"
	r := httptest.NewRequest(http.MethodPost, "/api/phone", strings.NewReader(body))
	var got struct {
		Inbox string `json:"inbox"`
	}
	if err := decode(r, &got); err != nil {
		t.Fatalf("a body with a byte-order mark was refused: %v", err)
	}
	if got.Inbox != `C:\Phone` {
		t.Errorf("read inbox as %q, want C:\\Phone", got.Inbox)
	}
}

func TestAnOrdinaryRequestIsUnaffected(t *testing.T) {
	r := httptest.NewRequest(http.MethodPost, "/api/phone", strings.NewReader(`{"watch":true}`))
	var got struct {
		Watch bool `json:"watch"`
	}
	if err := decode(r, &got); err != nil {
		t.Fatal(err)
	}
	if !got.Watch {
		t.Error("watch should have been read as true")
	}
}
