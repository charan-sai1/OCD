import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import type { GridItem } from '../api';
import { sortByDate } from '../photos';
import type { DriveContext } from './backup';
import { buildCatalogEntries, encodeCatalog } from './catalog';
import {
  clearDrive,
  forgetWalk,
  loadDrive,
  originalUriFor,
  pickDrive,
  storedDrive,
  thumbUriFor,
  type Catalog,
  type DirectItem,
  type StoredDrive,
} from './drive';
import { thumbName } from './hash';
import {
  accessGranted,
  driveId,
  driveVolumes,
  ensureAccess,
  ensureThumb,
  existingThumbs,
  fileUri,
  freeBytes,
  isDriveModuleAvailable,
  itemsFromCatalog,
  itemsFromScan,
  readCatalog,
  readCatalogWithSource,
  readMediaMetadata,
  scanVolume,
  syntheticCatalog,
  thumbPath,
  volumeName,
  watchVolumes,
  writeCatalog,
  type DriveVolume,
} from './native';

/** A placeholder catalog for the short time before a drive has been read. */
const EMPTY_CATALOG: Catalog = {
  header: {
    format: 'ocd-catalog',
    version: 1,
    volumeId: '',
    label: '',
    indexVersion: 0,
    generated: '',
    count: 0,
  },
  entries: [],
};

export type ActiveDrive = {
  root: string;
  volumeId: string;
  label: string;
  volume: DriveVolume;
};

export type DriveSession = {
  /** The native drive module is present in this build. */
  module: boolean;
  /** Android's all-files access has been granted. */
  access: boolean;
  volumes: DriveVolume[];
  unmounted: DriveVolume[];
  refreshing: boolean;
  /** The drive currently open, native or SAF. Native carries a writable root. */
  active: ActiveDrive | null;
  saf: StoredDrive | null;
  safFallback: StoredDrive | null;
  items: DirectItem[];
  catalog: Catalog | null;
  treeUri: string | null;
  hadThumbs: boolean;
  loading: boolean;
  walking: { done: number } | null;
  problem: string | null;
  needsIndex: boolean;
  recovered: boolean;
  indexing: boolean;
  /** Free bytes on the open drive, when the platform reports them. */
  free: number | null;
  driveContext: DriveContext | null;
  refreshVolumes: (showSpinner?: boolean) => Promise<void>;
  requestAccess: () => Promise<void>;
  openVolume: (volume: DriveVolume) => Promise<void>;
  openSaf: (drive: StoredDrive) => Promise<void>;
  chooseSaf: () => Promise<void>;
  disconnect: () => Promise<void>;
  refresh: () => Promise<void>;
  refreshFree: () => Promise<void>;
  reloadCatalog: () => Promise<void>;
  indexDrive: () => Promise<void>;
  /** Resolves a preview, building one on the drive when it is missing. */
  thumbForGridItem: (item: GridItem) => Promise<string | undefined>;
  /** The preview that already exists, for the viewer's first frame. */
  thumbUriForGridItem: (item: GridItem) => string | undefined;
  originalForGridItem: (item: GridItem) => Promise<string | undefined>;
  clearProblem: () => void;
};

function sameVolumes(a: DriveVolume[], b: DriveVolume[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (v, i) =>
        v.path === b[i].path &&
        v.state === b[i].state &&
        v.label === b[i].label &&
        v.writable === b[i].writable,
    )
  );
}

/**
 * Owns the one drive connection the whole app shares. The old screen asked the
 * user to pick a move each time it opened; here the first usable volume opens
 * by itself, and Photos, Backups and Space all read the same catalog.
 *
 * Nothing is written to a drive until the user asks for an index, a backup or a
 * tidy. Opening a drive only reads it.
 */
export function useDriveSession(): DriveSession {
  const [saf, setSaf] = useState<StoredDrive | null>(null);
  const [safFallback, setSafFallback] = useState<StoredDrive | null>(null);
  const [items, setItems] = useState<DirectItem[]>([]);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [treeUri, setTreeUri] = useState<string | null>(null);
  const [hadThumbs, setHadThumbs] = useState(false);
  const [loading, setLoading] = useState(false);
  const [walking, setWalking] = useState<{ done: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [native, setNative] = useState<ActiveDrive | null>(null);
  const [thumbs, setThumbs] = useState<Set<string>>(new Set());
  const [needsIndex, setNeedsIndex] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [free, setFree] = useState<number | null>(null);

  const [nativeAccess, setNativeAccess] = useState(
    () => isDriveModuleAvailable && accessGranted(),
  );
  const [volumes, setVolumes] = useState<DriveVolume[]>([]);
  const [unmounted, setUnmounted] = useState<DriveVolume[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const activeRef = useRef<ActiveDrive | null>(null);
  const openToken = useRef(0);
  const pendingThumbs = useRef<Set<string>>(new Set());
  const auto = useRef(true);
  const attempted = useRef<Set<string>>(new Set());
  const knownPaths = useRef<Set<string>>(new Set());

  const refreshVolumes = useCallback(async (showSpinner = false) => {
    if (!isDriveModuleAvailable) {
      setNativeAccess(false);
      setRefreshing(false);
      return;
    }
    if (showSpinner) {
      setRefreshing(true);
      // A manual refresh is also a way to retry a drive that failed to open.
      attempted.current.clear();
    }
    const granted = accessGranted();
    setNativeAccess(granted);
    if (!granted) {
      setVolumes([]);
      setUnmounted([]);
      if (showSpinner) setRefreshing(false);
      return;
    }
    try {
      const report = await driveVolumes();
      const usable = new Set(report.usable.map((v) => v.path));
      // A volume that disappeared and comes back is a fresh plug, even if
      // Android gives it the same mount point. Let it auto-open again.
      for (const path of knownPaths.current) {
        if (!usable.has(path)) attempted.current.delete(path);
      }
      knownPaths.current = usable;

      setVolumes((prev) => (sameVolumes(prev, report.usable) ? prev : report.usable));
      setUnmounted((prev) =>
        sameVolumes(prev, report.unmounted) ? prev : report.unmounted,
      );

      const current = activeRef.current;
      if (current && !usable.has(current.root)) {
        activeRef.current = null;
        setNative(null);
        setItems([]);
        setCatalog(null);
        setThumbs(new Set());
        setTreeUri(null);
        setFree(null);
        setNeedsIndex(false);
        setRecovered(false);
        auto.current = true;
      }
    } catch (e) {
      // A volume listing can fail on a half-mounted disk; a manual refresh
      // should say why, but a background poll stays quiet.
      if (showSpinner) {
        setProblem(e instanceof Error ? e.message : 'Could not list the drives on this phone.');
      }
    } finally {
      if (showSpinner) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // Volume listing touches a platform API; do it after the screen is up so
    // the first render is not blocked by a permission check.
    const timer = setTimeout(() => {
      void refreshVolumes();
    }, 0);
    return () => clearTimeout(timer);
  }, [refreshVolumes]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshVolumes();
    });
    return () => sub.remove();
  }, [refreshVolumes]);

  useEffect(() => {
    const sub = watchVolumes(() => {
      void refreshVolumes();
    });
    return () => sub.remove();
  }, [refreshVolumes]);

  useEffect(() => {
    // Waiting for a drive to finish mounting: the mount broadcast is the fast
    // path, this poll is the fallback for platforms where it never arrives.
    if (!isDriveModuleAvailable || !nativeAccess || native || saf) return;
    const timer = setInterval(() => {
      void refreshVolumes();
    }, 3000);
    return () => clearInterval(timer);
  }, [native, nativeAccess, refreshVolumes, saf]);

  const openNative = useCallback(async (v: DriveVolume) => {
    const token = ++openToken.current;
    setProblem(null);
    setLoading(true);
    setWalking(null);
    try {
      const root = v.path;
      const derivedId = await driveId(root, v);
      const [names, existing, room] = await Promise.all([
        existingThumbs(root),
        readCatalogWithSource(root),
        freeBytes(root),
      ]);
      if (token !== openToken.current) return;

      const storedCatalog = existing?.catalog ?? null;
      // A catalog that only exists as .bak means the primary is damaged: show
      // the previous copy rather than pretending the drive was never indexed.
      const fromBackup = existing?.source === 'backup';
      // Prefer the identity the catalog already uses: preview names are hashed
      // from it, so a second identity would miss every preview on the drive.
      const volumeId = storedCatalog?.header.volumeId || derivedId;
      const next: ActiveDrive = {
        root,
        volumeId,
        label: volumeName(v),
        volume: v,
      };
      activeRef.current = next;
      setNative(next);
      setSaf(null);
      setSafFallback(null);
      setTreeUri(null);
      setThumbs(names);
      setRecovered(fromBackup);
      setHadThumbs(names.size > 0);
      setFree(room);

      if (storedCatalog && storedCatalog.entries.length > 0) {
        setItems(sortByDate(itemsFromCatalog(storedCatalog)));
        setCatalog(storedCatalog);
        setNeedsIndex(fromBackup && v.writable);
      } else {
        // Browsing an unindexed drive stays read-only until the user asks for
        // an index; the scan is only used to show what is on it.
        const { entries } = await scanVolume(root);
        if (token !== openToken.current) return;
        setItems(sortByDate(itemsFromScan(entries)));
        setCatalog(syntheticCatalog(volumeId, v.label, entries.length));
        setNeedsIndex(entries.length > 0);
      }
    } catch (e) {
      if (token === openToken.current) {
        setProblem(e instanceof Error ? e.message : 'Could not open that drive.');
      }
    } finally {
      if (token === openToken.current) setLoading(false);
    }
  }, []);

  const openSaf = useCallback(async (drive: StoredDrive) => {
    const token = ++openToken.current;
    setProblem(null);
    setLoading(true);
    setWalking({ done: 0 });
    try {
      const loaded = await loadDrive(drive.treeUri, (done) => {
        if (token === openToken.current) setWalking({ done });
      });
      if (token !== openToken.current) return;
      activeRef.current = null;
      setNative(null);
      setSaf(drive);
      setSafFallback(null);
      setTreeUri(drive.treeUri);
      setItems(sortByDate(loaded.items));
      setCatalog(loaded.catalog);
      setHadThumbs(loaded.hadThumbs);
      setRecovered(false);
      setNeedsIndex(false);
      setThumbs(new Set());
      setFree(null);
    } catch (e) {
      if (token === openToken.current) {
        setProblem(e instanceof Error ? e.message : 'Could not read that drive.');
      }
    } finally {
      if (token === openToken.current) {
        setLoading(false);
        setWalking(null);
      }
    }
  }, []);

  useEffect(() => {
    let alive = true;
    storedDrive()
      .then((d) => {
        if (!alive || !d) return;
        if (isDriveModuleAvailable) {
          // Native access is faster and knows sizes and dates, so do not walk
          // the drive through SAF on launch. Keep it as an explicit fallback.
          setSafFallback(d);
          return;
        }
        void openSaf(d);
      })
      .catch(() => {
        // No remembered folder picker drive.
      });
    return () => {
      alive = false;
    };
  }, [openSaf]);

  useEffect(() => {
    // The first usable volume opens by itself. The user never has to pick one;
    // a second drive can be chosen from Devices.
    if (!isDriveModuleAvailable || !nativeAccess || native || saf) return;
    if (!auto.current) return;
    const ordered = [...volumes].sort(
      (a, b) => Number(b.writable) - Number(a.writable),
    );
    const next = ordered.find((v) => !attempted.current.has(v.path));
    if (!next) return;
    attempted.current.add(next.path);
    void openNative(next);
  }, [native, nativeAccess, openNative, saf, volumes]);

  const requestAccess = useCallback(async () => {
    setProblem(null);
    const granted = await ensureAccess();
    await refreshVolumes(true);
    if (granted) auto.current = true;
  }, [refreshVolumes]);

  const chooseSaf = useCallback(async () => {
    setProblem(null);
    try {
      const picked = await pickDrive();
      if (!picked) return;
      await openSaf(picked);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Could not choose that drive.');
    }
  }, [openSaf]);

  const disconnect = useCallback(async () => {
    openToken.current += 1;
    auto.current = false;
    activeRef.current = null;
    await clearDrive();
    await forgetWalk();
    setSaf(null);
    setSafFallback(null);
    setNative(null);
    setItems([]);
    setCatalog(null);
    setTreeUri(null);
    setThumbs(new Set());
    setNeedsIndex(false);
    setRecovered(false);
    setHadThumbs(false);
    setFree(null);
    setProblem(null);
    setLoading(false);
    setWalking(null);
    // If Android still has the drive mounted, let the next poll offer it again.
    attempted.current.clear();
  }, []);

  const refresh = useCallback(async () => {
    if (native) {
      await openNative(native.volume);
      return;
    }
    if (saf) {
      // Drop cached listings so a drive that gained files while unplugged, or
      // was reconnected after a failure, is read again from scratch.
      await forgetWalk();
      await openSaf(saf);
    }
  }, [native, openNative, openSaf, saf]);

  const refreshFree = useCallback(async () => {
    if (native) setFree(await freeBytes(native.root));
  }, [native]);

  const reloadCatalog = useCallback(async () => {
    if (!native) return;
    try {
      const read = await readCatalogWithSource(native.root);
      if (!read) return;
      const names = await existingThumbs(native.root);
      setThumbs(names);
      setCatalog(read.catalog);
      setItems(sortByDate(itemsFromCatalog(read.catalog)));
      setRecovered(read.source === 'backup');
      setNeedsIndex(read.source === 'backup' && native.volume.writable);
      setHadThumbs(names.size > 0);
      setFree(await freeBytes(native.root));
    } catch {
      // The drive may have been unplugged; leave the current view as it is.
    }
  }, [native]);

  const indexDrive = useCallback(async () => {
    if (!native || indexing) return;
    if (!native.volume.writable) {
      setProblem('This drive is write-protected, so OCD can only browse it.');
      return;
    }
    setProblem(null);
    setIndexing(true);
    try {
      const room = await freeBytes(native.root);
      // Unknown space is not a reason to refuse: the atomic write still fails
      // safely if the drive really is full.
      if (room !== null && room < 8 * 1024 * 1024) {
        setProblem(
          'The drive is too full to write a catalog safely. Free some space and try again.',
        );
        return;
      }

      const { entries, truncated, unreadable } = await scanVolume(native.root);
      if (entries.length === 0) {
        setProblem('No photos or videos were found on this drive.');
        return;
      }
      if (truncated || unreadable.length > 0) {
        // Rebuilding from a partial walk would drop every entry the walk never
        // reached. Leave the existing catalog exactly as it is.
        setProblem(
          truncated
            ? 'This drive holds more items than one pass can index. The catalog was left unchanged.'
            : `Some folders could not be read${
                unreadable.length
                  ? ` (${unreadable.slice(0, 3).join(', ')}${
                      unreadable.length > 3 ? ', …' : ''
                    })`
                  : ''
              }. The catalog was left unchanged.`,
        );
        return;
      }

      const [meta, previous] = await Promise.all([
        readMediaMetadata(native.root),
        readCatalog(native.root),
      ]);
      const record = buildCatalogEntries(entries, meta, previous?.entries ?? []);
      const bytes = encodeCatalog(
        {
          format: 'ocd-catalog',
          version: 1,
          volumeId: native.volumeId,
          label: native.label,
          indexVersion: 1,
          generated: new Date().toISOString(),
        },
        record,
      );

      if (!(await writeCatalog(native.root, bytes))) {
        setProblem('Could not write the catalog to the drive.');
        return;
      }

      // Read back what actually landed rather than trusting the buffer. The
      // backup must not answer here: falling back to it would hide a failed
      // write behind the previous catalog.
      const written = await readCatalogWithSource(native.root);
      if (
        !written ||
        written.source !== 'current' ||
        written.catalog.entries.length !== record.length
      ) {
        setProblem('The catalog was written but could not be read back. Re-index to retry.');
        return;
      }

      setCatalog(written.catalog);
      setItems(sortByDate(itemsFromCatalog(written.catalog)));
      setNeedsIndex(false);
      setRecovered(false);
      setFree(await freeBytes(native.root));
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Could not index this drive.');
    } finally {
      setIndexing(false);
    }
  }, [indexing, native]);

  const thumbForGridItem = useCallback(
    async (item: GridItem): Promise<string | undefined> => {
      const current = native;
      if (current) {
        const name = thumbName(
          current.volumeId,
          item.key,
          item.size,
          item.v,
        ).toLowerCase();
        if (thumbs.has(name)) {
          return fileUri(
            thumbPath(current.root, current.volumeId, item.key, item.size, item.v),
          );
        }

        // The drive has no preview for this file yet: build one now, off the
        // JS thread, and let the tile redraw when it lands.
        if (!pendingThumbs.current.has(name)) {
          pendingThumbs.current.add(name);
          ensureThumb(current.root, current.volumeId, {
            p: item.key,
            s: item.size,
            m: item.v,
            k: item.kind,
          })
            .then((path) => {
              if (path) setThumbs((prev) => new Set(prev).add(name));
            })
            .catch(() => {
              // A file the decoders cannot read keeps its original tile.
            })
            .finally(() => pendingThumbs.current.delete(name));
        }

        // Videos cannot borrow the original as a poster frame.
        if (item.kind === 'video') return undefined;
        return fileUri(current.root + '/' + item.key);
      }

      if (treeUri) {
        const direct = { ...item, rel: item.key, lib: 'drive' } as DirectItem;
        const thumb = catalog ? thumbUriFor(direct, catalog, treeUri) : undefined;
        if (thumb) return thumb;
        // No preview travels with the drive (or this file was never indexed):
        // let the platform draw the original.
        if (item.kind === 'video') return undefined;
        return originalUriFor(direct, treeUri);
      }
      return undefined;
    },
    [catalog, native, thumbs, treeUri],
  );

  const thumbUriForGridItem = useCallback(
    (item: GridItem): string | undefined => {
      const current = native;
      if (current) {
        const name = thumbName(
          current.volumeId,
          item.key,
          item.size,
          item.v,
        ).toLowerCase();
        return thumbs.has(name)
          ? fileUri(
              thumbPath(current.root, current.volumeId, item.key, item.size, item.v),
            )
          : undefined;
      }
      if (treeUri) {
        return thumbUriFor(
          { ...item, rel: item.key, lib: 'drive' } as DirectItem,
          catalog ?? EMPTY_CATALOG,
          treeUri,
        );
      }
      return undefined;
    },
    [catalog, native, thumbs, treeUri],
  );

  const originalForGridItem = useCallback(
    async (item: GridItem): Promise<string | undefined> => {
      if (native) return fileUri(native.root + '/' + item.key);
      if (treeUri) {
        return originalUriFor({ ...item, rel: item.key } as DirectItem, treeUri);
      }
      return undefined;
    },
    [native, treeUri],
  );

  const clearProblem = useCallback(() => setProblem(null), []);

  const driveContext = useMemo<DriveContext | null>(
    () =>
      native
        ? {
            root: native.root,
            volumeId: native.volumeId,
            label: native.label,
            writable: native.volume.writable,
          }
        : null,
    [native],
  );

  return {
    module: isDriveModuleAvailable,
    access: nativeAccess,
    volumes,
    unmounted,
    refreshing,
    active: native,
    saf,
    safFallback,
    items,
    catalog,
    treeUri,
    hadThumbs,
    loading,
    walking,
    problem,
    needsIndex,
    recovered,
    indexing,
    free,
    driveContext,
    refreshVolumes,
    requestAccess,
    openVolume: openNative,
    openSaf,
    chooseSaf,
    disconnect,
    refresh,
    refreshFree,
    reloadCatalog,
    indexDrive,
    thumbForGridItem,
    thumbUriForGridItem,
    originalForGridItem,
    clearProblem,
  };
}
