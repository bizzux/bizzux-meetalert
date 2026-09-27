import React from 'react';
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  ViewStyle,
  StyleProp,
  ActivityIndicator,
  Image,
  ImageSourcePropType,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useThemeColors } from '../theme';

interface Props {
  label: string;
  onPress: () => void;
  icon?: string;
  /** A real icon image (e.g. the Google "G" logo) shown before the label —
   * takes priority over `icon` (a plain-text/emoji prefix) when both are set. */
  iconImage?: ImageSourcePropType;
  /** Recolors `iconImage` to this color — for a single-color silhouette icon
   * (like the camera icon) that should match the button's own text color
   * instead of keeping its source art (e.g. the multi-color Google logo,
   * which never sets this). Emoji `icon` can't be recolored this way, which
   * is exactly why a themed asset + this prop replaces it where the icon
   * needs to match the app's palette rather than the OS's fixed emoji art. */
  iconTint?: string;
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
  iconImage,
  iconTint,
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
          styles.row,
          { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
          style,
        ]}
      >
        {loading ? (
          <ActivityIndicator color={colors.textPrimary} />
        ) : (
          <>
            {iconImage ? (
              <Image
                source={iconImage}
                style={[styles.iconImage, iconTint ? { tintColor: iconTint } : null]}
                resizeMode="contain"
              />
            ) : null}
            <Text style={[styles.label, { color: colors.textPrimary }]}>
              {!iconImage && icon ? `${icon}  ` : ''}
              {label}
            </Text>
          </>
        )}
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
          <View style={styles.row}>
            {iconImage ? (
              <Image
                source={iconImage}
                style={[styles.iconImage, iconTint ? { tintColor: iconTint } : null]}
                resizeMode="contain"
              />
            ) : null}
            <Text style={[styles.label, { color: colors.textOnPrimary }]}>
              {!iconImage && icon ? `${icon}  ` : ''}
              {label}
            </Text>
          </View>
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
  row: { flexDirection: 'row', alignItems: 'center' },
  iconImage: { width: 20, height: 20, marginRight: 10 },
  label: { fontSize: 15, fontWeight: '700' },
});
