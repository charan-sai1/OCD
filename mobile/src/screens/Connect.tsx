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
import { TOUCH } from '../layout';
import { PrimaryButton, Wordmark } from '../ui';

type Props = {
  initial: string;
  busy: boolean;
  problem: string | null;
  onConnect: (url: string) => void;
};

export function Connect({ initial, busy, problem, onConnect }: Props) {
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
          <Text style={styles.title}>Your drives, on your phone.</Text>
          <Text style={styles.subtitle}>
            Browse every photo and video on your portable drive without copying it.
          </Text>

          <View style={styles.card}>
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
            Start OCD Manager on your computer, then open{' '}
            <Text style={styles.hintStrong}>Phone</Text> in its window to see this
            address. Both devices need to be on the same Wi-Fi.
          </Text>

          <Pressable
            onPress={() => setValue('http://localhost:8090')}
            style={styles.debug}
            accessibilityRole="button"
            accessibilityLabel="Simulator? Use localhost:8090"
          >
            <Text style={styles.debugText}>Simulator? Use localhost:8090</Text>
          </Pressable>
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
    marginTop: space(9),
    gap: space(3),
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
  debug: {
    marginTop: space(4),
    alignSelf: 'flex-start',
    minHeight: TOUCH,
    justifyContent: 'center',
  },
  debugText: { fontSize: 12, color: colors.faint },
  footer: {
    paddingHorizontal: space(6),
    gap: 2,
  },
  footerText: { fontSize: 12, color: colors.faint },
});
