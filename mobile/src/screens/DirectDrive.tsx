import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { shareRemoteFiles } from '../share';
import {
  loadDrive,
  pickDrive,
  storedDrive,
  clearDrive,
  originalUriFor,
  thumbUriFor,
  forgetWalk,
  type Catalog,
  type DirectItem,
  type StoredDrive,
} from '../direct/drive';
import {
  accessGranted,
  driveId,
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
  removableDrives,
  scanVolume,
  syntheticCatalog,
  thumbPath,
  volumeName,
  writeCatalog,
  type DriveVolume,
} from '../direct/native';
import { buildCatalogEntries, encodeCatalog } from '../direct/catalog';
import { thumbName } from '../direct/hash';

import { ScreenHeader, TextAction } from '../layout';
import { colors, radius, space } from '../theme';
import { ErrorBanner, Wordmark } from '../ui';
import { Viewer } from './Viewer';
import { Tile } from './GalleryTile';
import type { GridItem } from '../api';

/** A placeholder Catalog used only when the viewer mounts before load finishes. */
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

const COLS = 3;
const GAP = 2;

export function DirectDrive() {
  const { width } = useWindowDimensions();
  const cell = Math.floor((width - GAP * (COLS - 1)) / COLS);

  const [stored, setStored] = useState<{ treeUri: string; label: string } | null>(null);
  // A drive remembered from the Android picker, kept but not auto-opened when
  // the native path is available: walking 25,000 files on launch is exactly
  // what this screen must not do.
  const [safFallback, setSafFallback] = useState<StoredDrive | null>(null);
  const [items, setItems] = useState<DirectItem[]>([]);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [treeUri, setTreeUri] = useState<string | null>(null);
  const [hadThumbs, setHadThumbs] = useState(false);
  const [loading, setLoading] = useState(true);
  const [walking, setWalking] = useState<{ done: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [viewer, setViewer] = useState<number | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const busy = useRef(false);

  // Native drive access (development build only). When the module is missing
  // the screen behaves exactly as before and uses SAF.
  const [nativeAccess, setNativeAccess] = useState(
    () => isDriveModuleAvailable && accessGranted(),
  );
  const [volumes, setVolumes] = useState<DriveVolume[]>([]);
  const [native, setNative] = useState<{
    root: string;
    volumeId: string;
    label: string;
    volume: DriveVolume;
  } | null>(null);
  const [thumbs, setThumbs] = useState<Set<string>>(new Set());
  const [needsIndex, setNeedsIndex] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const pendingThumbs = useRef<Set<string>>(new Set());

  const refreshVolumes = useCallback(async () => {
    if (!isDriveModuleAvailable) return;
    const granted = accessGranted();
    setNativeAccess(granted);
    setVolumes(granted ? await removableDrives() : []);
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
    // Returning from the all-files settings screen is the moment the drive
    // becomes readable, so re-list volumes whenever the app comes forward.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshVolumes();
    });
    return () => sub.remove();
  }, [refreshVolumes]);

  const openNative = useCallback(async (v: DriveVolume) => {
    setProblem(null);
    setLoading(true);
    try {
      const root = v.path;
      const derivedId = await driveId(root, v);
      const names = await existingThumbs(root);
      const existing = await readCatalogWithSource(root);
      const catalog = existing?.catalog ?? null;
      // A catalog that only exists as .bak means the primary is damaged: show
      // the previous copy rather than pretending the drive was never indexed.
      const fromBackup = existing?.source === 'backup';
      // Prefer the identity the catalog already uses: preview names are hashed
      // from it, so a second identity would miss every preview on the drive.
      const volumeId = catalog?.header.volumeId || derivedId;

      setNative({ root, volumeId, label: volumeName(v), volume: v });
      setStored(null);
      setTreeUri(null);
      setThumbs(names);
      setRecovered(fromBackup);

      if (catalog && catalog.entries.length > 0) {
        setItems(itemsFromCatalog(catalog));
        setCatalog(catalog);
        setHadThumbs(names.size > 0);
        setNeedsIndex(fromBackup && v.writable);
      } else {
        // Browsing an unindexed drive stays read-only until the user asks for
        // an index; the scan is only used to show what is on it.
        const { entries } = await scanVolume(root);
        setItems(itemsFromScan(entries));
        setCatalog(syntheticCatalog(volumeId, v.label, entries.length));
        setHadThumbs(names.size > 0);
        setNeedsIndex(entries.length > 0);
      }
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Could not open that drive.');
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Writes a catalog for this drive. This is the only place the phone writes
   * to a drive, and it only happens when the user asks for it. The new catalog
   * is built completely in memory and swapped in atomically, so a failure
   * leaves the previous catalog (or no catalog) exactly as it was.
   */
  const indexNative = useCallback(async () => {
    if (!native || indexing) return;
    if (!native.volume.writable) {
      setProblem('This drive is write-protected, so OCD can only browse it.');
      return;
    }
    setProblem(null);
    setIndexing(true);
    try {
      const space = await freeBytes(native.root);
      if (space < 8 * 1024 * 1024) {
        setProblem('The drive is too full to write a catalog safely. Free some space and try again.');
        return;
      }

      const { entries, truncated } = await scanVolume(native.root);
      if (entries.length === 0) {
        setProblem('No photos or videos were found on this drive.');
        return;
      }

      // Dates and dimensions come from the platform's media database (one
      // query, no per-file reads) and from whatever the drive already carried.
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
      setItems(itemsFromCatalog(written.catalog));
      setNeedsIndex(false);
      setRecovered(false);
      if (truncated) {
        setProblem('This drive holds more items than one pass can index. The first 500,000 were saved.');
      }
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Could not index this drive.');
    } finally {
      setIndexing(false);
    }
  }, [indexing, native]);

  const load = useCallback(async (uri: string) => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    setWalking({ done: 0 });
    setProblem(null);
    try {
      const { items, catalog, hadThumbs } = await loadDrive(uri, (done) =>
        setWalking({ done }),
      );
      setItems(items);
      setCatalog(catalog);
      setHadThumbs(hadThumbs);
      setTreeUri(uri);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Could not read the drive.');
    } finally {
      busy.current = false;
      setLoading(false);
      setWalking(null);
    }
  }, []);

  useEffect(() => {
    storedDrive()
      .then((d) => {
        if (!d) {
          setLoading(false);
          return;
        }
        if (isDriveModuleAvailable) {
          // Native access is faster and knows sizes and dates, so do not walk
          // the drive through SAF on launch. Keep it as an explicit fallback.
          setSafFallback(d);
          setLoading(false);
          return;
        }
        setStored(d);
        return load(d.treeUri);
      })
      .catch(() => setLoading(false));
  }, [load]);

  const chooseDrive = useCallback(async () => {
    setProblem(null);
    try {
      const picked = await pickDrive();
      if (!picked) {
        setProblem('No drive was chosen.');
        return;
      }
      setStored(picked);
      await load(picked.treeUri);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Could not choose that drive.');
    }
  }, [load]);

  const disconnect = useCallback(async () => {
    await clearDrive();
    forgetWalk();
    setStored(null);
    setNative(null);
    setNeedsIndex(false);
    setRecovered(false);
    setThumbs(new Set());
    pendingThumbs.current.clear();
    setItems([]);
    setCatalog(null);
    setTreeUri(null);
    setProblem(null);
    setSelecting(false);
    setSelected(new Set());
  }, []);

  const refresh = useCallback(async () => {
    if (native) {
      await openNative(native.volume);
      return;
    }
    if (!treeUri) return;
    // Drop cached listings so a drive that gained files while unplugged, or
    // was reconnected after a failure, is read again from scratch.
    await forgetWalk();
    await load(treeUri);
  }, [load, native, openNative, treeUri]);

  const toggleSelect = useCallback((rel: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(rel)) next.delete(rel);
      else next.add(rel);
      return next;
    });
  }, []);

  const gridItems = useMemo<GridItem[]>(
    () =>
      items.map((it) => ({
        key: it.key,
        name: it.name,
        dir: it.dir,
        lib: 'direct',
        kind: it.kind,
        w: it.w,
        h: it.h,
        shot: it.shot,
        size: it.size,
        dur: it.dur,
        v: it.v,
        fav: false,
      })),
    [items],
  );

  const thumbUri = useCallback(
    async (item: GridItem): Promise<string | undefined> => {
      if (native) {
        const name = thumbName(native.volumeId, item.key, item.size, item.v).toLowerCase();
        if (thumbs.has(name)) {
          return fileUri(thumbPath(native.root, native.volumeId, item.key, item.size, item.v));
        }

        // The drive has no preview for this file yet: build one now, off the
        // JS thread, and let the tile redraw when it lands.
        if (!pendingThumbs.current.has(name)) {
          pendingThumbs.current.add(name);
          ensureThumb(native.root, native.volumeId, {
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
        return fileUri(native.root + '/' + item.key);
      }

      const direct = { ...item, rel: item.key, lib: 'direct' } as DirectItem;
      const thumb = catalog ? thumbUriFor(direct, catalog, treeUri ?? '') : undefined;
      if (thumb) return thumb;
      // No preview travels with the drive (or this file was never indexed):
      // let the platform draw the original. This keeps photos visible on a
      // drive that has never been through this computer.
      if (item.kind === 'video') return undefined;
      return originalUriFor(direct, treeUri ?? undefined);
    },
    [catalog, native, thumbs, treeUri],
  );

  const originalFor = useCallback(
    async (item: GridItem): Promise<string | undefined> => {
      if (native) return fileUri(native.root + '/' + item.key);
      return originalUriFor({ rel: item.key } as DirectItem, treeUri ?? undefined);
    },
    [native, treeUri],
  );

  const shareItem = useCallback(
    async (item: GridItem) => {
      const uri = await originalFor(item);
      if (!uri) {
        setProblem('That file is not reachable on the drive.');
        return;
      }
      try {
        await shareRemoteFiles('', [
          { key: item.key, name: item.name, kind: item.kind, size: item.size, localUri: uri },
        ]);
      } catch (e) {
        setProblem(e instanceof Error ? e.message : 'Could not share this file.');
      }
    },
    [originalFor],
  );

  const shareSelected = useCallback(async () => {
    const picks = gridItems.filter((item) => selected.has(item.key));
    if (!picks.length) return;
    try {
      const withUris = await Promise.all(
        picks.map(async (item) => ({
          key: item.key,
          name: item.name,
          kind: item.kind,
          size: item.size,
          localUri: await originalFor(item),
        })),
      );
      const missing = withUris.filter((p) => !p.localUri).length;
      if (missing === withUris.length) {
        setProblem('Those files are not reachable on the drive.');
        return;
      }
      await shareRemoteFiles('', withUris);
      setSelecting(false);
      setSelected(new Set());
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Could not share these files.');
    }
  }, [gridItems, originalFor, selected]);

  // What the bar above the grid says. Kept out of the JSX because the damaged
  // catalog case has its own wording.
  const indexMessage = (() => {
    if (!native) return '';
    if (recovered) {
      return native.volume.writable
        ? 'The catalogue on this drive is damaged, so OCD opened the previous copy. Index to repair it — nothing is deleted.'
        : 'The catalogue on this drive is damaged. OCD is showing the previous copy, and the drive is write-protected so it cannot be repaired here.';
    }
    if (!native.volume.writable) {
      return 'This drive is write-protected. You can browse it, but OCD cannot add a catalogue or previews to it.';
    }
    return indexing
      ? 'Indexing this drive. Keep it plugged in.'
      : 'This drive has no catalogue yet. Index it here to open instantly next time and to build previews on the drive.';
  })();

  return (
    <View style={styles.root}>
      <ScreenHeader style={styles.header}>
        <View style={styles.brandRow}>
          <Wordmark />
          <TextAction
            label={stored || native ? 'Disconnect' : 'Choose drive'}
            onPress={stored || native ? disconnect : chooseDrive}
            accessibilityHint={
              stored || native
                ? 'Stop reading this drive in the app'
                : 'Pick the drive you plugged into this phone'
            }
          />
        </View>

        <Text style={styles.title}>USB Drive</Text>

        {stored || native ? (
          <View style={styles.statsRow}>
            <Text style={styles.stats}>
              {loading
                ? walking
                  ? `Reading the drive… ${walking.done} folders`
                  : 'Loading catalogue…'
                : `${items.length.toLocaleString()} items${hadThumbs ? '' : ' · no previews on drive'}`}
            </Text>
            <Text style={styles.scanning}>
              {stored ? stored.label : native ? volumeName(native.volume) : ''}
            </Text>
          </View>
        ) : (
          <View style={styles.pickWrap}>
            <View style={styles.pickGlyph}>
              <Text style={styles.pickIcon}>▭</Text>
            </View>
            <Text style={styles.pickTitle}>Copy from your drive</Text>
            <Text style={styles.pickText}>
              Plug the drive into this phone, then choose it. OCD reads the catalogue already on
              the drive and shows your photos and videos here — no computer involved.
            </Text>

            {isDriveModuleAvailable ? (
              nativeAccess ? (
                volumes.length > 0 ? (
                  <View style={styles.volumes}>
                    <Text style={styles.pickSection}>Drives on this phone</Text>
                    {volumes.map((v) => (
                      <Pressable
                        key={v.path}
                        onPress={() => openNative(v)}
                        style={({ pressed }) => [styles.volumeRow, pressed && styles.pickButtonPressed]}
                        accessibilityRole="button"
                        accessibilityLabel={`Open ${volumeName(v)}`}
                      >
                        <Text style={styles.volumeLabel}>{volumeName(v)}</Text>
                        <Text style={styles.volumePath}>{v.path}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.pickNote}>
                    No removable drive is mounted. Plug the drive in, then pull down to refresh.
                  </Text>
                )
              ) : (
                <View style={styles.volumes}>
                  <Text style={styles.pickSection}>Full drive control</Text>
                  <Text style={styles.pickNote}>
                    OCD needs the “All files access” permission to read sizes, dates and previews
                    straight from the drive. Nothing is deleted or changed without asking.
                  </Text>
                  <Pressable
                    onPress={async () => {
                      if (await ensureAccess()) await refreshVolumes();
                    }}
                    style={({ pressed }) => [styles.pickButton, pressed && styles.pickButtonPressed]}
                    accessibilityRole="button"
                    accessibilityLabel="Allow full drive access"
                  >
                    <Text style={styles.pickButtonText}>Allow access</Text>
                  </Pressable>
                </View>
              )
            ) : null}

            {safFallback ? (
              <View style={styles.volumes}>
                <Text style={styles.pickSection}>Opened before</Text>
                <Pressable
                  onPress={() => {
                    setSafFallback(null);
                    setStored(safFallback);
                    void load(safFallback.treeUri);
                  }}
                  style={({ pressed }) => [styles.volumeRow, pressed && styles.pickButtonPressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${safFallback.label} through the folder picker`}
                >
                  <Text style={styles.volumeLabel}>{safFallback.label}</Text>
                  <Text style={styles.volumePath}>
                    Folder picker · slower, has no sizes or previews
                  </Text>
                </Pressable>
              </View>
            ) : null}

            <View style={styles.chips}>
              <Pressable
                onPress={chooseDrive}
                style={({ pressed }) => [styles.pickButton, pressed && styles.pickButtonPressed]}
                accessibilityRole="button"
                accessibilityLabel="Choose a drive to browse"
              >
                <Text style={styles.pickButtonText}>Choose drive</Text>
              </Pressable>
            </View>
          </View>
        )}
      </ScreenHeader>

      {problem ? <ErrorBanner message={problem} onRetry={refresh} /> : null}

      {native && (needsIndex || recovered) ? (
        <View style={styles.indexBar}>
          <Text style={styles.indexText}>{indexMessage}</Text>
          {native.volume.writable ? (
            indexing ? (
              <ActivityIndicator color={colors.muted} size="small" />
            ) : (
              <TextAction
                label="Index drive"
                onPress={indexNative}
                accessibilityHint="Scan this drive and write a catalog to it"
              />
            )
          ) : null}
        </View>
      ) : null}

      {loading && items.length === 0 ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.muted} />
        </View>
      ) : stored || native ? (
        selecting ? (
          <View style={styles.selectionBar}>
            <Text style={styles.selectionText}>{selected.size} selected</Text>
            <View style={styles.selectionActions}>
              <TextAction
                label="Cancel"
                onPress={() => {
                  setSelecting(false);
                  setSelected(new Set());
                }}
              />
              {selected.size > 0 ? (
                <TextAction label="Share" onPress={shareSelected} accessibilityHint="Share the selected files" />
              ) : null}
            </View>
          </View>
        ) : (
          <View style={styles.topActions}>
            <TextAction
              label="Select"
              onPress={() => {
                setSelecting(true);
                setSelected(new Set());
              }}
              accessibilityHint="Choose files to share"
            />
          </View>
        )
      ) : null}

      {(stored || native) && items.length > 0 ? (
        <FlatList
          data={gridItems}
          keyExtractor={(it) => it.key}
          numColumns={COLS}
          columnWrapperStyle={{ gap: GAP }}
          contentContainerStyle={{ gap: GAP, paddingBottom: space(8) }}
          renderItem={({ item, index }) => (
            <Tile
              item={item}
              server=""
              size={cell}
              selecting={selecting}
              selected={selected.has(item.key)}
              onPress={() => {
                if (selecting) {
                  toggleSelect(item.key);
                  return;
                }
                setViewer(index);
              }}
              onLongPress={selecting ? undefined : () => shareItem(item)}
              onToggleSelect={() => toggleSelect(item.key)}
              onShare={() => shareItem(item)}
              thumbUri={thumbUri}
            />
          )}
          initialNumToRender={30}
          maxToRenderPerBatch={30}
          removeClippedSubviews={Platform.OS === 'android'}
          windowSize={9}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.muted} />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Nothing here</Text>
              <Text style={styles.emptyText}>
                The drive is empty, or its media is not recognised yet. Index it here and the
                previews appear on the drive itself.
              </Text>
            </View>
          }
        />
      ) : null}

      {viewer !== null && gridItems[viewer] ? (
        <Viewer
          server=""
          items={gridItems}
          start={viewer}
          onClose={() => setViewer(null)}
          onShareItem={(item) => shareItem(item)}
          thumbUriFor={(item) => {
            if (native) {
              const name = thumbName(
                native.volumeId,
                item.key,
                item.size,
                item.v,
              ).toLowerCase();
              return thumbs.has(name)
                ? fileUri(
                    thumbPath(native.root, native.volumeId, item.key, item.size, item.v),
                  )
                : undefined;
            }
            return thumbUriFor(
              { ...item, rel: item.key } as DirectItem,
              catalog ?? EMPTY_CATALOG,
              treeUri ?? '',
            );
          }}
          originalUriFor={originalFor}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: space(4),
    paddingBottom: space(2),
    backgroundColor: colors.bg,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  title: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '700',
    letterSpacing: -0.8,
    color: colors.text,
    marginTop: space(1),
  },
  pickWrap: { marginTop: space(3), paddingVertical: space(4) },
  pickGlyph: {
    width: space(12),
    height: space(12),
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space(3),
  },
  pickIcon: { fontSize: 44, lineHeight: 48, color: colors.faint },
  pickTitle: { fontSize: 17, fontWeight: '600', color: colors.text, marginBottom: space(1.5) },
  pickText: { fontSize: 14, lineHeight: 20, color: colors.muted },
  chips: { flexDirection: 'row', marginTop: space(4) },
  volumes: { marginTop: space(4), gap: space(2) },
  pickSection: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.faint,
  },
  pickNote: { fontSize: 13, lineHeight: 19, color: colors.muted },
  volumeRow: {
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: space(3),
    paddingVertical: space(2.5),
  },
  volumeLabel: { fontSize: 15, fontWeight: '600', color: colors.text },
  volumePath: { fontSize: 12, color: colors.faint, marginTop: 2 },
  indexBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space(3),
    paddingHorizontal: space(3),
    paddingVertical: space(2),
    backgroundColor: colors.surface,
  },
  indexText: { flex: 1, fontSize: 13, lineHeight: 18, color: colors.muted },
  pickButton: {
    borderRadius: radius.md,
    paddingHorizontal: space(5),
    paddingVertical: space(3),
    backgroundColor: colors.text,
  },
  pickButtonPressed: { opacity: 0.85 },
  pickButtonText: { color: colors.bg, fontSize: 15, fontWeight: '700' },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    marginTop: space(2),
    height: 18,
  },
  stats: { fontSize: 12, color: colors.muted, fontWeight: '600' },
  scanning: { fontSize: 12, color: colors.faint },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: {
    paddingHorizontal: space(10),
    paddingTop: space(16),
    alignItems: 'center',
  },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  emptyText: {
    marginTop: space(2),
    fontSize: 14,
    lineHeight: 21,
    color: colors.muted,
    textAlign: 'center',
  },
  selectionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: space(2),
    backgroundColor: colors.surface,
  },
  selectionText: { fontSize: 15, color: colors.text, fontWeight: '500' },
  selectionActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
  },
  topActions: {
    padding: space(2),
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: space(2),
  },
});
