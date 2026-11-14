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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as FileSystem from 'expo-file-system/legacy';
import { api, ImportMatch, Library, messageFor } from '../api';
import { BottomBar, ScreenHeader, TextAction } from '../layout';
import {
  clearFinished,
  enqueueSend,
  pendingCount,
  readSendQueue,
  retryFailed,
  runSendQueue,
  type QueuedItem,
} from '../sendQueue';
import { colors, duration, radius, space, takenOn } from '../theme';
import { Chip, PrimaryButton, Wordmark } from '../ui';

type PhoneAsset = {
  id: string;
  filename: string;
  uri: string;
  cloud?: boolean;
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
  const insets = useSafeAreaInsets();
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
  const [queue, setQueue] = useState<QueuedItem[]>([]);

  const after = useRef<string | undefined>(undefined);
  const busy = useRef(false);
  const sendStop = useRef(false);
  const draining = useRef(false);
  const autoResumed = useRef(false);

  const androidExpoGo = Platform.OS === 'android' && Constants.appOwnership === 'expo';

  useEffect(() => {
    (async () => {
      try {
        setPerm(await MediaLibrary.getPermissionsAsync());
      } catch (e) {
        setProblem(permissionProblem(e));
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
      setProblem(permissionProblem(e));
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
  const waitingCount = pendingCount(queue);
  const failedCount = queue.filter((i) => i.state === 'failed').length;

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

  const refreshQueue = useCallback(async () => {
    const all = await readSendQueue();
    setQueue(all.filter((i) => i.server === server));
  }, [server]);

  const drainQueue = useCallback(
    async (libraryId: string) => {
      if (draining.current) return;
      draining.current = true;
      sendStop.current = false;
      setSending(true);
      setSendError(null);
      setSentNote(null);
      setSendTotal(0);
      setSentCount(0);
      setSendProgress(0);
      try {
        const result = await runSendQueue(server, {
          libraryId,
          onProgress: (p) => {
            if (p.total > 0) {
              setSendTotal(p.total);
              setSentCount(p.done + p.failed);
              setSendProgress(p.totalBytes > 0 ? p.sentBytes / p.totalBytes : 0);
            }
            if (p.name) setSendName(p.name);
          },
          onItemFinished: (item) => {
            if (item.state !== 'done') return;
            setBadges((prev) => ({
              ...prev,
              [item.assetId]: {
                onDrive: true,
                path: item.path,
                label: item.libraryName,
                verified: Boolean(item.verified),
              },
            }));
          },
          shouldStop: () => sendStop.current,
        });

        const waiting = pendingCount(await readSendQueue(), libraryId);
        if (result.stopped) {
          setSentNote(`Stopped. ${result.done} sent; ${waiting} still queued.`);
        } else if (result.failed > 0) {
          setSentNote(
            `Sent ${result.done} of ${result.done + result.failed}. ${result.failed} could not be sent and stay in the queue.`,
          );
        } else if (result.done > 0) {
          // Show the tiles that just became backed up, so the verify-then-delete
          // step is right in front of the user.
          setFilter('all');
          setSentNote(
            result.verified > 0
              ? `Sent ${result.done} ${result.done === 1 ? 'item' : 'items'}. Delete from the phone when you are ready.`
              : result.done === 1
                ? 'That item was already on the drive.'
                : 'Those items were already on the drive.',
          );
        }
      } catch (e) {
        setSendError(messageFor(e));
      } finally {
        setSending(false);
        setSendName(null);
        draining.current = false;
        await refreshQueue();
      }
    },
    [server, refreshQueue],
  );

  const send = async () => {
    if (!dest || sending || deleting) return;
    const list = assets.filter((a) => selected.has(a.id) && !badges[a.id]?.onDrive);
    if (list.length === 0) return;
    setSendError(null);
    setSentNote(null);
    try {
      const next = await enqueueSend(
        server,
        { id: dest.id, name: dest.name },
        list.map((a) => ({
          assetId: a.id,
          name: a.filename,
          size: a.size ?? 0,
          takenAt: a.takenAt,
          kind: a.kind,
        })),
      );
      setQueue(next);
      await drainQueue(dest.id);
    } catch (e) {
      setSendError(messageFor(e));
    }
  };

  const retryQueue = async () => {
    setQueue(await retryFailed(server));
    if (dest) await drainQueue(dest.id);
  };

  const clearQueue = async () => {
    setQueue(await clearFinished(server));
  };

  useEffect(() => {
    // The queue lives on disk, so reading it is an external read.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshQueue();
  }, [refreshQueue]);

  useEffect(() => {
    autoResumed.current = false;
  }, [server]);

  useEffect(() => {
    if (autoResumed.current) return;
    if (!perm?.granted || sending || deleting) return;
    if (!dest) return;
    if (pendingCount(queue, dest.id) === 0) return;
    autoResumed.current = true;
    // One frame of visible "resuming" before the first upload starts.
    const timer = setTimeout(() => {
      void drainQueue(dest.id);
    }, 600);
    return () => clearTimeout(timer);
  }, [perm?.granted, sending, deleting, dest, queue, drainQueue]);

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
    <ScreenHeader style={styles.header}>
      <View style={styles.brandRow}>
        <Wordmark />
        <TextAction
          label="Change server"
          onPress={onChangeServer}
          accessibilityHint="Enter a different computer address"
        />
      </View>
      <View style={styles.titleRow}>
        <Text style={styles.title} accessibilityRole="header">
          {selecting ? 'Select photos' : 'Camera roll'}
        </Text>
        {assets.length > 0 ? (
          <TextAction
            label={selecting ? 'Cancel' : 'Select'}
            onPress={selecting ? cancelSelection : enterSelection}
            disabled={sending}
            accessibilityHint={selecting ? 'Stops selecting' : 'Pick photos to send'}
          />
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
          <TextAction
            label="Select all new"
            onPress={selectAllNew}
            accessibilityHint="Selects every photo that is not on the drive yet"
          />
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
    </ScreenHeader>
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
          {androidExpoGo ? (
            <View style={styles.permNotice}>
              <Text style={styles.permNoticeText}>
                Expo Go cannot read the Android camera roll. Open the OCD development
                build on Android, or use the iPhone for now.
              </Text>
            </View>
          ) : (
            <>
              <View style={styles.permButton}>
                <PrimaryButton
                  label={perm && !perm.canAskAgain ? 'Open Settings' : 'Allow photo access'}
                  onPress={perm && !perm.canAskAgain ? () => Linking.openSettings() : ask}
                />
              </View>
              {perm?.canAskAgain ? (
                <TextAction label="Open Settings" onPress={() => Linking.openSettings()} />
              ) : null}
            </>
          )}
          {problem ? <Text style={styles.error}>{problem}</Text> : null}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {header}

      {waitingCount + failedCount > 0 ? (
        <View style={styles.queueBar}>
          <View style={styles.queueTextWrap}>
            <Text style={styles.queueTitle} numberOfLines={1}>
              {sending
                ? sendName ?? 'Sending'
                : `${waitingCount} waiting to send${
                    failedCount ? ` · ${failedCount} failed` : ''
                  }`}
            </Text>
            <Text style={styles.queueSub} numberOfLines={1}>
              {sending
                ? `${sendTotal ? `${sentCount} of ${sendTotal}` : 'Starting…'}${
                    sendProgress ? ` · ${Math.round(sendProgress * 100)}%` : ''
                  }`
                : failedCount > 0
                  ? queue.find((i) => i.state === 'failed')?.error ??
                    'Some items could not be sent'
                  : 'Survives closing the app'}
            </Text>
          </View>
          <View style={styles.queueActions}>
            {sending ? (
              <TextAction
                label="Stop"
                onPress={() => {
                  sendStop.current = true;
                }}
                accessibilityHint="Finish the current item, then pause the queue"
              />
            ) : (
              <>
                {waitingCount > 0 && dest ? (
                  <TextAction label="Resume" onPress={() => void drainQueue(dest.id)} />
                ) : null}
                {failedCount > 0 ? (
                  <TextAction label="Retry" onPress={() => void retryQueue()} />
                ) : null}
                <TextAction label="Clear" onPress={() => void clearQueue()} />
              </>
            )}
          </View>
        </View>
      ) : null}

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
        <BottomBar style={styles.sendBar}>
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
        </BottomBar>
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
            preview.uri ? (
              <Image
                source={{ uri: preview.uri }}
                style={styles.viewerImage}
                resizeMode="contain"
              />
            ) : (
              <View style={styles.viewerCloud}>
                <Text style={styles.viewerCloudTitle}>In iCloud</Text>
                <Text style={styles.viewerCloudText}>
                  Select this item and send it to download the original first.
                </Text>
              </View>
            )
          ) : null}
          <Pressable
            onPress={() => setPreview(null)}
            style={[styles.viewerDone, { top: insets.top + space(2) }]}
            accessibilityRole="button"
            accessibilityLabel="Close preview"
          >
            <Text style={styles.viewerDoneText}>Done</Text>
          </Pressable>
          {preview ? (
            <View style={[styles.viewerMeta, { paddingBottom: insets.bottom + space(4) }]}>
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
  const showImage = Boolean(item.uri) && !failed;
  const label = [
    item.kind === 'video' ? 'Video' : 'Photo',
    takenOn(item.takenAt),
    item.cloud ? 'in iCloud' : '',
    badge?.onDrive ? `already on ${badge.label || 'the drive'}` : 'not on the drive',
    selecting ? (selected ? 'selected' : 'not selected') : '',
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={260}
      accessibilityRole="imagebutton"
      accessibilityLabel={label}
      accessibilityState={selecting ? { selected } : undefined}
      accessibilityHint={selecting ? 'Toggles selection' : 'Opens a preview'}
      style={({ pressed }) => [
        { width: cell, height: cell, backgroundColor: colors.surface },
        pressed && { opacity: 0.72 },
      ]}
    >
      {showImage ? (
        <Image
          source={{ uri: item.uri }}
          style={{ width: cell, height: cell }}
          resizeMode="cover"
          onError={() => setFailed(true)}
          fadeDuration={120}
        />
      ) : (
        <View style={styles.noPreview}>
          <Text style={styles.noPreviewText}>
            {item.cloud ? 'In iCloud' : item.kind === 'video' ? 'Video' : 'Preview unavailable'}
          </Text>
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
  let cloud = false;
  if (Platform.OS === 'ios') {
    try {
      // false: never pull originals down from iCloud just to show a badge.
      const info = await MediaLibrary.getAssetInfoAsync(a, {
        shouldDownloadFromNetwork: false,
      });
      if (info.localUri) uri = info.localUri;
      else cloud = true;
    } catch {
      // iCloud-only asset; the tile will say so.
      cloud = true;
    }
    // React Native's image loader has no handler for ph://. Handing it one
    // just logs "No suitable image URL loader found" and leaves an empty tile.
    if (uri.startsWith('ph://')) {
      cloud = true;
      uri = '';
    }
  }
  let size: number | undefined;
  if (uri) {
    try {
      const file = await FileSystem.getInfoAsync(uri);
      if (file.exists && !file.isDirectory) size = file.size;
    } catch {
      // Size is optional; a missing size just leaves the badge unknown.
    }
  }
  return {
    id: a.id,
    filename: a.filename,
    uri,
    cloud,
    size,
    takenAt: Math.round(a.creationTime / 1000),
    kind: a.mediaType === 'video' ? 'video' : 'image',
    duration: a.duration,
  };
}

function permissionProblem(e: unknown): string {
  if (Platform.OS === 'android' && Constants.appOwnership === 'expo') {
    return 'Expo Go cannot grant camera-roll access on Android. Use the iPhone, or install the OCD development build.';
  }
  return e instanceof Error ? e.message : String(e);
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
  permNotice: {
    marginTop: space(5),
    padding: space(4),
    borderRadius: radius.md,
    backgroundColor: '#fff7ed',
  },
  permNoticeText: { color: '#9a3412', fontSize: 14, lineHeight: 20 },
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
  queueBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    marginHorizontal: space(4),
    marginBottom: space(2),
    paddingHorizontal: space(3),
    paddingVertical: space(2),
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  queueTextWrap: { flex: 1, minWidth: 0 },
  queueTitle: { fontSize: 13, fontWeight: '700', color: colors.text },
  queueSub: { fontSize: 11, color: colors.muted, marginTop: 1 },
  queueActions: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
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
    backgroundColor: colors.bg,
    paddingHorizontal: space(4),
    paddingTop: space(2.5),
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
  viewerCloud: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space(10),
  },
  viewerCloudTitle: { color: colors.white, fontSize: 22, fontWeight: '700' },
  viewerCloudText: {
    marginTop: space(2),
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
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
