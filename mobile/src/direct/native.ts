import * as FileSystem from 'expo-file-system/legacy';
import base64js from 'base64-js';
import { drive, isDriveModuleAvailable, type DriveVolume } from 'ocd-drive';

import { parseCatalog, type Catalog } from './catalog';
import { catalogEntryToItem, itemFromRel, type DirectItem } from './drive';
import { thumbName } from './hash';

export { isDriveModuleAvailable };
export type { DriveVolume };

/** Preview size and quality, matching the engine's 400px JPEGs. */
export const THUMB_SIZE = 400;
const THUMB_QUALITY = 82;
/** A JPEG smaller than this is almost certainly a black frame. */
const BLACK_FRAME_BYTES = 3000;

export function accessGranted(): boolean {
  return isDriveModuleAvailable && drive().hasAllFilesAccess();
}

export function requestAccess(): void {
  if (isDriveModuleAvailable) drive().requestAllFilesAccess();
}

/**
 * Removable volumes that are actually mounted. The primary volume is excluded:
 * it is the phone's own storage, not a drive the user plugged in.
 */
export async function removableDrives(): Promise<DriveVolume[]> {
  if (!isDriveModuleAvailable) return [];
  try {
    const volumes = await drive().listVolumes();
    return volumes.filter(
      (v) => v.removable && !v.primary && v.state === 'mounted' && !!v.path && v.writable,
    );
  } catch {
    return [];
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

export function thumbDir(root: string): string {
  return ocdDir(root) + '/thumbs';
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
    await drive().writeText(
      ocdDir(root) + '/volume.json',
      JSON.stringify({ id, created: new Date().toISOString() }, null, 2),
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

export async function readCatalog(root: string): Promise<Catalog | null> {
  try {
    const b64 = await drive().readBase64(catalogPath(root));
    return parseCatalog(base64js.toByteArray(b64));
  } catch {
    return null;
  }
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
 * previous catalog kept as .bak. Only call this once the new snapshot is
 * complete in memory; a half-built catalog must never reach the drive.
 */
export async function writeCatalog(root: string, bytes: Uint8Array): Promise<boolean> {
  await drive().mkdirs(ocdDir(root));
  return drive().writeBase64Atomic(catalogPath(root), base64js.fromByteArray(bytes), true);
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
 * Builds one preview on the drive if it is missing. Videos are grabbed at a
 * quarter of the duration first: a video that opens on black is common, and a
 * black frame is worse than no tile at all.
 */
export async function ensureThumb(
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
