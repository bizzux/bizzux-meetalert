import { create } from 'zustand';
import { getSetting, setSetting } from '../db/database';
import { ReminderOffsetMinutes } from '../types';

export type ThemeMode = 'system' | 'light' | 'dark';

interface SettingsState {
  themeMode: ThemeMode;
  calendarSources: {
    teams: boolean;
    outlook: boolean;
    localCalendar: boolean;
  };
  reminderOffsets: ReminderOffsetMinutes[];
  snoozeMinutes: number;
  requireConfirmation: boolean;

  setThemeMode: (mode: ThemeMode) => void;
  toggleCalendarSource: (key: 'teams' | 'outlook' | 'localCalendar') => void;
  toggleReminderOffset: (offset: ReminderOffsetMinutes) => void;
  setSnoozeMinutes: (minutes: number) => void;
  setRequireConfirmation: (value: boolean) => void;
  hydrate: () => void;
}

const DEFAULTS = {
  themeMode: 'system' as ThemeMode,
  calendarSources: { teams: true, outlook: true, localCalendar: true },
  reminderOffsets: [30, 15, 5, 2] as ReminderOffsetMinutes[],
  snoozeMinutes: 2,
  requireConfirmation: true,
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
      calendarSources: getSetting('calendarSources', DEFAULTS.calendarSources),
      reminderOffsets: getSetting('reminderOffsets', DEFAULTS.reminderOffsets),
      snoozeMinutes: getSetting('snoozeMinutes', DEFAULTS.snoozeMinutes),
      requireConfirmation: getSetting('requireConfirmation', DEFAULTS.requireConfirmation),
    });
  },

  setThemeMode: (mode) => {
    setSetting('themeMode', mode);
    set({ themeMode: mode });
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
}));
