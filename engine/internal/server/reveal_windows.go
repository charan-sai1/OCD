//go:build windows

package server

import (
	"fmt"
	"runtime"
	"syscall"
	"unsafe"
)

var (
	shell32 = syscall.NewLazyDLL("shell32.dll")
	ole32   = syscall.NewLazyDLL("ole32.dll")

	procSHParseDisplayName         = shell32.NewProc("SHParseDisplayName")
	procSHOpenFolderAndSelectItems = shell32.NewProc("SHOpenFolderAndSelectItems")
	procCoInitializeEx             = ole32.NewProc("CoInitializeEx")
	procCoUninitialize             = ole32.NewProc("CoUninitialize")
	procCoTaskMemFree              = ole32.NewProc("CoTaskMemFree")
)

const (
	coinitApartmentThreaded = 0x2
	rpcChangedMode          = 0x80010106
)

// revealFile opens the folder that holds path and highlights the file in it.
//
// This asks the shell to do the work instead of starting explorer.exe. A
// machine can refuse to create explorer.exe outright — a policy or an
// application-control rule is enough, and then every attempt comes back
// "Access is denied" — while the shell itself will happily do what is wanted.
// Going through it also means the folder opens in the session the user is
// actually looking at, with no console window flashing up on the way.
func revealFile(path string) error {
	// The window belongs to the thread that asks for it, so stay on this one
	// and hand the apartment back when we are done.
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	hr, _, _ := procCoInitializeEx.Call(0, coinitApartmentThreaded)
	if failed(hr) && uint32(hr) != rpcChangedMode {
		// Already-initialised is fine; anything else means no shell for us.
		return fmt.Errorf("the shell is not available (0x%x)", uint32(hr))
	}
	defer func() {
		if !failed(hr) {
			procCoUninitialize.Call()
		}
	}()

	name, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return err
	}
	var pidl uintptr
	hr, _, _ = procSHParseDisplayName.Call(
		uintptr(unsafe.Pointer(name)), 0, uintptr(unsafe.Pointer(&pidl)), 0, 0)
	if failed(hr) {
		return fmt.Errorf("the file could not be located (0x%x)", uint32(hr))
	}
	defer procCoTaskMemFree.Call(pidl)

	// Asked for one item rather than for children, the shell opens the folder
	// that contains it and selects it.
	hr, _, _ = procSHOpenFolderAndSelectItems.Call(pidl, 0, 0, 0)
	if failed(hr) {
		return fmt.Errorf("the folder could not be opened (0x%x)", uint32(hr))
	}
	return nil
}

// failed reports whether an HRESULT carries an error code.
func failed(hr uintptr) bool { return int32(hr) < 0 }
