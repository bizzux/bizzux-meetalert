import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useAlertStore, AlertButton } from '../store/alertStore';
import { useThemeColors } from '../theme';

/**
 * Single, app-wide host for showAlert() (see services/appAlert.ts) — mount
 * this once at the root (navigation/index.tsx) and every screen's confirm,
 * error, or info pop-up renders through this one rounded card instead of
 * each platform's native alert dialog. Two buttons sit side by side (the
 * common Cancel/Confirm shape); anything else (a lone OK, or a 3-way delete
 * choice) stacks full-width instead, so it never gets cramped.
 */
export default function AppAlertHost() {
  const colors = useThemeColors();
  const { visible, title, message, buttons, hide } = useAlertStore();

  const onPressButton = (button: AlertButton) => {
    hide();
    button.onPress?.();
  };

  const sideBySide = buttons.length === 2;

  const buttonColor = (button: AlertButton) => {
    if (button.style === 'destructive') return colors.danger;
    if (button.style === 'cancel') return colors.textSecondary;
    return colors.primary;
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={hide}>
      <View style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.content}>
            <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
            {!!message && <Text style={[styles.message, { color: colors.textSecondary }]}>{message}</Text>}
          </View>

          <View style={[styles.buttonWrap, { borderTopColor: colors.border }, sideBySide && styles.buttonRow]}>
            {buttons.map((button, i) => (
              <TouchableOpacity
                key={i}
                onPress={() => onPressButton(button)}
                style={[
                  styles.button,
                  sideBySide ? { flex: 1 } : undefined,
                  i > 0 && { borderColor: colors.border },
                  i > 0 && (sideBySide ? styles.buttonBorderLeft : styles.buttonBorderTop),
                ]}
              >
                <Text
                  style={[
                    styles.buttonText,
                    { color: buttonColor(button), fontWeight: button.style === 'cancel' ? '600' : '700' },
                  ]}
                >
                  {button.text}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  card: { width: '100%', maxWidth: 340, borderRadius: 22, borderWidth: 1, overflow: 'hidden' },
  content: { padding: 20, paddingBottom: 18 },
  title: { fontSize: 17, fontWeight: '800' },
  message: { fontSize: 14, lineHeight: 20, marginTop: 8 },
  buttonWrap: { borderTopWidth: 1 },
  buttonRow: { flexDirection: 'row' },
  button: { paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  buttonBorderLeft: { borderLeftWidth: 1 },
  buttonBorderTop: { borderTopWidth: 1 },
  buttonText: { fontSize: 15 },
});
