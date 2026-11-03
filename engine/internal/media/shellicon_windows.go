//go:build windows

package media

import (
	"fmt"
	"os"
	"runtime"
	"syscall"
	"unsafe"
)

// Windows has an HEVC decoder (the same one the Photos app uses) and exposes
// it through the thumbnail cache. The bundled ffmpeg build has no HEVC
// decoder, and Apple's HEIC files are HEVC, so this is the built-in route to a
// picture for them — and for any other format Windows knows and ffmpeg does
// not.

var (
	shell32Win = syscall.NewLazyDLL("shell32.dll")
	ole32Win   = syscall.NewLazyDLL("ole32.dll")
	gdi32Win   = syscall.NewLazyDLL("gdi32.dll")

	procSHCreateItemFromParsingName = shell32Win.NewProc("SHCreateItemFromParsingName")
	procCoInitializeExThumb         = ole32Win.NewProc("CoInitializeEx")
	procCoUninitializeThumb         = ole32Win.NewProc("CoUninitialize")
	procCreateCompatibleDC          = gdi32Win.NewProc("CreateCompatibleDC")
	procDeleteDC                    = gdi32Win.NewProc("DeleteDC")
	procDeleteObject                = gdi32Win.NewProc("DeleteObject")
	procGetDIBits                   = gdi32Win.NewProc("GetDIBits")
)

const (
	coinitApartmentThreaded = 0x2
	coinitDisableOleDDE     = 0x4
	rpcChangedMode          = 0x80010106
)

// comObject is the three-entry IUnknown prefix every shell interface starts
// with. Later methods are addressed through the vtable array so no
// function-pointer representation is guessed at.
type comObject struct {
	vtbl *comVtbl
}

type comVtbl struct {
	queryInterface uintptr
	addRef         uintptr
	release        uintptr
	rest           [8]uintptr
}

func (o *comObject) release() {
	if o != nil && o.vtbl != nil && o.vtbl.release != 0 {
		syscall.Syscall(o.vtbl.release, 1, uintptr(unsafe.Pointer(o)), 0, 0)
	}
}

func hfailed(hr uintptr) bool { return hr != 0 && uint32(hr) >= 0x80000000 }

// shellThumbnail returns a top-down RGBA picture of path, at most maxDim wide
// or tall, drawn by the operating system.
func shellThumbnail(path string, maxDim int) ([]byte, int, int, error) {
	if maxDim <= 0 {
		maxDim = 256
	}
	// The shell objects belong to the thread that made them, so stay put.
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	hr, _, _ := procCoInitializeExThumb.Call(0, coinitApartmentThreaded|coinitDisableOleDDE)
	if hfailed(hr) && uint32(hr) != rpcChangedMode {
		return nil, 0, 0, fmt.Errorf("the shell is not available (0x%x)", uint32(hr))
	}
	if !hfailed(hr) {
		defer procCoUninitializeThumb.Call()
	}
	abs, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return nil, 0, 0, err
	}
	iidShellItem := syscall.GUID{
		Data1: 0x43826D1E, Data2: 0xE718, Data3: 0x42EE,
		Data4: [8]byte{0xBC, 0x55, 0xA1, 0xE2, 0x61, 0xC3, 0x7B, 0xFE},
	}
	var item *comObject
	hr, _, _ = procSHCreateItemFromParsingName.Call(
		uintptr(unsafe.Pointer(abs)), 0,
		uintptr(unsafe.Pointer(&iidShellItem)),
		uintptr(unsafe.Pointer(&item)),
	)
	if hfailed(hr) || item == nil {
		return nil, 0, 0, fmt.Errorf("Windows could not open the file (0x%x)", uint32(hr))
	}
	defer item.release()

	iidThumbnailProvider := syscall.GUID{
		Data1: 0xE357FCCD, Data2: 0xA995, Data3: 0x4576,
		Data4: [8]byte{0xB0, 0x1F, 0x23, 0x46, 0x30, 0x8D, 0x54, 0xB2},
	}
	var provider *comObject
	hr, _, _ = syscall.Syscall(
		item.vtbl.queryInterface, 3,
		uintptr(unsafe.Pointer(item)),
		uintptr(unsafe.Pointer(&iidThumbnailProvider)),
		uintptr(unsafe.Pointer(&provider)),
	)
	if hfailed(hr) || provider == nil {
		return nil, 0, 0, fmt.Errorf("Windows has no thumbnail provider for this file (0x%x)", uint32(hr))
	}
	defer provider.release()

	// IThumbnailProvider::GetThumbnail is slot 3:
	// HRESULT GetThumbnail(UINT cx, HBITMAP *phbmp, WTS_ALPHATYPE *pdwAlpha)
	var hbmp syscall.Handle
	var alphaType uint32
	hr, _, _ = syscall.Syscall6(
		provider.vtbl.rest[0], 4,
		uintptr(unsafe.Pointer(provider)),
		uintptr(uint32(maxDim)),
		uintptr(unsafe.Pointer(&hbmp)),
		uintptr(unsafe.Pointer(&alphaType)),
		0, 0,
	)
	if hfailed(hr) || hbmp == 0 {
		return nil, 0, 0, fmt.Errorf("Windows could not decode a preview (0x%x)", uint32(hr))
	}
	defer procDeleteObject.Call(uintptr(hbmp))

	raw, w, h, err := bitmapRGBA(hbmp)
	if err != nil {
		return nil, 0, 0, err
	}
	if w <= 0 || h <= 0 {
		return nil, 0, 0, fmt.Errorf("Windows returned an empty preview")
	}
	return raw, w, h, nil
}

type bitmapInfoHeader struct {
	Size          uint32
	Width         int32
	Height        int32
	Planes        uint16
	BitCount      uint16
	Compression   uint32
	SizeImage     uint32
	XPelsPerMeter int32
	YPelsPerMeter int32
	ClrUsed       uint32
	ClrImportant  uint32
}

// bitmapRGBA copies an HBITMAP into a top-down RGBA buffer. The alpha byte of
// a 32-bit GDI bitmap is only meaningful when the provider sets one, so it is
// forced opaque; a transparent thumbnail would show as black on the phone.
func bitmapRGBA(hbmp syscall.Handle) ([]byte, int, int, error) {
	hdc, _, _ := procCreateCompatibleDC.Call(0)
	if hdc == 0 {
		return nil, 0, 0, fmt.Errorf("could not create a drawing surface")
	}
	defer procDeleteDC.Call(hdc)

	var bi bitmapInfoHeader
	bi.Size = uint32(unsafe.Sizeof(bi))
	bi.Planes = 1
	bi.BitCount = 32
	bi.Compression = 0 // BI_RGB

	r, _, e := procGetDIBits.Call(hdc, uintptr(hbmp), 0, 0,
		uintptr(unsafe.Pointer(&bi)), uintptr(unsafe.Pointer(&bi)), 0)
	if r == 0 {
		return nil, 0, 0, fmt.Errorf("could not measure the preview bitmap (%v)", e)
	}
	w, h := int(bi.Width), int(bi.Height)
	if w <= 0 || h <= 0 || int64(w)*int64(h) > 64<<20 {
		return nil, 0, 0, fmt.Errorf("the preview bitmap has an impossible size")
	}

	// A negative height asks GDI for a top-down copy, which is the order image
	// packages and the phone expect.
	bi.Height = -int32(h)
	bi.SizeImage = uint32(w * 4 * h)
	buf := make([]byte, w*4*h)
	r, _, e = procGetDIBits.Call(hdc, uintptr(hbmp), 0, uintptr(h),
		uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&bi)), 0)
	if r == 0 {
		return nil, 0, 0, fmt.Errorf("could not read the preview bitmap (%v)", e)
	}
	for i := 0; i+3 < len(buf); i += 4 {
		buf[i], buf[i+2] = buf[i+2], buf[i] // BGRA -> RGBA
		buf[i+3] = 0xFF
	}
	return buf, w, h, nil
}

var _ = os.Remove
