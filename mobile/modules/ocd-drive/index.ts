import { requireOptionalNativeModule } from 'expo-modules-core';

/** A mounted volume as the platform reports it. */
export type DriveVolume = {
  /** FAT/exFAT serial, e.g. "6EC7-679B" — the same value Windows calls the volume serial. */
  uuid: string;
  label: string;
  /** Absolute mount point, e.g. /storage/6EC7-679B. */
  path: string;
  primary: boolean;
  removable: boolean;
  state: string;
  writable: boolean;
};

export type ScanResult = {
  /** Cache file holding one JSON object per media file. */
  path: string;
  count: number;
  truncated: boolean;
};

export type FileStat = {
  exists: boolean;
  size: number;
  /** Unix seconds, matching the catalog's own unit. */
  mtime: number;
  isDir: boolean;
};

type OcdDriveNative = {
  hasAllFilesAccess(): boolean;
  requestAllFilesAccess(): boolean;
  listVolumes(): DriveVolume[];
  scan(root: string, maxEntries: number): ScanResult;
  stat(path: string): FileStat;
  readBase64(path: string): string;
  writeBase64Atomic(path: string, data: string, keepBackup: boolean): boolean;
  writeText(path: string, text: string): boolean;
  mkdirs(path: string): boolean;
  remove(path: string): boolean;
  rename(from: string, to: string): boolean;
  freeBytes(path: string): number;
  imageThumb(src: string, dst: string, maxSize: number, quality: number): boolean;
  videoDuration(src: string): number;
  videoThumb(
    src: string,
    dst: string,
    atMs: number,
    maxSize: number,
    quality: number,
  ): boolean;
};

/**
 * Absent in Expo Go: this module needs a development build. Everything that
 * uses it must fall back to the SAF path rather than assume it is there.
 */
const native = requireOptionalNativeModule<OcdDriveNative>('OcdDrive');

export const isDriveModuleAvailable = native != null;

export function drive(): OcdDriveNative {
  if (!native) {
    throw new Error(
      'Direct drive access needs the OCD development build — this Expo Go app cannot write to a drive.',
    );
  }
  return native;
}
