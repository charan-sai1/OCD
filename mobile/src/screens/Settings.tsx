import React, { useCallback, useEffect, useState } from 'react';
import {
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Constants from 'expo-constants';

import { api, messageFor } from '../api';
import { ScreenHeader, TextAction } from '../layout';
import {
  clearFinished,
  pendingCount,
  readSendQueue,
  readVerified,
  type QueuedItem,
  type VerifiedItem,
} from '../sendQueue';
import { colors, radius, space } from '../theme';
import { Wordmark } from '../ui';
import { Activity } from './Activity';
import { FreeSpace } from './FreeSpace';

/**
 * Settings is deliberately plain: it answers "what computer is this phone
 * talking to, what has the app done, and what can I clean up?" without adding
 * options that change how the backup engine behaves behind the user's back.
 */
export function Settings({
  server,
  onChangeServer,
}: {
  server: string | null;
  onChangeServer: () => void;
}) {
  const [queue, setQueue] = useState<QueuedItem[]>([]);
  const [verified, setVerified] = useState<VerifiedItem[]>([]);
  const [desktop, setDesktop] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [freeOpen, setFreeOpen] = useState(false);

  const appVersion = Constants.expoConfig?.version ?? '0.2.0';

  const refresh = useCallback(async () => {
    try {
      const [all, checked] = await Promise.all([
        readSendQueue(),
        server ? readVerified(server) : Promise.resolve([] as VerifiedItem[]),
      ]);
      setQueue(server ? all.filter((i) => i.server === server) : all);
      setVerified(checked);
      setError(null);
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setLoading(false);
    }
  }, [server]);

  useEffect(() => {
    // The queue and verified list live on disk, so this is an external read.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!server) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDesktop(null);
      return;
    }
    let alive = true;
    api
      .version(server)
      .then((v) => {
        if (alive) setDesktop(v.current || null);
      })
      .catch(() => {
        if (alive) setDesktop(null);
      });
    return () => {
      alive = false;
    };
  }, [server]);

  const waiting = pendingCount(queue);
  const failed = queue.filter((i) => i.state === 'failed').length;
  const finished = queue.filter((i) => i.state === 'done').length;

  const clear = async () => {
    if (!server || clearing) return;
    setClearing(true);
    setError(null);
    setNote(null);
    try {
      await clearFinished(server);
      await refresh();
      setNote('Finished sends cleared. The verified items stay available to free space.');
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setClearing(false);
    }
  };

  return (
    <View style={styles.root}>
      <ScreenHeader style={styles.header}>
        <View style={styles.brandRow}>
          <Wordmark />
          <Text style={styles.tag}>Settings</Text>
        </View>
        <Text style={styles.title} accessibilityRole="header">
          Settings
        </Text>
        <Text style={styles.sub}>
          What this phone talks to, what it has done, and what it can clean up.
        </Text>
      </ScreenHeader>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void refresh().finally(() => setRefreshing(false));
            }}
            tintColor={colors.muted}
            colors={[colors.text]}
          />
        }
      >
        <Section title="Computer">
          <Row label="Address" value={server ?? 'Not connected'} mono />
          <Row
            label="Desktop"
            value={
              server
                ? desktop
                  ? `OCD ${desktop}`
                  : 'No answer from the desktop'
                : 'Connect one to send photos over Wi-Fi'
            }
          />
          <TextAction
            label={server ? 'Change address' : 'Connect a computer'}
            onPress={onChangeServer}
            accessibilityHint="Enter a different computer address"
          />
        </Section>

        <Section
          title="Activity"
          note="Sends, phone backups and duplicate moves, read from each drive's own record."
        >
          <Pressable
            onPress={() => {
              if (server) setActivityOpen(true);
            }}
            disabled={!server}
            accessibilityRole="button"
            accessibilityLabel="View activity"
            accessibilityState={{ disabled: !server }}
            style={({ pressed }) => [
              styles.linkRow,
              pressed && styles.linkPressed,
              !server && styles.disabled,
            ]}
          >
            <View style={styles.linkText}>
              <Text style={styles.linkTitle}>View activity</Text>
              <Text style={styles.linkSub}>
                {server ? 'Newest first, across every drive' : 'Connect a computer first'}
              </Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        </Section>

        <Section title="This phone">
          <Row label="Waiting to send" value={loading ? '…' : waiting.toLocaleString()} />
          <Row label="Failed sends" value={loading ? '…' : failed.toLocaleString()} />
          <Row
            label="Verified items"
            value={loading ? '…' : verified.length.toLocaleString()}
          />
          <Row label="Finished sends" value={loading ? '…' : finished.toLocaleString()} />
          <TextAction
            label="Free up space"
            onPress={() => setFreeOpen(true)}
            disabled={!server || verified.length === 0}
            accessibilityHint="Choose items the computer has verified and delete them from this phone"
          />
          <TextAction
            label={clearing ? 'Clearing…' : 'Clear finished sends'}
            onPress={() => void clear()}
            disabled={!server || finished === 0 || clearing}
            accessibilityHint="Forgets rows for sends that already finished"
          />
          {error ? (
            <Text style={styles.error} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
          {note ? <Text style={styles.note}>{note}</Text> : null}
        </Section>

        <Section title="About">
          <Row label="App version" value={appVersion} />
          <Text style={styles.about}>
            OCD Manager keeps every original. Copies are verified by content before
            you are ever offered the delete step, and redundant drive copies are
            quarantined rather than hard-deleted.
          </Text>
        </Section>
      </ScrollView>

      {server ? (
        <Activity
          visible={activityOpen}
          server={server}
          onClose={() => setActivityOpen(false)}
        />
      ) : null}
      {server ? (
        <FreeSpace
          visible={freeOpen}
          server={server}
          onClose={() => {
            setFreeOpen(false);
            void refresh();
          }}
          onDeleted={() => void refresh()}
        />
      ) : null}
    </View>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {note ? <Text style={styles.sectionNote}>{note}</Text> : null}
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text
        style={[styles.rowValue, mono && styles.rowValueMono]}
        numberOfLines={2}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { paddingBottom: space(2) },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 34,
  },
  tag: { fontSize: 12, fontWeight: '600', color: colors.faint },
  title: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '700',
    letterSpacing: -0.8,
    color: colors.text,
    marginTop: space(1),
  },
  sub: { marginTop: space(1), fontSize: 13, lineHeight: 18, color: colors.muted },
  scroll: { paddingBottom: space(10) },
  section: {
    paddingHorizontal: space(4),
    paddingTop: space(5),
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  sectionNote: {
    marginTop: space(1),
    fontSize: 12,
    lineHeight: 17,
    color: colors.muted,
  },
  sectionBody: {
    marginTop: space(2),
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space(3),
    paddingHorizontal: space(3.5),
    paddingVertical: space(2.5),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  rowLabel: { flex: 1, fontSize: 14, color: colors.text },
  rowValue: {
    flexShrink: 1,
    maxWidth: '62%',
    textAlign: 'right',
    fontSize: 13,
    color: colors.muted,
  },
  rowValueMono: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    fontSize: 12,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    paddingHorizontal: space(3.5),
    paddingVertical: space(3),
    minHeight: 56,
  },
  linkPressed: { backgroundColor: colors.surfacePressed },
  linkText: { flex: 1, minWidth: 0 },
  linkTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  linkSub: { marginTop: 1, fontSize: 12, color: colors.muted },
  chevron: { fontSize: 22, color: colors.faint, marginTop: -2 },
  disabled: { opacity: 0.5 },
  error: {
    paddingHorizontal: space(3.5),
    paddingVertical: space(2.5),
    fontSize: 13,
    lineHeight: 18,
    color: colors.danger,
  },
  note: {
    paddingHorizontal: space(3.5),
    paddingVertical: space(2.5),
    fontSize: 13,
    lineHeight: 18,
    color: '#027a48',
  },
  about: {
    paddingHorizontal: space(3.5),
    paddingVertical: space(3),
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
  },
});
