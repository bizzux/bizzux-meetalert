import { useColorScheme } from 'react-native';
import { useSettingsStore } from './store/settingsStore';

// Meetera color system — pinned to the exact Bizzux brand palette, sampled
// pixel-by-pixel from the bizzux.com screenshots (pricing page + dark hero
// page): the teal→blue gradient (#14A69C → #2159D4) used on every CTA
// button and toggle, the dark hero navy (#0F1B2D), the lime accent
// (#A3E635), the discount orange (#FF4D00), and the slate-900/slate-600
// text pair used on the white page. Both light and dark palettes share the
// same role names so screens never branch on theme mode directly — they
// just read colors.<role> from useThemeColors().

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
  gradientStart: string; // for LinearGradient — brand teal
  gradientEnd: string; // for LinearGradient — brand blue

  secondary: string; // teal — reminders, attended, positive
  accent: string; // lime — secondary highlights

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

  // Screen-background wash (Home screen redesign) — a near-flat diagonal
  // variation of the exact dark navy background, plus a matching fill for
  // the "next meeting" hero card that echoes the same brand teal-to-blue
  // gradient used on buttons and toggles. Light mode's entries are flat
  // (same color repeated) so the gradient components are a visual no-op
  // there — light mode stays pure white as before.
  screenGradient: [string, string, string];
  heroGradient: [string, string];
}

// Dark mode = the exact bizzux.com dark hero background (#0F1B2D — sampled
// directly, it's a flat navy there, not a gradient, so screenGradient below
// stays a near-flat variation of it rather than inventing a stronger wash).
const dark: ThemeColors = {
  background: '#0F1B2D',
  surface: '#16263C',
  surfaceAlt: '#1C3350',
  border: '#2A4060',

  textPrimary: '#FFFFFF',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  textOnPrimary: '#FFFFFF',

  primary: '#2159D4',
  primaryDark: '#1B49C5',
  gradientStart: '#14A69C',
  gradientEnd: '#2159D4',

  secondary: '#12A695',
  accent: '#A3E635',

  success: '#12A695',
  warning: '#FF4D00',
  danger: '#F87171',

  avatarTeams: '#3B82F6',
  avatarOutlook: '#2159D4',
  avatarLocal: '#14A69C',
  avatarManual: '#12A695',
  avatarGoogle: '#A3E635',

  white: '#FFFFFF',
  overlay: 'rgba(15,27,45,0.72)',

  screenGradient: ['#0A1420', '#0F1B2D', '#132540'],
  heroGradient: ['#14A69C', '#2159D4'],
};

// Light mode = the exact bizzux.com pricing-page palette: pure white
// background, slate-900/slate-600 text (sampled directly off the page's
// headings and body copy), and the same teal→blue gradient the site uses
// on "Start Free Trial" etc. — sampled on this exact white background, so
// it's the same pairing here.
const light: ThemeColors = {
  background: '#FFFFFF',
  surface: '#FFFFFF',
  // The site's own light teal badge fill ("AI-POWERED..." pill), sampled
  // directly — a touch lighter here so it works as a broad panel tint
  // rather than just a small badge.
  surfaceAlt: '#F0FDFA',
  border: '#CCFBF1',

  textPrimary: '#0F172A',
  textSecondary: '#475569',
  textMuted: '#64748B',
  textOnPrimary: '#FFFFFF',

  primary: '#2159D4',
  primaryDark: '#1B49C5',
  gradientStart: '#14A69C',
  gradientEnd: '#2159D4',

  secondary: '#12A695',
  accent: '#A3E635',

  success: '#12A695',
  warning: '#FF4D00',
  danger: '#DC2626',

  avatarTeams: '#2159D4',
  avatarOutlook: '#2159D4',
  avatarLocal: '#14A69C',
  avatarManual: '#12A695',
  avatarGoogle: '#65A30D',

  white: '#FFFFFF',
  overlay: 'rgba(15,23,42,0.4)',

  // Flat (both stops identical) — light mode keeps its plain white
  // background and white hero card exactly as before. The brand gradient
  // itself is only ever paired with white text on bizzux.com too (its
  // buttons, never a text-heavy card) — HeroCard here renders textPrimary/
  // textSecondary (dark, for the white page) directly on top of
  // heroGradient, so making this the colorful gradient would put dark text
  // on a mid-tone teal/blue background and hurt readability. Kept flat.
  screenGradient: ['#FFFFFF', '#FFFFFF', '#FFFFFF'],
  heroGradient: ['#FFFFFF', '#FFFFFF'],
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
