import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as FileSystem from 'expo-file-system/legacy';
import { api, ImportMatch, Library, messageFor, uploadFile } from '../api';
import { colors, duration, radius, space } from '../theme';
import { Chip, PrimaryButton, Wordmark } from '../ui';

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

  const [libs, setLibs] = useState<Library[]>([]);
  const [destId, setDestId] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<'all' | 'new'>('all');
  const [sending, setSending] = useState(false);
  const [sendTotal, setSendTotal] = useState(0);
  const [sentCount, setSentCount] = useState(0);
  const [sendName, setSendName] = useState<string | null>(null);
  const [sendProgress, setSendProgress] = useState(0);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sentNote, setSentNote] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  const loadLibraries = useCallback(async () => {
    try {
      const all = await api.libraries(server);
      const usable = all.filter((l) => l.available);
      setLibs(usable);
      setDestId((prev) =>
        usable.some((l) => l.id === prev) ? prev : usable[0]?.id ?? '',
      );
    } catch {
      // The camera roll still works offline; the send bar explains the rest.
    }
  }, [server]);

  useEffect(() => {
    // Loading the library list is an external read, not derived state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadLibraries();
  }, [loadLibraries]);

  const load = useCallback(
    async (reset: boolean) => {
      if (busy.current) return;
      busy.current = true;
      if (reset) {
        after.current = undefined;
        setAssets([]);
        setHasMore(false);
        setDriveProblem(null);
        setProblem(null);
        setSendError(null);
        setSentNote(null);
        setSelected(new Set());
        setSelecting(false);
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
                const match = res.matches[i] ?? { onDrive: false };
                // A file sent a moment ago may not be in the catalog until the
                // next write lands; do not take its badge away in the meantime.
                next[a.id] =
                  match.onDrive || !prev[a.id]?.onDrive ? match : prev[a.id];
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
    loadLibraries();
    load(true);
  };

  const onEnd = () => {
    if (hasMore && !busy.current) load(false);
  };

  const onDrive = assets.reduce((n, a) => n + (badges[a.id]?.onDrive ? 1 : 0), 0);
  const newCount = assets.length - onDrive;
  const visible = filter === 'new' ? assets.filter((a) => !badges[a.id]?.onDrive) : assets;
  const dest = libs.find((l) => l.id === destId);
  const selectedItems = assets.filter((a) => selected.has(a.id));
  const selectedNew = selectedItems.filter((a) => !badges[a.id]?.onDrive).length;
  const selectedVerified = selectedItems.filter((a) => badges[a.id]?.verified).length;

  const enterSelection = () => {
    if (sending) return;
    setSelecting(true);
    setSelected(new Set());
    setSentNote(null);
  };

  const cancelSelection = () => {
    if (sending) return;
    setSelecting(false);
    setSelected(new Set());
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onTilePress = (a: PhoneAsset) => {
    if (selecting) toggle(a.id);
    else setPreview(a);
  };

  const onTileLongPress = (a: PhoneAsset) => {
    if (sending) return;
    setSelecting(true);
    setSelected((prev) => {
      const next = new Set(prev);
      next.add(a.id);
      return next;
    });
  };

  const selectAllNew = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      visible.filter((a) => !badges[a.id]?.onDrive).forEach((a) => next.add(a.id));
      return next;
    });
  };

  const markOnDrive = (
    a: PhoneAsset,
    res: { path?: string; existingPath?: string; volumeId?: string; label?: string },
    verified: boolean,
  ) => {
    setBadges((prev) => ({
      ...prev,
      [a.id]: {
        onDrive: true,
        path: res.path ?? res.existingPath,
        volumeId: res.volumeId,
        label: res.label,
        verified,
      },
    }));
  };

  const send = async () => {
    if (!dest || sending || deleting) return;
    const list = assets.filter((a) => selected.has(a.id) && !badges[a.id]?.onDrive);
    if (list.length === 0) return;
    setSending(true);
    setSendError(null);
    setSentNote(null);
    setSendTotal(list.length);
    setSentCount(0);
    setSendProgress(0);
    let done = 0;
    let verified = 0;
    let failed = 0;

    for (const a of list) {
      setSendName(a.filename);
      setSendProgress(0);
      try {
        const ready = await ensureUploadable(a);
        if (!ready) {
          throw new Error('This item is only in iCloud and could not be downloaded.');
        }
        const start = await api.uploadStart(server, {
          libraryId: dest.id,
          name: a.filename,
          size: ready.size,
          takenAt: a.takenAt,
          kind: a.kind,
        });
        if (start.existingPath) {
          markOnDrive(a, start, false);
          done++;
          setSentCount(done);
          continue;
        }
        if (!start.uploadId) throw new Error('The desktop did not start the upload.');
        try {
          await uploadFile(server, start.uploadId, ready.uri, (sentBytes, totalBytes) => {
            setSendProgress(totalBytes > 0 ? sentBytes / totalBytes : 0);
          });
          const fin = await api.uploadFinish(server, start.uploadId);
          markOnDrive(a, fin, true);
          done++;
          verified++;
          setSentCount(done);
        } catch (e) {
          // Never leave a half-written file among the real ones.
          try {
            await api.uploadAbort(server, start.uploadId);
          } catch {
            // The session may already be gone.
          }
          throw e;
        }
      } catch (e) {
        failed++;
        setSendError(`${a.filename}: ${messageFor(e)}`);
      }
    }

    setSending(false);
    setSendName(null);
    if (failed === 0) {
      // Show the tiles that just became backed up, so the verify-then-delete
      // step is right in front of the user.
      setFilter('all');
      setSentNote(
        verified > 0
          ? `Sent ${done} ${done === 1 ? 'item' : 'items'} to ${dest.name}. Delete from the phone when you are ready.`
          : done === 1
            ? 'That item was already on the drive.'
            : 'Those items were already on the drive.',
      );
    } else {
      setSentNote(`Sent ${done} of ${list.length}. ${failed} could not be sent.`);
    }
  };

  const deleteSelected = () => {
    if (sending || deleting) return;
    const items = assets.filter((a) => selected.has(a.id) && badges[a.id]?.verified);
    if (items.length === 0) return;
    Alert.alert(
      `Delete ${items.length} ${items.length === 1 ? 'item' : 'items'} from this phone?`,
      'A verified copy is already on the drive. This frees space on the phone and cannot be undone.',
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void deleteItems(items);
          },
        },
      ],
    );
  };

  const deleteItems = async (items: PhoneAsset[]) => {
    const ids = items.map((a) => a.id);
    setDeleting(true);
    setSendError(null);
    setSentNote(null);
    try {
      const ok = await MediaLibrary.deleteAssetsAsync(ids);
      if (!ok) throw new Error('The phone did not delete those items.');
      const idSet = new Set(ids);
      setAssets((prev) => prev.filter((a) => !idSet.has(a.id)));
      setBadges((prev) => {
        const next = { ...prev };
        ids.forEach((id) => delete next[id]);
        return next;
      });
      setSelected((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      setSentNote(
        `Deleted ${ids.length} ${ids.length === 1 ? 'item' : 'items'} from the phone. The drive copy is still there.`,
      );
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      setSendError(text);
    } finally {
      setDeleting(false);
    }
  };

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
      <View style={styles.titleRow}>
        <Text style={styles.title}>{selecting ? 'Select photos' : 'Camera roll'}</Text>
        {assets.length > 0 ? (
          <Pressable
            onPress={selecting ? cancelSelection : enterSelection}
            hitSlop={10}
            disabled={sending}
            accessibilityRole="button"
          >
            <Text style={[styles.change, sending && styles.dim]}>
              {selecting ? 'Cancel' : 'Select'}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.stats}>
        {loading
          ? 'Reading your camera roll…'
          : `${assets.length.toLocaleString()}${hasMore ? '+' : ''} items${
              onDrive ? ` · ${onDrive} on drive` : ''
            }${newCount ? ` · ${newCount} new` : ''}`}
        {checking ? '  ·  Checking drive…' : ''}
      </Text>
      {selecting ? (
        <View style={styles.selectRow}>
          <Text style={styles.selectCount}>{selected.size} selected</Text>
          <Pressable onPress={selectAllNew} hitSlop={8} accessibilityRole="button">
            <Text style={styles.selectAction}>Select all new</Text>
          </Pressable>
        </View>
      ) : null}
      {assets.length > 0 ? (
        <View style={styles.filterRow}>
          <Chip label="All" active={filter === 'all'} onPress={() => setFilter('all')} />
          <Chip
            label={newCount ? `Not on drive (${newCount})` : 'Not on drive'}
            active={filter === 'new'}
            onPress={() => setFilter('new')}
          />
        </View>
      ) : null}
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
      {sendError ? (
        <View style={styles.notice} accessibilityRole="alert">
          <Text style={styles.noticeText}>{sendError}</Text>
        </View>
      ) : null}
      {sentNote ? (
        <View style={styles.okNotice}>
          <Text style={styles.okText}>{sentNote}</Text>
        </View>
      ) : null}

      <FlatList
        data={visible}
        extraData={selected}
        keyExtractor={(a) => a.id}
        numColumns={COLS}
        columnWrapperStyle={{ gap: GAP }}
        contentContainerStyle={{ gap: GAP, paddingBottom: space(8) }}
        renderItem={({ item }) => (
          <Tile
            item={item}
            cell={cell}
            badge={badges[item.id]}
            selecting={selecting}
            selected={selected.has(item.id)}
            onPress={() => onTilePress(item)}
            onLongPress={() => onTileLongPress(item)}
          />
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
              <Text style={styles.emptyTitle}>
                {filter === 'new' ? 'Nothing new here' : 'No photos on this phone'}
              </Text>
              <Text style={styles.emptyText}>
                {filter === 'new'
                  ? 'Every photo loaded so far is already on the drive.'
                  : 'Take a photo, then pull down here to refresh.'}
              </Text>
            </View>
          )
        }
      />

      {selecting ? (
        <View style={styles.sendBar}>
          <View style={styles.destRow}>
            <Text style={styles.sendLabel}>Send to</Text>
            {libs.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.destChips}
                keyboardShouldPersistTaps="handled"
              >
                {libs.map((l) => (
                  <Chip
                    key={l.id}
                    label={l.name}
                    active={l.id === destId}
                    onPress={() => setDestId(l.id)}
                  />
                ))}
              </ScrollView>
            ) : (
              <Text style={styles.sendMissing} numberOfLines={1}>
                No drive folder connected
              </Text>
            )}
          </View>
          <View style={styles.sendRow}>
            <View style={styles.sendInfo}>
              <Text style={styles.sendTitle}>
                {selected.size
                  ? `${selected.size} selected`
                  : 'Tap photos to select them'}
              </Text>
              <Text style={styles.sendSub} numberOfLines={1}>
                {sending
                  ? `${sendName ?? 'Sending'} · ${Math.round(sendProgress * 100)}%${
                      sendTotal ? ` — ${sentCount}/${sendTotal}` : ''
                    }`
                  : selectedNew > 0
                    ? dest
                      ? `To ${dest.name}`
                      : 'Choose a drive above'
                    : selected.size > 0
                      ? 'Already on the drive'
                      : 'Tap photos to select them'}
              </Text>
            </View>
            {selectedVerified > 0 ? (
              <Pressable
                onPress={deleteSelected}
                disabled={sending || deleting}
                accessibilityRole="button"
                accessibilityLabel="Delete the verified copies from this phone"
                style={({ pressed }) => [
                  styles.deleteButton,
                  (sending || deleting) && styles.dim,
                  pressed && { opacity: 0.7 },
                ]}
              >
                {deleting ? (
                  <ActivityIndicator color={colors.danger} />
                ) : (
                  <Text style={styles.deleteText}>Delete {selectedVerified}</Text>
                )}
              </Pressable>
            ) : null}
            {selectedNew > 0 ? (
              <Pressable
                onPress={send}
                disabled={!dest || sending || deleting}
                accessibilityRole="button"
                accessibilityLabel="Send selected photos to the drive"
                style={({ pressed }) => [
                  styles.sendButton,
                  (!dest || sending || deleting) && styles.dim,
                  pressed && styles.sendButtonPressed,
                ]}
              >
                {sending ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Text style={styles.sendButtonText}>Send {selectedNew}</Text>
                )}
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

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
  selecting,
  selected,
  onPress,
  onLongPress,
}: {
  item: PhoneAsset;
  cell: number;
  badge?: ImportMatch;
  selecting: boolean;
  selected: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={260}
      accessibilityRole="imagebutton"
      accessibilityLabel={item.filename}
      accessibilityState={selecting ? { selected } : undefined}
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
      {selecting ? (
        <View style={[styles.selectCircle, selected && styles.selectCircleOn]}>
          {selected ? <Text style={styles.selectTick}>✓</Text> : null}
        </View>
      ) : null}
      {selected ? <View pointerEvents="none" style={styles.selectedRing} /> : null}
    </Pressable>
  );
});

// ensureUploadable returns a local file the streaming uploader can read. An
// iCloud-only item is fetched first; nothing is sent until it exists.
async function ensureUploadable(
  a: PhoneAsset,
): Promise<{ uri: string; size: number } | null> {
  let uri = a.uri;
  if (Platform.OS === 'ios') {
    try {
      const info = await MediaLibrary.getAssetInfoAsync(a.id, {
        shouldDownloadFromNetwork: true,
      });
      if (info.localUri) uri = info.localUri;
    } catch {
      // Fall back to the URI we already have.
    }
  }
  try {
    const file = await FileSystem.getInfoAsync(uri);
    if (file.exists && !file.isDirectory) return { uri, size: file.size };
  } catch {
    // Missing cache copy or an unreadable URI.
  }
  return null;
}

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
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: space(3),
  },
  change: { fontSize: 13, color: colors.muted, fontWeight: '600' },
  dim: { opacity: 0.45 },
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
  filterRow: {
    flexDirection: 'row',
    marginTop: space(3),
  },
  selectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space(2),
  },
  selectCount: { fontSize: 13, fontWeight: '700', color: colors.text },
  selectAction: { fontSize: 13, fontWeight: '600', color: colors.muted },
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
  okNotice: {
    marginHorizontal: space(4),
    marginBottom: space(2),
    padding: space(3),
    borderRadius: radius.md,
    backgroundColor: '#ecfdf3',
  },
  okText: { color: '#027a48', fontSize: 13, lineHeight: 18 },
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
  selectCircle: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.white,
    backgroundColor: 'rgba(0,0,0,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectCircleOn: { backgroundColor: colors.text, borderColor: colors.text },
  selectTick: { color: colors.white, fontSize: 13, fontWeight: '800', lineHeight: 16 },
  selectedRing: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    borderWidth: 3,
    borderColor: colors.text,
  },
  sendBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    backgroundColor: colors.bg,
    paddingHorizontal: space(4),
    paddingTop: space(2.5),
    paddingBottom: space(3),
  },
  destRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    marginBottom: space(2),
  },
  destChips: { gap: 0 },
  sendLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.faint,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  sendMissing: { flex: 1, fontSize: 12, color: colors.muted },
  sendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
  },
  sendInfo: { flex: 1, gap: 2 },
  sendTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  sendSub: { fontSize: 12, color: colors.muted },
  sendButton: {
    height: 42,
    minWidth: 84,
    paddingHorizontal: space(5),
    borderRadius: radius.pill,
    backgroundColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonPressed: { opacity: 0.8 },
  sendButtonText: { color: colors.white, fontSize: 15, fontWeight: '700' },
  deleteButton: {
    height: 42,
    minWidth: 88,
    paddingHorizontal: space(4),
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteText: { color: colors.danger, fontSize: 14, fontWeight: '700' },
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
