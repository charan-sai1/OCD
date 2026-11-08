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
};

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
        ? { p: e.p, s: e.size, m: e.m, k: e.k, w: e.w, h: e.h, d: e.d, t: e.t }
        : { p: e.p, s: e.s, m: e.m, k: e.k, w: e.w, h: e.h, d: e.d, t: e.t };
    byPath.set(entry.p, entry);
    order.push(entry.p);
  }
  for (const a of adds) {
    if (drop.has(a.p)) continue;
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
