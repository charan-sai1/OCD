import React, { useEffect, useState } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Constants from 'expo-constants';

import { api } from '../api';
import { ScreenHeader, TextAction } from '../layout';
import { colors, radius, space } from '../theme';

/**
 * Settings stays plain: which computer this phone talks to, and what version
 * of the app is running. Sends, devices, backups and cleanup each have their
 * own tab now, so this screen does not repeat them.
 */
export function Settings({
  server,
  onChangeServer,
}: {
  server: string | null;
  onChangeServer: () => void;
}) {
  const [desktop, setDesktop] = useState<string | null>(null);

  const appVersion = Constants.expoConfig?.version ?? '0.2.0';

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

  return (
    <View style={styles.root}>
      <ScreenHeader style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          Settings
        </Text>
        <Text style={styles.sub}>The computer this phone talks to, and the app itself.</Text>
      </ScreenHeader>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Section title="Computer">
          <Row label="Address" value={server ?? 'Not connected'} mono />
          <Row
            label="Desktop"
            value={
              server
                ? desktop
                  ? `OCD ${desktop}`
                  : 'No answer from the desktop'
                : 'Connect one in Devices'
            }
          />
          <Row
            label="Photos"
            value={
              server
                ? 'Phone, drive and computer appear together on the Photos tab'
                : 'Phone and drive still work without a computer'
            }
          />
          <View style={styles.actionRow}>
            <TextAction
              label={server ? 'Manage in Devices' : 'Connect a computer'}
              onPress={onChangeServer}
              accessibilityHint="Open the Devices tab to change the computer"
            />
          </View>
        </Section>

        <Section title="About">
          <Row label="App version" value={appVersion} />
          <Text style={styles.about}>
            Nothing is deleted from this phone without a checked copy elsewhere.
            Duplicate drive copies are quarantined, never erased. A backup verifies
            every copy by content before it counts.
          </Text>
        </Section>
      </ScrollView>
    </View>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
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
  actionRow: { alignItems: 'flex-start' },
  about: {
    paddingHorizontal: space(3.5),
    paddingVertical: space(3),
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
  },
});
