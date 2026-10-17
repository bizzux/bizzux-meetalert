import { useColorScheme } from 'react-native';
import { useSettingsStore } from './store/settingsStore';

// BizzMinder color system - pinned to the exact Bizzux brand palette, sampled
// pixel-by-pixel from the bizzux.com screenshots (pricing page + dark hero
// page): the teal→blue gradient (#14A69C → #2159D4) used on every CTA
// button and toggle, the dark hero navy (#0F1B2D), the lime accent
// (#A3E635), the discount orange (#FF4D00), and the slate-900/slate-600
// text pair used on the white page. Both light and dark palettes share the
// same role names so screens never branch on theme mode directly - they
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
  // Empty-field placeholder text ("Standup tomorrow 9am", "you@example.com",
  // etc.) - kept a plain gray in both themes, deliberately separate from
  // textMuted above: dark mode's textMuted is forced to white (see that
  // field's own comment below), but a placeholder needs to read as "nothing
  // typed here yet" against real white input text, so it stays gray even in
  // dark mode.
  placeholder: string;

  primary: string;
  primaryDark: string;
  gradientStart: string; // for LinearGradient - brand teal
  gradientEnd: string; // for LinearGradient - brand blue
  // For small text sitting directly on a dark surface (the paywall's
  // strikethrough "was" price, TrialBanner's "Make payment" link) -
  // `primary` (#2159D4) only clears ~2.5:1 contrast against the dark-mode
  // navy surfaces, well under the ~4.5:1 normal text needs, so it was hard
  // to read there even though it's plenty visible as a button fill, border,
  // or icon. Dark mode uses the same lime as `accent` instead (confirmed
  // against the real card background). Light mode keeps it identical to
  // `primary` - that pairing already reads fine on white, and the same lime
  // would barely clear ~1.5:1 contrast there, the opposite problem.
  linkText: string;

  secondary: string; // teal - reminders, attended, positive
  accent: string; // lime - secondary highlights

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

  // Screen-background wash (Home screen redesign) - a near-flat diagonal
  // variation of the exact dark navy background, plus a flat fill for the
  // "next meeting" hero card. Both light and dark keep heroGradient flat
  // (same color repeated) so the gradient component is a visual no-op in
  // both themes - dark mode's card matches the dark navy page background,
  // light mode's stays pure white, each set off only by its own border.
  screenGradient: [string, string, string];
  heroGradient: [string, string];
}

// Dark mode = the exact bizzux.com dark hero background (#0F1B2D - sampled
// directly, it's a flat navy there, not a gradient, so screenGradient below
// stays a near-flat variation of it rather than inventing a stronger wash).
const dark: ThemeColors = {
  background: '#0F1B2D',
  surface: '#16263C',
  surfaceAlt: '#1C3350',
  border: '#2A4060',

  textPrimary: '#FFFFFF',
  // Requested explicitly: every gray/muted text tone in dark mode reads as
  // plain white now, not the slate-gray (#94A3B8 / #64748B) it used to be -
  // light mode's textSecondary/textMuted below are untouched, so this is
  // dark-mode-only. Note this does flatten the primary/secondary text
  // hierarchy in dark mode (section labels, subtitles, and hints are now the
  // same white as titles) - that trade-off was the explicit ask, not an
  // oversight.
  textSecondary: '#FFFFFF',
  textMuted: '#FFFFFF',
  textOnPrimary: '#FFFFFF',
  // Same slate gray placeholders use on the light page below - not white,
  // so an empty field still looks empty next to real (white) typed text.
  placeholder: '#94A3B8',

  primary: '#2159D4',
  primaryDark: '#1B49C5',
  gradientStart: '#14A69C',
  gradientEnd: '#2159D4',
  // See this field's own comment on the interface above.
  linkText: '#A3E635',

  secondary: '#12A695',
  accent: '#A3E635',

  success: '#12A695',
  warning: '#FF4D00',
  danger: '#F87171',

  avatarTeams: '#3B82F6',
  avatarOutlook: '#2159D4',
  avatarLocal: '#14A69C',
  // Manual entries used to show a plain "M" letter on this same green as
  // avatarLocal - easy to mistake for another synced source. Now it's a
  // meeting-icon glyph instead of a letter (see Avatar.tsx), so it gets its
  // own distinct blue instead, as asked.
  avatarManual: '#3B5BDB',
  avatarGoogle: '#A3E635',

  white: '#FFFFFF',
  overlay: 'rgba(15,27,45,0.72)',

  screenGradient: ['#0A1420', '#0F1B2D', '#132540'],
  // Flat dark navy, matching `background` exactly - not the brand teal it
  // used to be. The card's own `border` (see HeroCard/timelineCardInner in
  // TodayScreen.tsx) is what separates it from the page now, same as every
  // other surface card in dark mode.
  heroGradient: ['#0F1B2D', '#0F1B2D'],
};

// Light mode = the exact bizzux.com pricing-page palette: pure white
// background, slate-900/slate-600 text (sampled directly off the page's
// headings and body copy), and the same teal→blue gradient the site uses
// on "Start Free Trial" etc. - sampled on this exact white background, so
// it's the same pairing here.
const light: ThemeColors = {
  background: '#FFFFFF',
  surface: '#FFFFFF',
  // The site's own light teal badge fill ("AI-POWERED..." pill), sampled
  // directly - a touch lighter here so it works as a broad panel tint
  // rather than just a small badge.
  surfaceAlt: '#F0FDFA',
  border: '#CCFBF1',

  textPrimary: '#0F172A',
  textSecondary: '#475569',
  textMuted: '#64748B',
  textOnPrimary: '#FFFFFF',
  placeholder: '#94A3B8',

  primary: '#2159D4',
  primaryDark: '#1B49C5',
  gradientStart: '#14A69C',
  gradientEnd: '#2159D4',
  // Same as `primary` in light mode - no contrast problem to fix here
  // against the white page (see the interface field's own comment).
  linkText: '#2159D4',

  secondary: '#12A695',
  accent: '#A3E635',

  success: '#12A695',
  warning: '#FF4D00',
  danger: '#DC2626',

  avatarTeams: '#2159D4',
  avatarOutlook: '#2159D4',
  avatarLocal: '#14A69C',
  // See the dark palette's avatarManual comment - same reasoning here.
  avatarManual: '#3B5BDB',
  avatarGoogle: '#65A30D',

  white: '#FFFFFF',
  overlay: 'rgba(15,23,42,0.4)',

  // Flat (both stops identical) - light mode keeps its plain white
  // background and white hero card exactly as before. The brand gradient
  // itself is only ever paired with white text on bizzux.com too (its
  // buttons, never a text-heavy card) - HeroCard here renders textPrimary/
  // textSecondary (dark, for the white page) directly on top of
  // heroGradient, so making this the colorful gradient would put dark text
  // on a mid-tone teal/blue background and hurt readability. Kept flat.
  screenGradient: ['#FFFFFF', '#FFFFFF', '#FFFFFF'],
  heroGradient: ['#FFFFFF', '#FFFFFF'],
};

export const themes = { light, dark };

// Deliberately NOT part of ThemeColors/the light-dark split above - one-off
// accent for the paywall's "launch pricing" tag only, the same in both
// themes on purpose: a touch lighter than dark mode's own #0F1B2D
// background, picked during design review specifically so lime text sits
// on it clearly without looking near-black.
export const GALAXY_BLUE = '#26407A';

/** Live palette for the current theme - follows system appearance unless the
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
