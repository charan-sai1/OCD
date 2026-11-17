import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  RefreshControl,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as MediaLibrary from 'expo-media-library/legacy';

import { api, messageFor } from '../api';
import { phoneFreeBytes } from '../direct/deviceSpace';
import { freeAfter } from '../direct/spacePlan';
import type { DriveSession } from '../direct/session';
import { volumeName } from '../direct/native';
import {
  forgetVerified,
  readVerified,
  type VerifiedItem,
} from '../sendQueue';
import { BottomBar, ScreenHeader, TextAction } from '../layout';
import { colors, radius, space, bytes, takenOn } from '../theme';
import { PrimaryButton } from '../ui';

/** How many camera-roll lookups run at once while checking presence. */
const CHECK_CHUNK = 25;

type Presence = 'checking' | 'present' | 'gone';

type Props = {
  server: string | null;
  drive: DriveSession;
  onOpenDevices: () => void;
  /** Bumped when the camera roll changed in another screen. */
  phoneRevision: number;
  onDeleted: (assetIds: string[]) => void;
};

/**
 * Space shows what is left on the phone and on the open drive, and offers the
 * one destructive action in the app: deleting phone copies that a computer has
 * already checked by hash. A catalog match is not proof, so only the verified
 * store reaches this list. The drive copies and the phone originals are never
 * touched by anything else here.
 */
export function Space({ server, drive, onOpenDevices, phoneRevision, onDeleted }: Props) {
  const [items, setItems] = useState<VerifiedItem[]>([]);
  const [presence, setPresence] = useState<Record<string, Presence>>({});
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [phoneFree, setPhoneFree] = useState<number | null>(null);
  const [checking, setChecking] = useState(true);
  const [working, setWorking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const run = useRef(0);

  const load = useCallback(async () => {
    const token = ++run.current;
    setChecking(true);
    setError(null);
    try {
      const [free, list] = await Promise.all([
        phoneFreeBytes(),
        server ? readVerified(server) : Promise.resolve([] as VerifiedItem[]),
      ]);
      if (token !== run.current) return;
      setPhoneFree(free);
      setItems(list);
      setPicked(new Set());
      setPresence(
        Object.fromEntries(list.map((i) => [i.assetId, 'checking' as Presence])),
      );

      // The store is the source of truth; this pass only notices items that
      // have already been removed elsewhere so the list never lies.
      for (let i = 0; i < list.length; i += CHECK_CHUNK) {
        const chunk = list.slice(i, i + CHECK_CHUNK);
        const answers = await Promise.all(
          chunk.map(async (item) => {
            try {
              await MediaLibrary.getAssetInfoAsync(item.assetId);
              return [item.assetId, 'present' as Presence] as const;
            } catch {
              return [item.assetId, 'gone' as Presence] as const;
            }
          }),
        );
        if (token !== run.current) return;
        setPresence((prev) => {
          const next = { ...prev };
          for (const [id, state] of answers) next[id] = state;
          return next;
        });
      }
    } catch (e) {
      if (token === run.current) setError(messageFor(e));
    } finally {
      if (token === run.current) setChecking(false);
    }
  }, [server]);

  useEffect(() => {
    // Reading the store and the camera roll are external reads, not derived
    // state; the page also re-runs this when a delete happened elsewhere.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, phoneRevision]);

  const refreshFree = drive.refreshFree;

  useEffect(() => {
    void refreshFree();
  }, [refreshFree]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void load();
    });
    return () => sub.remove();
  }, [load]);

  const present = items.filter((i) => presence[i.assetId] === 'present');
  const gone = items.filter((i) => presence[i.assetId] === 'gone');
  const selected = present.filter((i) => picked.has(i.assetId));
  const selectedBytes = selected.reduce((n, i) => n + i.size, 0);
  const freeableBytes = present.reduce((n, i) => n + i.size, 0);

  const toggle = (assetId: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  };

  const selectAll = () => setPicked(new Set(present.map((i) => i.assetId)));

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.allSettled([load(), drive.refreshFree()]);
    setRefreshing(false);
  }, [drive, load]);

  const forgetGone = async () => {
    if (!server) return;
    setWorking(true);
    setError(null);
    try {
      await forgetVerified(server, gone.map((i) => i.assetId));
      setItems((prev) => prev.filter((i) => presence[i.assetId] !== 'gone'));
      setNote(
        gone.length === 1
          ? 'That item was already gone from this phone.'
          : `${gone.length} items were already gone from this phone.`,
      );
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setWorking(false);
    }
  };

  const recordFree = async (deleted: VerifiedItem[]): Promise<number> => {
    if (!server) return 0;
    const groups = new Map<string, { count: number; bytes: number; name?: string }>();
    for (const item of deleted) {
      const group = groups.get(item.libraryId) ?? { count: 0, bytes: 0 };
      group.count += 1;
      group.bytes += item.size;
      if (item.name) group.name = item.name;
      groups.set(item.libraryId, group);
    }
    let failed = 0;
    for (const [libraryId, group] of groups) {
      try {
        await api.freeRecord(server, {
          libraryId,
          count: group.count,
          bytes: group.bytes,
          name: group.count === 1 ? group.name : undefined,
        });
      } catch {
        failed += 1;
      }
    }
    return failed;
  };

  const doDelete = async (deleted: VerifiedItem[]) => {
    setWorking(true);
    setError(null);
    setNote(null);
    const ids = deleted.map((i) => i.assetId);
    const freed = deleted.reduce((n, i) => n + i.size, 0);
    try {
      const ok = await MediaLibrary.deleteAssetsAsync(ids);
      if (!ok) throw new Error('The phone did not delete those items.');
      // Only now forget the proof, so a partial failure keeps the rest listed.
      if (server) await forgetVerified(server, ids);
      const logFailures = await recordFree(deleted);
      const freeNow = await phoneFreeBytes();
      setPhoneFree(freeNow);
      const drop = new Set(ids);
      setItems((prev) => prev.filter((i) => !drop.has(i.assetId)));
      setPicked(new Set());
      onDeleted(ids);
      setNote(
        `Deleted ${ids.length.toLocaleString()} ${
          ids.length === 1 ? 'item' : 'items'
        } · ${bytes(freed)} freed on this phone.${
          freeNow !== null ? ` ${bytes(freeNow)} is free now.` : ''
        } ${
          logFailures
            ? 'The computer log could not be updated, but its copies are unchanged.'
            : 'The computer log recorded the change.'
        }`,
      );
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setWorking(false);
    }
  };

  const confirmDelete = () => {
    if (picked.size === 0 || working) return;
    const count = selected.length;
    Alert.alert(
      `Delete ${count.toLocaleString()} ${count === 1 ? 'item' : 'items'} from this phone?`,
      `${bytes(selectedBytes)} will be freed. The computer checked and kept a copy of every one of these, and those copies stay exactly as they are. This cannot be undone.`,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void doDelete(selected);
          },
        },
      ],
    );
  };

  const driveLabel = drive.active
    ? volumeName(drive.active.volume)
    : drive.saf?.label ?? '';

  const header = (
    <View>
      <View style={styles.metrics}>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>This phone</Text>
          <Text style={styles.metricValue}>
            {phoneFree === null ? 'Unknown' : bytes(phoneFree)}
          </Text>
          <Text style={styles.metricSub}>
            {picked.size > 0 && phoneFree !== null
              ? `${bytes(freeAfter(phoneFree, selectedBytes) ?? phoneFree)} after deleting`
              : 'free space'}
          </Text>
        </View>

        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>
            {driveLabel || 'Drive'}
          </Text>
          <Text style={styles.metricValue}>
            {drive.free === null ? 'Unknown' : bytes(drive.free)}
          </Text>
          <Text style={styles.metricSub}>
            {drive.active || drive.saf ? 'free on this drive' : 'no drive open'}
          </Text>
          {!drive.active && !drive.saf ? (
            <View style={styles.metricAction}>
              <TextAction
                label="Open Devices"
                onPress={onOpenDevices}
                accessibilityHint="Plug in a drive or connect a computer"
              />
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.summary}>
        <Text style={styles.summaryTitle}>
          {!server
            ? 'Verified cleanup needs a computer'
            : checking
              ? 'Checking what is still on this phone…'
              : present.length > 0
                ? `${bytes(freeableBytes)} can be freed`
                : 'Nothing to free right now'}
        </Text>
        <Text style={styles.summarySub}>
          {!server
            ? 'Connect a computer on this Wi-Fi to send photos. Once it has checked a copy by hash, the phone copy can be deleted here.'
            : picked.size > 0
              ? `${picked.size.toLocaleString()} of ${present.length.toLocaleString()} selected · ${bytes(selectedBytes)}`
              : present.length > 0
                ? `${present.length.toLocaleString()} ${
                    present.length === 1 ? 'item' : 'items'
                  } checked by the computer. Pick some, or select all.`
                : 'Send photos from Backups first, then check back here.'}
        </Text>
        {server && present.length > 0 ? (
          <View style={styles.actions}>
            <Text
              onPress={picked.size === present.length ? () => setPicked(new Set()) : selectAll}
              accessibilityRole="button"
              accessibilityLabel={
                picked.size === present.length ? 'Clear selection' : 'Select every item'
              }
              style={styles.action}
            >
              {picked.size === present.length ? 'Clear selection' : 'Select all'}
            </Text>
          </View>
        ) : null}
      </View>

      {error ? (
        <View style={styles.errorBox} accessibilityRole="alert">
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
      {note ? (
        <View style={styles.noteBox}>
          <Text style={styles.noteText}>{note}</Text>
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={styles.root}>
      <ScreenHeader style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          Space
        </Text>
        <Text style={styles.sub}>
          Room on this phone and the open drive. Only checked copies can be deleted.
        </Text>
      </ScreenHeader>

      <FlatList
        data={server ? items : []}
        keyExtractor={(i) => i.assetId}
        contentContainerStyle={{ paddingBottom: space(10) }}
        ListHeaderComponent={header}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={colors.muted}
            colors={[colors.text]}
          />
        }
        renderItem={({ item }) => {
          const state = presence[item.assetId] ?? 'checking';
          const isPicked = picked.has(item.assetId);
          const disabled = state !== 'present';
          return (
            <Pressable
              onPress={() => {
                if (!disabled) toggle(item.assetId);
              }}
              disabled={disabled}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isPicked, disabled }}
              accessibilityLabel={item.name}
              style={({ pressed }) => [
                styles.row,
                pressed && styles.rowPressed,
                disabled && styles.rowDisabled,
              ]}
            >
              <View style={[styles.check, isPicked && styles.checkOn]}>
                {isPicked ? <Text style={styles.tick}>✓</Text> : null}
              </View>
              <View style={styles.rowText}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {bytes(item.size)} · {takenOn(item.takenAt)}
                  {item.libraryName ? ` · ${item.libraryName}` : ''}
                </Text>
                {state === 'gone' ? (
                  <Text style={styles.gone}>No longer on this phone</Text>
                ) : state === 'checking' ? (
                  <Text style={styles.meta}>Checking…</Text>
                ) : (
                  <Text style={styles.verified}>Checked by the computer</Text>
                )}
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          !server ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Connect a computer</Text>
              <Text style={styles.emptyText}>
                Verified cleanup is only offered for copies a computer has checked by
                hash. The drive still shows its free space above.
              </Text>
              <View style={styles.emptyAction}>
                <PrimaryButton label="Open Devices" onPress={onOpenDevices} />
              </View>
            </View>
          ) : checking ? (
            <View style={styles.empty}>
              <ActivityIndicator color={colors.muted} />
            </View>
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No verified items yet</Text>
              <Text style={styles.emptyText}>
                Send photos from Backups. Once the computer has checked a copy, it shows
                up here so you can delete it from the phone.
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          gone.length > 0 ? (
            <View style={styles.forget}>
              <Text
                onPress={() => void forgetGone()}
                accessibilityRole="button"
                accessibilityLabel="Forget items that are already gone"
                style={styles.action}
              >
                Forget {gone.length.toLocaleString()} already-gone{' '}
                {gone.length === 1 ? 'item' : 'items'}
              </Text>
            </View>
          ) : undefined
        }
      />

      {server ? (
        <BottomBar>
          <PrimaryButton
            label={
              picked.size === 0
                ? 'Choose items to free space'
                : `Delete ${picked.size.toLocaleString()} from this phone`
            }
            onPress={confirmDelete}
            disabled={picked.size === 0 || working}
            busy={working}
          />
        </BottomBar>
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
  metrics: {
    flexDirection: 'row',
    gap: space(2.5),
    paddingHorizontal: space(4),
    paddingTop: space(3),
  },
  metricCard: {
    flex: 1,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    padding: space(3),
  },
  metricLabel: { fontSize: 12, fontWeight: '600', color: colors.muted },
  metricValue: {
    marginTop: space(1),
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.4,
    color: colors.text,
  },
  metricSub: { fontSize: 12, lineHeight: 17, color: colors.muted },
  metricAction: { marginTop: space(1), alignItems: 'flex-start' },
  summary: {
    paddingHorizontal: space(4),
    paddingTop: space(4),
    paddingBottom: space(2),
  },
  summaryTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  summarySub: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 17,
    color: colors.muted,
  },
  actions: { marginTop: space(1) },
  action: {
    paddingVertical: space(1.5),
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    paddingHorizontal: space(4),
    paddingVertical: space(2.5),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    minHeight: 60,
  },
  rowPressed: { backgroundColor: colors.surfacePressed },
  rowDisabled: { opacity: 0.5 },
  check: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.faint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.text, borderColor: colors.text },
  tick: { color: colors.white, fontSize: 14, fontWeight: '800', marginTop: -1 },
  rowText: { flex: 1, minWidth: 0 },
  name: { fontSize: 14, fontWeight: '600', color: colors.text },
  meta: { marginTop: 1, fontSize: 12, color: colors.muted },
  verified: { marginTop: 1, fontSize: 11, fontWeight: '600', color: '#027a48' },
  gone: { marginTop: 1, fontSize: 11, fontWeight: '600', color: colors.muted },
  errorBox: {
    marginHorizontal: space(4),
    marginTop: space(2),
    padding: space(3),
    borderRadius: radius.md,
    backgroundColor: colors.dangerBg,
  },
  errorText: { fontSize: 13, lineHeight: 18, color: colors.danger },
  noteBox: {
    marginHorizontal: space(4),
    marginTop: space(2),
    padding: space(3),
    borderRadius: radius.md,
    backgroundColor: '#ecfdf3',
  },
  noteText: { fontSize: 13, lineHeight: 18, color: '#027a48' },
  empty: {
    paddingHorizontal: space(8),
    paddingTop: space(10),
    alignItems: 'center',
  },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  emptyText: {
    marginTop: space(2),
    fontSize: 13,
    lineHeight: 19,
    color: colors.muted,
    textAlign: 'center',
  },
  emptyAction: { marginTop: space(4) },
  forget: {
    paddingHorizontal: space(4),
    paddingTop: space(2),
    alignItems: 'flex-start',
  },
});
