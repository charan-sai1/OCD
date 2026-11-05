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
