import React, { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, space } from '../theme';

/**
 * A full-screen task sheet. Backup and Tidy both need room to show conditions,
 * progress and a summary, so they take over the screen rather than competing
 * with the photo grid.
 */
export function Sheet({
  visible,
  title,
  subtitle,
  onClose,
  closeLabel = 'Close',
  hideClose,
  children,
  footer,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  closeLabel?: string;
  /** Hide the top-right action while the sheet is doing something it cannot stop. */
  hideClose?: boolean;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      {/* A full-screen modal does not inherit the window's keyboard resize on
          iOS, so the footer and the field being typed into would slide under
          the keyboard. On Android the window already resizes. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.root}
      >
        <View style={{ paddingTop: insets.top }}>
          <View style={styles.head}>
            <View style={styles.headText}>
              <Text style={styles.title}>{title}</Text>
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            </View>
            {hideClose ? null : (
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel={closeLabel}
                style={styles.closeHit}
              >
                <Text style={styles.close}>{closeLabel}</Text>
              </Pressable>
            )}
          </View>
        </View>

        <View style={styles.body}>{children}</View>

        {footer ? (
          <View
            style={[
              styles.footer,
              { paddingBottom: Math.max(insets.bottom, space(2)) + space(2) },
            ]}
          >
            {footer}
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    paddingHorizontal: space(4),
    paddingTop: space(2),
    paddingBottom: space(2),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  headText: { flex: 1 },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  subtitle: { marginTop: 2, fontSize: 13, lineHeight: 18, color: colors.muted },
  closeHit: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  close: { fontSize: 15, fontWeight: '600', color: colors.text },
  body: { flex: 1 },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    paddingHorizontal: space(4),
    paddingTop: space(3),
    gap: space(2),
  },
});
