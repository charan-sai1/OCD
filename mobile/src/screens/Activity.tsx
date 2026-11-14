import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { api, messageFor, type ActivityEntry } from '../api';
import { colors, radius, space, bytes } from '../theme';
import { Sheet } from './Sheet';

/** Turns an audit operation into words a person would use. */
function opLabel(op: string): string {
  switch (op) {
    case 'import':
      return 'Sent from a phone';
    case 'backup':
      return 'Backed up from a phone';
    case 'dedupe-move':
      return 'Duplicate moved';
    case 'delete':
      return 'Removed from a phone';
    default:
      return op.replace(/[-_]/g, ' ');
  }
}

function shortName(path: string | undefined): string {
  if (!path) return '';
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function whenLabel(iso: string): string {
  if (!iso) return 'Time unknown';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Time unknown';
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Today ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  const date = d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  return `${date} ${time}`;
}

/**
 * A read-only timeline built from the audit logs the desktop and the phone
 * already write. It never records anything itself; if a file was moved or
 * copied, the row that describes it came from the operation that did it.
 */
export function Activity({
  visible,
  server,
  onClose,
}: {
  visible: boolean;
  server: string;
  onClose: () => void;
}) {
  const [items, setItems] = useState<ActivityEntry[]>([]);
  const [files, setFiles] = useState(0);
  const [rows, setRows] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);

  const load = useCallback(
    async (refresh: boolean) => {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const page = await api.activity(server, 200);
        setItems(page.items ?? []);
        setFiles(page.files ?? 0);
        setRows(page.rows ?? 0);
      } catch (e) {
        setError(messageFor(e));
      } finally {
        setLoading(false);
        setRefreshing(false);
        setLoadedOnce(true);
      }
    },
    [server],
  );

  useEffect(() => {
    if (!visible) return;
    // Reading the desktop's audit logs is an external read.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(false);
  }, [visible, load]);

  const latest = rows > items.length ? `Newest ${items.length} of ${rows}` : null;

  return (
    <Sheet
      visible={visible}
      title="Activity"
      subtitle="Sends, phone backups and duplicate moves, newest first. Read from each drive's own record."
      onClose={onClose}
    >
      {error ? (
        <View style={styles.errorBox} accessibilityRole="alert">
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <FlatList
        data={items}
        keyExtractor={(item, index) => `${item.at}-${item.op}-${item.to ?? item.from ?? ''}-${index}`}
        contentContainerStyle={{ paddingBottom: space(8) }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load(true)}
            tintColor={colors.muted}
            colors={[colors.text]}
          />
        }
        ListHeaderComponent={
          items.length > 0 ? (
            <View style={styles.summary}>
              <Text style={styles.summaryText}>
                {latest ?? `${rows.toLocaleString()} ${rows === 1 ? 'entry' : 'entries'}`}
                {files > 0
                  ? ` · ${files} ${files === 1 ? 'log' : 'logs'}`
                  : ''}
              </Text>
            </View>
          ) : undefined
        }
        renderItem={({ item }) => {
          const name = shortName(item.to) || shortName(item.from);
          const detail = [
            item.library,
            item.device,
            whenLabel(item.at),
            item.verified ? 'verified' : '',
          ]
            .filter(Boolean)
            .join(' · ');
          return (
            <View style={styles.row}>
              <View style={styles.body}>
                <Text style={styles.op}>{opLabel(item.op)}</Text>
                {name ? (
                  <Text style={styles.name} numberOfLines={1}>
                    {name}
                  </Text>
                ) : null}
                <Text style={styles.detail} numberOfLines={2}>
                  {detail}
                </Text>
              </View>
              {item.bytes ? (
                <Text style={styles.size}>{bytes(item.bytes)}</Text>
              ) : null}
            </View>
          );
        }}
        ListEmptyComponent={
          loading ? (
            <View style={styles.empty}>
              <ActivityIndicator color={colors.muted} />
            </View>
          ) : loadedOnce ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Nothing recorded yet</Text>
              <Text style={styles.emptyText}>
                Send photos from the Phone tab, back up a drive from the phone, or
                tidy duplicates. Each action leaves a row here.
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
    paddingVertical: space(2),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  summaryText: { fontSize: 12, fontWeight: '600', color: colors.muted },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space(3),
    paddingHorizontal: space(4),
    paddingVertical: space(3),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  body: { flex: 1, minWidth: 0 },
  op: { fontSize: 11, fontWeight: '700', color: colors.muted, letterSpacing: 0.3 },
  name: { marginTop: 2, fontSize: 14, fontWeight: '600', color: colors.text },
  detail: { marginTop: 2, fontSize: 12, lineHeight: 17, color: colors.muted },
  size: { fontSize: 12, fontWeight: '600', color: colors.muted },
  errorBox: {
    marginHorizontal: space(4),
    marginTop: space(2),
    padding: space(3),
    borderRadius: radius.md,
    backgroundColor: colors.dangerBg,
  },
  errorText: { fontSize: 13, lineHeight: 18, color: colors.danger },
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
});
