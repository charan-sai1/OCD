import React, { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, space } from './theme';

// Anything a finger has to hit: the WCAG 2.2 minimum target size.
export const TOUCH = 44;

type Insets = { top: number; right: number; bottom: number; left: number };

/**
 * ScreenTop is the one place that knows how far down a screen's content must
 * start. Constants.statusBarHeight is the *status bar*, which on a notched
 * iPhone sits above a taller cutout, so headers used to slide under the notch.
 */export function useSafeInsets(): Insets & { top: number } {
  const insets = useSafeAreaInsets();
  return {
    ...insets,
    // Android without edge-to-edge still reports 0; keep the old constant as a
    // floor so the header never collides with the clock either way.
    top: Math.max(insets.top, 0),
  };
}

export function ScreenHeader({
  children,
  style,
}: {
  children: ReactNode;
  style?: ViewStyle;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + space(2) }, style]}>
      {children}
    </View>
  );
}

/** A bottom-of-screen bar that clears the home indicator or gesture bar. */
export function BottomBar({
  children,
  style,
}: {
  children: ReactNode;
  style?: ViewStyle;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.bottom,
        { paddingBottom: Math.max(insets.bottom, space(2)) + space(2) },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/**
 * A text action with a full-size hit area. The visible text stays small; the
 * tappable box is at least 44x44 so it is reachable with a thumb or a tremor.
 */
export function TextAction({
  label,
  onPress,
  disabled,
  tone = 'default',
  accessibilityLabel,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger' | 'light';
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: Boolean(disabled) }}
      style={({ pressed }) => [
        styles.action,
        disabled && styles.dim,
        pressed && styles.actionPressed,
      ]}
    >
      <Text
        style={[
          styles.actionLabel,
          tone === 'danger' && styles.actionDanger,
          tone === 'light' && styles.actionLight,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: space(4),
    paddingBottom: space(2),
    backgroundColor: colors.bg,
  },
  bottom: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    backgroundColor: colors.bg,
    paddingHorizontal: space(4),
    paddingTop: space(2.5),
  },
  action: {
    minHeight: TOUCH,
    minWidth: TOUCH,
    paddingHorizontal: space(2),
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionPressed: { opacity: 0.55 },
  actionLabel: { fontSize: 15, fontWeight: '600', color: colors.text },
  actionDanger: { color: colors.danger },
  actionLight: { color: colors.white },
  dim: { opacity: 0.4 },
});
