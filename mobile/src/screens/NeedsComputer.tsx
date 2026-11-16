import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ScreenHeader, TextAction } from '../layout';
import { colors, space } from '../theme';
import { PrimaryButton } from '../ui';

/**
 * Shown when the Camera roll tab is opened before a computer is connected.
 * Sending is the only thing this tab does, so it explains the missing step
 * instead of silently dropping the user on the address screen.
 */
export function NeedsComputer({
  onConnect,
  onUseDrive,
}: {
  onConnect: () => void;
  onUseDrive?: () => void;
}) {
  return (
    <View style={styles.root}>
      <ScreenHeader>
        <Text style={styles.title} accessibilityRole="header">
          Camera roll
        </Text>
        <Text style={styles.sub}>Send photos and videos to your computer over Wi-Fi.</Text>
      </ScreenHeader>

      <View style={styles.body}>
        <View style={styles.glyph}>
          <Text style={styles.glyphText}>→</Text>
        </View>
        <Text style={styles.heading}>Connect a computer first</Text>
        <Text style={styles.text}>
          Start OCD Manager on your computer, open Import there, and expand
          “Open this page on your phone” to see the address it shows.
        </Text>
        <View style={styles.wide}>
          <PrimaryButton label="Connect a computer" onPress={onConnect} />
        </View>
        {onUseDrive ? (
          <TextAction
            label="Or open a drive plugged into this phone"
            onPress={onUseDrive}
            accessibilityHint="Switch to the This phone tab"
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  title: {
    marginTop: space(1),
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '700',
    letterSpacing: -0.8,
    color: colors.text,
  },
  sub: { marginTop: space(1), fontSize: 13, lineHeight: 18, color: colors.muted },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space(8),
    paddingBottom: space(12),
    gap: space(3),
  },
  glyph: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space(1),
  },
  glyphText: { fontSize: 24, color: colors.muted },
  heading: { fontSize: 19, fontWeight: '700', color: colors.text, textAlign: 'center' },
  text: {
    marginBottom: space(3),
    fontSize: 14,
    lineHeight: 21,
    color: colors.muted,
    textAlign: 'center',
  },
  wide: { alignSelf: 'stretch' },
});
