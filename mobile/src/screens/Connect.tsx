import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, space } from '../theme';
import { PrimaryButton, Wordmark } from '../ui';

type Props = {
  initial: string;
  busy: boolean;
  problem: string | null;
  onConnect: (url: string) => void;
  /** Present when this phone can open a drive plugged straight into it. */
  onUseDrive?: () => void;
};

export function Connect({ initial, busy, problem, onConnect, onUseDrive }: Props) {
  const [value, setValue] = useState(initial);
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <View style={[styles.wrap, { paddingTop: insets.top + space(16) }]}>
          <View style={styles.mark}>
            <Text style={styles.markText}>OCD</Text>
          </View>
          <Text style={styles.title}>Your library, on your phone.</Text>
          <Text style={styles.subtitle}>
            Open a drive plugged into this phone, or browse your computer’s library
            over Wi-Fi.
          </Text>

          {onUseDrive ? (
            <Pressable
              onPress={onUseDrive}
              style={styles.drive}
              accessibilityRole="button"
              accessibilityLabel="Open this phone's drive"
            >
              <Text style={styles.driveTitle}>Open this phone’s drive</Text>
              <Text style={styles.driveText}>
                No computer needed. Plug in the drive and OCD reads it here.
              </Text>
            </Pressable>
          ) : null}

          {onUseDrive ? (
            <Text style={styles.sectionLabel}>Or connect to a computer</Text>
          ) : null}

          <View style={[styles.card, !onUseDrive && styles.cardSolo]}>
            <Text style={styles.label}>Desktop address</Text>
            <TextInput
              value={value}
              onChangeText={setValue}
              onSubmitEditing={() => onConnect(value)}
              placeholder="http://192.168.1.10:8090"
              placeholderTextColor={colors.faint}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              style={styles.input}
              accessibilityLabel="Desktop address"
              editable={!busy}
            />
            <PrimaryButton
              label="Connect"
              busy={busy}
              onPress={() => onConnect(value)}
              disabled={!value.trim()}
            />
            {problem ? (
              <Text style={styles.error} accessibilityRole="alert">
                {problem}
              </Text>
            ) : null}
          </View>

          <Text style={styles.hint}>
            Start OCD Manager on your computer, open{' '}
            <Text style={styles.hintStrong}>Import</Text> there, and expand{' '}
            <Text style={styles.hintStrong}>Open this page on your phone</Text> to see
            this address. Both devices need to be on the same Wi-Fi.
          </Text>
        </View>
        <View style={[styles.footer, { paddingBottom: insets.bottom + space(4) }]}>
          <Wordmark />
          <Text style={styles.footerText}>Local-first. Nothing leaves your network.</Text>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  wrap: {
    flex: 1,
    paddingHorizontal: space(6),
    justifyContent: 'center',
  },
  mark: {
    width: 58,
    height: 58,
    borderRadius: 16,
    backgroundColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space(7),
  },
  markText: {
    color: colors.white,
    fontWeight: '800',
    fontSize: 15,
    letterSpacing: 1.5,
  },
  title: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '700',
    letterSpacing: -0.6,
    color: colors.text,
    maxWidth: 320,
  },
  subtitle: {
    marginTop: space(3),
    fontSize: 15,
    lineHeight: 22,
    color: colors.muted,
    maxWidth: 330,
  },
  card: {
    marginTop: space(2),
    gap: space(3),
  },
  cardSolo: { marginTop: space(9) },
  sectionLabel: {
    marginTop: space(7),
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  input: {
    height: 50,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    paddingHorizontal: space(3.5),
    fontSize: 16,
    color: colors.text,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    lineHeight: 19,
  },
  hint: {
    marginTop: space(6),
    fontSize: 13,
    lineHeight: 20,
    color: colors.muted,
  },
  hintStrong: { fontWeight: '700', color: colors.text },
  drive: {
    marginTop: space(6),
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    paddingHorizontal: space(3.5),
    paddingVertical: space(3),
    gap: 2,
  },
  driveTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  driveText: { fontSize: 13, lineHeight: 19, color: colors.muted },
  footer: {
    paddingHorizontal: space(6),
    gap: 2,
  },
  footerText: { fontSize: 12, color: colors.faint },
});
