import type {
  BackupConditions,
  BackupLayout,
  BackupMedia,
  DuplicatePolicy,
} from './backup';

/**
 * A resume marker is written before a backup starts copying and removed after it
 * finishes, however it ends. If the process is killed in between, the marker is
 * what is left behind, and the backup screen offers to continue from it.
 *
 * The marker stores the rules rather than a list of finished files. A resumed
 * run is always forced to skip files already on the drive, which makes the
 * already-copied part of the previous run a no-op without having to track every
 * item. This file is pure: the platform storage lives in `resumeStore.ts`.
 */

const VERSION = 1;

export type ResumeRecord = {
  /** The drive this run was writing to; a marker for another drive is ignored. */
  volumeId: string;
  label: string;
  /** The exact rules the first run used. */
  conditions: BackupConditions;
  /** Present when the run was copying a ticked set rather than the whole roll. */
  assetIds?: string[];
  /** Unix seconds, for showing when the unfinished run began. */
  startedAt: number;
};

const MEDIA: BackupMedia[] = ['image', 'video', 'both'];
const LAYOUTS: BackupLayout[] = ['phone', 'year', 'flat'];
const DUPLICATES: DuplicatePolicy[] = ['skip', 'rename', 'quarantine'];

function pick<T extends string>(
  value: unknown,
  allowed: T[],
  fallback: T,
): T {
  return typeof value === 'string' && (allowed as string[]).includes(value)
    ? (value as T)
    : fallback;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Reads conditions defensively. A marker is our own file, but it can be edited
 * or left over from an older build; an unrecognised value falls back to the
 * same default the backup screen uses rather than failing the whole record.
 */
function conditionsFrom(raw: unknown): BackupConditions | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  return {
    media: pick(c.media, MEDIA, 'both'),
    albumId: text(c.albumId),
    albumTitle: text(c.albumTitle),
    since: num(c.since, 0),
    until: num(c.until, 0),
    skipScreenshots: bool(c.skipScreenshots, true),
    minBytes: num(c.minBytes, 0),
    layout: pick(c.layout, LAYOUTS, 'phone'),
    duplicates: pick(c.duplicates, DUPLICATES, 'skip'),
    duplicateFolder: text(c.duplicateFolder),
    updateCatalog: bool(c.updateCatalog, true),
  };
}

export function encodeResume(record: ResumeRecord): string {
  return JSON.stringify({ version: VERSION, ...record });
}

/** Returns null for anything that is not a complete, current marker. */
export function decodeResume(textValue: string | null | undefined): ResumeRecord | null {
  if (!textValue) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(textValue);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== VERSION) return null;

  const volumeId = typeof o.volumeId === 'string' ? o.volumeId.trim() : '';
  if (!volumeId) return null;
  const conditions = conditionsFrom(o.conditions);
  if (!conditions) return null;

  const ids = Array.isArray(o.assetIds)
    ? o.assetIds.filter(
        (id): id is string => typeof id === 'string' && id.length > 0,
      )
    : [];

  return {
    volumeId,
    label: text(o.label),
    conditions,
    assetIds: ids.length ? ids : undefined,
    startedAt: num(o.startedAt, 0),
  };
}

/**
 * The rules a resumed run should actually use. Duplicates are forced to `skip`:
 * the previous run may have copied an item a moment before it was killed, and
 * "keep both" would then add a needless `(1)` copy of the same bytes.
 */
export function resumeConditions(record: ResumeRecord): BackupConditions {
  return { ...record.conditions, duplicates: 'skip' };
}
