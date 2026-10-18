package server

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

// photofieldBase is where the gallery engine listens.
const photofieldBase = "http://localhost:8080"

// Photo is one item in the grid.
type Photo struct {
	ID             int64  `json:"id"`
	Name           string `json:"name"`
	Datetime       string `json:"datetime"`
	Width          int    `json:"width"`
	Height         int    `json:"height"`
	Collection     string `json:"collection"`
	CollectionName string `json:"collectionName"`
}

// photos aggregates the newest photos across the saved collections, so the UI
// can render a single library view instead of one gallery per drive.
func (s *Server) photos(w http.ResponseWriter, r *http.Request) {
	limit := 240
	if v, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && v > 0 && v <= 2000 {
		limit = v
	}
	only := r.URL.Query().Get("collection")

	root, err := httpGetJSON(photofieldBase + "/api/collections")
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"items": []Photo{}, "running": false,
			"error": "gallery is not running",
		})
		return
	}

	cols, _ := root["items"].([]any)
	type result struct {
		items []Photo
		errs  []string
	}
	var out result

	for _, c := range cols {
		cm, ok := c.(map[string]any)
		if !ok {
			continue
		}
		id, _ := cm["id"].(string)
		name, _ := cm["name"].(string)
		if id == "" || (only != "" && id != only) {
			continue
		}
		// index over a single collection only needs a page that covers the limit
		q := url.Values{}
		q.Set("limit", strconv.Itoa(limit))
		q.Set("sort", "-date")
		files, err := httpGetJSON(photofieldBase + "/api/collections/" + url.PathEscape(id) + "/files?" + q.Encode())
		if err != nil {
			out.errs = append(out.errs, name)
			continue
		}
		items, _ := files["items"].([]any)
		for _, it := range items {
			m, ok := it.(map[string]any)
			if !ok {
				continue
			}
			p := Photo{
				Name:           str(m["file_name"]),
				Datetime:       str(m["datetime"]),
				Width:          int(num(m["width"])),
				Height:         int(num(m["height"])),
				Collection:     id,
				CollectionName: name,
			}
			p.ID = int64(num(m["id"]))
			if p.ID == 0 || p.Width <= 0 || p.Height <= 0 {
				continue
			}
			out.items = append(out.items, p)
		}
	}

	sort.SliceStable(out.items, func(i, j int) bool {
		return out.items[i].Datetime > out.items[j].Datetime
	})
	if len(out.items) > limit {
		out.items = out.items[:limit]
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"items":   out.items,
		"count":   len(out.items),
		"running": true,
		"errors":  out.errs,
	})
}

// thumb proxies a PhotoField preview through our own origin. Same-origin means
// one port to expose, and no CORS handling in the browser.
//
//	/api/thumb/{id}/{filename}?w=512&h=512
func (s *Server) thumb(w http.ResponseWriter, r *http.Request) {
	// Registered as a prefix so we don't depend on ServeMux wildcard patterns,
	// which are only enabled when go.mod declares go >= 1.22.
	rest := strings.TrimPrefix(r.URL.Path, "/api/thumb/")
	id, name, ok := strings.Cut(rest, "/")
	if !ok || id == "" || name == "" {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	q := url.Values{}
	for _, k := range []string{"w", "h"} {
		if v := r.URL.Query().Get(k); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 4096 {
				q.Set(k, strconv.Itoa(n))
			}
		}
	}
	target := fmt.Sprintf("%s/api/files/%s/previews/%s", photofieldBase,
		url.PathEscape(id), url.PathEscape(name))
	if len(q) > 0 {
		target += "?" + q.Encode()
	}

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Get(target)
	if err != nil {
		http.Error(w, "gallery not running", http.StatusServiceUnavailable)
		return
	}
	defer resp.Body.Close()

	if ct := resp.Header.Get("Content-Type"); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	if resp.StatusCode != http.StatusOK {
		w.WriteHeader(resp.StatusCode)
		_, _ = io.Copy(w, resp.Body)
		return
	}
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, resp.Body)
}

func str(v any) string {
	s, _ := v.(string)
	return s
}

func num(v any) float64 {
	f, _ := v.(float64)
	return f
}
