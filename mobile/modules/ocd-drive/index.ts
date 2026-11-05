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
  // Everything below is an Expo `AsyncFunction`: it runs off the JS thread and
  // resolves later. Nothing that touches the filesystem may block the UI.
  listVolumes(): Promise<DriveVolume[]>;
  scan(root: string, maxEntries: number): Promise<ScanResult>;
  listNames(path: string): Promise<string[]>;
  stat(path: string): Promise<FileStat>;
  readBase64(path: string): Promise<string>;
  writeBase64Atomic(path: string, data: string, keepBackup: boolean): Promise<boolean>;
  writeText(path: string, text: string): Promise<boolean>;
  mkdirs(path: string): Promise<boolean>;
  remove(path: string): Promise<boolean>;
  rename(from: string, to: string): Promise<boolean>;
  freeBytes(path: string): Promise<number>;
  imageThumb(src: string, dst: string, maxSize: number, quality: number): Promise<boolean>;
  videoDuration(src: string): Promise<number>;
  videoThumb(
    src: string,
    dst: string,
    atMs: number,
    maxSize: number,
    quality: number,
  ): Promise<boolean>;
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
