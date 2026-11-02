//go:build windows

package volume

import (
	"fmt"
	"syscall"
	"unsafe"
)

var procGetVolumeInformationW = syscall.NewLazyDLL("kernel32.dll").NewProc("GetVolumeInformationW")

// nativeID asks Windows for the volume serial number, which survives a drive
// letter change. It returns the serial and the volume label.
func nativeID(root string) (string, string, error) {
	ptr, err := syscall.UTF16PtrFromString(root)
	if err != nil {
		return "", "", err
	}
	var label [261]uint16
	var serial, maxComponent, flags uint32
	var fsName [261]uint16
	ok, _, callErr := procGetVolumeInformationW.Call(
		uintptr(unsafe.Pointer(ptr)),
		uintptr(unsafe.Pointer(&label[0])), uintptr(len(label)),
		uintptr(unsafe.Pointer(&serial)),
		uintptr(unsafe.Pointer(&maxComponent)),
		uintptr(unsafe.Pointer(&flags)),
		uintptr(unsafe.Pointer(&fsName[0])), uintptr(len(fsName)),
	)
	if ok == 0 {
		return "", "", callErr
	}
	return fmt.Sprintf("win:%08X", serial), syscall.UTF16ToString(label[:]), nil
}
