import React from 'react';
import { Text, TouchableOpacity, StyleSheet, ViewStyle, StyleProp, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useThemeColors } from '../theme';

interface Props {
  label: string;
  onPress: () => void;
  icon?: string;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'outline' | 'muted';
}

/** The signature gradient (violet → blue) pill button used for every primary
 * call-to-action: Join now, Save meeting, I've joined — stop alarm, the FAB. */
export default function GradientButton({
  label,
  onPress,
  icon,
  style,
  disabled,
  loading,
  variant = 'primary',
}: Props) {
  const colors = useThemeColors();

  if (variant === 'outline') {
    return (
      <TouchableOpacity
        onPress={onPress}
        disabled={disabled || loading}
        style={[
          styles.base,
          { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
          style,
        ]}
      >
        <Text style={[styles.label, { color: colors.textPrimary }]}>
          {icon ? `${icon}  ` : ''}
          {label}
        </Text>
      </TouchableOpacity>
    );
  }

  if (variant === 'muted') {
    return (
      <TouchableOpacity
        onPress={onPress}
        disabled={disabled || loading}
        style={[styles.base, { backgroundColor: colors.surfaceAlt }, style]}
      >
        <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity onPress={onPress} disabled={disabled || loading} style={[{ opacity: disabled ? 0.6 : 1 }, style]}>
      <LinearGradient
        colors={[colors.gradientStart, colors.gradientEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.base}
      >
        {loading ? (
          <ActivityIndicator color={colors.textOnPrimary} />
        ) : (
          <Text style={[styles.label, { color: colors.textOnPrimary }]}>
            {icon ? `${icon}  ` : ''}
            {label}
          </Text>
        )}
      </LinearGradient>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 15, fontWeight: '700' },
});
