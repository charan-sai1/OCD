import React, { useCallback, useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  applyTidy,
  duplicatesFolder,
  scanTidy,
  type Cancellation,
  type DriveContext,
  type TidyPlan,
  type TidyProgress,
  type TidyResult,
} from '../direct/backup';
import { colors, radius, space, bytes } from '../theme';
import { PrimaryButton } from '../ui';
import { Sheet } from './Sheet';

export function TidySheet({
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
  const [phase, setPhase] = useState<'idle' | 'scanning' | 'preview' | 'applying' | 'done'>(
    'idle',
  );
  const [plan, setPlan] = useState<TidyPlan | null>(null);
  const [result, setResult] = useState<TidyResult | null>(null);
  const [progress, setProgress] = useState<TidyProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cancelRef = useRef<Cancellation>({ cancelled: false });
  const lastUpdate = useRef(0);

  const pushProgress = useCallback((p: TidyProgress) => {
    const now = Date.now();
    if (p.phase === 'done' || p.phase === 'cataloguing' || now - lastUpdate.current > 120) {
      lastUpdate.current = now;
      setProgress(p);
    }
  }, []);

  const scan = async () => {
    if (!ctx) return;
    setError(null);
    setResult(null);
    setPlan(null);
    setProgress(null);
    cancelRef.current = { cancelled: false };
    setPhase('scanning');
    try {
      const found = await scanTidy(ctx, pushProgress, cancelRef.current);
      setPlan(found);
      setProgress(null);
      setPhase('preview');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The drive could not be scanned.');
      setPhase('idle');
    }
  };

  const apply = async () => {
    if (!ctx || !plan || !plan.moves.length) return;
    setError(null);
    cancelRef.current = { cancelled: false };
    setPhase('applying');
    try {
      const done = await applyTidy(ctx, plan, pushProgress, cancelRef.current);
      setResult(done);
      setProgress(null);
      setPhase('done');
      if (done.moved > 0 || done.catalogWritten) onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The duplicates could not be moved.');
      setPhase('preview');
    }
  };

  const requestClose = () => {
    if (phase === 'scanning' || phase === 'applying') return;
    onClose();
  };

  const reset = () => {
    setPhase('idle');
    setPlan(null);
    setResult(null);
    setProgress(null);
    setError(null);
  };

  const footer =
    phase === 'scanning' || phase === 'applying' ? (
      <PrimaryButton
        label={phase === 'scanning' ? 'Stop scan' : 'Stop moving'}
        onPress={() => {
          cancelRef.current.cancelled = true;
        }}
      />
    ) : phase === 'preview' && plan && plan.moves.length > 0 ? (
      <PrimaryButton
        label={`Move ${plan.moves.length.toLocaleString()} ${
          plan.moves.length === 1 ? 'file' : 'files'
        }`}
        onPress={apply}
      />
    ) : phase === 'done' ? (
      <PrimaryButton label="Done" onPress={onClose} />
    ) : (
      <PrimaryButton label="Find duplicates" onPress={scan} disabled={!ctx} />
    );

  const pct =
    progress && progress.total > 0
      ? Math.max(0, Math.min(1, progress.done / progress.total))
      : 0;

  return (
    <Sheet
      visible={visible}
      title="Tidy the drive"
      subtitle="Content duplicates → _OCD Duplicates"
      onClose={requestClose}
      closeLabel={phase === 'scanning' || phase === 'applying' ? 'Working' : 'Close'}
      footer={footer}
    >
      <ScrollView contentContainerStyle={styles.wrap}>
        <Text style={styles.lead}>
          OCD compares files by their bytes, not their names. When two files are truly
          identical it keeps the oldest copy and moves the extra into the folder below.
          Nothing is deleted, and the folder is hidden from the gallery.
        </Text>

        {ctx ? (
          <View style={styles.pathCard}>
            <Text style={styles.pathLabel}>Duplicates go to</Text>
            <Text style={styles.pathText} numberOfLines={2}>
              {duplicatesFolder(ctx.root)}
            </Text>
          </View>
        ) : null}

        {phase === 'idle' ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>How it works</Text>
            <Text style={styles.cardText}>
              1. Read the drive and group files by size.{'\n'}
              2. Hash only the groups where a duplicate is possible.{'\n'}
              3. Keep the oldest, shallowest copy of each match.{'\n'}
              4. Move the rest with a rename on the same drive.{'\n'}
              5. Update the catalog so the gallery shows one clean library.
            </Text>
            <Text style={styles.cardNote}>
              Large drives take a while to hash. Keep the drive plugged in and the screen
              on. If a file cannot be moved it stays where it is and is reported.
            </Text>
          </View>
        ) : null}

        {(phase === 'scanning' || phase === 'applying') && progress ? (
          <View style={styles.progressCard} accessibilityRole="progressbar">
            <Text style={styles.progressPhase}>
              {progress.phase === 'scanning'
                ? 'Reading the drive…'
                : progress.phase === 'hashing'
                  ? 'Comparing identical sizes…'
                  : progress.phase === 'cataloguing'
                    ? 'Updating the catalog…'
                    : 'Moving duplicates…'}
            </Text>
            {progress.total > 0 ? (
              <>
                <View style={styles.track}>
                  <View style={[styles.fill, { width: `${Math.round(pct * 100)}%` }]} />
                </View>
                <Text style={styles.progressCount}>
                  {progress.done.toLocaleString()} of {progress.total.toLocaleString()}
                </Text>
              </>
            ) : null}
            {progress.name ? (
              <Text style={styles.progressName} numberOfLines={1}>
                {progress.name}
              </Text>
            ) : null}
          </View>
        ) : null}

        {phase === 'preview' && plan ? (
          plan.cancelled ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Scan stopped</Text>
              <Text style={styles.cardText}>
                No files were moved. Run the scan again when you are ready; already
                measured groups are discarded rather than shown as a clean result.
              </Text>
            </View>
          ) : plan.moves.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>No duplicates found</Text>
              <Text style={styles.cardText}>
                OCD read {plan.scanned.toLocaleString()} media files and found no two files
                with identical content. Nothing to move.
              </Text>
            </View>
          ) : (
            <>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>
                  {plan.redundant.toLocaleString()} redundant{' '}
                  {plan.redundant === 1 ? 'copy' : 'copies'}
                </Text>
                <Text style={styles.cardText}>
                  {plan.groups.toLocaleString()} duplicate{' '}
                  {plan.groups === 1 ? 'group' : 'groups'} across{' '}
                  {plan.scanned.toLocaleString()} files. Moving them takes{' '}
                  {bytes(plan.reclaimable)} out of the gallery; they stay in
                  _OCD Duplicates on the same drive.
                </Text>
                <Text style={styles.cardNote}>
                  The oldest, shallowest copy in each group stays in the gallery. Every
                  move is written to the audit log.
                </Text>
              </View>

              <View style={styles.card}>
                <Text style={styles.cardTitle}>Moving</Text>
                {plan.moves.slice(0, 12).map((m) => (
                  <View key={m.from} style={styles.moveRow}>
                    <Text style={styles.moveFrom} numberOfLines={1}>
                      {m.from}
                    </Text>
                    <Text style={styles.moveSize}>{bytes(m.size)}</Text>
                  </View>
                ))}
                {plan.moves.length > 12 ? (
                  <Text style={styles.cardNote}>
                    + {(plan.moves.length - 12).toLocaleString()} more
                  </Text>
                ) : null}
              </View>
            </>
          )
        ) : null}

        {phase === 'done' && result ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              {result.cancelled ? 'Stopped' : 'Tidy finished'}
            </Text>
            <Row label="Moved" value={result.moved.toLocaleString()} />
            <Row label="Failed" value={result.failed.toLocaleString()} />
            <Row label="Moved out of the gallery" value={bytes(result.bytes)} />
            <Row
              label="Catalog"
              value={
                result.catalogWritten
                  ? `${result.catalogCount.toLocaleString()} items`
                  : 'not updated'
              }
            />
            {result.errors.length > 0 ? (
              <View style={styles.errors}>
                {result.errors.slice(0, 6).map((e, i) => (
                  <Text key={`${i}-${e}`} style={styles.errorLine}>
                    {e}
                  </Text>
                ))}
                {result.errors.length > 6 ? (
                  <Text style={styles.errorLine}>
                    + {result.errors.length - 6} more
                  </Text>
                ) : null}
              </View>
            ) : null}
            <Text style={styles.cardNote}>
              The files in _OCD Duplicates can be restored or deleted from a computer.
              OCD never removes them by itself.
            </Text>
            <Text
              style={styles.scanAgain}
              onPress={reset}
              accessibilityRole="button"
            >
              Scan again
            </Text>
          </View>
        ) : null}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </ScrollView>
    </Sheet>
  );
}

function Row({ label, value }: { label: string; value: string }) {
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
    gap: space(3),
  },
  lead: { fontSize: 14, lineHeight: 21, color: colors.muted },
  pathCard: {
    padding: space(3),
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    gap: 2,
  },
  pathLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.faint,
  },
  pathText: { fontSize: 12, color: colors.text },
  card: {
    padding: space(3),
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    gap: space(1.5),
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  cardText: { fontSize: 13, lineHeight: 20, color: colors.muted },
  cardNote: { fontSize: 12, lineHeight: 18, color: colors.faint },
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
  moveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    paddingVertical: 2,
  },
  moveFrom: { flex: 1, fontSize: 12, color: colors.text },
  moveSize: { fontSize: 11, color: colors.faint },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', gap: space(3) },
  summaryLabel: { fontSize: 13, color: colors.muted },
  summaryValue: { fontSize: 13, fontWeight: '600', color: colors.text },
  errors: { marginTop: space(1), gap: 2 },
  errorLine: { fontSize: 12, lineHeight: 17, color: colors.danger },
  scanAgain: {
    marginTop: space(2),
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    textDecorationLine: 'underline',
  },
  errorText: {
    padding: space(3),
    borderRadius: radius.md,
    backgroundColor: colors.dangerBg,
    color: colors.danger,
    fontSize: 13,
    lineHeight: 18,
  },
});
