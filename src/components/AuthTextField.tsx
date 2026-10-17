import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, TextInputProps, TouchableOpacity } from 'react-native';
import Svg, { Path, Circle, Line } from 'react-native-svg';
import { useThemeColors } from '../theme';

interface Props extends TextInputProps {
  label: string;
  error?: boolean;
}

/** Plain stroke eye / eye-with-slash glyph, same 24x24 outline language as
 * TabIcons.tsx's icons, so the password-reveal toggle matches the rest of
 * the app's icon style instead of introducing a new icon library. */
function EyeIcon({ color, visible }: { color: string; visible: boolean }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12Z" />
      <Circle cx={12} cy={12} r={3} />
      {!visible && <Line x1={2.5} y1={2.5} x2={21.5} y2={21.5} />}
    </Svg>
  );
}

/** Shared labeled input for the sign-in / create-account / phone-OTP /
 * forgot-password screens - kept to one place so all four look identical.
 *
 * Any field passed `secureTextEntry` (every password field in this app sets
 * it to `true`) automatically gets a show/hide eye button on the right -
 * masked by default, tap to reveal, tap again to re-mask. A field that
 * never passes `secureTextEntry` at all renders exactly as before, no icon. */
export default function AuthTextField({ label, error, style, secureTextEntry, ...inputProps }: Props) {
  const colors = useThemeColors();
  const isPasswordField = secureTextEntry !== undefined;
  const [visible, setVisible] = useState(false);

  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
      <View style={styles.inputRow}>
        <TextInput
          placeholderTextColor={colors.placeholder}
          secureTextEntry={isPasswordField ? !visible : secureTextEntry}
          style={[
            styles.input,
            isPasswordField && styles.inputWithIcon,
            {
              backgroundColor: colors.surfaceAlt,
              borderColor: error ? colors.danger : colors.border,
              color: colors.textPrimary,
            },
            style,
          ]}
          {...inputProps}
        />
        {isPasswordField && (
          <TouchableOpacity
            onPress={() => setVisible((v) => !v)}
            style={styles.eyeButton}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityLabel={visible ? 'Hide password' : 'Show password'}
          >
            <EyeIcon color={colors.textSecondary} visible={visible} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '600', marginBottom: 6 },
  inputRow: { justifyContent: 'center' },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
  },
  // Room for the eye button so typed text never runs under it.
  inputWithIcon: { paddingRight: 44 },
  eyeButton: { position: 'absolute', right: 12, padding: 4 },
});
