import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { api, Cursor, GridItem, Library, messageFor } from '../api';
import { ScreenHeader, TextAction } from '../layout';
import { colors, radius, space } from '../theme';
import { Chip, ErrorBanner, Wordmark } from '../ui';
import { shareRemoteFiles } from '../share';
import { Viewer } from './Viewer';
import { Tile } from './GalleryTile';

const COLS = 3;
const GAP = 2;
const PAGE = 200;

type Props = {
  server: string;
  onChangeServer: () => void;
};

export function Gallery({ server, onChangeServer }: Props) {
  const { width } = useWindowDimensions();
  const cell = Math.floor((width - GAP * (COLS - 1)) / COLS);

  const [libs, setLibs] = useState<Library[]>([]);
  const [lib, setLib] = useState('');
  const [query, setQuery] = useState('');
  const [term, setTerm] = useState('');
  const [rows, setRows] = useState<GridItem[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [building, setBuilding] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [viewer, setViewer] = useState<number | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const cursor = useRef<Cursor | undefined>(undefined);
  const busy = useRef(false);
  const run = useRef(0);

  const loadLibs = useCallback(() => {
    api
      .libraries(server)
      .then(setLibs)
      .catch(() => {
        // The photo request below reports the real connection problem.
      });
  }, [server]);

  useEffect(loadLibs, [loadLibs]);

  useEffect(() => {
    const t = setTimeout(() => setTerm(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(
    async (reset: boolean) => {
      if (!reset && (busy.current || !hasMore)) return;
      busy.current = true;
      const id = ++run.current;
      if (reset) {
        cursor.current = undefined;
        setRows([]);
        setHasMore(false);
        setProblem(null);
        setLoading(true);
      } else {
        setLoadingMore(true);
      }
      try {
        const page = await api.photos(server, {
          limit: PAGE,
          q: term || undefined,
          lib: lib || undefined,
          before: reset ? undefined : cursor.current,
          stats: reset,
        });
        if (id !== run.current) return;
        setRows((prev) => (reset ? page.items : [...prev, ...page.items]));
        cursor.current = page.cursor;
        setHasMore(Boolean(page.hasMore && page.cursor));
        // The header shows how big the library really is, not just how much of
        // it has scrolled past so far.
        if (reset) setTotal(page.stats?.total ?? page.indexed ?? 0);
        setBuilding(page.building);
        setProblem(null);
      } catch (e) {
        if (id === run.current) setProblem(messageFor(e));
      } finally {
        if (id === run.current) {
          busy.current = false;
          setLoading(false);
          setLoadingMore(false);
          setRefreshing(false);
        }
      }
    },
    [server, term, lib, hasMore],
  );

  // A new server, search term, or folder means the list starts over.
  useEffect(() => {
    // Clearing the grid is the point of a new filter, not a cascading render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(true);
    // load changes for each filter; this effect is the reset those filters want.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server, term, lib]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    cursor.current = undefined;
    setHasMore(false);
    loadLibs();
    load(true);
  }, [load, loadLibs]);

  const onEnd = useCallback(() => {
    if (hasMore && !busy.current) load(false);
  }, [hasMore, load]);

  const shareItem = useCallback(
    async (item: GridItem) => {
      try {
        await shareRemoteFiles(server, [
          { key: item.key, name: item.name, kind: item.kind, size: item.size },
        ]);
      } catch (e) {
        setProblem(messageFor(e));
      }
    },
    [server],
  );

  const shareSelected = useCallback(async () => {
    const items = rows.filter((item) => selected.has(item.key));
    if (!items.length) return;
    try {
      await shareRemoteFiles(
        server,
        items.map((item) => ({ key: item.key, name: item.name, kind: item.kind, size: item.size })),
      );
      // Sharing clears the selection, like other gallery apps.
      setSelecting(false);
      setSelected(new Set());
    } catch (e) {
      setProblem(messageFor(e));
    }
  }, [rows, selected, server]);

  const toggleSelect = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const shown = rows.length;
  // Only warn about drives the grid is actually trying to show.
  const offline = (lib ? libs.filter((l) => l.id === lib) : libs).filter(
    (l) => !l.available,
  );
  const subtitle = loading
    ? 'Loading photos…'
    : shown === 0
      ? 'No photos'
      : total > shown
        ? `${shown.toLocaleString()} of ${total.toLocaleString()} items`
        : `${(total || shown).toLocaleString()} items`;

  return (
    <View style={styles.root}>
      <ScreenHeader style={styles.header}>
        <View style={styles.brandRow}>
          <Wordmark />
          <TextAction
            label="Change server"
            onPress={onChangeServer}
            accessibilityHint="Enter a different computer address"
          />
        </View>

        <Text style={styles.title}>Photos</Text>

        <View style={styles.search}>
          <View style={styles.mag}>
            <View style={styles.magCircle} />
            <View style={styles.magHandle} />
          </View>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search photos or a year"
            placeholderTextColor={colors.faint}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            style={styles.searchInput}
            accessibilityLabel="Search photos"
          />
          {query ? (
            <Pressable
              onPress={() => setQuery('')}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              style={styles.clearHit}
            >
              <Text style={styles.clear}>✕</Text>
            </Pressable>
          ) : null}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          keyboardShouldPersistTaps="handled"
        >
          <Chip label="All" active={!lib} onPress={() => setLib('')} />
          {libs.map((l) => (
            <Chip
              key={l.id}
              label={l.name}
              active={lib === l.id}
              dim={!l.available}
              onPress={() => setLib(l.id)}
            />
          ))}
        </ScrollView>

        <View style={styles.statsRow}>
          <Text style={styles.stats}>{subtitle}</Text>
          {building ? <Text style={styles.scanning}>Scanning drive…</Text> : null}
        </View>
      </ScreenHeader>

      {selecting ? (
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
              <TextAction
                label="Share"
                onPress={shareSelected}
                accessibilityHint="Share the selected photos"
              />
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
            accessibilityHint="Choose photos to share"
          />
        </View>
      )}

      {offline.length > 0 ? (
        <View style={styles.offline} accessibilityRole="alert">
          <Text style={styles.offlineText}>
            {offline.length === 1
              ? `${offline[0].name} is offline.`
              : `${offline.map((l) => l.name).join(' and ')} are offline.`}{' '}
            Plug the drive back in, then pull to refresh.
          </Text>
        </View>
      ) : null}

      {problem ? <ErrorBanner message={problem} onRetry={refresh} /> : null}

      {loading && rows.length === 0 ? (
        <Skeleton cell={cell} width={width} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(it) => it.key}
          numColumns={COLS}
          columnWrapperStyle={{ gap: GAP }}
          contentContainerStyle={{ gap: GAP, paddingBottom: space(8) }}
          renderItem={({ item, index }) => (
            <Tile
              item={item}
              server={server}
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
            />
          )}
          onEndReached={onEnd}
          onEndReachedThreshold={0.9}
          onScrollBeginDrag={Keyboard.dismiss}
          removeClippedSubviews={Platform.OS === 'android'}
          initialNumToRender={30}
          maxToRenderPerBatch={30}
          updateCellsBatchingPeriod={80}
          windowSize={9}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={colors.muted}
              colors={[colors.text]}
            />
          }
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.more}>
                <ActivityIndicator color={colors.muted} />
              </View>
            ) : hasMore ? (
              <Pressable
                onPress={() => load(false)}
                style={styles.more}
                accessibilityRole="button"
                accessibilityLabel="Load more photos"
              >
                <Text style={styles.moreText}>Load more</Text>
              </Pressable>
            ) : undefined
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Nothing here yet</Text>
              <Text style={styles.emptyText}>
                Add your drive in OCD Manager on the computer and let it finish
                scanning. New photos appear here without a restart.
              </Text>
            </View>
          }
        />
      )}

      {viewer !== null && rows[viewer] ? (
        <Viewer
          server={server}
          items={rows}
          start={viewer}
          onClose={() => setViewer(null)}
        />
      ) : null}
    </View>
  );
}

function Skeleton({ cell, width }: { cell: number; width: number }) {
  const n = 18;
  return (
    <View style={[styles.skeleton, { width }]}>
      {Array.from({ length: n }).map((_, i) => (
        <View
          key={i}
          style={{ width: cell, height: cell, backgroundColor: colors.surface }}
        />
      ))}
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
  change: { fontSize: 13, color: colors.muted, fontWeight: '600' },
  clearHit: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '700',
    letterSpacing: -0.8,
    color: colors.text,
    marginTop: space(1),
  },
  search: {
    marginTop: space(3),
    height: 42,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space(3),
  },
  mag: { width: 20, height: 20, marginRight: space(1) },
  magCircle: {
    position: 'absolute',
    left: 2,
    top: 2,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.muted,
  },
  magHandle: {
    position: 'absolute',
    left: 12,
    top: 13,
    width: 6,
    height: 1.5,
    borderRadius: 1,
    backgroundColor: colors.muted,
    transform: [{ rotate: '45deg' }],
  },
  searchInput: {
    flex: 1,
    height: 42,
    fontSize: 15,
    color: colors.text,
    padding: 0,
  },
  clear: { fontSize: 13, color: colors.muted },
  chips: { paddingTop: space(3), paddingBottom: 2 },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    marginTop: space(2),
    height: 18,
  },
  stats: { fontSize: 12, color: colors.muted, fontWeight: '600' },
  scanning: { fontSize: 12, color: colors.faint },
  offline: {
    marginHorizontal: space(4),
    marginBottom: space(2),
    padding: space(3),
    borderRadius: radius.md,
    backgroundColor: '#fff7ed',
  },
  offlineText: { color: '#9a3412', fontSize: 13, lineHeight: 18 },
  skeleton: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GAP,
  },
  more: { paddingVertical: space(7), alignItems: 'center' },
  moreText: { color: colors.muted, fontSize: 14, fontWeight: '600' },
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
  selectionText: {
    fontSize: 15,
    color: colors.text,
    fontWeight: '500',
  },
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
