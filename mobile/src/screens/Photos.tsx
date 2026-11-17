import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Constants from 'expo-constants';
import * as MediaLibrary from 'expo-media-library/legacy';

import { api, messageFor, type Cursor, type GridItem } from '../api';
import {
  askRollPermission,
  readRollPermission,
  readRollPage,
  type PhoneAsset,
} from '../phoneRoll';
import {
  computerToItem,
  driveToItem,
  mergeByDate,
  phoneToItem,
  sourceKey,
  sourceLabel,
  type PhotoSource,
  type UnifiedItem,
} from '../photos';
import type { DriveSession } from '../direct/session';
import { shareRemoteFiles } from '../share';
import { ScreenHeader, TextAction } from '../layout';
import { colors, radius, space } from '../theme';
import { Chip, ErrorBanner, PrimaryButton } from '../ui';
import { Tile } from './GalleryTile';
import { Viewer } from './Viewer';

const COLS = 3;
const GAP = 2;
/** The computer sends a page at a time; the phone roll does the same. */
const PC_PAGE = 120;

type Props = {
  server: string | null;
  drive: DriveSession;
  onOpenDevices: () => void;
  /** Bumped when the camera roll changed elsewhere, so the grid reloads. */
  phoneRevision: number;
};

/**
 * One grid for every photo the app can see: this phone's camera roll, a drive
 * plugged into the phone, and a computer on the same Wi-Fi. The chips decide
 * which sources show; every tile keeps the source it came from so previews,
 * originals and sharing go back to the right place.
 */
export function Photos({ server, drive, onOpenDevices, phoneRevision }: Props) {
  const { width } = useWindowDimensions();
  const cell = Math.floor((width - GAP * (COLS - 1)) / COLS);

  const [perm, setPerm] = useState<MediaLibrary.PermissionResponse | null>(null);
  const [phone, setPhone] = useState<PhoneAsset[]>([]);
  const [phoneMore, setPhoneMore] = useState(false);
  const [phoneLoading, setPhoneLoading] = useState(false);
  const [phoneMoreLoading, setPhoneMoreLoading] = useState(false);
  const [pc, setPc] = useState<GridItem[]>([]);
  const [pcMore, setPcMore] = useState(false);
  const [pcLoading, setPcLoading] = useState(false);
  const [pcMoreLoading, setPcMoreLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | PhotoSource>('all');
  const [viewer, setViewer] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const phoneAfter = useRef<string | undefined>(undefined);
  const phoneBusy = useRef(false);
  const pcCursor = useRef<Cursor | undefined>(undefined);
  const pcBusy = useRef(false);
  const pcRun = useRef(0);

  const androidExpoGo = Platform.OS === 'android' && Constants.appOwnership === 'expo';

  useEffect(() => {
    let alive = true;
    readRollPermission()
      .then((next) => {
        if (alive) setPerm(next);
      })
      .catch((e) => {
        if (alive) setProblem(messageFor(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  const loadPhone = useCallback(async (reset: boolean) => {
    if (phoneBusy.current) return;
    phoneBusy.current = true;
    if (reset) setPhoneLoading(true);
    else setPhoneMoreLoading(true);
    try {
      const page = await readRollPage(reset ? undefined : phoneAfter.current);
      phoneAfter.current = page.endCursor;
      setPhone((prev) => (reset ? page.assets : [...prev, ...page.assets]));
      setPhoneMore(page.hasNextPage);
      setProblem(null);
    } catch (e) {
      setProblem(messageFor(e));
    } finally {
      phoneBusy.current = false;
      setPhoneLoading(false);
      setPhoneMoreLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (perm?.granted) void loadPhone(true);
    // The revision changes after a delete elsewhere; the roll is then stale.
  }, [perm?.granted, loadPhone, phoneRevision]);

  const loadPc = useCallback(
    async (reset: boolean) => {
      if (!server || pcBusy.current) return;
      pcBusy.current = true;
      const token = reset ? ++pcRun.current : pcRun.current;
      if (reset) setPcLoading(true);
      else setPcMoreLoading(true);
      try {
        const page = await api.photos(server, {
          limit: PC_PAGE,
          before: reset ? undefined : pcCursor.current,
        });
        if (token !== pcRun.current) return;
        setPc((prev) => (reset ? page.items : [...prev, ...page.items]));
        pcCursor.current = page.cursor;
        setPcMore(Boolean(page.hasMore && page.cursor));
        setProblem(null);
      } catch (e) {
        if (token === pcRun.current) setProblem(messageFor(e));
      } finally {
        if (token === pcRun.current) {
          pcBusy.current = false;
          setPcLoading(false);
          setPcMoreLoading(false);
        }
      }
    },
    [server],
  );

  useEffect(() => {
    // A different computer has a different library; drop the old page.
    pcRun.current += 1;
    pcCursor.current = undefined;
    pcBusy.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPc([]);
    setPcMore(false);
    if (server) void loadPc(true);
  }, [server, loadPc]);

  const ask = useCallback(async () => {
    try {
      setProblem(null);
      setPerm(await askRollPermission());
    } catch (e) {
      setProblem(messageFor(e));
    }
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setProblem(null);
    const jobs: Promise<unknown>[] = [drive.refresh()];
    if (perm?.granted) jobs.push(loadPhone(true));
    if (server) jobs.push(loadPc(true));
    await Promise.allSettled(jobs);
    setRefreshing(false);
  }, [drive, loadPc, loadPhone, perm?.granted, server]);

  const phoneItems = useMemo(() => phone.map(phoneToItem), [phone]);
  const driveItems = useMemo(() => drive.items.map(driveToItem), [drive.items]);
  const pcItems = useMemo(() => pc.map(computerToItem), [pc]);
  const all = useMemo(
    () => mergeByDate([phoneItems, driveItems, pcItems]),
    [driveItems, pcItems, phoneItems],
  );

  const phoneVisible = Boolean(perm?.granted);
  const driveVisible = drive.module;
  const pcVisible = Boolean(server);
  const shown: 'all' | PhotoSource =
    filter === 'phone' && !phoneVisible
      ? 'all'
      : filter === 'drive' && !driveVisible
        ? 'all'
        : filter === 'computer' && !pcVisible
          ? 'all'
          : filter;

  const list = useMemo(
    () => (shown === 'all' ? all : all.filter((i) => i.source === shown)),
    [all, shown],
  );

  const onEnd = useCallback(() => {
    if (phoneMore) void loadPhone(false);
    if (pcMore) void loadPc(false);
  }, [loadPc, loadPhone, pcMore, phoneMore]);

  // The tile and the viewer only know GridItem; the prefix on the key is what
  // identifies the source again, so the cast is safe at this boundary.
  const driveItem = useCallback(
    (item: GridItem): GridItem => ({ ...item, key: sourceKey(item) }),
    [],
  );

  const thumbFor = useCallback(
    async (raw: GridItem): Promise<string | undefined> => {
      const item = raw as UnifiedItem;
      if (item.source === 'phone') return item.phone?.uri || undefined;
      if (item.source === 'drive') return drive.thumbForGridItem(driveItem(item));
      if (item.source === 'computer' && server) {
        return api.thumb(server, sourceKey(item), 400, item.v);
      }
      return undefined;
    },
    [drive, driveItem, server],
  );

  const originalFor = useCallback(
    async (raw: GridItem): Promise<string | undefined> => {
      const item = raw as UnifiedItem;
      if (item.source === 'phone') return item.phone?.uri || undefined;
      if (item.source === 'drive') return drive.originalForGridItem(driveItem(item));
      if (item.source === 'computer' && server) {
        return api.original(server, sourceKey(item));
      }
      return undefined;
    },
    [drive, driveItem, server],
  );

  const viewerThumb = useCallback(
    (item: GridItem) => {
      const source = (item as UnifiedItem).source;
      if (source === 'phone') return (item as UnifiedItem).phone?.uri || undefined;
      if (source === 'drive') return drive.thumbUriForGridItem(driveItem(item));
      if (source === 'computer' && server) {
        return api.thumb(server, sourceKey(item), 1600, item.v);
      }
      return undefined;
    },
    [drive, driveItem, server],
  );

  const shareItem = useCallback(
    async (item: UnifiedItem) => {
      setProblem(null);
      try {
        if (item.source === 'computer') {
          if (!server) throw new Error('Connect a computer first.');
          await shareRemoteFiles(server, [
            { key: sourceKey(item), name: item.name, kind: item.kind, size: item.size },
          ]);
          return;
        }
        const uri = await originalFor(item);
        if (!uri) {
          throw new Error(
            item.phone?.cloud
              ? 'That photo is in iCloud. Open it in Photos once to download it, then share it here.'
              : 'That file is not reachable right now. Reconnect the drive and try again.',
          );
        }
        await shareRemoteFiles('', [
          {
            key: item.name,
            name: item.name,
            kind: item.kind,
            size: item.size,
            localUri: uri,
          },
        ]);
      } catch (e) {
        setProblem(messageFor(e));
      }
    },
    [originalFor, server],
  );

  const loading = phoneLoading || pcLoading || drive.loading;
  const more = phoneMoreLoading || pcMoreLoading;

  const permitPrompt = !perm?.granted ? (
    <View style={styles.permit}>
      <Text style={styles.permitTitle}>
        {perm && !perm.canAskAgain ? 'Camera roll access is off' : 'Show this phone’s photos'}
      </Text>
      <Text style={styles.permitText}>
        OCD reads the camera roll to place your photos beside the drive and computer.
        Nothing is uploaded or deleted from here.
      </Text>
      {androidExpoGo ? (
        <Text style={styles.permitNote}>
          Expo Go cannot read the Android camera roll. Use the OCD development build.
        </Text>
      ) : (
        <View style={styles.permitAction}>
          <PrimaryButton
            label={perm && !perm.canAskAgain ? 'Open Settings' : 'Allow photo access'}
            onPress={
              perm && !perm.canAskAgain ? () => void Linking.openSettings() : ask
            }
          />
        </View>
      )}
    </View>
  ) : null;

  const empty = loading ? (
    <View style={styles.empty}>
      <ActivityIndicator color={colors.muted} />
    </View>
  ) : (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>
        {shown === 'drive'
          ? 'No photos on this drive'
          : shown === 'computer'
            ? 'No photos on this computer'
            : shown === 'phone'
              ? 'No photos on this phone'
              : 'Nothing to show yet'}
      </Text>
      <Text style={styles.emptyText}>
        {shown === 'drive'
          ? 'Plug in a drive, or index it from Devices so OCD can build a catalog.'
          : shown === 'computer'
            ? 'The computer answered, but its photo folders are empty or still being scanned.'
            : shown === 'phone'
              ? 'Take a photo, then pull down here to refresh.'
              : 'Take a photo, plug in a drive, or connect a computer on the same Wi-Fi.'}
      </Text>
      <View style={styles.emptyAction}>
        <PrimaryButton label="Open Devices" onPress={onOpenDevices} />
      </View>
    </View>
  );

  return (
    <View style={styles.root}>
      <ScreenHeader style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          Photos
        </Text>
        <Text style={styles.sub}>
          {loading
            ? 'Reading your photos…'
            : `${list.length.toLocaleString()}${shown === 'all' ? '' : ` on ${sourceLabel(shown)}`}${
                phoneMore && (shown === 'all' || shown === 'phone') ? '+' : ''
              }${drive.loading ? ' · reading drive' : ''}`}
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          <Chip label="All" active={shown === 'all'} onPress={() => setFilter('all')} />
          {phoneVisible ? (
            <Chip
              label={phoneMore ? `Phone (${phone.length}+)` : `Phone (${phone.length})`}
              active={shown === 'phone'}
              onPress={() => setFilter('phone')}
            />
          ) : null}
          {driveVisible ? (
            <Chip
              label={`Drive (${driveItems.length})`}
              active={shown === 'drive'}
              onPress={() => setFilter('drive')}
            />
          ) : null}
          {pcVisible ? (
            <Chip
              label={pcMore ? `Computer (${pc.length}+)` : `Computer (${pc.length})`}
              active={shown === 'computer'}
              onPress={() => setFilter('computer')}
            />
          ) : null}
        </ScrollView>
      </ScreenHeader>

      {problem ? <ErrorBanner message={problem} onRetry={() => void refresh()} /> : null}

      <FlatList
        data={list}
        keyExtractor={(it) => it.key}
        numColumns={COLS}
        columnWrapperStyle={{ gap: GAP }}
        contentContainerStyle={{ gap: GAP, paddingBottom: space(8) }}
        renderItem={({ item, index }) => (
          <Tile
            item={item}
            server=""
            size={cell}
            sourceLabel={shown === 'all' ? sourceLabel(item.source) : undefined}
            onPress={() => setViewer(index)}
            onLongPress={() => void shareItem(item)}
            onShare={() => void shareItem(item)}
            thumbUri={thumbFor}
          />
        )}
        ListHeaderComponent={permitPrompt ?? undefined}
        ListFooterComponent={
          more ? (
            <View style={styles.more}>
              <ActivityIndicator color={colors.muted} />
            </View>
          ) : undefined
        }
        ListEmptyComponent={permitPrompt ? undefined : empty}
        onEndReached={onEnd}
        onEndReachedThreshold={0.9}
        initialNumToRender={30}
        maxToRenderPerBatch={30}
        updateCellsBatchingPeriod={80}
        removeClippedSubviews={Platform.OS === 'android'}
        windowSize={9}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={colors.muted}
            colors={[colors.text]}
          />
        }
      />

      {viewer !== null && list[viewer] ? (
        <Viewer
          // Every preview and original comes from the resolvers above, so the
          // viewer must not fall back to a computer URL for a phone or drive
          // key: the key still carries a source prefix at this point.
          server=""
          items={list}
          start={viewer}
          onClose={() => setViewer(null)}
          thumbUriFor={viewerThumb}
          originalUriFor={originalFor}
          onShareItem={(item) => shareItem(item as UnifiedItem)}
        />
      ) : null}

      {!perm?.granted && perm && !perm.canAskAgain && !androidExpoGo ? (
        <View style={styles.footerNote}>
          <TextAction
            label="Open phone settings"
            onPress={() => void Linking.openSettings()}
            accessibilityHint="Allow camera roll access in Android or iOS settings"
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { paddingBottom: space(2) },
  title: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '700',
    letterSpacing: -0.8,
    color: colors.text,
    marginTop: space(1),
  },
  sub: { marginTop: space(1), fontSize: 13, lineHeight: 18, color: colors.muted },
  chips: { gap: space(2), paddingTop: space(2.5), paddingRight: space(2) },
  permit: {
    marginHorizontal: space(3),
    marginTop: space(2),
    marginBottom: space(2),
    padding: space(3.5),
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  permitTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  permitText: {
    marginTop: space(1),
    fontSize: 13,
    lineHeight: 19,
    color: colors.muted,
  },
  permitNote: {
    marginTop: space(2),
    fontSize: 12,
    lineHeight: 17,
    color: colors.danger,
  },
  permitAction: { marginTop: space(3), alignItems: 'flex-start' },
  more: { paddingVertical: space(4), alignItems: 'center' },
  empty: {
    paddingHorizontal: space(8),
    paddingTop: space(12),
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
  emptyAction: { marginTop: space(5) },
  footerNote: {
    alignItems: 'center',
    paddingBottom: space(1),
  },
});
