package media

import (
	"fmt"
	"image"
	"path/filepath"
	"strings"
)

// heifExts are the still-image formats that usually need an HEVC decoder:
// Windows reaches them through its HEVC Video Extensions, and ffmpeg only
// through a build that enables HEVC.
var heifExts = map[string]bool{
	".heic": true,
	".heif": true,
	".hif":  true,
	".avif": true,
}

// shellHook lets tests replace the OS decoder. Nil means "use the real one".
var shellHook func(path string, maxDim int) (rgba []byte, w, h int, err error)

// shellPreview asks the operating system for a picture of path.
func shellPreview(path string, maxDim int) ([]byte, int, int, error) {
	if shellHook != nil {
		return shellHook(path, maxDim)
	}
	return shellThumbnail(path, maxDim)
}

// rawToImage wraps a top-down RGBA buffer as an image.
func rawToImage(raw []byte, w, h int) (image.Image, error) {
	if w <= 0 || h <= 0 || len(raw) < w*h*4 {
		return nil, fmt.Errorf("the preview bitmap is truncated")
	}
	return &image.RGBA{Pix: raw, Stride: w * 4, Rect: image.Rect(0, 0, w, h)}, nil
}

// describePreviewFailure picks the message that actually helps. A HEIC file
// with no HEVC decoder deserves an explanation; other formats keep ffmpeg's
// own words.
func describePreviewFailure(src string, ffmpegErr, shellErr error) error {
	name := filepath.Base(src)
	ext := strings.ToLower(filepath.Ext(src))
	switch {
	case ffmpegErr == nil && shellErr == nil:
		return fmt.Errorf("no preview available for %s", name)
	case shellErr == nil:
		return ffmpegErr
	case ffmpegErr == nil && !heifExts[ext]:
		return shellErr
	case ffmpegErr == nil:
		return ffmpegErr
	}
	if heifExts[ext] {
		return fmt.Errorf(
			"could not preview %s: this computer cannot decode HEVC. Install the HEVC Video Extensions from the Microsoft Store, or use a full ffmpeg build.",
			name,
		)
	}
	return ffmpegErr
}
