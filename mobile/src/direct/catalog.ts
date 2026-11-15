import { Gzip, gunzipSync, strToU8 } from 'fflate';
import base64js from 'base64-js';

export type CatalogHeader = {
  format: string;
  version: number;
  volumeId: string;
  label?: string;
  indexVersion?: number;
  generated: string;
  count: number;
};

export type CatalogEntry = {
  p: string; // volume-relative path, slashes
  size: number;
  m: number; // mtime
  t?: number; // shot
  k?: string; // kind
  w?: number;
  h?: number;
  d?: number; // duration
  live?: string;
  hash?: string;
  make?: string;
  model?: string;
  iso?: number;
  fnumber?: number;
  exposure?: number; // seconds
  focal?: number; // mm
  lat?: number;
  lon?: number;
  gps?: boolean;
  orient?: number;
};

export type Catalog = {
  header: CatalogHeader;
  entries: CatalogEntry[];
};

/** decodeBase64 turns the base64 the reader API hands back into bytes. */
export function decodeBase64(data: string): Uint8Array {
  return base64js.toByteArray(data);
}

/**
 * parseCatalog decodes the drive's catalog.gz. The encoder writes the header
 * as the first JSON line and one entry per following line, all gzipped.
 */
export function parseCatalog(bytes: Uint8Array): Catalog {
  let json: Uint8Array;
  try {
    json = gunzipSync(bytes);
  } catch {
    throw new Error('Could not read the drive catalog — the file may be damaged.');
  }
  const text = new TextDecoder().decode(json);
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].trim()) lines.splice(i, 1);
  }
  if (!lines.length) throw new Error('The drive catalog is empty.');

  let header: CatalogHeader;
  try {
    header = JSON.parse(lines[0]);
  } catch {
    throw new Error('The drive catalog is not in the OCD format.');
  }
  if (header.format !== 'ocd-catalog') {
    throw new Error('This drive does not hold an OCD catalog yet — index it on your computer first.');
  }

  // The header line is followed by one entry per line. Decode in a single pass
  // and tolerate a torn tail line rather than failing the whole catalogue.
  const entries: CatalogEntry[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const e = JSON.parse(line) as {
        path: string;
        size: number;
        mtime: number;
        shot?: number;
        kind?: string;
        width?: number;
        height?: number;
        duration?: number;
        live?: string;
        hash?: string;
        make?: string;
        model?: string;
        iso?: number;
        fnumber?: number;
        exposure?: number;
        focal?: number;
        lat?: number;
        lon?: number;
        gps?: boolean;
        orient?: number;
      };
      if (!e.path) continue;
      entries.push({
        p: e.path,
        size: e.size ?? 0,
        m: e.mtime ?? 0,
        t: e.shot,
        k: e.kind,
        w: e.width,
        h: e.height,
        d: e.duration,
        live: e.live,
        hash: e.hash,
        make: e.make,
        model: e.model,
        iso: e.iso,
        fnumber: e.fnumber,
        exposure: e.exposure,
        focal: e.focal,
        lat: e.lat,
        lon: e.lon,
        gps: e.gps,
        orient: e.orient,
      });
    } catch {
      // A half-written final line must not cost a 25,000-item catalogue.
      break;
    }
  }
  return { header, entries };
}

export const DIRS = ['.ocd', 'thumbs'] as const;
export const FILE_CATALOG = 'catalog.gz';

/** Capture facts the platform's media database already knows about a file. */
export type MediaMeta = {
  p: string;
  t?: number; // shot, Unix seconds
  w?: number;
  h?: number;
  d?: number; // duration, seconds
};

/** One file the phone is about to write into a catalog. */
export type CatalogWriteEntry = {
  p: string;
  s: number;
  m: number;
  k?: string;
  w?: number;
  h?: number;
  d?: number;
  t?: number;
  live?: string;
  hash?: string;
  make?: string;
  model?: string;
  iso?: number;
  fnumber?: number;
  exposure?: number;
  focal?: number;
  lat?: number;
  lon?: number;
  gps?: boolean;
  orient?: number;
};

/** Fields that describe the file's content rather than its place on the drive. */
const CONTENT_KEYS = [
  'live',
  'hash',
  'make',
  'model',
  'iso',
  'fnumber',
  'exposure',
  'focal',
  'lat',
  'lon',
  'gps',
  'orient',
] as const;

/**
 * contentFields copies the optional content metadata from an entry. A phone
 * rewrite only refreshes path, size and mtime; everything the computer or the
 * phone worked out about the bytes has to travel through untouched, or the next
 * catalog write would erase hashes, Live pairs, camera details and GPS.
 */
function contentFields(
  e: CatalogEntry | CatalogWriteEntry,
): Partial<CatalogWriteEntry> {
  const out: Partial<CatalogWriteEntry> = {};
  const src = e as Record<string, unknown>;
  for (const key of CONTENT_KEYS) {
    const v = src[key];
    if (v !== undefined && v !== null && v !== '') {
      (out as Record<string, unknown>)[key] = v;
    }
  }
  return out;
}

/**
 * buildCatalogEntries merges three sources for one file, in authority order:
 * the catalog already on the drive (when the file is unchanged), then the
 * platform's media database, then nothing at all. The scan refreshes only
 * path, size, mtime and kind, so a phone re-index can never strip dates and
 * dimensions a computer already worked out.
 */
export function buildCatalogEntries(
  scan: { p: string; s: number; m: number; k?: string }[],
  meta: Map<string, MediaMeta>,
  previous: CatalogEntry[] = [],
): CatalogWriteEntry[] {
  const prev = new Map<string, CatalogEntry>();
  for (const e of previous) prev.set(e.p, e);

  const out: CatalogWriteEntry[] = [];
  for (const f of scan) {
    const old = prev.get(f.p);
    const unchanged = !!old && old.size === f.s && old.m === f.m;
    // FAT is case-insensitive, and MediaStore may report a different case than
    // the directory walk, so the lookup is lowercased.
    const m = meta.get(f.p.toLowerCase());

    const entry: CatalogWriteEntry = { p: f.p, s: f.s, m: f.m, k: f.k };
    const shot = (unchanged && old ? old.t : undefined) ?? m?.t;
    if (shot) entry.t = shot;
    const w = (unchanged && old ? old.w : undefined) ?? m?.w;
    if (w) entry.w = w;
    const h = (unchanged && old ? old.h : undefined) ?? m?.h;
    if (h) entry.h = h;
    const d = (unchanged && old ? old.d : undefined) ?? m?.d;
    if (d) entry.d = d;
    // Unchanged bytes keep what an earlier writer learned about them. A file
    // whose size or mtime moved is a different file until proven otherwise.
    if (unchanged && old) Object.assign(entry, contentFields(old));
    out.push(entry);
  }
  return out;
}

/**
 * mergeCatalogEntries applies an organise run to the catalog already on the
 * drive instead of rebuilding it. Existing entries keep their dates, sizes and
 * dimensions; only the paths an action touched change. Order is preserved so a
 * re-written catalog stays stable for the PC.
 */
export function mergeCatalogEntries(
  previous: readonly (CatalogEntry | CatalogWriteEntry)[],
  adds: CatalogWriteEntry[],
  removes: Iterable<string> = [],
): CatalogWriteEntry[] {
  const drop = new Set(removes);
  const byPath = new Map<string, CatalogWriteEntry>();
  const order: string[] = [];

  for (const e of previous) {
    if (drop.has(e.p)) continue;
    // A written entry (already short keys) and a catalog entry (long keys) are
    // both accepted so a merge can start from either side of a re-index.
    const entry: CatalogWriteEntry =
      'size' in e
        ? {
            p: e.p,
            s: e.size,
            m: e.m,
            k: e.k,
            w: e.w,
            h: e.h,
            d: e.d,
            t: e.t,
            ...contentFields(e),
          }
        : { ...e };
    byPath.set(entry.p, entry);
    order.push(entry.p);
  }
  for (const a of adds) {
    // Removals only describe entries that were already in the catalog. An
    // addition may legitimately reuse a removed path: quarantine moves the old
    // drive copy aside, then the phone copy lands at that exact path. Dropping
    // the addition here would leave the new file out of the catalog until the
    // next full index.
    if (!byPath.has(a.p)) order.push(a.p);
    byPath.set(a.p, a);
  }
  return order.map((p) => byPath.get(p)!);
}

/**
 * encodeCatalog produces the same bytes the Go writer produces: one gzipped
 * JSON object per line, header first, with the engine's long field names. The
 * phone never invents a schema — it writes what the engine already reads.
 */
export function encodeCatalog(
  header: Omit<CatalogHeader, 'count'>,
  entries: CatalogWriteEntry[],
): Uint8Array {
  const h: Record<string, unknown> = {
    format: 'ocd-catalog',
    version: 1,
    volumeId: header.volumeId,
    generated: header.generated,
    count: entries.length,
  };
  if (header.label) h.label = header.label;
  if (header.indexVersion) h.indexVersion = header.indexVersion;

  // Streamed rather than joined: a 40,000-item catalog is several megabytes of
  // text and holding it twice can push a phone into swapping. Level 1 matches
  // the engine's gzip.BestSpeed — the catalog is read far more than written.
  const chunks: Uint8Array[] = [];
  const gz = new Gzip({ level: 1 }, (chunk) => {
    chunks.push(chunk);
  });

  gz.push(strToU8(JSON.stringify(h) + '\n'), false);
  for (const e of entries) {
    const o: Record<string, unknown> = { path: e.p, size: e.s, mtime: e.m };
    if (e.k) o.kind = e.k;
    if (e.w) o.width = e.w;
    if (e.h) o.height = e.h;
    if (e.d) o.duration = e.d;
    if (e.t) o.shot = e.t;
    if (e.orient) o.orient = e.orient;
    if (e.live) o.live = e.live;
    if (e.hash) o.hash = e.hash;
    if (e.make) o.make = e.make;
    if (e.model) o.model = e.model;
    if (e.iso) o.iso = e.iso;
    if (e.fnumber) o.fnumber = e.fnumber;
    if (e.exposure) o.exposure = e.exposure;
    if (e.focal) o.focal = e.focal;
    // A position at 0,0 is real, so the presence flag decides, not the value.
    if (e.gps) {
      o.lat = e.lat ?? 0;
      o.lon = e.lon ?? 0;
      o.gps = true;
    }
    gz.push(strToU8(JSON.stringify(o) + '\n'), false);
  }
  gz.push(new Uint8Array(0), true);

  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

export function normSlashes(s: string): string {
  return s.replace(/\\/g, '/').replace(/\/+/g, '/');
}

export function splitRel(rel: string): string[] {
  return normSlashes(rel).split('/').filter(Boolean);
}
