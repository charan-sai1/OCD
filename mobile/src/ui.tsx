import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, radius, space } from './theme';

export function PrimaryButton({
  label,
  onPress,
  busy,
  disabled,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.button,
        (pressed || busy || disabled) && styles.buttonDim,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={colors.white} />
      ) : (
        <Text style={styles.buttonLabel}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Chip({
  label,
  active,
  onPress,
  dim,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  dim?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.chip,
        active && styles.chipActive,
        pressed && !active && styles.chipPressed,
      ]}
    >
      <Text
        style={[
          styles.chipLabel,
          active && styles.chipLabelActive,
          dim && !active && styles.chipLabelDim,
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Text style={styles.bannerText} numberOfLines={3}>
        {message}
      </Text>
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel="Retry"
        style={styles.bannerActionHit}
      >
        <Text style={styles.bannerAction}>Retry</Text>
      </Pressable>
    </View>
  );
}

export function Wordmark({ size = 15 }: { size?: number }) {
  return (
    <Text style={[styles.wordmark, { fontSize: size }]} accessibilityRole="header">
      OCD
    </Text>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 50,
    borderRadius: radius.md,
    backgroundColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space(4),
  },
  buttonDim: { opacity: 0.65 },
  buttonLabel: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  chip: {
    height: 44,
    paddingHorizontal: space(3.5),
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space(2),
  },
  chipActive: { backgroundColor: colors.text },
  chipPressed: { backgroundColor: colors.surfacePressed },
  chipLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
    maxWidth: 140,
  },
  chipLabelActive: { color: colors.white },
  chipLabelDim: { color: colors.faint },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    marginHorizontal: space(4),
    marginBottom: space(2),
    padding: space(3),
    borderRadius: radius.md,
    backgroundColor: colors.dangerBg,
  },
  bannerText: {
    flex: 1,
    color: colors.danger,
    fontSize: 13,
    lineHeight: 18,
  },
  bannerAction: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '700',
  },
  bannerActionHit: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space(1),
  },
  wordmark: {
    fontWeight: '800',
    letterSpacing: 3,
    color: colors.text,
  },
});
