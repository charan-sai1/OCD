import { gunzipSync } from 'fflate';
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

export function normSlashes(s: string): string {
  return s.replace(/\\/g, '/').replace(/\/+/g, '/');
}

export function splitRel(rel: string): string[] {
  return normSlashes(rel).split('/').filter(Boolean);
}
