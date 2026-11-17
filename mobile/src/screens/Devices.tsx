import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { api, guessServer, messageFor } from '../api';
import { findComputers, subnetFrom, type FoundComputer } from '../discover';
import { volumeName } from '../direct/native';
import type { DriveSession } from '../direct/session';
import { ScreenHeader, TextAction } from '../layout';
import { colors, radius, space, bytes } from '../theme';
import { ErrorBanner, PrimaryButton } from '../ui';

type Props = {
  server: string | null;
  initialUrl: string;
  /** Returns null when the computer answered, or a message when it did not. */
  connectTo: (raw: string) => Promise<string | null>;
  forgetComputer: () => void;
  drive: DriveSession;
};

/**
 * Devices is where the two non-phone sources are managed. The computer card
 * keeps the saved address and can sweep the local network for OCD; the drive
 * card shows what Android has mounted and opens the first usable volume by
 * itself, so plugging a drive in needs no picker.
 */
export function Devices({
  server,
  initialUrl,
  connectTo,
  forgetComputer,
  drive,
}: Props) {
  const [address, setAddress] = useState(
    () => server ?? initialUrl ?? guessServer(),
  );
  const [editing, setEditing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [desktop, setDesktop] = useState<string | null>(null);

  const [scanning, setScanning] = useState(false);
  const [scanDone, setScanDone] = useState<{ done: number; total: number } | null>(null);
  const [found, setFound] = useState<FoundComputer[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);
  const scanCtl = useRef<AbortController | null>(null);

  const showForm = !server || editing;

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

  useEffect(
    () => () => {
      scanCtl.current?.abort();
    },
    [],
  );

  const submit = useCallback(async () => {
    setConnecting(true);
    setConnectError(null);
    const problem = await connectTo(address);
    setConnecting(false);
    if (problem) {
      setConnectError(problem);
      return;
    }
    setEditing(false);
  }, [address, connectTo]);

  const scan = useCallback(async () => {
    const hint = server || address || guessServer();
    if (!subnetFrom(hint)) {
      setScanError(
        'OCD needs one address on this Wi-Fi before it can search it. Connect once by typing the address shown on the computer, then scan.',
      );
      return;
    }
    scanCtl.current?.abort();
    const ctl = new AbortController();
    scanCtl.current = ctl;
    setScanning(true);
    setScanError(null);
    setFound([]);
    setScanDone({ done: 0, total: 254 });
    try {
      const answer = await findComputers({
        hint,
        signal: ctl.signal,
        onProgress: (done, total, seen) => {
          setScanDone({ done, total });
          setFound(seen);
        },
      });
      setFound(answer);
      if (answer.length === 0) {
        setScanError('No computer answered. Check OCD is open on the computer and both are on the same Wi-Fi.');
      }
    } catch (e) {
      if (!ctl.signal.aborted) setScanError(messageFor(e));
    } finally {
      if (scanCtl.current === ctl) scanCtl.current = null;
      setScanning(false);
      setScanDone(null);
    }
  }, [address, server]);

  const connectFound = useCallback(
    async (item: FoundComputer) => {
      setAddress(item.url);
      setEditing(false);
      setConnecting(true);
      setConnectError(null);
      const problem = await connectTo(item.url);
      setConnecting(false);
      if (problem) setConnectError(problem);
    },
    [connectTo],
  );

  const indexMessage = (() => {
    const active = drive.active;
    if (!active) return '';
    if (drive.recovered) {
      return active.volume.writable
        ? 'The catalog on this drive is damaged, so OCD opened the previous copy. Index to repair it — nothing is deleted.'
        : 'The catalog on this drive is damaged. OCD is showing the previous copy, and the drive is write-protected.';
    }
    if (!active.volume.writable) {
      return 'This drive is write-protected. You can browse it, but OCD cannot add a catalog or previews.';
    }
    return drive.indexing
      ? 'Indexing this drive. Keep it plugged in.'
      : 'This drive has no catalog yet. Index it here to open instantly next time and to build previews on the drive.';
  })();

  return (
    <View style={styles.root}>
      <ScreenHeader style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          Devices
        </Text>
        <Text style={styles.sub}>
          A computer on this Wi-Fi, and a drive plugged into this phone.
        </Text>
      </ScreenHeader>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={drive.refreshing}
            onRefresh={() => void drive.refreshVolumes(true)}
            tintColor={colors.muted}
            colors={[colors.text]}
          />
        }
      >
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Computer</Text>

          {server && !showForm ? (
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <View style={styles.cardHeadText}>
                  <Text style={styles.cardTitle}>Connected</Text>
                  <Text style={styles.cardMono} numberOfLines={1}>
                    {server}
                  </Text>
                  <Text style={styles.cardMeta}>
                    {desktop ? `OCD ${desktop}` : 'No answer right now'}
                  </Text>
                </View>
                <View style={styles.okDot} />
              </View>
              <View style={styles.rowActions}>
                <TextAction
                  label="Scan network"
                  onPress={() => void scan()}
                  disabled={scanning}
                  accessibilityHint="Search this Wi-Fi for another computer running OCD"
                />
                <TextAction
                  label="Change"
                  onPress={() => {
                    setEditing(true);
                    setConnectError(null);
                  }}
                  accessibilityHint="Type a different computer address"
                />
                <TextAction
                  label="Forget"
                  onPress={() => {
                    forgetComputer();
                    setEditing(true);
                    setScanError(null);
                    setFound([]);
                  }}
                  tone="danger"
                  accessibilityHint="Stop using this computer until it is connected again"
                />
              </View>
            </View>
          ) : null}

          {showForm ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>
                {server ? 'Change computer' : 'Connect a computer'}
              </Text>
              <Text style={styles.cardText}>
                Open OCD on the computer, then type the address it shows. The phone and
                computer must be on the same Wi-Fi.
              </Text>
              <TextInput
                value={address}
                onChangeText={setAddress}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                returnKeyType="go"
                onSubmitEditing={() => void submit()}
                placeholder="http://192.168.1.20:8090"
                placeholderTextColor={colors.faint}
                accessibilityLabel="Computer address"
                style={styles.input}
              />
              <View style={styles.rowActions}>
                <PrimaryButton
                  label={server ? 'Save' : 'Connect'}
                  onPress={() => void submit()}
                  busy={connecting}
                  disabled={!address.trim()}
                />
                {server ? (
                  <TextAction
                    label="Cancel"
                    onPress={() => {
                      setEditing(false);
                      setConnectError(null);
                      setAddress(server);
                    }}
                  />
                ) : null}
              </View>
              {connectError ? (
                <Text style={styles.error} accessibilityRole="alert">
                  {connectError}
                </Text>
              ) : null}
            </View>
          ) : null}

          <View style={styles.card}>
            <View style={styles.cardHead}>
              <View style={styles.cardHeadText}>
                <Text style={styles.cardTitle}>Find on this Wi-Fi</Text>
                <Text style={styles.cardText}>
                  Checks every address on the saved network and asks for OCD. Nothing is
                  uploaded.
                </Text>
              </View>
              {scanning && scanDone ? (
                <Text style={styles.progress}>
                  {Math.round((scanDone.done / scanDone.total) * 100)}%
                </Text>
              ) : null}
            </View>
            <View style={styles.rowActions}>
              <TextAction
                label={scanning ? 'Stop scan' : 'Scan network'}
                onPress={() => {
                  if (scanning) {
                    scanCtl.current?.abort();
                    setScanning(false);
                    setScanDone(null);
                  } else {
                    void scan();
                  }
                }}
                accessibilityHint="Search the saved network for a computer running OCD"
              />
              {scanning ? <ActivityIndicator color={colors.muted} size="small" /> : null}
            </View>
            {found.length > 0 ? (
              <View style={styles.foundList}>
                {found.map((item) => (
                  <Pressable
                    key={item.url}
                    onPress={() => void connectFound(item)}
                    disabled={connecting}
                    accessibilityRole="button"
                    accessibilityLabel={`Connect to OCD ${item.version} at ${item.address}`}
                    style={({ pressed }) => [
                      styles.foundRow,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={styles.foundText}>
                      <Text style={styles.foundTitle}>{item.address}</Text>
                      <Text style={styles.cardMeta}>OCD {item.version}</Text>
                    </View>
                    <Text style={styles.chevron}>›</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {scanError ? (
              <Text style={styles.error} accessibilityRole="alert">
                {scanError}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Drive on this phone</Text>
            {drive.module ? (
              <TextAction
                label={drive.refreshing ? 'Checking…' : 'Refresh'}
                onPress={() => void drive.refreshVolumes(true)}
                disabled={drive.refreshing}
                accessibilityHint="Check again for drives Android has mounted"
              />
            ) : null}
          </View>

          {!drive.module ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Folder picker only</Text>
              <Text style={styles.cardText}>
                This build cannot read a drive directly, so there are no sizes,
                dates or previews. You can still open a drive that already carries
                a catalog through Android&apos;s folder picker, read-only. Use the
                development build for the full engine; on iPhone, send photos to a
                computer instead.
              </Text>
              <View style={styles.rowActions}>
                <PrimaryButton
                  label={drive.saf ? 'Choose another drive' : 'Choose a drive'}
                  onPress={() => void drive.chooseSaf()}
                />
              </View>
            </View>
          ) : !drive.access ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Allow full drive access</Text>
              <Text style={styles.cardText}>
                Android needs “All files access” to read sizes, dates and previews
                directly from the drive. Nothing is deleted or changed without asking.
              </Text>
              <View style={styles.rowActions}>
                <PrimaryButton
                  label="Allow access"
                  onPress={() => void drive.requestAccess()}
                />
                <TextAction
                  label="Use folder picker"
                  onPress={() => void drive.chooseSaf()}
                  accessibilityHint="Open a drive through Android's folder picker instead"
                />
                {drive.safFallback ? (
                  <TextAction
                    label="Open the remembered drive"
                    onPress={() => void drive.openSaf(drive.safFallback!)}
                    accessibilityHint="Open the remembered drive through Android's folder picker"
                  />
                ) : null}
              </View>
            </View>
          ) : null}

          {drive.access || !drive.module ? (
            <>
              {drive.active || drive.saf ? (
                <View style={styles.card}>
                  <View style={styles.cardHead}>
                    <View style={styles.cardHeadText}>
                      <Text style={styles.cardTitle}>
                        {drive.active
                          ? volumeName(drive.active.volume)
                          : drive.saf?.label ?? 'Drive'}
                      </Text>
                      <Text style={styles.cardMono} numberOfLines={1}>
                        {drive.active ? drive.active.root : 'Folder picker'}
                      </Text>
                      <Text style={styles.cardMeta}>
                        {drive.loading
                          ? drive.walking
                            ? `Reading the drive… ${drive.walking.done} folders`
                            : 'Loading catalog…'
                          : `${drive.items.length.toLocaleString()} items${
                              drive.active && !drive.active.volume.writable
                                ? ' · read-only'
                                : ''
                            }`}
                      </Text>
                      {drive.free !== null ? (
                        <Text style={styles.cardMeta}>
                          {bytes(drive.free)} free on this drive
                        </Text>
                      ) : null}
                    </View>
                    <View style={styles.okDot} />
                  </View>
                  <View style={styles.rowActions}>
                    <TextAction
                      label="Eject"
                      onPress={() => void drive.disconnect()}
                      tone="danger"
                      accessibilityHint="Stop reading this drive in the app"
                    />
                  </View>
                </View>
              ) : (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Plug in a drive</Text>
                  <Text style={styles.cardText}>
                    When Android mounts a drive, OCD opens the first readable volume by
                    itself. Photos, Backups and Space then use the same catalog.
                  </Text>
                </View>
              )}

              {drive.problem ? (
                <ErrorBanner message={drive.problem} onRetry={() => void drive.refresh()} />
              ) : null}

              {drive.active && (drive.needsIndex || drive.recovered) ? (
                <View style={styles.indexBar}>
                  <Text style={styles.indexText}>{indexMessage}</Text>
                  {drive.active.volume.writable ? (
                    drive.indexing ? (
                      <ActivityIndicator color={colors.muted} size="small" />
                    ) : (
                      <TextAction
                        label="Index drive"
                        onPress={() => void drive.indexDrive()}
                        accessibilityHint="Scan this drive and write a catalog to it"
                      />
                    )
                  ) : null}
                </View>
              ) : null}

              {drive.volumes.length > 0 ? (
                <View style={styles.card}>
                  <Text style={styles.sectionLabel}>Readable volumes</Text>
                  {drive.volumes.map((v) => {
                    const open = drive.active?.root === v.path;
                    return (
                      <Pressable
                        key={v.path}
                        onPress={() => {
                          if (!open) void drive.openVolume(v);
                        }}
                        disabled={open || drive.loading}
                        accessibilityRole="button"
                        accessibilityLabel={
                          open ? `${volumeName(v)} is open` : `Open ${volumeName(v)}`
                        }
                        style={({ pressed }) => [
                          styles.volumeRow,
                          pressed && styles.pressed,
                          open && styles.volumeOpen,
                        ]}
                      >
                        <View style={styles.volumeText}>
                          <Text style={styles.volumeTitle}>
                            {volumeName(v)}
                            {open ? ' · open' : ''}
                          </Text>
                          <Text style={styles.cardMeta} numberOfLines={1}>
                            {v.path}
                            {v.writable ? '' : ' · read-only'}
                          </Text>
                        </View>
                        {open ? <Text style={styles.tick}>✓</Text> : <Text style={styles.chevron}>›</Text>}
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}

              {drive.unmounted.length > 0 ? (
                <View style={styles.card}>
                  <Text style={styles.sectionLabel}>Not mounted by Android</Text>
                  {drive.unmounted.map((v, i) => (
                    <View key={`${v.uuid || v.label || 'volume'}-${v.state}-${i}`} style={styles.volumeRow}>
                      <View style={styles.volumeText}>
                        <Text style={styles.volumeTitle}>{volumeName(v)}</Text>
                        <Text style={styles.cardMeta}>
                          {v.state || 'unmounted'} · Android has not mounted this volume
                        </Text>
                      </View>
                    </View>
                  ))}
                  <Text style={styles.cardText}>
                    Android mounts the partitions of one disk separately. Try unplugging
                    and reconnecting, or use a powered USB hub.
                  </Text>
                </View>
              ) : null}

              {drive.safFallback && drive.active ? (
                <View style={styles.card}>
                  <Text style={styles.sectionLabel}>Opened before</Text>
                  <Pressable
                    onPress={() => void drive.openSaf(drive.safFallback!)}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${drive.safFallback.label} through the folder picker`}
                    style={({ pressed }) => [styles.volumeRow, pressed && styles.pressed]}
                  >
                    <View style={styles.volumeText}>
                      <Text style={styles.volumeTitle}>{drive.safFallback.label}</Text>
                      <Text style={styles.cardMeta}>
                        Folder picker · slower, has no sizes or previews
                      </Text>
                    </View>
                    <Text style={styles.chevron}>›</Text>
                  </Pressable>
                </View>
              ) : null}

              <View style={styles.rowActions}>
                <TextAction
                  label="Choose another drive"
                  onPress={() => void drive.chooseSaf()}
                  accessibilityHint="Open Android's folder picker"
                />
              </View>
            </>
          ) : null}
        </View>
      </ScrollView>
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
  scroll: { paddingHorizontal: space(4), paddingBottom: space(12) },
  section: { paddingTop: space(5), gap: space(2) },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: colors.faint,
    marginBottom: space(1),
  },
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
  cardMono: {
    fontSize: 12,
    color: colors.muted,
    fontFamily: 'monospace',
  },
  cardMeta: { fontSize: 12, lineHeight: 17, color: colors.muted },
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
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: space(3),
    paddingVertical: space(2.5),
    minHeight: 46,
  },
  error: { fontSize: 13, lineHeight: 18, color: colors.danger },
  progress: { fontSize: 13, fontWeight: '700', color: colors.muted },
  foundList: { gap: space(1.5) },
  foundRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    paddingVertical: space(2),
    paddingHorizontal: space(2.5),
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
  },
  foundText: { flex: 1, minWidth: 0 },
  foundTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  pressed: { opacity: 0.72 },
  volumeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    paddingVertical: space(2),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  volumeOpen: { opacity: 0.85 },
  volumeText: { flex: 1, minWidth: 0, gap: 1 },
  volumeTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  tick: { fontSize: 16, fontWeight: '800', color: '#027a48' },
  chevron: { fontSize: 22, color: colors.faint, marginTop: -2 },
  indexBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space(3),
    padding: space(3),
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  indexText: { flex: 1, fontSize: 13, lineHeight: 18, color: colors.muted },
});
