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
  avatarGoogle: string;

  white: string;
  overlay: string; // scrim behind modals/alarm screen
}

// Blue / teal / turquoise family throughout — no violet/purple anywhere.
// Dark mode is tinted toward a deep teal (not plain navy/black) so the
// blue/teal accent colors read as part of one consistent color family
// rather than sitting on a generic dark-gray background.
const dark: ThemeColors = {
  background: '#081716',
  surface: '#0E2422',
  surfaceAlt: '#123330',
  border: '#1E4340',

  textPrimary: '#F1F6FA',
  textSecondary: '#9AB0C2',
  textMuted: '#66808F',
  textOnPrimary: '#FFFFFF',

  primary: '#0EA5E9',
  primaryDark: '#0369A1',
  gradientStart: '#2DD4BF',
  gradientEnd: '#0284C7',

  secondary: '#14B8A6',
  accent: '#22D3EE',

  success: '#14B8A6',
  warning: '#F59E0B',
  danger: '#F87171',

  avatarTeams: '#3B82F6',
  avatarOutlook: '#0EA5E9',
  avatarLocal: '#06B6D4',
  avatarManual: '#14B8A6',
  avatarGoogle: '#2DD4BF',

  white: '#FFFFFF',
  overlay: 'rgba(4,10,18,0.72)',
};

// Light mode background is pure white — cards/pills use a very faint teal
// tint (surfaceAlt) and border so they still read as distinct sections
// against it without the whole screen looking off-white.
const light: ThemeColors = {
  background: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceAlt: '#EFF6F8',
  // A touch stronger than surfaceAlt so a white card's border still reads
  // clearly against the now-pure-white background (previously the
  // background itself was tinted, doing most of that work).
  border: '#CFE3EA',

  textPrimary: '#0B2436',
  textSecondary: '#4E6B7C',
  textMuted: '#8AA4B2',
  textOnPrimary: '#FFFFFF',

  primary: '#0284C7',
  primaryDark: '#075985',
  gradientStart: '#06B6D4',
  gradientEnd: '#2563EB',

  secondary: '#0D9488',
  accent: '#0891B2',

  success: '#0D9488',
  warning: '#D97706',
  danger: '#DC2626',

  avatarTeams: '#2563EB',
  avatarOutlook: '#0284C7',
  avatarLocal: '#0891B2',
  avatarManual: '#0D9488',
  avatarGoogle: '#0D9488',

  white: '#FFFFFF',
  overlay: 'rgba(11,36,54,0.4)',
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
