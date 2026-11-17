import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { messageFor } from '../api';
import { volumeName } from '../direct/native';
import type { DriveSession } from '../direct/session';
import {
  pendingCount,
  readSendQueue,
  readVerified,
  retryFailed,
  type QueuedItem,
  type VerifiedItem,
} from '../sendQueue';
import { ScreenHeader, TextAction } from '../layout';
import { colors, radius, space, bytes } from '../theme';
import { PrimaryButton } from '../ui';
import { Activity } from './Activity';
import { BackupSheet } from './BackupSheet';
import { Phone } from './Phone';
import { TidySheet } from './TidySheet';

type Props = {
  server: string | null;
  drive: DriveSession;
  onOpenDevices: () => void;
  onOpenSpace: () => void;
  /** Bumped when the camera roll changed in another screen. */
  phoneRevision: number;
  /** Tells the app the camera roll changed, so Photos reloads it. */
  onPhoneChanged: () => void;
};

/**
 * Backups holds the two jobs that write to a drive: copying this phone's photos
 * onto it, and moving duplicate copies into the quarantine folder. Neither ever
 * deletes a phone original. Sends to a computer also live here, next to the
 * drive work, because both are "get this photo somewhere safe" tasks.
 */
export function Backups({
  server,
  drive,
  onOpenDevices,
  onOpenSpace,
  phoneRevision,
  onPhoneChanged,
}: Props) {
  const [queue, setQueue] = useState<QueuedItem[]>([]);
  const [verified, setVerified] = useState<VerifiedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'backup' | 'tidy' | null>(null);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const refresh = useCallback(async () => {
    if (!server) {
      setQueue([]);
      setVerified([]);
      setLoading(false);
      return;
    }
    try {
      const [all, checked] = await Promise.all([
        readSendQueue(),
        readVerified(server),
      ]);
      setQueue(all.filter((i) => i.server === server));
      setVerified(checked);
      setProblem(null);
    } catch (e) {
      setProblem(messageFor(e));
    } finally {
      setLoading(false);
    }
  }, [server]);

  useEffect(() => {
    // The queue and the verified list live on disk, so this is an external read.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh, phoneRevision]);

  const waiting = pendingCount(queue);
  const failed = queue.filter((i) => i.state === 'failed').length;
  const finished = queue.filter((i) => i.state === 'done').length;

  const retry = useCallback(async () => {
    if (!server || retrying) return;
    setRetrying(true);
    try {
      setQueue(await retryFailed(server));
      setProblem(null);
    } catch (e) {
      setProblem(messageFor(e));
    } finally {
      setRetrying(false);
    }
  }, [retrying, server]);

  const active = drive.active;
  const saf = drive.saf;
  const driveLabel = active ? volumeName(active.volume) : saf?.label ?? 'this drive';
  const writable = Boolean(active?.volume.writable);
  const canWrite = Boolean(drive.driveContext && writable);

  const closePhone = useCallback(() => {
    setPhoneOpen(false);
    void refresh();
  }, [refresh]);

  const closeSheet = useCallback(async () => {
    setSheet(null);
    await drive.reloadCatalog();
    await drive.refreshFree();
  }, [drive]);

  const driveProblem = drive.problem;

  return (
    <View style={styles.root}>
      <ScreenHeader style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          Backups
        </Text>
        <Text style={styles.sub}>
          Copy this phone onto a drive, tidy duplicates, or send photos to a computer.
        </Text>
      </ScreenHeader>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.sectionTitle}>This drive</Text>

        {active || saf ? (
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <View style={styles.cardHeadText}>
                <Text style={styles.cardTitle}>{driveLabel}</Text>
                <Text style={styles.cardMeta} numberOfLines={1}>
                  {active ? active.root : 'Folder picker'}
                </Text>
                <Text style={styles.cardMeta}>
                  {drive.items.length.toLocaleString()} items
                  {active && !writable ? ' · read-only' : ''}
                  {drive.free !== null ? ` · ${bytes(drive.free)} free` : ''}
                </Text>
              </View>
              <View style={styles.okDot} />
            </View>
            {active && !writable ? (
              <Text style={styles.warn}>
                This drive is write-protected. OCD can browse it, but cannot copy a
                backup onto it or tidy it.
              </Text>
            ) : null}
            {driveProblem ? (
              <Text style={styles.warn} accessibilityRole="alert">
                {driveProblem}
              </Text>
            ) : null}
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>No drive open</Text>
            <Text style={styles.cardText}>
              Plug a drive into this phone, or connect a computer on this Wi-Fi.
            </Text>
            {driveProblem ? (
              <Text style={styles.warn} accessibilityRole="alert">
                {driveProblem}
              </Text>
            ) : null}
            <View style={styles.cardAction}>
              <PrimaryButton label="Open Devices" onPress={onOpenDevices} />
            </View>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Back up this phone</Text>
          <Text style={styles.cardText}>
            Copies the photos and videos you choose onto {driveLabel}. Originals stay
            on the phone. A duplicate is moved into the drive&apos;s quarantine folder,
            never erased, and every copy is verified by content before it counts.
          </Text>
          <View style={styles.cardAction}>
            <PrimaryButton
              label="Choose what to back up"
              onPress={() => setSheet('backup')}
              disabled={!canWrite}
            />
          </View>
          {!active ? (
            <Text style={styles.cardMeta}>
              {saf
                ? 'Folder picker mode can browse this drive but cannot write to it. Use the development build to back up onto it.'
                : 'Open a drive in Devices first.'}
            </Text>
          ) : !writable ? (
            <Text style={styles.cardMeta}>
              This drive is read-only, so a backup cannot be written to it.
            </Text>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Tidy duplicates</Text>
          <Text style={styles.cardText}>
            Finds copies whose bytes match, keeps one, and moves the extras into the
            quarantine folder on the drive. The catalog is updated only after the
            moves are verified.
          </Text>
          <View style={styles.cardAction}>
            <PrimaryButton
              label="Find duplicates"
              onPress={() => setSheet('tidy')}
              disabled={!canWrite}
            />
          </View>
        </View>

        <Text style={[styles.sectionTitle, styles.sectionGap]}>Sends to a computer</Text>

        {!server ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>No computer connected</Text>
            <Text style={styles.cardText}>
              Connect a computer on the same Wi-Fi to send photos over the air.
              The drive above works without one.
            </Text>
            <View style={styles.cardAction}>
              <PrimaryButton label="Open Devices" onPress={onOpenDevices} />
            </View>
          </View>
        ) : (
          <View style={styles.card}>
            <View style={styles.statsRow}>
              <Stat label="Waiting" value={waiting} />
              <Stat label="Failed" value={failed} />
              <Stat label="Checked" value={verified.length} />
              <Stat label="Finished" value={finished} />
            </View>
            {loading ? (
              <ActivityIndicator color={colors.muted} />
            ) : (
              <Text style={styles.cardMeta}>
                {waiting + failed > 0
                  ? 'A send queue survives closing the app. Open it to resume or retry.'
                  : 'Nothing waiting. New photos are ready to send when you choose them.'}
              </Text>
            )}
            <View style={styles.rowActions}>
              <PrimaryButton label="Send photos" onPress={() => setPhoneOpen(true)} />
              {failed > 0 ? (
                <TextAction
                  label={retrying ? 'Retrying…' : 'Retry failed'}
                  onPress={() => void retry()}
                  disabled={retrying}
                  accessibilityHint="Put failed sends back in the queue"
                />
              ) : null}
            </View>
            <View style={styles.rowActions}>
              <TextAction
                label="Free up space"
                onPress={onOpenSpace}
                accessibilityHint="Delete photos the computer has already checked from this phone"
              />
              <TextAction
                label="View activity"
                onPress={() => setActivityOpen(true)}
                accessibilityHint="Sends, backups and duplicate moves"
              />
            </View>
          </View>
        )}

        {problem ? (
          <Text style={styles.error} accessibilityRole="alert">
            {problem}
          </Text>
        ) : null}
      </ScrollView>

      {sheet === 'backup' ? (
        <BackupSheet
          visible
          ctx={drive.driveContext}
          onClose={() => setSheet(null)}
          onDone={() => void closeSheet()}
        />
      ) : null}

      {sheet === 'tidy' ? (
        <TidySheet
          visible
          ctx={drive.driveContext}
          onClose={() => setSheet(null)}
          onDone={() => void closeSheet()}
        />
      ) : null}

      {phoneOpen && server ? (
        <Modal
          visible
          animationType="slide"
          onRequestClose={closePhone}
          presentationStyle="fullScreen"
        >
          <Phone
            server={server}
            onClose={closePhone}
            onPhoneChanged={onPhoneChanged}
          />
        </Modal>
      ) : null}

      {server ? (
        <Activity
          visible={activityOpen}
          server={server}
          onClose={() => setActivityOpen(false)}
        />
      ) : null}
    </View>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value.toLocaleString()}</Text>
      <Text style={styles.statLabel}>{label}</Text>
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
  scroll: { paddingHorizontal: space(4), paddingBottom: space(12), gap: space(2) },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.muted,
    marginTop: space(4),
  },
  sectionGap: { marginTop: space(6) },
  card: {
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    padding: space(3.5),
    gap: space(2),
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space(3),
  },
  cardHeadText: { flex: 1, minWidth: 0, gap: 2 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  cardText: { fontSize: 13, lineHeight: 19, color: colors.muted },
  cardMeta: { fontSize: 12, lineHeight: 17, color: colors.muted },
  cardAction: { marginTop: space(1), alignItems: 'flex-start' },
  warn: { fontSize: 13, lineHeight: 18, color: colors.danger },
  okDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#12b76a',
    marginTop: space(1),
  },
  rowActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space(2),
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space(2),
  },
  stat: { flex: 1 },
  statValue: { fontSize: 18, fontWeight: '700', color: colors.text },
  statLabel: { fontSize: 11, color: colors.muted },
  error: { fontSize: 13, lineHeight: 18, color: colors.danger },
});
