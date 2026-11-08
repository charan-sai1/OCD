import * as FileSystem from 'expo-file-system/legacy';
import base64js from 'base64-js';
import { strToU8 } from 'fflate';
import { PermissionsAndroid, Platform } from 'react-native';
import { drive, isDriveModuleAvailable, type CopyResult, type DriveVolume } from 'ocd-drive';

import { parseCatalog, type Catalog, type MediaMeta } from './catalog';
import { catalogEntryToItem, itemFromRel, type DirectItem } from './drive';
import { thumbName } from './hash';

export { isDriveModuleAvailable };
export type { CopyResult, DriveVolume };

/** Before Android 11 the drive is reachable with ordinary storage permission. */
const LEGACY_STORAGE =
  Platform.OS === 'android' && Number(Platform.Version) < 30;

/** Preview size and quality, matching the engine's 400px JPEGs. */
export const THUMB_SIZE = 400;
const THUMB_QUALITY = 82;
/** A JPEG smaller than this is almost certainly a black frame. */
const BLACK_FRAME_BYTES = 3000;

export function accessGranted(): boolean {
  if (!isDriveModuleAvailable) return false;
  // Below Android 11 the module's all-files check is meaningless: access comes
  // from the ordinary storage permission instead.
  if (LEGACY_STORAGE) return true;
  return drive().hasAllFilesAccess();
}

export function requestAccess(): void {
  if (!isDriveModuleAvailable || LEGACY_STORAGE) return;
  drive().requestAllFilesAccess();
}

/**
 * Asks for whatever this Android version needs, and reports whether the drive
 * is usable right now. On Android 11+ the first call opens system settings and
 * returns false; the caller waits for the app to come back to the foreground.
 */
export async function ensureAccess(): Promise<boolean> {
  if (!isDriveModuleAvailable) return false;
  if (LEGACY_STORAGE) {
    const result = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
      PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
    ]);
    return Object.values(result).every(
      (state) => state === PermissionsAndroid.RESULTS.GRANTED,
    );
  }
  if (accessGranted()) return true;
  requestAccess();
  return false;
}

/**
 * A volume Android has mounted and given a real filesystem path. The primary
 * volume is excluded: it is the phone's own storage, not a drive the user
 * plugged in. Read-only mounts are included so they can still be browsed;
 * only indexing is refused.
 */
function usableVolume(v: DriveVolume): boolean {
  if (v.primary || !v.path) return false;
  if (v.path.includes('/emulated')) return false;
  if (v.state !== 'mounted' && v.state !== 'mounted_ro') return false;
  // Most USB drives report isRemovable, but some OTG bridges do not. A volume
  // mounted under /storage or /mnt/media_rw is still a real disk, never the
  // phone's own storage (already excluded above).
  return v.removable || /^\/(storage|mnt\/media_rw)\/[^/]+$/i.test(v.path);
}

/** A disk-like volume the platform knows about but has not mounted. */
function unmountedVolume(v: DriveVolume): boolean {
  if (v.primary) return false;
  if (v.state === 'mounted' || v.state === 'mounted_ro') return false;
  return v.removable || !!v.uuid;
}

export type DriveVolumeReport = {
  /** Mounted volumes the app can actually read. */
  usable: DriveVolume[];
  /** Volumes Android knows about but has not given a mount point. */
  unmounted: DriveVolume[];
};

/**
 * Lists volumes in two groups. Android mounts the partitions of one disk
 * independently, so a disk can be plugged in while only its first partition is
 * readable. Separating the groups lets the screen say that plainly instead of
 * looking as if the second partition does not exist.
 */
export async function driveVolumes(): Promise<DriveVolumeReport> {
  if (!isDriveModuleAvailable) return { usable: [], unmounted: [] };
  try {
    const volumes = await drive().listVolumes();
    return {
      usable: volumes.filter(usableVolume),
      unmounted: volumes.filter(unmountedVolume),
    };
  } catch {
    return { usable: [], unmounted: [] };
  }
}

export async function removableDrives(): Promise<DriveVolume[]> {
  return (await driveVolumes()).usable;
}

type VolumeListener = { remove(): void };

/**
 * Native mount/unmount notifications. A drive that finishes mounting after the
 * screen is already open would otherwise stay invisible until the app is
 * restarted. The screen also polls as a fallback for platforms where this
 * event never arrives.
 */
export function watchVolumes(listener: () => void): VolumeListener {
  if (!isDriveModuleAvailable) return { remove() {} };
  const emitter = drive() as unknown as {
    addListener?: (name: string, cb: (event: unknown) => void) => VolumeListener;
  };
  if (typeof emitter.addListener !== 'function') return { remove() {} };
  try {
    return emitter.addListener('onVolumeChange', (_event: unknown) => listener());
  } catch {
    return { remove() {} };
  }
}

export function fileUri(path: string): string {
  return path.startsWith('file://') ? path : 'file://' + path;
}

export function ocdDir(root: string): string {
  return root.replace(/\/+$/, '') + '/.ocd';
}

export function catalogPath(root: string): string {
  return ocdDir(root) + '/catalog.gz';
}

/** The previous catalog, kept by the atomic writer. */
export function backupCatalogPath(root: string): string {
  return ocdDir(root) + '/catalog.bak';
}

export function thumbDir(root: string): string {
  return ocdDir(root) + '/thumbs';
}

/** Files copied from the phone are staged here before their final rename. */
export function incomingDir(root: string): string {
  return root.replace(/\/+$/, '') + '/.ocd-incoming';
}

/** Where the phone moves redundant drive files. Never part of the gallery. */
export function duplicatesDir(root: string): string {
  return root.replace(/\/+$/, '') + '/_OCD Duplicates';
}

/** Append-only record of every organise action the phone performed. */
export function auditPath(root: string): string {
  return ocdDir(root) + '/audit.jsonl';
}

/** Joins a volume-relative path onto the mount point, with slashes. */
export function absolutePath(root: string, rel: string): string {
  return root.replace(/\/+$/, '') + '/' + rel.replace(/^\/+/, '');
}

/** Turns `file:///storage/...` into the real path a native call expects. */
export function localPath(uri: string): string {
  if (!uri.startsWith('file://')) return uri;
  try {
    return decodeURIComponent(uri.slice(7));
  } catch {
    return uri.slice(7);
  }
}

/**
 * Derives the same identity the engine uses on Windows. Android reports the
 * USB volume's FAT serial as the volume uuid ("6EC7-679B"); Windows reports
 * the same 32-bit serial as "6EC7679B", so one prefix on both sides keeps a
 * single catalog and a single set of preview names.
 */
export function serialVolumeId(v: DriveVolume): string {
  const hex = (v.uuid || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  return /^[0-9A-F]{8}$/.test(hex) ? 'win:' + hex : '';
}

/**
 * A name to show for a drive. Android falls back to the raw serial as the
 * description when a volume has no label, which reads like an error code.
 */
export function volumeName(v: DriveVolume): string {
  const label = (v.label || '').trim();
  if (!label) return 'USB drive';
  const bare = label.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  const serial = (v.uuid || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  return serial && bare === serial ? 'USB drive' : label;
}

function randomHex16(): string {
  let out = '';
  for (let i = 0; i < 16; i += 1) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

async function readVolumeId(root: string): Promise<string> {
  try {
    const b64 = await drive().readBase64(ocdDir(root) + '/volume.json');
    const parsed = JSON.parse(new TextDecoder().decode(base64js.toByteArray(b64))) as {
      id?: string;
    };
    if (parsed && typeof parsed.id === 'string' && /^vol_[0-9a-f]{16}$/.test(parsed.id)) {
      return parsed.id;
    }
  } catch {
    // No identity file yet.
  }
  return '';
}

/**
 * Volume identity for a native drive, preferring the serial the PC already
 * uses, then whatever identity the drive carries, and only then creating one.
 * Creating one is the last resort: it must never give a drive a second name.
 */
export async function driveId(root: string, v: DriveVolume): Promise<string> {
  const serial = serialVolumeId(v);
  if (serial) return serial;

  const existing = await readVolumeId(root);
  if (existing) return existing;

  const id = 'vol_' + randomHex16();
  try {
    await drive().mkdirs(ocdDir(root));
    // Same atomic write as the catalog: a torn identity file would hand the
    // drive a new name on the next launch and orphan its previews.
    const bytes = strToU8(JSON.stringify({ id, created: new Date().toISOString() }, null, 2));
    await drive().writeBase64Atomic(
      ocdDir(root) + '/volume.json',
      base64js.fromByteArray(bytes),
      false,
    );
  } catch {
    // A read-only drive keeps the id for this session only.
  }
  return id;
}

export type ScanEntry = { p: string; s: number; m: number; k: string };

/**
 * Walks the drive natively and returns real sizes and mtimes. The native side
 * writes the entries to a cache file so tens of thousands of them never have
 * to cross the bridge as objects.
 */
export async function scanVolume(
  root: string,
  maxEntries = 500000,
): Promise<{ entries: ScanEntry[]; truncated: boolean }> {
  const res = await drive().scan(root, maxEntries);
  try {
    const text = await FileSystem.readAsStringAsync(fileUri(res.path), { encoding: 'utf8' });
    const entries: ScanEntry[] = [];
    for (const line of text.split('\n')) {
      if (!line) continue;
      try {
        const o = JSON.parse(line) as { p?: string; s?: number; m?: number; k?: string };
        if (o && typeof o.p === 'string' && o.p) {
          entries.push({
            p: o.p,
            s: o.s ?? 0,
            m: o.m ?? 0,
            k: o.k === 'video' ? 'video' : 'image',
          });
        }
      } catch {
        // A torn final line must not cost the whole scan.
      }
    }
    return { entries, truncated: res.truncated };
  } finally {
    await FileSystem.deleteAsync(fileUri(res.path), { idempotent: true }).catch(() => {});
  }
}

export type CatalogSource = 'current' | 'backup';

export type CatalogRead = {
  catalog: Catalog;
  /** Which file answered. "backup" means the primary is damaged. */
  source: CatalogSource;
};

/**
 * Capture metadata for a volume from the platform's media database. One query,
 * no per-file reads. A file the platform has not indexed is simply absent from
 * the map, and the caller falls back to the file's own mtime.
 */
export async function readMediaMetadata(root: string): Promise<Map<string, MediaMeta>> {
  const out = new Map<string, MediaMeta>();
  try {
    const res = await drive().mediaMetadata(root);
    try {
      const text = await FileSystem.readAsStringAsync(fileUri(res.path), { encoding: 'utf8' });
      for (const line of text.split('\n')) {
        if (!line) continue;
        try {
          const o = JSON.parse(line) as MediaMeta;
          if (o && typeof o.p === 'string' && o.p) {
            // Keyed lowercased: FAT is case-insensitive and MediaStore may
            // report a different case than the directory walk.
            out.set(o.p.toLowerCase(), o);
          }
        } catch {
          // A torn final line must not cost the whole metadata set.
        }
      }
    } finally {
      await FileSystem.deleteAsync(fileUri(res.path), { idempotent: true }).catch(() => {});
    }
  } catch {
    // No media database access: dates fall back to mtime, as before.
  }
  return out;
}

/**
 * Reads the catalog, falling back to the backup the way the engine does. A
 * damaged primary on a drive that still has a good previous copy must not look
 * like "this drive was never indexed".
 */
export async function readCatalogWithSource(root: string): Promise<CatalogRead | null> {
  const candidates: [string, CatalogSource][] = [
    [catalogPath(root), 'current'],
    [backupCatalogPath(root), 'backup'],
  ];
  for (const [path, source] of candidates) {
    try {
      const b64 = await drive().readBase64(path);
      return { catalog: parseCatalog(base64js.toByteArray(b64)), source };
    } catch {
      // Missing or damaged: try the next copy.
    }
  }
  return null;
}

export async function readCatalog(root: string): Promise<Catalog | null> {
  return (await readCatalogWithSource(root))?.catalog ?? null;
}

export async function catalogExists(root: string): Promise<boolean> {
  try {
    return (await drive().stat(catalogPath(root))).exists;
  } catch {
    return false;
  }
}

/**
 * Writes the catalog the way the engine does: temp file, fsync, rename, and the
 * previous catalog kept as .bak. The current file is only promoted to backup
 * when it still parses — rotating a damaged file over the last good copy would
 * destroy the backup at exactly the moment it is needed.
 */
export async function writeCatalog(root: string, bytes: Uint8Array): Promise<boolean> {
  await drive().mkdirs(ocdDir(root));

  let keepBackup = false;
  try {
    const b64 = await drive().readBase64(catalogPath(root));
    parseCatalog(base64js.toByteArray(b64));
    keepBackup = true;
  } catch {
    // Absent (nothing to rotate) or damaged (must not rotate).
  }

  return drive().writeBase64Atomic(
    catalogPath(root),
    base64js.fromByteArray(bytes),
    keepBackup,
  );
}

/** Preview file names already on the drive, lowercased. */
export async function existingThumbs(root: string): Promise<Set<string>> {
  try {
    const names = await drive().listNames(thumbDir(root));
    return new Set(names.filter((n) => n.toLowerCase().endsWith('.jpg')).map((n) => n.toLowerCase()));
  } catch {
    return new Set();
  }
}

export function thumbPath(
  root: string,
  volumeId: string,
  rel: string,
  size: number,
  mtime: number,
): string {
  return thumbDir(root) + '/' + thumbName(volumeId, rel, size, mtime);
}

export type ThumbTarget = { p: string; s: number; m: number; k: string };

/**
 * The native module serves one request at a time, and a full-size decode can
 * take a while. Without a limit, a fast scroll queues hundreds of previews and
 * every list/stat/read behind them, which makes the drive feel frozen. A few
 * in flight keeps the grid filling without starving the rest.
 */
const MAX_PARALLEL_PREVIEWS = 3;
let previewsActive = 0;
const previewWaiters: (() => void)[] = [];

async function withPreviewSlot<T>(job: () => Promise<T>): Promise<T> {
  if (previewsActive >= MAX_PARALLEL_PREVIEWS) {
    await new Promise<void>((resolve) => previewWaiters.push(resolve));
  }
  previewsActive += 1;
  try {
    return await job();
  } finally {
    previewsActive -= 1;
    previewWaiters.shift()?.();
  }
}

/**
 * Builds one preview on the drive if it is missing. Videos are grabbed at a
 * quarter of the duration first: a video that opens on black is common, and a
 * black frame is worse than no tile at all.
 */
export async function ensureThumb(
  root: string,
  volumeId: string,
  entry: ThumbTarget,
): Promise<string | null> {
  return withPreviewSlot(() => buildThumb(root, volumeId, entry));
}

async function buildThumb(
  root: string,
  volumeId: string,
  entry: ThumbTarget,
): Promise<string | null> {
  const dst = thumbPath(root, volumeId, entry.p, entry.s, entry.m);
  try {
    if ((await drive().stat(dst)).exists) return dst;
  } catch {
    return null;
  }

  const src = root.replace(/\/+$/, '') + '/' + entry.p;
  await drive().mkdirs(thumbDir(root));

  if (entry.k === 'video') {
    const dur = await drive().videoDuration(src);
    const offsets = dur > 0 ? [0.25, 0.5, 0] : [0];
    for (const fraction of offsets) {
      const at = Math.max(0, Math.round(dur * fraction));
      if (!(await drive().videoThumb(src, dst, at, THUMB_SIZE, THUMB_QUALITY))) continue;
      if ((await drive().stat(dst)).size >= BLACK_FRAME_BYTES) return dst;
      await drive().remove(dst);
    }
    return null;
  }

  return (await drive().imageThumb(src, dst, THUMB_SIZE, THUMB_QUALITY)) ? dst : null;
}

export async function freeBytes(root: string): Promise<number> {
  try {
    return await drive().freeBytes(root);
  } catch {
    return 0;
  }
}

export async function statFile(path: string): Promise<{ exists: boolean; size: number; mtime: number; isDir: boolean }> {
  try {
    return await drive().stat(path);
  } catch {
    return { exists: false, size: 0, mtime: 0, isDir: false };
  }
}

/**
 * Sizes for a batch of paths, in the same order. Missing files come back as -1.
 * The camera-roll listing uses this instead of one bridge call per asset.
 */
export async function statSizes(paths: string[]): Promise<number[]> {
  if (!paths.length) return [];
  try {
    return await drive().statSizes(paths);
  } catch {
    return paths.map(() => -1);
  }
}

/**
 * Copies a phone asset onto the drive and verifies it by hashing the bytes on
 * both sides. The caller is responsible for choosing a destination that does
 * not exist: this never overwrites a file.
 */
export async function copyAndHash(
  src: string,
  dst: string,
  mtimeSeconds: number,
  verify = true,
): Promise<CopyResult> {
  try {
    return await drive().copyAndHash(src, dst, mtimeSeconds, verify);
  } catch (e) {
    return {
      ok: false,
      size: 0,
      sha256: '',
      error: e instanceof Error ? e.message : 'copy failed',
    };
  }
}

export async function hashFile(path: string): Promise<string> {
  try {
    return await drive().hashFile(path);
  } catch {
    return '';
  }
}

export async function setMtime(path: string, seconds: number): Promise<boolean> {
  try {
    return await drive().setMtime(path, seconds);
  } catch {
    return false;
  }
}

export async function appendText(path: string, text: string): Promise<boolean> {
  try {
    return await drive().appendText(path, text);
  } catch {
    return false;
  }
}

/** Keeps the screen awake while a long copy runs, then releases it. */
export function keepScreenOn(on: boolean): void {
  if (!isDriveModuleAvailable) return;
  try {
    drive().keepScreenOn(on);
  } catch {
    // The flag is a nicety; losing it must not fail a backup.
  }
}

export async function mkdirs(path: string): Promise<boolean> {
  try {
    return await drive().mkdirs(path);
  } catch {
    return false;
  }
}

export async function renameFile(from: string, to: string): Promise<boolean> {
  try {
    return await drive().rename(from, to);
  } catch {
    return false;
  }
}

/** Removes a scratch file the app itself created. Never used on originals. */
export async function removeFile(path: string): Promise<boolean> {
  try {
    return await drive().remove(path);
  } catch {
    return false;
  }
}

/** Turns a decoded catalog into the grid's items. */
export function itemsFromCatalog(catalog: Catalog): DirectItem[] {
  return catalog.entries.map(catalogEntryToItem);
}

/** Turns a native scan into the same items a catalog would have produced. */
export function itemsFromScan(entries: ScanEntry[]): DirectItem[] {
  const items = entries.map((e) => {
    const item = itemFromRel(e.p, e.s, e.m);
    item.kind = e.k;
    item.v = e.m;
    return item;
  });
  items.sort((a, b) => a.key.localeCompare(b.key));
  return items;
}

export function syntheticCatalog(volumeId: string, label: string, count: number): Catalog {
  return {
    header: {
      format: 'ocd-catalog',
      version: 1,
      volumeId,
      label,
      indexVersion: 0,
      generated: '',
      count,
    },
    entries: [],
  };
}
