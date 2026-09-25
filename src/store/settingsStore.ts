import { create } from 'zustand';
import { getSetting, setSetting } from '../db/database';
import { ReminderOffsetMinutes } from '../types';

export type ThemeMode = 'system' | 'light' | 'dark';
export type HomeView = 'agenda' | 'timeline';

interface SettingsState {
  themeMode: ThemeMode;
  /** Home screen's view toggle — persisted so it reopens on whichever view
   * was last used instead of always resetting to Agenda. */
  homeView: HomeView;
  calendarSources: {
    microsoft: boolean;
    google: boolean;
    localCalendar: boolean;
  };
  reminderOffsets: ReminderOffsetMinutes[];
  snoozeMinutes: number;
  requireConfirmation: boolean;
  voiceAnnouncementEnabled: boolean;
  alarmSound: string;

  setThemeMode: (mode: ThemeMode) => void;
  setHomeView: (view: HomeView) => void;
  toggleCalendarSource: (key: 'microsoft' | 'google' | 'localCalendar') => void;
  toggleReminderOffset: (offset: ReminderOffsetMinutes) => void;
  setSnoozeMinutes: (minutes: number) => void;
  setRequireConfirmation: (value: boolean) => void;
  setVoiceAnnouncementEnabled: (value: boolean) => void;
  setAlarmSound: (soundKey: string) => void;
  hydrate: () => void;
  /** Snaps in-memory state back to DEFAULTS without touching disk — called
   * on sign-out (authStore) so the settings screen doesn't flash the
   * previous account's values while the sign-in screen is showing, before
   * the next hydrate() (on the next sign-in) loads whoever signs in next. */
  resetToDefaults: () => void;
}

const DEFAULTS = {
  themeMode: 'system' as ThemeMode,
  homeView: 'agenda' as HomeView,
  calendarSources: { microsoft: true, google: true, localCalendar: true },
  reminderOffsets: [30, 15, 5, 2] as ReminderOffsetMinutes[],
  snoozeMinutes: 2,
  requireConfirmation: true,
  voiceAnnouncementEnabled: true,
  alarmSound: 'default',
};

/**
 * Settings persisted through the app's existing expo-sqlite database (see
 * db/database.ts getSetting/setSetting) rather than a new storage
 * dependency. Call hydrate() once at app startup (after initDatabase()) to
 * load saved values; every setter both updates in-memory state and persists.
 */
export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...DEFAULTS,

  hydrate: () => {
    set({
      themeMode: getSetting('themeMode', DEFAULTS.themeMode),
      homeView: getSetting('homeView', DEFAULTS.homeView),
      calendarSources: getSetting('calendarSources', DEFAULTS.calendarSources),
      reminderOffsets: getSetting('reminderOffsets', DEFAULTS.reminderOffsets),
      snoozeMinutes: getSetting('snoozeMinutes', DEFAULTS.snoozeMinutes),
      requireConfirmation: getSetting('requireConfirmation', DEFAULTS.requireConfirmation),
      voiceAnnouncementEnabled: getSetting('voiceAnnouncementEnabled', DEFAULTS.voiceAnnouncementEnabled),
      alarmSound: getSetting('alarmSound', DEFAULTS.alarmSound),
    });
  },

  setThemeMode: (mode) => {
    setSetting('themeMode', mode);
    set({ themeMode: mode });
  },

  setHomeView: (view) => {
    setSetting('homeView', view);
    set({ homeView: view });
  },

  toggleCalendarSource: (key) => {
    const next = { ...get().calendarSources, [key]: !get().calendarSources[key] };
    setSetting('calendarSources', next);
    set({ calendarSources: next });
  },

  toggleReminderOffset: (offset) => {
    const current = get().reminderOffsets;
    const next = current.includes(offset)
      ? current.filter((o) => o !== offset)
      : [...current, offset].sort((a, b) => b - a);
    setSetting('reminderOffsets', next);
    set({ reminderOffsets: next });
  },

  setSnoozeMinutes: (minutes) => {
    const clamped = Math.min(10, Math.max(1, minutes));
    setSetting('snoozeMinutes', clamped);
    set({ snoozeMinutes: clamped });
  },

  setRequireConfirmation: (value) => {
    setSetting('requireConfirmation', value);
    set({ requireConfirmation: value });
  },

  setVoiceAnnouncementEnabled: (value) => {
    setSetting('voiceAnnouncementEnabled', value);
    set({ voiceAnnouncementEnabled: value });
  },

  setAlarmSound: (soundKey) => {
    setSetting('alarmSound', soundKey);
    set({ alarmSound: soundKey });
  },

  resetToDefaults: () => set({ ...DEFAULTS }),
}));
