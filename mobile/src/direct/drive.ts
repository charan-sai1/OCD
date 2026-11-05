import * as FileSystem from 'expo-file-system/legacy';

import { decodeBase64, parseCatalog, type Catalog, type CatalogEntry } from './catalog';
import { thumbName } from './hash';

export { Catalog, CatalogEntry };

export type DirectItem = {
  key: string;
  name: string;
  dir: string;
  rel: string;
  kind: string;
  w: number;
  h: number;
  shot: number;
  size: number;
  dur?: number;
  v: number;
};

const KEY = FileSystem.documentDirectory + 'ocd-direct-drive.json';

export type StoredDrive = { treeUri: string; label: string };

type DriveCache = {
  // Every directory listing we have seen, keyed by its SAF URI. A listing of a
  // file fails, so entries only ever hold directories.
  lists: Map<string, string[]>;
  // Preview file name (thumbs/<hash>.jpg) -> its URI on the drive.
  thumbs: Map<string, string>;
  // Original volume-relative path -> its URI, once looked up.
  uris: Map<string, string>;
};

let cache: (DriveCache & { treeUri: string }) | null = null;

function newCache(treeUri: string): DriveCache & { treeUri: string } {
  return { treeUri, lists: new Map(), thumbs: new Map(), uris: new Map() };
}

function cacheFor(treeUri: string): DriveCache & { treeUri: string } {
  if (!cache || cache.treeUri !== treeUri) cache = newCache(treeUri);
  return cache;
}

function lastName(uri: string): string {
  let decoded = uri;
  try {
    decoded = decodeURIComponent(uri);
  } catch {
    // Keep the raw segments when the provider hands us malformed text.
  }
  const idx = decoded.lastIndexOf('/');
  return idx >= 0 ? decoded.slice(idx + 1) : decoded;
}

export function normalizeSlashes(s: string): string {
  return s
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '');
}

/** decodeURIComponent is lossy on broken text; keep the raw segment when it fails. */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * listDir returns the children of a directory URI, or null when the URI is not
 * a readable directory. SAF has no stat call, so a failed listing is how a file
 * is told apart from a folder. Results are cached for the lifetime of a drive
 * because a phone cannot afford to re-walk 25,000 entries while scrolling.
 */
async function listDir(treeUri: string, dirUri: string): Promise<string[] | null> {
  const c = cacheFor(treeUri);
  const known = c.lists.get(dirUri);
  if (known) return known;
  let out: string[];
  try {
    out = await FileSystem.StorageAccessFramework.readDirectoryAsync(dirUri);
  } catch {
    // Do not cache a failure: a drive that was unplugged at this instant must
    // still be readable after the user plugs it back in and pulls to refresh.
    return null;
  }
  c.lists.set(dirUri, out);
  return out;
}

async function childUri(
  treeUri: string,
  parentUri: string,
  name: string,
): Promise<string | undefined> {
  const children = await listDir(treeUri, parentUri);
  if (!children) return undefined;
  return children.find((c) => safeDecode(lastName(c)) === name);
}

function isMedia(rel: string): boolean {
  const ext = rel.slice(rel.lastIndexOf('.')).toLowerCase();
  return MEDIA_EXT.has(ext);
}

async function loadThumbs(treeUri: string, thumbsDir: string): Promise<void> {
  const c = cacheFor(treeUri);
  const files = await listDir(treeUri, thumbsDir);
  if (!files) return;
  for (const f of files) {
    const name = safeDecode(lastName(f));
    if (name.toLowerCase().endsWith('.jpg')) c.thumbs.set(name, f);
  }
}

/**
 * findCatalog looks for <drive>/.ocd/catalog.gz without walking the whole
 * drive. A managed drive answers in two listings, so the grid opens at once.
 */
async function findCatalog(
  treeUri: string,
): Promise<{ catalogUri: string; thumbsDir?: string } | null> {
  const root = await listDir(treeUri, treeUri);
  if (!root) return null;
  const ocdUri = root.find((c) => safeDecode(lastName(c)).toLowerCase() === '.ocd');
  if (!ocdUri) return null;
  const ocd = await listDir(treeUri, ocdUri);
  if (!ocd) return null;
  const catalogUri = ocd.find((c) => safeDecode(lastName(c)).toLowerCase() === 'catalog.gz');
  if (!catalogUri) return null;
  const thumbsDir = ocd.find((c) => safeDecode(lastName(c)).toLowerCase() === 'thumbs');
  return { catalogUri, thumbsDir };
}

/**
 * walkTree is the fallback for a drive OCD has never indexed. It builds
 * rel -> uri for every file, so the grid can list whatever media is present.
 */
async function walkTree(
  treeUri: string,
  onProgress?: (done: number) => void,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const queue: { uri: string; rel: string }[] = [{ uri: treeUri, rel: '' }];
  let done = 0;

  while (queue.length) {
    const { uri, rel } = queue.shift()!;
    const children = await listDir(treeUri, uri);
    if (!children) continue;
    done += 1;
    if (done % 25 === 0) onProgress?.(done);

    for (const child of children) {
      const name = safeDecode(lastName(child));
      if (!name || name === '.' || name === '..') continue;
      const childRel = rel ? rel + '/' + name : name;
      const sub = await listDir(treeUri, child);
      if (sub) {
        queue.push({ uri: child, rel: childRel });
      } else {
        map.set(childRel, child);
      }
    }
  }

  onProgress?.(done);
  return map;
}

/** Drops everything read from the drive, e.g. after it is unplugged. */
export async function forgetWalk(): Promise<void> {
  cache = null;
}

export async function pickDrive(): Promise<StoredDrive | null> {
  const res = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!res.granted) return null;
  const stored: StoredDrive = { treeUri: res.directoryUri, label: lastName(res.directoryUri) };
  await FileSystem.writeAsStringAsync(KEY, JSON.stringify(stored), { encoding: 'utf8' });
  cache = null;
  return stored;
}

export async function storedDrive(): Promise<StoredDrive | null> {
  try {
    const b = await FileSystem.readAsStringAsync(KEY, { encoding: 'utf8' });
    const parsed = JSON.parse(b) as StoredDrive;
    if (parsed && typeof parsed.treeUri === 'string') return parsed;
  } catch {
    // First run or a cleared store.
  }
  return null;
}

export async function clearDrive(): Promise<void> {
  try {
    await FileSystem.deleteAsync(KEY, { idempotent: true });
  } catch {
    // Nothing to forget.
  }
  cache = null;
}

export async function loadDrive(
  treeUri: string,
  onProgress?: (done: number) => void,
): Promise<{ items: DirectItem[]; catalog: Catalog; hadThumbs: boolean }> {
  cacheFor(treeUri);
  if ((await listDir(treeUri, treeUri)) === null) {
    throw new Error(
      'Could not read the drive. Plug it back in, then pull down to refresh — or choose it again.',
    );
  }

  // Fast path: the catalog and its previews travel with an indexed drive.
  const found = await findCatalog(treeUri);
  if (found) {
    try {
      const b64 = await FileSystem.readAsStringAsync(found.catalogUri, { encoding: 'base64' });
      const catalog = parseCatalog(decodeBase64(b64));
      if (found.thumbsDir) await loadThumbs(treeUri, found.thumbsDir);
      const items = catalog.entries.map(catalogEntryToItem);
      return { items, catalog, hadThumbs: cacheFor(treeUri).thumbs.size > 0 };
    } catch {
      // A damaged catalog still leaves a usable drive: fall through and list
      // the media found on it instead of failing outright.
    }
  }

  // Drive was never indexed on a computer: show whatever media the walk found.
  // Sizes, dates and previews arrive only after it is indexed on a PC.
  const map = await walkTree(treeUri, onProgress);
  const items: DirectItem[] = [];
  for (const rel of map.keys()) {
    if (rel.split('/')[0] === '.ocd') continue; // preview files are machinery
    if (!isMedia(rel)) continue;
    items.push(itemFromRel(rel));
  }
  items.sort((a, b) => a.key.localeCompare(b.key));
  return {
    items,
    catalog: {
      header: {
        format: 'ocd-catalog',
        version: 1,
        volumeId: '',
        label: '',
        indexVersion: 0,
        generated: '',
        count: items.length,
      },
      entries: [],
    },
    hadThumbs: cacheFor(treeUri).thumbs.size > 0,
  };
}

/**
 * originalUriFor resolves a volume-relative path to the file's SAF URI, one
 * folder at a time. Nothing is walked ahead of time, so opening one photo or
 * video costs a handful of listings even on an enormous drive.
 */
export async function originalUriFor(
  item: DirectItem,
  treeUri?: string,
): Promise<string | undefined> {
  if (!treeUri) return undefined;
  const c = cacheFor(treeUri);
  const hit = c.uris.get(item.rel);
  if (hit) return hit;

  const segments = normalizeSlashes(item.rel).split('/').filter(Boolean);
  let uri = treeUri;
  for (const segment of segments) {
    const next = await childUri(treeUri, uri, segment);
    if (!next) return undefined;
    uri = next;
  }
  c.uris.set(item.rel, uri);
  return uri;
}

export function thumbUriFor(
  item: DirectItem,
  catalog: Catalog,
  treeUri: string,
): string | undefined {
  if (cache?.treeUri !== treeUri) return undefined;
  const key = thumbName(catalog.header.volumeId, item.rel, item.size, item.v);
  return cache.thumbs.get(key);
}

export function itemFromRel(rel: string, size = 0, mtime = 0): DirectItem {
  const base = rel.slice(rel.lastIndexOf('/') + 1);
  const ext = rel.slice(rel.lastIndexOf('.')).toLowerCase();
  return {
    key: rel,
    name: base,
    dir: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '',
    rel,
    kind: VIDEO_EXT.has(ext) ? 'video' : 'image',
    w: 0,
    h: 0,
    shot: 0,
    size,
    dur: undefined,
    v: mtime,
  };
}

export function catalogEntryToItem(e: CatalogEntry): DirectItem {
  const rel = normalizeSlashes(e.p);
  const base = rel.slice(rel.lastIndexOf('/') + 1);
  return {
    key: rel,
    name: base,
    dir: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '',
    rel,
    kind: e.k === 'video' ? 'video' : 'image',
    w: e.w ?? 0,
    h: e.h ?? 0,
    shot: e.t ?? 0,
    size: e.size,
    dur: e.d,
    v: e.m ?? 0,
  };
}

export const VIDEO_EXT = new Set([
  '.mp4', '.m4v', '.mov', '.avi', '.mkv', '.webm', '.3gp', '.mts', '.m2ts',
]);

export const MEDIA_EXT = new Set([
  ...VIDEO_EXT,
  '.jpg', '.jpeg', '.png', '.gif', '.heic', '.heif', '.hif', '.webp', '.bmp',
  '.tif', '.tiff', '.avif', '.dng', '.cr2', '.nef', '.arw', '.raf',
]);
