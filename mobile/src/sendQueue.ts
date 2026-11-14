import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library/legacy';
import { Platform } from 'react-native';

import { api, messageFor, uploadFile } from './api';

/**
 * The send queue is the phone side of "upload, verify, then you may delete".
 *
 * Until now a send lived only in component state: closing the app lost the
 * list and any copies already verified were forgotten. This module keeps the
 * list on disk instead, one small JSON file, and records the verification
 * answer per item so a relaunch can still offer the delete step.
 *
 * Only pending work runs. An item is written as `pending` before it starts and
 * only becomes `done` or `failed` after the server answers, so a kill in the
 * middle retries that item instead of pretending it arrived. Retrying is safe:
 * the server keys uploads by content and returns `existingPath` when the bytes
 * are already on the drive.
 */

const QUEUE_VERSION = 1;
/** Finished rows stay for a day so the summary is not empty after a relaunch. */
const KEEP_FINISHED_MS = 24 * 60 * 60 * 1000;
const SCRATCH = 'ocd-send/';

export type QueuedItem = {
  /** Camera-roll asset id: the identity used for de-duplication. */
  assetId: string;
  server: string;
  libraryId: string;
  libraryName: string;
  name: string;
  /** Best known size at queue time; the staged file's size is authoritative. */
  size: number;
  takenAt: number;
  kind: 'image' | 'video';
  state: 'pending' | 'done' | 'failed';
  error?: string;
  addedAt: number;
  finishedAt?: number;
  /** True only when this upload's bytes were hashed by the server. */
  verified?: boolean;
  path?: string;
};

type Stored = { version: number; items: QueuedItem[] };

/**
 * A send the desktop hashed on arrival. This is the only evidence the free-space
 * screen will act on: a catalog match is metadata-only, so it is deliberately
 * not recorded here. Entries outlive the queue, because finished queue rows are
 * pruned after a day and the delete step can happen much later.
 */
export type VerifiedItem = {
  assetId: string;
  server: string;
  libraryId: string;
  libraryName: string;
  name: string;
  size: number;
  takenAt: number;
  kind: 'image' | 'video';
  path?: string;
  verifiedAt: number;
};

type VerifiedStored = { version: number; items: VerifiedItem[] };

export type SendProgress = {
  total: number;
  done: number;
  verified: number;
  failed: number;
  name: string;
  sentBytes: number;
  totalBytes: number;
};

export type SendResult = {
  done: number;
  verified: number;
  failed: number;
  stopped: boolean;
};

/* ------------------------------------------------------------------ */
/* storage                                                             */
/* ------------------------------------------------------------------ */

function queuePath(): string | null {
  const dir = FileSystem.documentDirectory;
  return dir ? `${dir}ocd-send-queue.json` : null;
}

function coerceItem(raw: unknown): QueuedItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.assetId !== 'string' ||
    typeof r.server !== 'string' ||
    typeof r.libraryId !== 'string' ||
    typeof r.name !== 'string'
  ) {
    return null;
  }
  const state = r.state === 'done' || r.state === 'failed' ? r.state : 'pending';
  return {
    assetId: r.assetId,
    server: r.server,
    libraryId: r.libraryId,
    libraryName: typeof r.libraryName === 'string' ? r.libraryName : 'drive',
    name: r.name,
    size: typeof r.size === 'number' && r.size > 0 ? r.size : 0,
    takenAt: typeof r.takenAt === 'number' ? r.takenAt : 0,
    kind: r.kind === 'video' ? 'video' : 'image',
    state,
    error: typeof r.error === 'string' ? r.error : undefined,
    addedAt: typeof r.addedAt === 'number' ? r.addedAt : 0,
    finishedAt: typeof r.finishedAt === 'number' ? r.finishedAt : undefined,
    verified: r.verified === true,
    path: typeof r.path === 'string' ? r.path : undefined,
  };
}

async function readFile(path: string): Promise<QueuedItem[] | null> {
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(path)) as unknown;
    const items = (parsed as Stored | null)?.items;
    if (!Array.isArray(items)) return null;
    const out: QueuedItem[] = [];
    for (const it of items) {
      const item = coerceItem(it);
      if (item) out.push(item);
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * The queue, with rows that finished more than a day ago dropped. A corrupt
 * primary falls back to the temporary copy a write leaves behind.
 */
export async function readSendQueue(): Promise<QueuedItem[]> {
  const path = queuePath();
  if (!path) return [];
  const items = (await readFile(path)) ?? (await readFile(`${path}.tmp`)) ?? [];
  const cutoff = Date.now() - KEEP_FINISHED_MS;
  return items.filter(
    (i) => i.state === 'pending' || (i.finishedAt ?? i.addedAt) > cutoff,
  );
}

async function writeJsonAtomic(path: string, body: string): Promise<boolean> {
  const tmp = `${path}.tmp`;
  try {
    // Write beside the target, then copy over it. A kill before the copy leaves
    // the previous file intact; a kill during it leaves the temp copy readable.
    await FileSystem.writeAsStringAsync(tmp, body);
    await FileSystem.copyAsync({ from: tmp, to: path });
    await FileSystem.deleteAsync(tmp, { idempotent: true });
    return true;
  } catch {
    return false;
  }
}

async function writeSendQueue(items: QueuedItem[]): Promise<boolean> {
  const path = queuePath();
  if (!path) return false;
  return writeJsonAtomic(
    path,
    JSON.stringify({ version: QUEUE_VERSION, items } satisfies Stored),
  );
}

function sameKey(
  a: QueuedItem,
  b: { server: string; libraryId: string; assetId: string },
): boolean {
  return (
    a.server === b.server &&
    a.libraryId === b.libraryId &&
    a.assetId === b.assetId
  );
}

/* ------------------------------------------------------------------ */
/* the verified store                                                  */
/* ------------------------------------------------------------------ */

function verifiedPath(): string | null {
  const dir = FileSystem.documentDirectory;
  return dir ? `${dir}ocd-verified.json` : null;
}

function coerceVerified(raw: unknown): VerifiedItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.assetId !== 'string' ||
    typeof r.server !== 'string' ||
    typeof r.libraryId !== 'string' ||
    typeof r.name !== 'string'
  ) {
    return null;
  }
  return {
    assetId: r.assetId,
    server: r.server,
    libraryId: r.libraryId,
    libraryName: typeof r.libraryName === 'string' ? r.libraryName : 'drive',
    name: r.name,
    size: typeof r.size === 'number' && r.size > 0 ? r.size : 0,
    takenAt: typeof r.takenAt === 'number' ? r.takenAt : 0,
    kind: r.kind === 'video' ? 'video' : 'image',
    path: typeof r.path === 'string' ? r.path : undefined,
    verifiedAt: typeof r.verifiedAt === 'number' ? r.verifiedAt : 0,
  };
}

async function readVerifiedStore(): Promise<VerifiedItem[]> {
  const path = verifiedPath();
  if (!path) return [];
  const read = async (file: string): Promise<VerifiedItem[] | null> => {
    try {
      const info = await FileSystem.getInfoAsync(file);
      if (!info.exists) return null;
      const parsed = JSON.parse(await FileSystem.readAsStringAsync(file)) as unknown;
      const items = (parsed as VerifiedStored | null)?.items;
      if (!Array.isArray(items)) return null;
      const out: VerifiedItem[] = [];
      for (const it of items) {
        const item = coerceVerified(it);
        if (item) out.push(item);
      }
      return out;
    } catch {
      return null;
    }
  };
  return (await read(path)) ?? (await read(`${path}.tmp`)) ?? [];
}

async function writeVerifiedStore(items: VerifiedItem[]): Promise<boolean> {
  const path = verifiedPath();
  if (!path) return false;
  return writeJsonAtomic(
    path,
    JSON.stringify({ version: 1, items } satisfies VerifiedStored),
  );
}

/**
 * Verified sends for one desktop, newest first, with one row per camera-roll
 * asset. Sending the same photo to two folders leaves two store rows (each is
 * a real verified copy), but the phone copy can only be freed once, so every
 * screen counts and lists it once.
 */
export async function readVerified(server: string): Promise<VerifiedItem[]> {
  const seen = new Set<string>();
  return (await readVerifiedStore())
    .filter((i) => i.server === server)
    .sort((a, b) => b.verifiedAt - a.verifiedAt)
    .filter((i) => {
      if (seen.has(i.assetId)) return false;
      seen.add(i.assetId);
      return true;
    });
}

/**
 * Records a verified send. Failure to write the store must never fail a send,
 * so the caller treats this as best-effort.
 */
export async function recordVerified(
  server: string,
  item: QueuedItem,
): Promise<void> {
  if (!item.verified) return;
  const current = await readVerifiedStore();
  const next: VerifiedItem = {
    assetId: item.assetId,
    server,
    libraryId: item.libraryId,
    libraryName: item.libraryName,
    name: item.name,
    size: item.size,
    takenAt: item.takenAt,
    kind: item.kind,
    path: item.path,
    verifiedAt: item.finishedAt ?? Date.now(),
  };
  const index = current.findIndex(
    (c) =>
      c.server === server &&
      c.libraryId === item.libraryId &&
      c.assetId === item.assetId,
  );
  if (index >= 0) current[index] = next;
  else current.push(next);
  await writeVerifiedStore(current);
}

/**
 * Drops the record for items that no longer need freeing. The drive copies are
 * untouched; this only forgets the phone-side proof.
 */
export async function forgetVerified(
  server: string,
  assetIds: string[],
): Promise<void> {
  if (assetIds.length === 0) return;
  const drop = new Set(assetIds);
  const current = (await readVerifiedStore()).filter(
    (i) => !(i.server === server && drop.has(i.assetId)),
  );
  await writeVerifiedStore(current);
}

/* ------------------------------------------------------------------ */
/* queue edits                                                         */
/* ------------------------------------------------------------------ */

export type NewQueueItem = {
  assetId: string;
  name: string;
  size: number;
  takenAt: number;
  kind: 'image' | 'video';
};

/** Adds items, ignoring ones already queued for that drive. */
export async function enqueueSend(
  server: string,
  library: { id: string; name: string },
  items: NewQueueItem[],
): Promise<QueuedItem[]> {
  const current = await readSendQueue();
  const now = Date.now();
  for (const it of items) {
    const key = { server, libraryId: library.id, assetId: it.assetId };
    const found = current.find((c) => sameKey(c, key));
    if (found) {
      // Queueing an item again is an explicit request: a failed row is a retry
      // and a finished one is re-checked (the server answers existingPath).
      if (found.state !== 'pending') {
        found.state = 'pending';
        found.error = undefined;
        found.addedAt = now;
      }
      continue;
    }
    current.push({
      ...it,
      server,
      libraryId: library.id,
      libraryName: library.name,
      state: 'pending',
      addedAt: now,
      verified: false,
    });
  }
  await writeSendQueue(current);
  return current.filter((i) => i.server === server);
}

/** Re-queues failed rows so Resume can try them again. */
export async function retryFailed(server: string): Promise<QueuedItem[]> {
  const current = await readSendQueue();
  for (const item of current) {
    if (item.server === server && item.state === 'failed') {
      item.state = 'pending';
      item.error = undefined;
      item.addedAt = Date.now();
    }
  }
  await writeSendQueue(current);
  return current.filter((i) => i.server === server);
}

/** Drops finished rows; anything still pending is untouched. */
export async function clearFinished(server: string): Promise<QueuedItem[]> {
  const current = (await readSendQueue()).filter(
    (i) => i.server !== server || i.state === 'pending',
  );
  await writeSendQueue(current);
  return current.filter((i) => i.server === server);
}

export function pendingCount(items: QueuedItem[], libraryId?: string): number {
  return items.filter(
    (i) => i.state === 'pending' && (!libraryId || i.libraryId === libraryId),
  ).length;
}

async function saveItem(next: QueuedItem): Promise<void> {
  const current = await readSendQueue();
  const index = current.findIndex((c) => sameKey(c, next));
  if (index >= 0) current[index] = next;
  else current.push(next);
  await writeSendQueue(current);
}

/* ------------------------------------------------------------------ */
/* local files                                                         */
/* ------------------------------------------------------------------ */

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot) : '';
}

async function discardStagedUpload(uri: string): Promise<void> {
  if (uri.startsWith(FileSystem.cacheDirectory ?? '') && uri.includes(`/${SCRATCH}`)) {
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
  }
}

/**
 * Copies the item into the app sandbox. Upload tasks cannot open a Photos
 * resource directly: the request is aborted before any byte reaches the server.
 */
async function stageForUpload(
  ready: { uri: string; size: number },
  ext: string,
): Promise<{ uri: string; size: number }> {
  const scratch = `${FileSystem.cacheDirectory}${SCRATCH}`;
  if (!scratch) throw new Error('The app cache is not available on this phone.');
  await FileSystem.makeDirectoryAsync(scratch, { intermediates: true });
  const suffix = ext && ext.startsWith('.') ? ext : '';
  const target = `${scratch}${Date.now()}-${Math.random().toString(36).slice(2)}${suffix}`;
  try {
    await FileSystem.copyAsync({ from: ready.uri, to: target });
  } catch (e) {
    throw new Error(
      `Could not copy the file into the app: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const info = await FileSystem.getInfoAsync(target);
  if (!info.exists || info.isDirectory) {
    await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => undefined);
    throw new Error('Could not copy the file into the app.');
  }
  return { uri: target, size: info.size ?? ready.size };
}

/**
 * A readable local file for an asset, asking iCloud for the original when the
 * phone only holds a placeholder. Returns null when the bytes are not on the
 * phone, so a cloud-only item fails cleanly instead of stalling.
 */
export async function localFileFor(
  assetId: string,
  fallbackUri?: string,
): Promise<{ uri: string; size: number } | null> {
  let uri = fallbackUri ?? '';
  if (Platform.OS === 'ios') {
    try {
      const info = await MediaLibrary.getAssetInfoAsync(assetId, {
        shouldDownloadFromNetwork: true,
      });
      if (info.localUri) uri = info.localUri;
      else if (!uri && info.uri) uri = info.uri;
    } catch {
      // Fall through to anything we already had.
    }
  }
  if (!uri) {
    try {
      const info = await MediaLibrary.getAssetInfoAsync(assetId, {});
      if (info.localUri) uri = info.localUri;
      else if (info.uri) uri = info.uri;
    } catch {
      return null;
    }
  }
  if (!uri || uri.startsWith('ph://')) return null;
  try {
    const file = await FileSystem.getInfoAsync(uri);
    if (file.exists && !file.isDirectory) return { uri, size: file.size };
  } catch {
    // Missing cache copy or an unreadable URI.
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* the worker                                                          */
/* ------------------------------------------------------------------ */

type SendOutcome =
  | { ok: true; verified: boolean; path?: string; size?: number }
  | { ok: false; error: string };

async function sendOne(
  server: string,
  item: QueuedItem,
  onBytes: (sent: number, total: number) => void,
): Promise<SendOutcome> {
  let staged: { uri: string; size: number } | null = null;
  try {
    const ready = await localFileFor(item.assetId);
    if (!ready) {
      return {
        ok: false,
        error:
          'No local copy on this phone. Open it in Photos or turn off iCloud optimisation, then retry.',
      };
    }
    staged = await stageForUpload(ready, extensionOf(item.name));
    const start = await api.uploadStart(server, {
      libraryId: item.libraryId,
      // The staged size is the truth; the queued size was only a hint.
      name: item.name,
      size: staged.size,
      takenAt: item.takenAt,
      kind: item.kind,
    });
    if (start.existingPath) {
      return { ok: true, verified: false, path: start.existingPath, size: staged.size };
    }
    const uploadId = start.uploadId;
    if (!uploadId) return { ok: false, error: 'The desktop did not start the upload.' };
    try {
      await uploadFile(server, uploadId, staged.uri, onBytes);
      const fin = await api.uploadFinish(server, uploadId);
      return { ok: true, verified: fin.verified, path: fin.path, size: staged.size };
    } catch (e) {
      // Never leave a half-written file among the real ones.
      try {
        await api.uploadAbort(server, uploadId);
      } catch {
        // The session may already be gone.
      }
      throw e;
    }
  } catch (e) {
    return { ok: false, error: messageFor(e) };
  } finally {
    if (staged) await discardStagedUpload(staged.uri);
  }
}

/**
 * Runs the pending items for one drive, in order, persisting after each one.
 * It never throws for an item-level failure: the row is marked failed with the
 * reason and the next item is tried. `shouldStop` is checked between items, so
 * a large video finishes rather than being cut in half.
 */
export async function runSendQueue(
  server: string,
  opts: {
    libraryId: string;
    onProgress: (p: SendProgress) => void;
    onItemFinished: (item: QueuedItem) => void;
    shouldStop: () => boolean;
  },
): Promise<SendResult> {
  const all = await readSendQueue();
  const targets = all.filter(
    (i) =>
      i.server === server &&
      i.libraryId === opts.libraryId &&
      i.state === 'pending',
  );
  const result: SendResult = { done: 0, verified: 0, failed: 0, stopped: false };

  for (const target of targets) {
    if (opts.shouldStop()) {
      result.stopped = true;
      break;
    }
    opts.onProgress({
      total: targets.length,
      done: result.done,
      verified: result.verified,
      failed: result.failed,
      name: target.name,
      sentBytes: 0,
      totalBytes: 0,
    });

    const outcome = await sendOne(server, target, (sentBytes, totalBytes) =>
      opts.onProgress({
        total: targets.length,
        done: result.done,
        verified: result.verified,
        failed: result.failed,
        name: target.name,
        sentBytes,
        totalBytes,
      }),
    );

    const next: QueuedItem = outcome.ok
      ? {
          ...target,
          // The staged file's size is authoritative; the queued size was a hint.
          size: outcome.size ?? target.size,
          state: 'done',
          verified: outcome.verified,
          path: outcome.path,
          error: undefined,
          finishedAt: Date.now(),
        }
      : { ...target, state: 'failed', error: outcome.error, finishedAt: Date.now() };

    await saveItem(next);
    if (outcome.ok) {
      result.done += 1;
      if (outcome.verified) {
        result.verified += 1;
        // Best-effort: the free-space list is convenience, not the send itself.
        await recordVerified(server, next).catch(() => undefined);
      }
    } else {
      result.failed += 1;
    }
    opts.onItemFinished(next);
  }

  opts.onProgress({
    total: targets.length,
    done: result.done,
    verified: result.verified,
    failed: result.failed,
    name: '',
    sentBytes: 0,
    totalBytes: 0,
  });
  return result;
}
