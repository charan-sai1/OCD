import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
} from '../direct/drive';

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
        if (d) {
          setStored(d);
          return load(d.treeUri);
        }
        setLoading(false);
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
    setItems([]);
    setCatalog(null);
    setTreeUri(null);
    setProblem(null);
    setSelecting(false);
    setSelected(new Set());
  }, []);

  const refresh = useCallback(async () => {
    if (!treeUri) return;
    // Drop cached listings so a drive that gained files while unplugged, or
    // was reconnected after a failure, is read again from scratch.
    await forgetWalk();
    await load(treeUri);
  }, [load, treeUri]);

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
    (item: GridItem) => {
      const direct = { ...item, rel: item.key, lib: 'direct' } as DirectItem;
      const thumb = catalog
        ? thumbUriFor(direct, catalog, treeUri ?? '')
        : undefined;
      if (thumb) return thumb;
      // No preview travels with the drive (or this file was never indexed):
      // let the platform draw the original. This keeps photos visible on a
      // drive that has never been through this computer.
      if (item.kind === 'video') return undefined;
      return originalUriFor(direct, treeUri ?? undefined);
    },
    [catalog, treeUri],
  );

  const shareItem = useCallback(
    async (item: GridItem) => {
      const uri = await originalUriFor({ rel: item.key } as DirectItem, treeUri ?? undefined);
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
    [treeUri],
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
          localUri: await originalUriFor({ rel: item.key } as DirectItem, treeUri ?? undefined),
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
  }, [gridItems, selected, treeUri]);

  return (
    <View style={styles.root}>
      <ScreenHeader style={styles.header}>
        <View style={styles.brandRow}>
          <Wordmark />
          <TextAction
            label={stored ? 'Disconnect' : 'Choose drive'}
            onPress={stored ? disconnect : chooseDrive}
            accessibilityHint={
              stored
                ? 'Stop reading this drive in the app'
                : 'Pick the drive you plugged into this phone'
            }
          />
        </View>

        <Text style={styles.title}>USB Drive</Text>

        {stored ? (
          <View style={styles.statsRow}>
            <Text style={styles.stats}>
              {loading
                ? walking
                  ? `Reading the drive… ${walking.done} folders`
                  : 'Loading catalogue…'
                : `${items.length.toLocaleString()} items${hadThumbs ? '' : ' · no previews on drive'}`}
            </Text>
            <Text style={styles.scanning}>{stored.label}</Text>
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

      {loading && items.length === 0 ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.muted} />
        </View>
      ) : stored ? (
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

      {stored && items.length > 0 ? (
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
                The drive is empty, or its media is not recognised yet. Index it on your
                computer and the previews and playback arrive automatically.
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
          thumbUriFor={(item) =>
            thumbUriFor({ ...item, rel: item.key } as DirectItem, catalog ?? EMPTY_CATALOG, treeUri ?? '')
          }
          originalUriFor={(item) =>
            originalUriFor({ rel: item.key } as DirectItem, treeUri ?? undefined)
          }
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
