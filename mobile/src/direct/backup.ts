import * as MediaLibrary from 'expo-media-library/legacy';

import {
  appendText,
  absolutePath,
  auditPath,
  copyAndHash,
  duplicatesDir,
  freeBytes,
  hashFile,
  incomingDir,
  keepScreenOn,
  localPath,
  mkdirs,
  readCatalog,
  readCatalogWithSource,
  readMediaMetadata,
  removeFile,
  renameFile,
  scanVolume,
  setMtime,
  statFile,
  statSizes,
  writeCatalog,
  type CopyResult,
  type ScanEntry,
} from './native';
import {
  buildCatalogEntries,
  encodeCatalog,
  mergeCatalogEntries,
  type CatalogWriteEntry,
} from './catalog';

/** A mounted drive the phone has opened. */
export type DriveContext = {
  root: string;
  volumeId: string;
  label: string;
};

export type BackupMedia = 'image' | 'video' | 'both';

export type BackupLayout = 'phone' | 'year' | 'flat';

/**
 * `skip` leaves the existing drive copy alone, `rename` keeps both with a
 * numbered name, and `quarantine` moves the older drive copy into the chosen
 * subfolder of `_OCD Duplicates/` before writing the phone copy into its dated
 * folder.
 */
export type DuplicatePolicy = 'skip' | 'rename' | 'quarantine';

export type BackupConditions = {
  media: BackupMedia;
  /** Album id from the phone; empty means the whole camera roll. */
  albumId: string;
  albumTitle: string;
  /** Unix seconds. Zero means no bound. */
  since: number;
  until: number;
  skipScreenshots: boolean;
  /** Ignore tiny files such as stickers and thumbnails. */
  minBytes: number;
  layout: BackupLayout;
  duplicates: DuplicatePolicy;
  /**
   * Subfolder under `_OCD Duplicates` for old copies moved aside by the
   * quarantine policy. Empty means the archive root itself. Stored raw so the
   * text field can be edited freely; normalise it before using it as a path.
   */
  duplicateFolder: string;
  updateCatalog: boolean;
};

export type BackupProgress = {
  phase: 'listing' | 'copying' | 'cataloguing' | 'done';
  index: number;
  total: number;
  name: string;
  bytes: number;
  copied: number;
  skipped: number;
  quarantined: number;
  failed: number;
};

export type BackupSummary = {
  copied: number;
  skipped: number;
  quarantined: number;
  failed: number;
  bytes: number;
  errors: string[];
  cancelled: boolean;
  /** True when the run stopped because the drive filled up. */
  halted: boolean;
  /** Drive-relative folder this run used for old copies. */
  quarantineFolder: string;
  catalogWritten: boolean;
  catalogCount: number;
};

export type AlbumChoice = { id: string; title: string; count: number };

export type TidyMove = {
  from: string;
  to: string;
  size: number;
  mtime: number;
  kind: string;
  hash: string;
};

export type TidyPlan = {
  moves: TidyMove[];
  groups: number;
  redundant: number;
  reclaimable: number;
  scanned: number;
  hashed: number;
  scan: ScanEntry[];
  cancelled: boolean;
};

export type TidyProgress = {
  phase: 'scanning' | 'hashing' | 'moving' | 'cataloguing' | 'done';
  done: number;
  total: number;
  name: string;
};

export type TidyResult = {
  moved: number;
  bytes: number;
  failed: number;
  errors: string[];
  cancelled: boolean;
  catalogWritten: boolean;
  catalogCount: number;
};

export type Cancellation = { cancelled: boolean };

const ASSET_PAGE = 250;
/** Keep this much room free beyond the file being copied. */
const FREE_HEADROOM = 64 * 1024 * 1024;
/** Flush audit rows in batches: every append fsyncs the drive. */
const AUDIT_BATCH = 20;
const TIDY_MIN_BYTES = 1024;

export const DEFAULT_CONDITIONS: BackupConditions = {
  media: 'both',
  albumId: '',
  albumTitle: '',
  since: 0,
  until: 0,
  skipScreenshots: true,
  minBytes: 0,
  layout: 'phone',
  duplicates: 'skip',
  duplicateFolder: '',
  updateCatalog: true,
};

/* ------------------------------------------------------------------ */
/* names and folders                                                   */
/* ------------------------------------------------------------------ */

export function isScreenshot(name: string): boolean {
  return /screen[-_ ]?shot/i.test(name);
}

function sanitiseName(name: string): string {
  const cleaned = (name || '')
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_')
    .replace(/[. ]+$/g, '')
    .replace(/^\.+/, '');
  return cleaned || 'file';
}

/**
 * The archive root. Every scanner on the phone and the PC skips this whole
 * tree, so a user-chosen destination stays underneath it instead of becoming
 * an ordinary folder that would reappear in the gallery.
 */
export const DUPLICATE_ARCHIVE = '_OCD Duplicates';
const DUPLICATE_FOLDER_DEPTH = 3;
const DUPLICATE_SEGMENT_MAX = 48;
const WINDOWS_RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

/**
 * Turns whatever the user typed into a safe path below the archive root.
 * Leading/trailing slashes, `..`, and a pasted `_OCD Duplicates/` prefix are
 * removed rather than rejected, so a typo never escapes the skipped tree.
 */
export function normaliseDuplicateFolder(input: string): string {
  const parts = (input || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part && part !== '.' && part !== '..');

  while (
    parts.length &&
    parts[0].toLowerCase() === DUPLICATE_ARCHIVE.toLowerCase()
  ) {
    parts.shift();
  }

  const cleaned: string[] = [];
  for (const part of parts.slice(0, DUPLICATE_FOLDER_DEPTH)) {
    let name = sanitiseName(part).slice(0, DUPLICATE_SEGMENT_MAX).trim();
    name = name.replace(/[. ]+$/g, '');
    if (!name || name === '.' || name === '..') continue;
    if (WINDOWS_RESERVED.has(name.toLowerCase())) name += '_';
    cleaned.push(name);
  }
  return cleaned.join('/');
}

/** The drive-relative folder where a backup moves old copies. */
export function duplicateArchiveRel(folder: string): string {
  const sub = normaliseDuplicateFolder(folder);
  return sub ? `${DUPLICATE_ARCHIVE}/${sub}` : DUPLICATE_ARCHIVE;
}

function splitExt(name: string): [string, string] {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
}

function suffixed(rel: string, n: number): string {
  const slash = rel.lastIndexOf('/');
  const dir = slash >= 0 ? rel.slice(0, slash + 1) : '';
  const base = slash >= 0 ? rel.slice(slash + 1) : rel;
  const [stem, ext] = splitExt(base);
  return `${dir}${stem} (${n})${ext}`;
}

/** A path under a destination folder that no scanned or claimed file uses. */
function uniqueRel(rel: string, taken: Set<string>): string {
  let cand = rel;
  for (let n = 1; taken.has(cand.toLowerCase()); n += 1) cand = suffixed(rel, n);
  taken.add(cand.toLowerCase());
  return cand;
}

/**
 * A free path under the duplicate archive. That tree is excluded from scans, so
 * unlike the media tree there is no in-memory list to consult; one stat per
 * candidate is cheap because a clash is rare.
 */
async function uniqueDuplicateRel(
  root: string,
  rel: string,
  claimed: Set<string>,
): Promise<string> {
  let cand = rel;
  for (let n = 1; ; n += 1) {
    const key = cand.toLowerCase();
    if (!claimed.has(key)) {
      claimed.add(key);
      const info = await statFile(absolutePath(root, cand));
      if (!info.exists) return cand;
    }
    cand = suffixed(rel, n);
  }
}

function dateParts(takenAt: number): { year: number; month: number } {
  const seconds = takenAt > 0 ? takenAt : Math.floor(Date.now() / 1000);
  const d = new Date(seconds * 1000);
  let year = d.getFullYear();
  if (year < 1990 || year > 2200) year = new Date().getFullYear();
  return { year, month: d.getMonth() + 1 };
}

export function destinationRel(
  layout: BackupLayout,
  takenAt: number,
  filename: string,
): string {
  const name = sanitiseName(filename);
  if (layout === 'flat') return `Phone/${name}`;
  const { year, month } = dateParts(takenAt);
  const mm = String(month).padStart(2, '0');
  return layout === 'year' ? `${year}/${mm}/${name}` : `Phone/${year}/${mm}/${name}`;
}

function parentOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash > 0 ? path.slice(0, slash) : '';
}

/* ------------------------------------------------------------------ */
/* camera roll                                                         */
/* ------------------------------------------------------------------ */

type DriveIndex = Map<string, { size: number; rel: string }[]>;

function indexDrive(entries: ScanEntry[]): DriveIndex {
  const out: DriveIndex = new Map();
  for (const e of entries) {
    const name = e.p.slice(e.p.lastIndexOf('/') + 1).toLowerCase();
    const list = out.get(name) ?? [];
    list.push({ size: e.s, rel: e.p });
    out.set(name, list);
  }
  return out;
}

function remember(
  index: DriveIndex,
  name: string,
  size: number,
  rel: string,
): void {
  const key = name.toLowerCase();
  const list = index.get(key) ?? [];
  list.push({ size, rel });
  index.set(key, list);
}

function forget(index: DriveIndex, name: string, rel: string): void {
  const key = name.toLowerCase();
  const list = (index.get(key) ?? []).filter((e) => e.rel !== rel);
  if (list.length) index.set(key, list);
  else index.delete(key);
}

function assetKind(a: MediaLibrary.Asset): 'image' | 'video' {
  return a.mediaType === 'video' || a.mediaType === 'pairedVideo'
    ? 'video'
    : 'image';
}

function assetTakenAt(a: MediaLibrary.Asset): number {
  const ms = a.creationTime || a.modificationTime || Date.now();
  return Math.round(ms / 1000);
}

async function visitAssetPages(
  cond: BackupConditions,
  visit: (assets: MediaLibrary.Asset[]) => Promise<boolean>,
): Promise<void> {
  let after: string | undefined;
  for (;;) {
    const page = await MediaLibrary.getAssetsAsync({
      first: ASSET_PAGE,
      after,
      album: cond.albumId || undefined,
      mediaType:
        cond.media === 'both'
          ? ['photo', 'video']
          : cond.media === 'video'
            ? 'video'
            : 'photo',
      createdAfter: cond.since ? cond.since * 1000 : undefined,
      createdBefore: cond.until ? cond.until * 1000 : undefined,
      sortBy: [['creationTime', true]] as [MediaLibrary.SortByKey, boolean][],
    });
    const stop = await visit(page.assets);
    if (stop || !page.hasNextPage) return;
    after = page.endCursor;
  }
}

/** Albums with at least one item, ready for a condition chip row. */
export async function listAlbums(): Promise<AlbumChoice[]> {
  try {
    const albums = await MediaLibrary.getAlbumsAsync({ includeSmartAlbums: true });
    return albums
      .filter((a) => a.assetCount > 0)
      .map((a) => ({ id: a.id, title: a.title, count: a.assetCount }))
      .sort((a, b) => a.title.localeCompare(b.title));
  } catch {
    return [];
  }
}

/** Whether the camera roll is already readable, without prompting. */
export async function hasMediaAccess(): Promise<boolean> {
  try {
    const current = await MediaLibrary.getPermissionsAsync(false, ['photo', 'video']);
    return current.granted;
  } catch {
    return false;
  }
}

/** Asks for camera-roll access. Returns true when the roll can be read. */
export async function ensureMediaAccess(): Promise<boolean> {
  try {
    const current = await MediaLibrary.getPermissionsAsync(false, ['photo', 'video']);
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    const asked = await MediaLibrary.requestPermissionsAsync(false, ['photo', 'video']);
    return asked.granted;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* audit + catalog                                                     */
/* ------------------------------------------------------------------ */

function auditLine(row: Record<string, unknown>): string {
  return JSON.stringify({ at: new Date().toISOString(), ...row }) + '\n';
}

async function flushAudit(root: string, lines: string[]): Promise<void> {
  if (!lines.length) return;
  const text = lines.join('');
  lines.length = 0;
  await appendText(auditPath(root), text);
}

type CatalogCommit = { ok: boolean; count: number; error?: string };

/**
 * Writes the catalog from the drive's current scan plus the organise actions.
 * Everything already catalogued keeps its dates and dimensions; the additions
 * and removals only describe what this run actually touched.
 */
async function commitCatalog(
  ctx: DriveContext,
  scan: ScanEntry[],
  adds: CatalogWriteEntry[],
  removes: string[],
): Promise<CatalogCommit> {
  try {
    const [previous, meta] = await Promise.all([
      readCatalog(ctx.root),
      readMediaMetadata(ctx.root),
    ]);
    const record = buildCatalogEntries(scan, meta, previous?.entries ?? []);
    const merged = mergeCatalogEntries(record, adds, removes);

    const bytes = encodeCatalog(
      {
        format: 'ocd-catalog',
        version: 1,
        volumeId: ctx.volumeId,
        label: ctx.label,
        indexVersion: 1,
        generated: new Date().toISOString(),
      },
      merged,
    );

    if (!(await writeCatalog(ctx.root, bytes))) {
      return { ok: false, count: 0, error: 'Could not write the catalog to the drive.' };
    }

    // Read back the just-written primary. Falling back to .bak here would hide
    // a failed write behind the previous catalog.
    const back = await readCatalogWithSource(ctx.root);
    if (
      !back ||
      back.source !== 'current' ||
      back.catalog.entries.length !== merged.length
    ) {
      return {
        ok: false,
        count: merged.length,
        error: 'The catalog was written but could not be read back. Re-index to retry.',
      };
    }
    return { ok: true, count: merged.length };
  } catch (e) {
    return {
      ok: false,
      count: 0,
      error: e instanceof Error ? e.message : 'Could not update the drive catalog.',
    };
  }
}

async function moveExistingToDuplicates(
  root: string,
  archiveRel: string,
  rel: string,
  claimed: Set<string>,
): Promise<string | null> {
  const from = absolutePath(root, rel);
  const targetRel = await uniqueDuplicateRel(root, `${archiveRel}/${rel}`, claimed);
  const to = absolutePath(root, targetRel);
  const parent = parentOf(to);
  if (parent) await mkdirs(parent);
  if (!(await renameFile(from, to))) return null;
  return targetRel;
}

function progressOf(
  summary: BackupSummary,
  phase: BackupProgress['phase'],
  index: number,
  total: number,
  name: string,
): BackupProgress {
  return {
    phase,
    index,
    total,
    name,
    bytes: summary.bytes,
    copied: summary.copied,
    skipped: summary.skipped,
    quarantined: summary.quarantined,
    failed: summary.failed,
  };
}

/**
 * Copies the phone's camera roll onto the drive. Every file is staged on the
 * drive, hashed while streaming, renamed into place, then read back and hashed
 * again before it counts as copied. The phone originals are never touched.
 */
export async function runBackup(
  ctx: DriveContext,
  cond: BackupConditions,
  onProgress: (p: BackupProgress) => void,
  cancel: Cancellation,
): Promise<BackupSummary> {
  const summary: BackupSummary = {
    copied: 0,
    skipped: 0,
    quarantined: 0,
    failed: 0,
    bytes: 0,
    errors: [],
    cancelled: false,
    halted: false,
    quarantineFolder: duplicateArchiveRel(cond.duplicateFolder),
    catalogWritten: false,
    catalogCount: 0,
  };

  keepScreenOn(true);
  try {
    onProgress(progressOf(summary, 'listing', 0, 0, 'Reading the drive…'));
    const scan = await scanVolume(ctx.root);
    const taken = new Set(scan.entries.map((e) => e.p.toLowerCase()));
    const index = indexDrive(scan.entries);
    const dupClaimed = new Set<string>();
    const additions: CatalogWriteEntry[] = [];
    const removals: string[] = [];
    const audit: string[] = [];

    let total = 0;
    await visitAssetPages(cond, async (assets) => {
      total += assets.length;
      return false;
    });
    onProgress(progressOf(summary, 'listing', 0, total, ''));

    if (cancel.cancelled) {
      summary.cancelled = true;
      onProgress(progressOf(summary, 'done', 0, total, ''));
      return summary;
    }

    let seen = 0;
    await visitAssetPages(cond, async (assets) => {
      const paths = assets.map((a) => (a.uri ? localPath(a.uri) : ''));
      const sizes = await statSizes(paths);

      for (let i = 0; i < assets.length; i += 1) {
        if (cancel.cancelled) {
          summary.cancelled = true;
          return true;
        }
        seen += 1;
        const a = assets[i];
        const name = a.filename || `item-${seen}`;
        const size = sizes[i] ?? -1;

        if (size < 0) {
          summary.failed += 1;
          summary.errors.push(`${name}: could not read this item on the phone.`);
          onProgress(progressOf(summary, 'copying', seen, total, name));
          continue;
        }
        if (cond.minBytes > 0 && size < cond.minBytes) {
          summary.skipped += 1;
          onProgress(progressOf(summary, 'copying', seen, total, name));
          continue;
        }
        if (cond.skipScreenshots && isScreenshot(name)) {
          summary.skipped += 1;
          onProgress(progressOf(summary, 'copying', seen, total, name));
          continue;
        }

        const kind = assetKind(a);
        const takenAt = assetTakenAt(a);
        const key = name.toLowerCase();
        const same = (index.get(key) ?? []).find((e) => e.size === size);

        if (same && cond.duplicates === 'skip') {
          summary.skipped += 1;
          onProgress(progressOf(summary, 'copying', seen, total, name));
          continue;
        }

        if (same && cond.duplicates === 'quarantine') {
          const movedTo = await moveExistingToDuplicates(
            ctx.root,
            summary.quarantineFolder,
            same.rel,
            dupClaimed,
          );
          if (!movedTo) {
            summary.failed += 1;
            summary.errors.push(
              `${name}: could not move the existing copy to ${summary.quarantineFolder}.`,
            );
            onProgress(progressOf(summary, 'copying', seen, total, name));
            continue;
          }
          removals.push(same.rel);
          taken.delete(same.rel.toLowerCase());
          forget(index, name, same.rel);
          summary.quarantined += 1;
          audit.push(
            auditLine({ op: 'dedupe-move', from: same.rel, to: movedTo, size }),
          );
        }

        const rel = uniqueRel(
          destinationRel(cond.layout, takenAt, name),
          taken,
        );
        const dest = absolutePath(ctx.root, rel);

        const free = await freeBytes(ctx.root);
        if (free < size + FREE_HEADROOM) {
          summary.halted = true;
          summary.errors.push(
            `The drive is full. ${name} and everything after it were not copied.`,
          );
          return true;
        }

        onProgress(progressOf(summary, 'copying', seen, total, name));

        const parent = parentOf(dest);
        if (parent) await mkdirs(parent);
        await mkdirs(incomingDir(ctx.root));
        const staging = `${incomingDir(ctx.root)}/${Date.now()}-${seen}.part`;

        let copied: CopyResult;
        try {
          copied = await copyAndHash(a.uri, staging, takenAt, true);
        } catch (e) {
          copied = {
            ok: false,
            size: 0,
            sha256: '',
            error: e instanceof Error ? e.message : 'copy failed',
          };
        }

        if (!copied.ok) {
          summary.failed += 1;
          summary.errors.push(`${name}: ${copied.error || 'copy failed'}`);
          await removeFile(staging);
          onProgress(progressOf(summary, 'copying', seen, total, name));
          continue;
        }

        if (!(await renameFile(staging, dest))) {
          // The destination appeared between planning and renaming (or the
          // drive rejected the rename). Keep the staged copy out of the way.
          await removeFile(staging);
          summary.failed += 1;
          summary.errors.push(`${name}: could not move the copy into its folder.`);
          onProgress(progressOf(summary, 'copying', seen, total, name));
          continue;
        }

        // The rename keeps the mtime set on the staged file, but some exFAT
        // implementations drop it; setting it again is cheap and exact.
        await setMtime(dest, takenAt);

        summary.copied += 1;
        summary.bytes += copied.size;
        additions.push({
          p: rel,
          s: copied.size,
          m: takenAt,
          k: kind,
          w: a.width || undefined,
          h: a.height || undefined,
          d: a.duration || undefined,
          t: takenAt,
        });
        remember(index, name, copied.size, rel);
        audit.push(
          auditLine({
            op: 'backup',
            from: name,
            to: rel,
            size: copied.size,
            sha256: copied.sha256,
          }),
        );

        if (audit.length >= AUDIT_BATCH) await flushAudit(ctx.root, audit);
        onProgress(
          progressOf(
            summary,
            'copying',
            seen,
            total,
            `${name} — ${summary.copied} copied`,
          ),
        );
      }
      return false;
    });

    await flushAudit(ctx.root, audit);

    if (cond.updateCatalog) {
      onProgress(progressOf(summary, 'cataloguing', seen, total, 'Updating the catalog…'));
      const committed = await commitCatalog(ctx, scan.entries, additions, removals);
      summary.catalogWritten = committed.ok;
      summary.catalogCount = committed.count;
      if (!committed.ok && committed.error) summary.errors.push(committed.error);
    }

    onProgress(progressOf(summary, 'done', seen, total, ''));
    return summary;
  } finally {
    keepScreenOn(false);
  }
}

/* ------------------------------------------------------------------ */
/* tidy                                                                */
/* ------------------------------------------------------------------ */

function pathDepth(rel: string): number {
  let depth = 0;
  for (const part of rel.split('/')) if (part) depth += 1;
  return depth;
}

/** Oldest first, then the shallowest and shortest path, then alphabetical. */
function keeperOrder(a: ScanEntry, b: ScanEntry): number {
  if (a.m !== b.m) return a.m - b.m;
  const da = pathDepth(a.p);
  const db = pathDepth(b.p);
  if (da !== db) return da - db;
  if (a.p.length !== b.p.length) return a.p.length - b.p.length;
  return a.p.localeCompare(b.p);
}

/**
 * Finds content-identical files on the drive and plans one move per redundant
 * copy into `_OCD Duplicates/<original path>`. Nothing is moved here: the plan
 * is what the preview shows and what applyTidy executes.
 */
export async function scanTidy(
  ctx: DriveContext,
  onProgress: (p: TidyProgress) => void,
  cancel: Cancellation,
): Promise<TidyPlan> {
  onProgress({ phase: 'scanning', done: 0, total: 0, name: '' });
  const scan = await scanVolume(ctx.root);

  const bySize = new Map<number, ScanEntry[]>();
  for (const e of scan.entries) {
    if (e.s < TIDY_MIN_BYTES) continue;
    const list = bySize.get(e.s) ?? [];
    list.push(e);
    bySize.set(e.s, list);
  }

  const candidates: ScanEntry[] = [];
  for (const list of bySize.values()) {
    if (list.length > 1) candidates.push(...list);
  }

  const byHash = new Map<string, { hash: string; files: ScanEntry[] }>();
  let hashed = 0;
  for (const e of candidates) {
    if (cancel.cancelled) {
      return {
        moves: [],
        groups: 0,
        redundant: 0,
        reclaimable: 0,
        scanned: scan.entries.length,
        hashed,
        scan: scan.entries,
        cancelled: true,
      };
    }
    hashed += 1;
    onProgress({
      phase: 'hashing',
      done: hashed,
      total: candidates.length,
      name: e.p,
    });
    const hash = await hashFile(absolutePath(ctx.root, e.p));
    if (!hash) continue;
    const key = `${e.s}:${hash}`;
    const found = byHash.get(key) ?? { hash, files: [] };
    found.files.push(e);
    byHash.set(key, found);
  }

  const claimed = new Set<string>();
  const moves: TidyMove[] = [];
  let groups = 0;
  for (const found of byHash.values()) {
    if (found.files.length < 2) continue;
    groups += 1;
    const ordered = [...found.files].sort(keeperOrder);
    for (let i = 1; i < ordered.length; i += 1) {
      const f = ordered[i];
      if (cancel.cancelled) break;
      const to = await uniqueDuplicateRel(
        ctx.root,
        `_OCD Duplicates/${f.p}`,
        claimed,
      );
      moves.push({
        from: f.p,
        to,
        size: f.s,
        mtime: f.m,
        kind: f.k,
        hash: found.hash,
      });
    }
    if (cancel.cancelled) break;
  }

  moves.sort((a, b) => a.from.localeCompare(b.from));
  const reclaimable = moves.reduce((n, m) => n + m.size, 0);

  onProgress({ phase: 'done', done: moves.length, total: moves.length, name: '' });
  return {
    moves,
    groups,
    redundant: moves.length,
    reclaimable,
    scanned: scan.entries.length,
    hashed,
    scan: scan.entries,
    cancelled: cancel.cancelled,
  };
}

/** Executes a plan: same-volume renames, an audit row, and a merged catalog. */
export async function applyTidy(
  ctx: DriveContext,
  plan: TidyPlan,
  onProgress: (p: TidyProgress) => void,
  cancel: Cancellation,
): Promise<TidyResult> {
  const result: TidyResult = {
    moved: 0,
    bytes: 0,
    failed: 0,
    errors: [],
    cancelled: false,
    catalogWritten: false,
    catalogCount: 0,
  };

  keepScreenOn(true);
  try {
    await mkdirs(duplicatesDir(ctx.root));
    const removes: string[] = [];
    const audit: string[] = [];

    for (let i = 0; i < plan.moves.length; i += 1) {
      if (cancel.cancelled) {
        result.cancelled = true;
        break;
      }
      const m = plan.moves[i];
      onProgress({ phase: 'moving', done: i, total: plan.moves.length, name: m.from });

      const from = absolutePath(ctx.root, m.from);
      const to = absolutePath(ctx.root, m.to);
      const parent = parentOf(to);
      if (parent) await mkdirs(parent);

      if (!(await renameFile(from, to))) {
        result.failed += 1;
        result.errors.push(`${m.from}: could not be moved.`);
        continue;
      }

      result.moved += 1;
      result.bytes += m.size;
      // The archive folder is not part of the gallery, so the moved file is
      // dropped from the catalog instead of being re-added at its new path.
      // Its audit row keeps the from/to pair for a later restore.
      removes.push(m.from);
      audit.push(
        auditLine({
          op: 'dedupe-move',
          from: m.from,
          to: m.to,
          size: m.size,
          sha256: m.hash,
        }),
      );

      if (audit.length >= AUDIT_BATCH) await flushAudit(ctx.root, audit);
      onProgress({
        phase: 'moving',
        done: i + 1,
        total: plan.moves.length,
        name: m.from,
      });
    }

    await flushAudit(ctx.root, audit);

    if (result.moved > 0) {
      onProgress({
        phase: 'cataloguing',
        done: result.moved,
        total: plan.moves.length,
        name: 'Updating the catalog…',
      });
      const committed = await commitCatalog(ctx, plan.scan, [], removes);
      result.catalogWritten = committed.ok;
      result.catalogCount = committed.count;
      if (!committed.ok && committed.error) result.errors.push(committed.error);
    }

    onProgress({ phase: 'done', done: result.moved, total: plan.moves.length, name: '' });
    return result;
  } finally {
    keepScreenOn(false);
  }
}

/** Kept beside the engine so callers do not re-implement the folder name. */
export function duplicatesFolder(root: string): string {
  return duplicatesDir(root);
}
