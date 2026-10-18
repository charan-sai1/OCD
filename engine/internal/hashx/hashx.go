// Package hashx provides content hashing helpers used for duplicate
// detection and copy verification. Stdlib-only (no external deps) so the
// binary stays a single, dependency-free static executable on every platform.
package hashx

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
)

// File returns the hex-encoded SHA-256 of the file at path.
func File(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// Reader returns the hex-encoded SHA-256 of everything read from r.
func Reader(r io.Reader) (string, error) {
	h := sha256.New()
	if _, err := io.Copy(h, r); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// Partial is a cheap pre-filter hash: the first and last n bytes of the file.
// Used to skip full hashing of files that cannot possibly be identical.
func Partial(path string, n int64) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()

	st, err := f.Stat()
	if err != nil {
		return "", err
	}

	h := sha256.New()
	if st.Size() <= 2*n {
		// Small file: just hash the whole thing.
		if _, err := io.Copy(h, f); err != nil {
			return "", err
		}
		return hex.EncodeToString(h.Sum(nil)), nil
	}

	head := make([]byte, n)
	if _, err := io.ReadFull(f, head); err != nil {
		return "", err
	}
	h.Write(head)

	if _, err := f.Seek(-n, io.SeekEnd); err != nil {
		return "", err
	}
	tail := make([]byte, n)
	if _, err := io.ReadFull(f, tail); err != nil {
		return "", err
	}
	h.Write(tail)

	return hex.EncodeToString(h.Sum(nil)), nil
}
