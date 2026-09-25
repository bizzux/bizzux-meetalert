import { useColorScheme } from 'react-native';
import { useSettingsStore } from './store/settingsStore';

// MeetAlert color system — indigo/violet + blue + teal, with an amber/orange
// accent reserved for "missed" status. Both light and dark palettes share
// the same role names so screens never branch on theme mode directly —
// they just read colors.<role> from useThemeColors().

export interface ThemeColors {
  background: string;
  surface: string;
  surfaceAlt: string; // tab bar, headers, secondary panels
  border: string;

  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textOnPrimary: string;

  primary: string;
  primaryDark: string;
  gradientStart: string; // for LinearGradient — violet
  gradientEnd: string; // for LinearGradient — blue

  secondary: string; // teal — reminders, attended, positive
  accent: string; // purple — secondary highlights

  success: string;
  warning: string; // missed status (amber/orange)
  danger: string; // form errors

  avatarTeams: string;
  avatarOutlook: string;
  avatarLocal: string;
  avatarManual: string;

  white: string;
  overlay: string; // scrim behind modals/alarm screen
}

const dark: ThemeColors = {
  background: '#0B0E1E',
  surface: '#151933',
  surfaceAlt: '#1B2040',
  border: '#2A2F55',

  textPrimary: '#F5F6FF',
  textSecondary: '#9CA3C9',
  textMuted: '#6B7299',
  textOnPrimary: '#FFFFFF',

  primary: '#6D5BFF',
  primaryDark: '#5142D6',
  gradientStart: '#7C5CFF',
  gradientEnd: '#4F8EFF',

  secondary: '#14B8A6',
  accent: '#A78BFA',

  success: '#14B8A6',
  warning: '#F59E0B',
  danger: '#F87171',

  avatarTeams: '#4F6BFF',
  avatarOutlook: '#3B82F6',
  avatarLocal: '#A855F7',
  avatarManual: '#14B8A6',

  white: '#FFFFFF',
  overlay: 'rgba(5,7,20,0.72)',
};

const light: ThemeColors = {
  background: '#F5F6FC',
  surface: '#FFFFFF',
  surfaceAlt: '#EEF0FB',
  border: '#E4E7FB',

  textPrimary: '#1E1B4B',
  textSecondary: '#585B8A',
  textMuted: '#9A9DC2',
  textOnPrimary: '#FFFFFF',

  primary: '#5B4FE0',
  primaryDark: '#3E36A8',
  gradientStart: '#6D5BFF',
  gradientEnd: '#3E7BFA',

  secondary: '#0D9488',
  accent: '#7C3AED',

  success: '#0D9488',
  warning: '#D97706',
  danger: '#DC2626',

  avatarTeams: '#4F6BFF',
  avatarOutlook: '#2563EB',
  avatarLocal: '#7C3AED',
  avatarManual: '#0D9488',

  white: '#FFFFFF',
  overlay: 'rgba(30,27,75,0.4)',
};

export const themes = { light, dark };

/** Live palette for the current theme — follows system appearance unless the
 * user picked Light/Dark explicitly in Settings. Use in every screen instead
 * of importing colors directly, so theme switching updates the whole app. */
export function useThemeColors(): ThemeColors {
  const systemScheme = useColorScheme();
  const mode = useSettingsStore((s) => s.themeMode); // 'system' | 'light' | 'dark'
  const resolved = mode === 'system' ? systemScheme ?? 'dark' : mode;
  return resolved === 'light' ? light : dark;
}

export function useIsDark(): boolean {
  const systemScheme = useColorScheme();
  const mode = useSettingsStore((s) => s.themeMode);
  const resolved = mode === 'system' ? systemScheme ?? 'dark' : mode;
  return resolved === 'dark';
}
