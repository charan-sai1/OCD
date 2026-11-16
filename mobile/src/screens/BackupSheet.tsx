import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  DEFAULT_CONDITIONS,
  duplicateArchiveRel,
  ensureMediaAccess,
  hasMediaAccess,
  listAlbums,
  normaliseDuplicateFolder,
  runBackup,
  type AlbumChoice,
  type BackupConditions,
  type BackupProgress,
  type BackupSummary,
  type Cancellation,
  type DriveContext,
} from '../direct/backup';
import { resumeConditions, type ResumeRecord } from '../direct/resume';
import { clearResume, readResume } from '../direct/resumeStore';
import { colors, radius, space, bytes } from '../theme';
import { Chip, PrimaryButton } from '../ui';
import { AssetPicker } from './AssetPicker';
import { Sheet } from './Sheet';

type Preset = 'all' | '7' | '30' | '90' | 'year';

const PRESETS: { id: Preset; label: string }[] = [
  { id: 'all', label: 'All time' },
  { id: '7', label: 'Last 7 days' },
  { id: '30', label: 'Last 30 days' },
  { id: '90', label: 'Last 90 days' },
  { id: 'year', label: 'This year' },
];

const DUPLICATE_FOLDERS: { id: string; label: string }[] = [
  { id: '', label: 'Archive root' },
  { id: 'Old copies', label: 'Old copies' },
  { id: 'Reviewed', label: 'Reviewed' },
];

function sinceFor(preset: Preset): number {
  if (preset === 'all') return 0;
  if (preset === 'year') {
    const now = new Date();
    return Math.floor(new Date(now.getFullYear(), 0, 1).getTime() / 1000);
  }
  return Math.floor(Date.now() / 1000) - Number(preset) * 86400;
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
      {children}
    </View>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {children}
    </ScrollView>
  );
}

/** Condition sections that stop applying once exact items are ticked. */
function Rules({ show, children }: { show: boolean; children: React.ReactNode }) {
  return show ? <>{children}</> : null;
}

export function BackupSheet({
  visible,
  ctx,
  onClose,
  onDone,
}: {
  visible: boolean;
  ctx: DriveContext | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [permission, setPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  const [albums, setAlbums] = useState<AlbumChoice[]>([]);
  const [cond, setCond] = useState<BackupConditions>(DEFAULT_CONDITIONS);
  const [preset, setPreset] = useState<Preset>('all');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [summary, setSummary] = useState<BackupSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Ticked camera-roll ids; null means "use the conditions below". */
  const [pickedIds, setPickedIds] = useState<string[] | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  /** A marker left by a run the OS killed, if one belongs to this drive. */
  const [resume, setResume] = useState<ResumeRecord | null>(null);

  const cancelRef = useRef<Cancellation>({ cancelled: false });
  const lastUpdate = useRef(0);

  const refreshPermission = useCallback(async () => {
    const granted = await hasMediaAccess();
    setPermission(granted ? 'granted' : 'unknown');
    if (granted) setAlbums(await listAlbums());
  }, []);

  // The sheet mounts fresh on every open, so the only thing to do here is ask
  // the system whether the camera roll is already readable. This is an
  // external read, not derived state.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshPermission();
  }, [refreshPermission]);

  // One marker is kept at a time. Read it when the sheet opens, and again if
  // the mounted drive changes; only the drive it names can continue the run.
  useEffect(() => {
    let alive = true;
    void readResume().then((record) => {
      if (alive) setResume(record);
    });
    return () => {
      alive = false;
    };
  }, [ctx?.volumeId]);

  const resumeHere =
    resume && ctx && resume.volumeId === ctx.volumeId ? resume : null;

  const set = useCallback(<K extends keyof BackupConditions>(key: K, value: BackupConditions[K]) => {
    setCond((prev) => ({ ...prev, [key]: value }));
  }, []);

  const askPermission = async () => {
    setError(null);
    const granted = await ensureMediaAccess();
    setPermission(granted ? 'granted' : 'denied');
    if (granted) setAlbums(await listAlbums());
    else setError('OCD cannot read the camera roll yet. Allow photo access in system settings.');
  };

  const pushProgress = useCallback((p: BackupProgress) => {
    const now = Date.now();
    if (
      p.phase === 'done' ||
      p.phase === 'cataloguing' ||
      now - lastUpdate.current > 120
    ) {
      lastUpdate.current = now;
      setProgress(p);
    }
  }, []);

  const startRun = async (from: ResumeRecord | null) => {
    if (!ctx || running) return;
    setError(null);
    setSummary(null);
    setProgress(null);
    cancelRef.current = { cancelled: false };

    const granted = await ensureMediaAccess();
    setPermission(granted ? 'granted' : 'denied');
    if (!granted) {
      setError('Photo access is needed to copy the camera roll.');
      return;
    }

    // A resume uses the rules the killed run started with, except that
    // duplicates are forced to skip so already-copied items are not duplicated.
    const runConditions = from ? resumeConditions(from) : cond;
    const assetIds = from
      ? from.assetIds
      : pickedIds?.length
        ? pickedIds
        : undefined;

    setRunning(true);
    try {
      const result = await runBackup(
        ctx,
        runConditions,
        pushProgress,
        cancelRef.current,
        assetIds?.length ? { assetIds } : undefined,
        from ? { resumed: true } : undefined,
      );
      setSummary(result);
      setProgress(null);
      if (result.copied > 0 || result.quarantined > 0 || result.catalogWritten) {
        onDone();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The backup could not finish.');
    } finally {
      // The attempt is over, whichever way it ended. A kill would not reach
      // here, which is exactly when the marker should stay for the next launch.
      if (from) {
        setResume(null);
        await clearResume();
      }
      setRunning(false);
    }
  };

  const start = () => {
    void startRun(null);
  };

  const continueRun = () => {
    if (resumeHere) void startRun(resumeHere);
  };

  const dismissResume = () => {
    setResume(null);
    void clearResume();
  };

  const finish = () => {
    if (summary?.catalogWritten) onDone();
    onClose();
  };

  const requestClose = () => {
    if (running) return;
    if (summary) finish();
    else onClose();
  };

  const duplicateFolder = normaliseDuplicateFolder(cond.duplicateFolder);

  const mediaLabel =
    cond.media === 'image'
      ? 'Photos'
      : cond.media === 'video'
        ? 'Videos'
        : 'Photos + videos';
  const timeLabel = PRESETS.find((p) => p.id === preset)?.label ?? 'All time';
  const duplicateLabel =
    cond.duplicates === 'skip'
      ? 'Skip duplicates'
      : cond.duplicates === 'rename'
        ? 'Keep both'
        : 'Move old copies';
  const layoutLabel =
    cond.layout === 'phone'
      ? 'Phone / year / month'
      : cond.layout === 'year'
        ? 'Year / month'
        : 'One folder';
  const optionsSummary = (
    pickedIds
      ? [duplicateLabel, layoutLabel]
      : [
          mediaLabel,
          timeLabel,
          cond.albumTitle ? `Album: ${cond.albumTitle}` : '',
          duplicateLabel,
          layoutLabel,
          cond.skipScreenshots ? 'Screenshots skipped' : '',
        ]
  )
    .filter(Boolean)
    .join(' · ');

  const pct = progress && progress.total > 0
    ? Math.max(0, Math.min(1, progress.index / progress.total))
    : 0;

  const footer = running ? (
    <PrimaryButton
      label="Stop backup"
      onPress={() => {
        cancelRef.current.cancelled = true;
      }}
    />
  ) : summary ? (
    <PrimaryButton label="Done" onPress={finish} />
  ) : permission === 'granted' ? (
    <PrimaryButton
      label={
        pickedIds?.length
          ? `Back up ${pickedIds.length.toLocaleString()} selected`
          : 'Back up everything new'
      }
      onPress={start}
      disabled={!ctx}
    />
  ) : (
    <PrimaryButton label="Allow photo access" onPress={askPermission} />
  );

  return (
    <>
    <Sheet
      visible={visible && !pickerOpen}
      title="Back up this phone"
      subtitle={
        ctx
          ? `Camera roll → ${ctx.label || 'USB drive'}`
          : 'Open a drive first'
      }
      onClose={requestClose}
      hideClose={running}
      footer={footer}
    >
      <ScrollView
        contentContainerStyle={styles.wrap}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <Text style={styles.lead}>
          Copies from this phone to the drive. Every file is verified, and phone originals
          are never deleted.
        </Text>

        {resumeHere && !running && !summary ? (
          <View style={styles.resumeCard}>
            <Text style={styles.resumeTitle}>The last backup did not finish</Text>
            <Text style={styles.resumeText}>
              {startedLabel(resumeHere.startedAt)} It was copying to{' '}
              {ctx?.label || 'this drive'}. Continuing uses the same rules and skips
              files that are already on the drive.
            </Text>
            <Row>
              <Chip label="Continue" active onPress={continueRun} />
              <Chip label="Dismiss" active={false} onPress={dismissResume} />
            </Row>
          </View>
        ) : null}

        {permission !== 'granted' ? (
          <View style={styles.permissionCard}>
            <Text style={styles.permissionTitle}>Camera roll access</Text>
            <Text style={styles.permissionText}>
              OCD needs permission to read your photos and videos. It only reads the items
              you choose to back up.
            </Text>
            {permission === 'denied' ? (
              <Text
                style={styles.settingsLink}
                onPress={() => void Linking.openSettings()}
                accessibilityRole="button"
              >
                Open system settings
              </Text>
            ) : null}
          </View>
        ) : (
          <>
            <Section
              title="What to copy"
              note="Everything new, or choose exact items yourself."
            >
              <Row>
                <Chip
                  label="Everything new"
                  active={!pickedIds}
                  onPress={() => setPickedIds(null)}
                />
                <Chip
                  label={
                    pickedIds
                      ? `Change (${pickedIds.length.toLocaleString()} picked)`
                      : 'Choose items…'
                  }
                  active={Boolean(pickedIds)}
                  onPress={() => setPickerOpen(true)}
                />
              </Row>
              {pickedIds ? (
                <Text style={styles.pickedNote}>
                  Exactly these {pickedIds.length.toLocaleString()} item
                  {pickedIds.length === 1 ? '' : 's'} will be copied. Duplicate handling, folder
                  layout and verification below still apply.
                </Text>
              ) : null}
            </Section>

            <Pressable
              onPress={() => setOptionsOpen((open) => !open)}
              accessibilityRole="button"
              accessibilityState={{ expanded: optionsOpen }}
              accessibilityLabel="Backup options"
              style={({ pressed }) => [
                styles.optionsRow,
                pressed && styles.optionsPressed,
              ]}
            >
              <View style={styles.optionsText}>
                <Text style={styles.optionsTitle}>Options</Text>
                <Text style={styles.optionsSub}>{optionsSummary}</Text>
              </View>
              <Text style={styles.optionsChevron}>{optionsOpen ? '⌃' : '⌄'}</Text>
            </Pressable>

            {optionsOpen ? (
              <>
                <Rules show={!pickedIds}>
                  <Section title="Photos or videos">
                    <Row>
                      <Chip
                        label="Photos + videos"
                        active={cond.media === 'both'}
                        onPress={() => set('media', 'both')}
                      />
                      <Chip
                        label="Photos only"
                        active={cond.media === 'image'}
                        onPress={() => set('media', 'image')}
                      />
                      <Chip
                        label="Videos only"
                        active={cond.media === 'video'}
                        onPress={() => set('media', 'video')}
                      />
                    </Row>
                  </Section>

                  <Section title="When they were taken">
                    <Row>
                      {PRESETS.map((p) => (
                        <Chip
                          key={p.id}
                          label={p.label}
                          active={preset === p.id}
                          onPress={() => {
                            setPreset(p.id);
                            set('since', sinceFor(p.id));
                          }}
                        />
                      ))}
                    </Row>
                  </Section>

                  {albums.length > 0 ? (
                    <Section title="From which album">
                      <Row>
                        <Chip
                          label="All albums"
                          active={!cond.albumId}
                          onPress={() => {
                            set('albumId', '');
                            set('albumTitle', '');
                          }}
                        />
                        {albums.slice(0, 30).map((a) => (
                          <Chip
                            key={a.id}
                            label={a.title}
                            active={cond.albumId === a.id}
                            onPress={() => {
                              set('albumId', a.id);
                              set('albumTitle', a.title);
                            }}
                          />
                        ))}
                      </Row>
                    </Section>
                  ) : null}
                </Rules>

                <Section
                  title="If a file is already on the drive"
                  note="Skip is the fastest and keeps one copy. Moving an old copy puts it in the duplicate archive, never deletes it."
                >
                  <Row>
                    <Chip
                      label="Skip it"
                      active={cond.duplicates === 'skip'}
                      onPress={() => set('duplicates', 'skip')}
                    />
                    <Chip
                      label="Keep both"
                      active={cond.duplicates === 'rename'}
                      onPress={() => set('duplicates', 'rename')}
                    />
                    <Chip
                      label="Move old copy"
                      active={cond.duplicates === 'quarantine'}
                      onPress={() => set('duplicates', 'quarantine')}
                    />
                  </Row>

                  {cond.duplicates === 'quarantine' ? (
                    <View style={styles.destination}>
                      <Text style={styles.destinationLabel}>Folder for old copies</Text>
                      <Row>
                        {DUPLICATE_FOLDERS.map((f) => (
                          <Chip
                            key={f.id || 'root'}
                            label={f.label}
                            active={duplicateFolder === f.id}
                            onPress={() => set('duplicateFolder', f.id)}
                          />
                        ))}
                      </Row>
                      <TextInput
                        style={styles.input}
                        value={cond.duplicateFolder}
                        onChangeText={(text) => set('duplicateFolder', text)}
                        placeholder="Or type a subfolder, e.g. Old copies"
                        placeholderTextColor={colors.faint}
                        autoCapitalize="none"
                        autoCorrect={false}
                        maxLength={120}
                        returnKeyType="done"
                        accessibilityLabel="Folder for old copies"
                      />
                      <Text style={styles.destinationPreview}>
                        Old copies move to {duplicateArchiveRel(cond.duplicateFolder)}
                      </Text>
                      <Text style={styles.destinationNote}>
                        This stays inside _OCD Duplicates, so it never appears in the
                        gallery or the drive scans.
                      </Text>
                    </View>
                  ) : null}
                </Section>

                <Section title="Folder layout">
                  <Row>
                    <Chip
                      label="Phone / year / month"
                      active={cond.layout === 'phone'}
                      onPress={() => set('layout', 'phone')}
                    />
                    <Chip
                      label="Year / month"
                      active={cond.layout === 'year'}
                      onPress={() => set('layout', 'year')}
                    />
                    <Chip
                      label="One folder"
                      active={cond.layout === 'flat'}
                      onPress={() => set('layout', 'flat')}
                    />
                  </Row>
                </Section>

                <Rules show={!pickedIds}>
                  <Section title="Screenshots">
                    <Row>
                      <Chip
                        label="Skip screenshots"
                        active={cond.skipScreenshots}
                        onPress={() => set('skipScreenshots', true)}
                      />
                      <Chip
                        label="Include them"
                        active={!cond.skipScreenshots}
                        onPress={() => set('skipScreenshots', false)}
                      />
                    </Row>
                  </Section>
                </Rules>
              </>
            ) : null}

            <View style={styles.safety}>
              <Text style={styles.safetyText}>
                The catalog on the drive is updated after the copy, so the files come back
                in the same gallery on this phone and on the computer.{' '}
                {Platform.OS === 'android'
                  ? 'You can lock the screen: the copy keeps running in the background. Keep the drive plugged in.'
                  : 'Keep the app open and the drive plugged in while this runs.'}
              </Text>
            </View>
          </>
        )}

        {running && progress ? (
          <View style={styles.progressCard} accessibilityRole="progressbar">
            <Text style={styles.progressPhase}>
              {progress.phase === 'listing'
                ? 'Checking what is on the drive…'
                : progress.phase === 'cataloguing'
                  ? 'Updating the catalog…'
                  : 'Copying and verifying…'}
            </Text>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.round(pct * 100)}%` }]} />
            </View>
            <Text style={styles.progressCount}>
              {progress.total > 0
                ? `${progress.index.toLocaleString()} of ${progress.total.toLocaleString()}`
                : 'Reading…'}
              {' · '}
              {progress.copied.toLocaleString()} copied
              {progress.skipped ? ` · ${progress.skipped.toLocaleString()} skipped` : ''}
              {progress.quarantined ? ` · ${progress.quarantined} moved` : ''}
              {progress.failed ? ` · ${progress.failed} failed` : ''}
            </Text>
            {progress.name ? (
              <Text style={styles.progressName} numberOfLines={1}>
                {progress.name}
              </Text>
            ) : null}
            <Text style={styles.progressBytes}>{bytes(progress.bytes)} copied</Text>
          </View>
        ) : null}

        {summary ? (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>
              {summary.cancelled
                ? 'Backup stopped'
                : summary.halted
                  ? 'Drive full'
                  : 'Backup finished'}
            </Text>
            <SummaryRow label="Copied" value={summary.copied.toLocaleString()} />
            {summary.duplicates > 0 ? (
              <SummaryRow
                label="Already on the drive"
                value={summary.duplicates.toLocaleString()}
              />
            ) : null}
            {summary.screenshots > 0 ? (
              <SummaryRow
                label="Screenshots skipped"
                value={summary.screenshots.toLocaleString()}
              />
            ) : null}
            {summary.tooSmall > 0 ? (
              <SummaryRow label="Too small" value={summary.tooSmall.toLocaleString()} />
            ) : null}
            {summary.quarantined > 0 ? (
              <SummaryRow
                label={`Moved to ${summary.quarantineFolder}`}
                value={summary.quarantined.toLocaleString()}
              />
            ) : null}
            {summary.failed > 0 ? (
              <SummaryRow label="Failed" value={summary.failed.toLocaleString()} />
            ) : null}
            {summary.mtimeFailed > 0 ? (
              <SummaryRow
                label="File dates not set"
                value={summary.mtimeFailed.toLocaleString()}
              />
            ) : null}
            {summary.bytes > 0 ? (
              <SummaryRow label="Bytes copied" value={bytes(summary.bytes)} />
            ) : null}
            <SummaryRow
              label="Catalog"
              value={
                summary.catalogWritten
                  ? `${summary.catalogCount.toLocaleString()} items`
                  : 'not updated'
              }
            />
            {summary.errors.length > 0 ? (
              <View style={styles.errors}>
                <Text style={styles.errorsTitle}>What did not work</Text>
                {summary.errors.slice(0, 8).map((e, i) => (
                  <Text key={`${i}-${e}`} style={styles.errorLine}>
                    {e}
                  </Text>
                ))}
                {summary.errors.length > 8 ? (
                  <Text style={styles.errorLine}>
                    + {summary.errors.length - 8} more
                  </Text>
                ) : null}
              </View>
            ) : null}
            <Text style={styles.summaryNote}>
              Nothing was deleted from this phone. Open the drive again to see the whole
              library in one grid.
            </Text>
            {summary.scanIncomplete ? (
              <Text style={styles.summaryNote}>
                The drive scan was incomplete, so existing copies beyond that point were
                not checked. The catalog kept the entries it already had.
              </Text>
            ) : null}
          </View>
        ) : null}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </ScrollView>
    </Sheet>

    {pickerOpen ? (
      <AssetPicker
        media={cond.media}
        initial={pickedIds ?? []}
        onClose={() => setPickerOpen(false)}
        onConfirm={(ids) => {
          setPickedIds(ids);
          setPickerOpen(false);
        }}
      />
    ) : null}
    </>
  );
}

function startedLabel(startedAt: number): string {
  if (!startedAt) return 'An earlier run was interrupted.';
  const when = new Date(startedAt * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  return `Started ${when}.`;
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: space(4),
    paddingTop: space(4),
    paddingBottom: space(8),
    gap: space(4),
  },
  lead: { fontSize: 14, lineHeight: 21, color: colors.muted },
  section: { gap: space(1.5) },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.faint,
  },
  sectionNote: { fontSize: 12, lineHeight: 17, color: colors.muted },
  pickedNote: { fontSize: 12, lineHeight: 17, color: colors.muted },
  optionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    padding: space(3.5),
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  optionsPressed: { backgroundColor: colors.surfacePressed },
  optionsText: { flex: 1, minWidth: 0 },
  optionsTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  optionsSub: { marginTop: 2, fontSize: 12, lineHeight: 17, color: colors.muted },
  optionsChevron: { fontSize: 18, color: colors.faint },
  row: { paddingRight: space(4), gap: space(2) },
  destination: { gap: space(2), marginTop: space(1) },
  destinationLabel: { fontSize: 12, fontWeight: '600', color: colors.text },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    color: colors.text,
    paddingHorizontal: space(3),
    paddingVertical: space(2.5),
    fontSize: 14,
  },
  destinationPreview: { fontSize: 12, fontWeight: '600', color: colors.text },
  destinationNote: { fontSize: 12, lineHeight: 17, color: colors.muted },
  permissionCard: {
    padding: space(4),
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    gap: space(2),
  },
  permissionTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  permissionText: { fontSize: 13, lineHeight: 19, color: colors.muted },
  settingsLink: {
    marginTop: space(1),
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    textDecorationLine: 'underline',
  },
  safety: {
    padding: space(3),
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  safetyText: { fontSize: 12, lineHeight: 18, color: colors.muted },
  resumeCard: {
    padding: space(3),
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    gap: space(2),
  },
  resumeTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  resumeText: { fontSize: 13, lineHeight: 19, color: colors.muted },
  progressCard: {
    padding: space(3),
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    gap: space(2),
  },
  progressPhase: { fontSize: 14, fontWeight: '700', color: colors.text },
  track: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.line,
    overflow: 'hidden',
  },
  fill: { height: 6, borderRadius: radius.pill, backgroundColor: colors.text },
  progressCount: { fontSize: 12, color: colors.muted },
  progressName: { fontSize: 12, color: colors.faint },
  progressBytes: { fontSize: 11, color: colors.faint },
  summaryCard: {
    padding: space(3),
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    gap: space(1.5),
  },
  summaryTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: space(1) },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', gap: space(3) },
  summaryLabel: { fontSize: 13, color: colors.muted },
  summaryValue: { fontSize: 13, fontWeight: '600', color: colors.text },
  errors: { marginTop: space(2), gap: 2 },
  errorsTitle: { fontSize: 12, fontWeight: '700', color: colors.danger },
  errorLine: { fontSize: 12, lineHeight: 17, color: colors.danger },
  summaryNote: { marginTop: space(2), fontSize: 12, lineHeight: 17, color: colors.muted },
  errorText: {
    padding: space(3),
    borderRadius: radius.md,
    backgroundColor: colors.dangerBg,
    color: colors.danger,
    fontSize: 13,
    lineHeight: 18,
  },
});
