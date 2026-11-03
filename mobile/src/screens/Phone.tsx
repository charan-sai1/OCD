import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as FileSystem from 'expo-file-system/legacy';
import { api, ImportMatch, messageFor } from '../api';
import { colors, duration, radius, space } from '../theme';
import { PrimaryButton, Wordmark } from '../ui';

type PhoneAsset = {
  id: string;
  filename: string;
  uri: string;
  size?: number;
  takenAt: number;
  kind: 'image' | 'video';
  duration: number;
};

type Props = {
  server: string;
  onChangeServer: () => void;
};

const COLS = 3;
const GAP = 2;
const PAGE = 60;

export function Phone({ server, onChangeServer }: Props) {
  const { width } = useWindowDimensions();
  const cell = Math.floor((width - GAP * (COLS - 1)) / COLS);

  const [perm, setPerm] = useState<MediaLibrary.PermissionResponse | null>(null);
  const [booting, setBooting] = useState(true);
  const [assets, setAssets] = useState<PhoneAsset[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [badges, setBadges] = useState<Record<string, ImportMatch>>({});
  const [driveProblem, setDriveProblem] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [preview, setPreview] = useState<PhoneAsset | null>(null);

  const after = useRef<string | undefined>(undefined);
  const busy = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        setPerm(await MediaLibrary.getPermissionsAsync());
      } catch (e) {
        setProblem(String(e));
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  const load = useCallback(
    async (reset: boolean) => {
      if (busy.current) return;
      busy.current = true;
      if (reset) {
        after.current = undefined;
        setAssets([]);
        setBadges({});
        setHasMore(false);
        setDriveProblem(null);
        setProblem(null);
        setLoading(true);
      } else {
        setLoadingMore(true);
      }
      try {
        const page = await MediaLibrary.getAssetsAsync({
          first: PAGE,
          after: reset ? undefined : after.current,
          mediaType: ['photo', 'video'],
          sortBy: [['creationTime', false]],
        });
        const resolved = await resolveAssets(page.assets);
        setAssets((prev) => (reset ? resolved : [...prev, ...resolved]));
        after.current = page.endCursor;
        setHasMore(page.hasNextPage);

        // Size is what makes the metadata match reliable; iCloud-only assets
        // without a local copy simply show no badge.
        const withSize = resolved.filter((a) => a.size && a.size > 0);
        if (withSize.length > 0) {
          setChecking(true);
          try {
            const res = await api.importCheck(
              server,
              withSize.map((a) => ({
                name: a.filename,
                size: a.size!,
                takenAt: a.takenAt,
              })),
            );
            if (!res.drives || res.drives.length === 0) {
              setDriveProblem(
                'No drive catalog is reachable. Plug in a drive and let OCD finish scanning to see what is already backed up.',
              );
            } else {
              setDriveProblem(null);
            }
            setBadges((prev) => {
              const next = { ...prev };
              withSize.forEach((a, i) => {
                next[a.id] = res.matches[i] ?? { onDrive: false };
              });
              return next;
            });
          } catch (e) {
            setDriveProblem(messageFor(e));
          } finally {
            setChecking(false);
          }
        }
      } catch (e) {
        setProblem(String(e));
      } finally {
        busy.current = false;
        setLoading(false);
        setLoadingMore(false);
        setRefreshing(false);
      }
    },
    [server],
  );

  useEffect(() => {
    if (!perm?.granted) return;
    // Reading the roll is the whole point of the permission being granted.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(true);
  }, [perm?.granted, load]);

  const ask = async () => {
    try {
      setProblem(null);
      setPerm(await MediaLibrary.requestPermissionsAsync(false, ['photo', 'video']));
    } catch (e) {
      setProblem(String(e));
    }
  };

  const refresh = () => {
    if (busy.current) return;
    setRefreshing(true);
    load(true);
  };

  const onEnd = () => {
    if (hasMore && !busy.current) load(false);
  };

  const onDrive = assets.reduce((n, a) => n + (badges[a.id]?.onDrive ? 1 : 0), 0);

  const header = (
    <View
      style={[
        styles.header,
        { paddingTop: (Constants.statusBarHeight ?? 0) + space(2) },
      ]}
    >
      <View style={styles.brandRow}>
        <Wordmark />
        <Pressable onPress={onChangeServer} hitSlop={10} accessibilityRole="button">
          <Text style={styles.change}>Change server</Text>
        </Pressable>
      </View>
      <Text style={styles.title}>Camera roll</Text>
      <Text style={styles.stats}>
        {loading
          ? 'Reading your camera roll…'
          : `${assets.length.toLocaleString()}${hasMore ? '+' : ''} items${
              onDrive ? ` · ${onDrive} on drive` : ''
            }`}
        {checking ? '  ·  Checking drive…' : ''}
      </Text>
    </View>
  );

  if (booting) {
    return (
      <View style={styles.root}>
        {header}
        <ActivityIndicator color={colors.muted} style={styles.boot} />
      </View>
    );
  }

  if (!perm?.granted) {
    return (
      <View style={styles.root}>
        {header}
        <View style={styles.permission}>
          <Text style={styles.permTitle}>Know what is already safe</Text>
          <Text style={styles.permText}>
            OCD reads your camera roll to mark the photos that are already on your
            drive, so you only send the new ones. Nothing is uploaded until you
            choose.
          </Text>
          <View style={styles.permButton}>
            <PrimaryButton
              label={perm && !perm.canAskAgain ? 'Open Settings' : 'Allow photo access'}
              onPress={perm && !perm.canAskAgain ? () => Linking.openSettings() : ask}
            />
          </View>
          {problem ? <Text style={styles.error}>{problem}</Text> : null}
          {perm?.canAskAgain ? (
            <Pressable onPress={() => Linking.openSettings()} hitSlop={8}>
              <Text style={styles.settingsLink}>Open Settings</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {header}

      {driveProblem ? (
        <View style={styles.notice} accessibilityRole="alert">
          <Text style={styles.noticeText}>{driveProblem}</Text>
        </View>
      ) : null}
      {problem ? (
        <View style={styles.notice} accessibilityRole="alert">
          <Text style={styles.noticeText}>{problem}</Text>
        </View>
      ) : null}

      <FlatList
        data={assets}
        keyExtractor={(a) => a.id}
        numColumns={COLS}
        columnWrapperStyle={{ gap: GAP }}
        contentContainerStyle={{ gap: GAP, paddingBottom: space(8) }}
        renderItem={({ item }) => (
          <Tile item={item} cell={cell} badge={badges[item.id]} onPress={() => setPreview(item)} />
        )}
        onEndReached={onEnd}
        onEndReachedThreshold={0.9}
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
          ) : undefined
        }
        ListEmptyComponent={
          loading ? undefined : (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No photos on this phone</Text>
              <Text style={styles.emptyText}>
                Take a photo, then pull down here to refresh.
              </Text>
            </View>
          )
        }
      />

      <Modal
        visible={preview !== null}
        animationType="fade"
        onRequestClose={() => setPreview(null)}
        statusBarTranslucent
      >
        <StatusBar style="light" />
        <View style={styles.viewer}>
          {preview ? (
            <Image
              source={{ uri: preview.uri }}
              style={styles.viewerImage}
              resizeMode="contain"
            />
          ) : null}
          <Pressable
            onPress={() => setPreview(null)}
            hitSlop={14}
            style={[styles.viewerDone, { top: (Constants.statusBarHeight ?? 0) + space(2) }]}
            accessibilityRole="button"
          >
            <Text style={styles.viewerDoneText}>Done</Text>
          </Pressable>
          {preview ? (
            <View style={styles.viewerMeta}>
              <Text style={styles.viewerName} numberOfLines={1}>
                {preview.filename}
              </Text>
              <Text style={styles.viewerSub}>
                {badges[preview.id]?.onDrive
                  ? `Already on ${badges[preview.id]?.label || 'the drive'}`
                  : 'Not on the drive yet'}
              </Text>
            </View>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

const Tile = React.memo(function Tile({
  item,
  cell,
  badge,
  onPress,
}: {
  item: PhoneAsset;
  cell: number;
  badge?: ImportMatch;
  onPress: () => void;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="imagebutton"
      accessibilityLabel={item.filename}
      style={({ pressed }) => [
        { width: cell, height: cell, backgroundColor: colors.surface },
        pressed && { opacity: 0.72 },
      ]}
    >
      {!failed ? (
        <Image
          source={{ uri: item.uri }}
          style={{ width: cell, height: cell }}
          resizeMode="cover"
          onError={() => setFailed(true)}
          fadeDuration={120}
        />
      ) : (
        <View style={styles.noPreview}>
          <Text style={styles.noPreviewText}>{item.kind === 'video' ? 'Video' : 'In iCloud'}</Text>
        </View>
      )}
      {badge?.onDrive ? (
        <View style={styles.onDrive}>
          <Text style={styles.onDriveText}>✓ On drive</Text>
        </View>
      ) : null}
      {item.kind === 'video' ? (
        <View style={styles.videoBadge}>
          <Text style={styles.videoText}>▶ {duration(item.duration)}</Text>
        </View>
      ) : null}
    </Pressable>
  );
});

async function resolveAssets(list: MediaLibrary.Asset[]): Promise<PhoneAsset[]> {
  const out = new Array<PhoneAsset>(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next++;
      out[i] = await resolveOne(list[i]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(6, list.length) }, worker),
  );
  return out;
}

async function resolveOne(a: MediaLibrary.Asset): Promise<PhoneAsset> {
  let uri = a.uri;
  if (Platform.OS === 'ios') {
    try {
      // false: never pull originals down from iCloud just to show a badge.
      const info = await MediaLibrary.getAssetInfoAsync(a, {
        shouldDownloadFromNetwork: false,
      });
      if (info.localUri) uri = info.localUri;
    } catch {
      // iCloud-only asset; the tile will say so.
    }
  }
  let size: number | undefined;
  try {
    const file = await FileSystem.getInfoAsync(uri);
    if (file.exists && !file.isDirectory) size = file.size;
  } catch {
    // Size is optional; a missing size just leaves the badge unknown.
  }
  return {
    id: a.id,
    filename: a.filename,
    uri,
    size,
    takenAt: Math.round(a.creationTime / 1000),
    kind: a.mediaType === 'video' ? 'video' : 'image',
    duration: a.duration,
  };
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
    height: 34,
  },
  change: { fontSize: 13, color: colors.muted, fontWeight: '600' },
  title: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '700',
    letterSpacing: -0.8,
    color: colors.text,
    marginTop: space(1),
  },
  stats: {
    marginTop: space(2),
    fontSize: 12,
    fontWeight: '600',
    color: colors.muted,
  },
  boot: { marginTop: space(20) },
  permission: {
    paddingHorizontal: space(6),
    paddingTop: space(10),
  },
  permTitle: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '700',
    letterSpacing: -0.5,
    color: colors.text,
  },
  permText: {
    marginTop: space(3),
    fontSize: 15,
    lineHeight: 22,
    color: colors.muted,
  },
  permButton: { marginTop: space(7) },
  error: {
    marginTop: space(4),
    color: colors.danger,
    fontSize: 13,
    lineHeight: 19,
  },
  settingsLink: {
    marginTop: space(5),
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
  },
  notice: {
    marginHorizontal: space(4),
    marginBottom: space(2),
    padding: space(3),
    borderRadius: radius.md,
    backgroundColor: '#fff7ed',
  },
  noticeText: { color: '#9a3412', fontSize: 13, lineHeight: 18 },
  more: { paddingVertical: space(7), alignItems: 'center' },
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
  noPreview: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  noPreviewText: { fontSize: 11, color: colors.faint },
  onDrive: {
    position: 'absolute',
    left: 5,
    bottom: 5,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    backgroundColor: 'rgba(0,0,0,0.62)',
  },
  onDriveText: { color: colors.white, fontSize: 10, fontWeight: '700' },
  videoBadge: {
    position: 'absolute',
    right: 5,
    bottom: 5,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    backgroundColor: 'rgba(0,0,0,0.62)',
  },
  videoText: { color: colors.white, fontSize: 10, fontWeight: '700' },
  viewer: { flex: 1, backgroundColor: colors.black },
  viewerImage: { width: '100%', height: '100%' },
  viewerDone: {
    position: 'absolute',
    right: space(5),
    paddingHorizontal: space(3),
    paddingVertical: space(2),
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  viewerDoneText: { color: colors.white, fontSize: 15, fontWeight: '600' },
  viewerMeta: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space(5),
    paddingTop: space(4),
    paddingBottom: space(8),
    backgroundColor: 'rgba(0,0,0,0.55)',
    gap: 3,
  },
  viewerName: { color: colors.white, fontSize: 16, fontWeight: '600' },
  viewerSub: { color: 'rgba(255,255,255,0.7)', fontSize: 13 },
});
