import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as MediaLibrary from 'expo-media-library/legacy';

import { messageFor } from '../api';
import {
  forgetVerified,
  readVerified,
  type VerifiedItem,
} from '../sendQueue';
import { colors, radius, space, bytes, takenOn } from '../theme';
import { PrimaryButton } from '../ui';
import { Sheet } from './Sheet';

/** How many camera-roll lookups run at once while checking presence. */
const CHECK_CHUNK = 25;

type Presence = 'checking' | 'present' | 'gone';

/**
 * The free-space screen. It only ever offers items the desktop answered with
 * `verified` after hashing the bytes on arrival. A catalog match is not proof:
 * it only knows a name and a size, so those items never reach this list.
 *
 * Deleting is the one destructive action in the app, so it is deliberate: pick
 * items (or all of them), confirm with the exact count and byte total, and only
 * then ask the phone to delete. The forgotten record is written after the phone
 * confirms, so a failed delete leaves the item on the list to try again.
 */
export function FreeSpace({
  visible,
  server,
  onClose,
  onDeleted,
}: {
  visible: boolean;
  server: string;
  onClose: () => void;
  onDeleted?: (assetIds: string[]) => void;
}) {
  const [items, setItems] = useState<VerifiedItem[]>([]);
  const [presence, setPresence] = useState<Record<string, Presence>>({});
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [checking, setChecking] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const run = useRef(0);

  const load = useCallback(async () => {
    if (!visible) return;
    const token = ++run.current;
    setChecking(true);
    setError(null);
    setNote(null);
    setPicked(new Set());
    try {
      const list = await readVerified(server);
      if (token !== run.current) return;
      setItems(list);
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
  }, [visible, server]);

  useEffect(() => {
    // Reading the store and the camera roll are external reads, not derived
    // state; the sheet re-runs this every time it opens.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
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

  const forgetGone = async () => {
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

  const confirmDelete = () => {
    if (picked.size === 0 || working) return;
    const count = selected.length;
    Alert.alert(
      `Delete ${count.toLocaleString()} ${count === 1 ? 'item' : 'items'} from this phone?`,
      `${bytes(selectedBytes)} will be freed. The desktop already hashed and kept a copy of every one of these, and those copies stay exactly as they are. This cannot be undone.`,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void doDelete(selected.map((i) => i.assetId));
          },
        },
      ],
    );
  };

  const doDelete = async (ids: string[]) => {
    setWorking(true);
    setError(null);
    setNote(null);
    try {
      const ok = await MediaLibrary.deleteAssetsAsync(ids);
      if (!ok) throw new Error('The phone did not delete those items.');
      // Only now forget the proof, so a partial failure keeps the rest listed.
      await forgetVerified(server, ids);
      const drop = new Set(ids);
      setItems((prev) => prev.filter((i) => !drop.has(i.assetId)));
      setPicked(new Set());
      onDeleted?.(ids);
      setNote(
        `Deleted ${ids.length.toLocaleString()} ${ids.length === 1 ? 'item' : 'items'} from the phone. The drive copies are still there.`,
      );
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setWorking(false);
    }
  };

  const footer = (
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
  );

  return (
    <Sheet
      visible={visible}
      title="Free up space"
      subtitle="Only items the computer has checked by content appear here. The drive copies are never touched."
      onClose={onClose}
      footer={footer}
    >
      <View style={styles.summary}>
        <Text style={styles.summaryTitle}>
          {checking
            ? 'Checking what is still on this phone…'
            : present.length > 0
              ? `${present.length.toLocaleString()} ${present.length === 1 ? 'item' : 'items'} · ${bytes(freeableBytes)}`
              : 'Nothing to free right now'}
        </Text>
        <Text style={styles.summarySub}>
          {picked.size > 0
            ? `${picked.size.toLocaleString()} selected · ${bytes(selectedBytes)}`
            : present.length > 0
              ? 'Pick some, or select all.'
              : 'Send photos from the Phone tab first; a check mark means the bytes were verified.'}
        </Text>
        {present.length > 0 ? (
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

      <FlatList
        data={items}
        keyExtractor={(i) => i.assetId}
        contentContainerStyle={{ paddingBottom: space(8) }}
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
          checking ? (
            <View style={styles.empty}>
              <ActivityIndicator color={colors.muted} />
            </View>
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No verified items yet</Text>
              <Text style={styles.emptyText}>
                Send photos from the Phone tab. Once the desktop has hashed a copy,
                it shows up here so you can delete it from the phone.
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
    </Sheet>
  );
}

const styles = StyleSheet.create({
  summary: {
    paddingHorizontal: space(4),
    paddingVertical: space(3),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
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
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
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
    paddingTop: space(14),
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
  forget: {
    paddingHorizontal: space(4),
    paddingTop: space(2),
    alignItems: 'flex-start',
  },
});
