import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { formatDistanceToNow } from 'date-fns';
import { useThemeColors, ThemeMode } from '../theme';
import { useSettingsStore } from '../store/settingsStore';
import { getCalendarSourceSync } from '../db/database';
import { profile } from '../profile';
import PillGroup from '../components/Pill';
import { ReminderOffsetMinutes } from '../types';

const REMINDER_OPTIONS: { label: string; value: ReminderOffsetMinutes }[] = [
  { label: '30 min', value: 30 },
  { label: '15 min', value: 15 },
  { label: '5 min', value: 5 },
  { label: '2 min', value: 2 },
];

const THEME_OPTIONS: { label: string; value: ThemeMode }[] = [
  { label: 'System', value: 'system' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
];

export default function SettingsScreen() {
  const colors = useThemeColors();
  const {
    calendarSources,
    toggleCalendarSource,
    reminderOffsets,
    toggleReminderOffset,
    snoozeMinutes,
    setSnoozeMinutes,
    requireConfirmation,
    setRequireConfirmation,
    themeMode,
    setThemeMode,
  } = useSettingsStore();

  const onSignOut = () => {
    Alert.alert('Sign out', 'This disconnects your Microsoft account (Teams & Outlook sync) from MeetAlert.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          if (calendarSources.teams) toggleCalendarSource('teams');
          if (calendarSources.outlook) toggleCalendarSource('outlook');
        },
      },
    ]);
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]} contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
      <Text style={[styles.heading, { color: colors.textPrimary }]}>Settings</Text>

      <View style={[styles.profileCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={[styles.avatar, { backgroundColor: colors.accent }]}>
          <Text style={styles.avatarText}>{profile.initials}</Text>
        </View>
        <View style={{ marginLeft: 14 }}>
          <Text style={[styles.profileName, { color: colors.textPrimary }]}>{profile.fullName}</Text>
          <Text style={[styles.profileRole, { color: colors.textSecondary }]}>{profile.role}</Text>
        </View>
      </View>

      <SectionLabel colors={colors}>Appearance</SectionLabel>
      <PillGroup options={THEME_OPTIONS} selected={[themeMode]} onToggle={setThemeMode} />

      <SectionLabel colors={colors}>Calendar sources</SectionLabel>
      <SourceRow
        colors={colors}
        letter="T"
        avatarColor={colors.avatarTeams}
        title="Microsoft Teams"
        syncKey="graph"
        enabled={calendarSources.teams}
        onToggle={() => toggleCalendarSource('teams')}
      />
      <SourceRow
        colors={colors}
        letter="O"
        avatarColor={colors.avatarOutlook}
        title="Outlook calendar"
        syncKey="graph"
        enabled={calendarSources.outlook}
        onToggle={() => toggleCalendarSource('outlook')}
      />
      <SourceRow
        colors={colors}
        letter="C"
        avatarColor={colors.avatarLocal}
        title="Device local calendar"
        syncKey="local_calendar"
        enabled={calendarSources.localCalendar}
        onToggle={() => toggleCalendarSource('localCalendar')}
      />
      <View style={[styles.sourceRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={[styles.sourceAvatar, { backgroundColor: colors.avatarManual }]}>
          <Text style={styles.sourceAvatarText}>M</Text>
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={[styles.sourceTitle, { color: colors.textPrimary }]}>Manual entries</Text>
          <Text style={[styles.sourceSub, { color: colors.textMuted }]}>Always available</Text>
        </View>
      </View>

      <SectionLabel colors={colors}>Reminder schedule</SectionLabel>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <PillGroup tone="secondary" options={REMINDER_OPTIONS} selected={reminderOffsets} onToggle={toggleReminderOffset} />

        <View style={styles.stepperRow}>
          <Text style={[styles.stepperLabel, { color: colors.textPrimary }]}>Snooze frequency</Text>
          <View style={styles.stepper}>
            <TouchableOpacity
              onPress={() => setSnoozeMinutes(snoozeMinutes - 1)}
              style={[styles.stepperButton, { backgroundColor: colors.surfaceAlt }]}
            >
              <Text style={{ color: colors.textPrimary, fontSize: 16 }}>−</Text>
            </TouchableOpacity>
            <Text style={[styles.stepperValue, { color: colors.textPrimary }]}>{snoozeMinutes} min</Text>
            <TouchableOpacity
              onPress={() => setSnoozeMinutes(snoozeMinutes + 1)}
              style={[styles.stepperButton, { backgroundColor: colors.surfaceAlt }]}
            >
              <Text style={{ color: colors.textPrimary, fontSize: 16 }}>+</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <SectionLabel colors={colors}>Alarm</SectionLabel>
      <View style={[styles.toggleRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.toggleLabel, { color: colors.textPrimary }]}>Require confirmation to stop</Text>
        <TouchableOpacity
          onPress={() => setRequireConfirmation(!requireConfirmation)}
          style={[styles.switchTrack, { backgroundColor: requireConfirmation ? colors.primary : colors.border }]}
        >
          <View style={[styles.switchThumb, { alignSelf: requireConfirmation ? 'flex-end' : 'flex-start' }]} />
        </TouchableOpacity>
      </View>

      <TouchableOpacity onPress={onSignOut} style={{ marginTop: 28 }}>
        <Text style={[styles.signOut, { color: colors.warning }]}>Sign out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function SectionLabel({ children, colors }: { children: string; colors: ReturnType<typeof useThemeColors> }) {
  return <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{children}</Text>;
}

function SourceRow({
  colors,
  letter,
  avatarColor,
  title,
  syncKey,
  enabled,
  onToggle,
}: {
  colors: ReturnType<typeof useThemeColors>;
  letter: string;
  avatarColor: string;
  title: string;
  syncKey: string;
  enabled: boolean;
  onToggle: () => void;
}) {
  const lastSynced = getCalendarSourceSync(syncKey);
  const subtitle = enabled
    ? lastSynced
      ? `Connected · synced ${formatDistanceToNow(new Date(lastSynced), { addSuffix: true })}`
      : 'Connected · syncs on next refresh'
    : 'Disconnected';

  return (
    <View style={[styles.sourceRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={[styles.sourceAvatar, { backgroundColor: avatarColor }]}>
        <Text style={styles.sourceAvatarText}>{letter}</Text>
      </View>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={[styles.sourceTitle, { color: colors.textPrimary }]}>{title}</Text>
        <Text style={[styles.sourceSub, { color: colors.textMuted }]}>{subtitle}</Text>
      </View>
      <TouchableOpacity
        onPress={onToggle}
        style={[styles.switchTrack, { backgroundColor: enabled ? colors.primary : colors.border }]}
      >
        <View style={[styles.switchThumb, { alignSelf: enabled ? 'flex-end' : 'flex-start' }]} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  heading: { fontSize: 24, fontWeight: '800', marginBottom: 16 },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 8,
  },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  profileName: { fontSize: 17, fontWeight: '700' },
  profileRole: { fontSize: 13, marginTop: 2 },

  sectionLabel: { fontSize: 13, fontWeight: '700', marginTop: 24, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.4 },

  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 10,
  },
  sourceAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  sourceAvatarText: { color: '#fff', fontWeight: '700' },
  sourceTitle: { fontSize: 14, fontWeight: '600' },
  sourceSub: { fontSize: 12, marginTop: 2 },

  card: { borderRadius: 14, borderWidth: 1, padding: 16 },
  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18 },
  stepperLabel: { fontSize: 14, fontWeight: '600' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepperButton: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  stepperValue: { fontSize: 14, fontWeight: '700', minWidth: 48, textAlign: 'center' },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
  },
  toggleLabel: { fontSize: 14, fontWeight: '600', flex: 1, marginRight: 12 },

  switchTrack: { width: 46, height: 28, borderRadius: 14, padding: 3, justifyContent: 'center' },
  switchThumb: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff' },

  signOut: { textAlign: 'center', fontSize: 14, fontWeight: '700' },
});
