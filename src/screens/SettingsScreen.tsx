import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { formatDistanceToNow } from 'date-fns';
import { useThemeColors, ThemeMode } from '../theme';
import { useSettingsStore } from '../store/settingsStore';
import { getCalendarSourceSync } from '../db/database';
import { recreateAlarmChannel } from '../services/notifications';
import * as graphAuth from '../services/graphAuth';
import * as googleAuth from '../services/googleAuth';
import { profile } from '../profile';
import PillGroup from '../components/Pill';
import { ReminderOffsetMinutes } from '../types';

const ALARM_SOUND_OPTIONS = [
  { label: 'Default', value: 'default' },
  { label: 'Chime', value: 'chime' },
  { label: 'Classic', value: 'classic' },
];

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
  const insets = useSafeAreaInsets();
  const {
    calendarSources,
    toggleCalendarSource,
    reminderOffsets,
    toggleReminderOffset,
    snoozeMinutes,
    setSnoozeMinutes,
    requireConfirmation,
    setRequireConfirmation,
    voiceAnnouncementEnabled,
    setVoiceAnnouncementEnabled,
    alarmSound,
    setAlarmSound,
    themeMode,
    setThemeMode,
  } = useSettingsStore();

  const onChangeAlarmSound = (soundKey: string) => {
    setAlarmSound(soundKey);
    recreateAlarmChannel(soundKey);
  };

  const [microsoftAccount, setMicrosoftAccount] = useState<string | null>(null);
  const [googleEmail, setGoogleEmail] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<'microsoft' | 'google' | null>(null);

  const refreshAccountStatus = useCallback(async () => {
    const account = await graphAuth.getSignedInAccount();
    setMicrosoftAccount(account?.username ?? null);
    setGoogleEmail(googleAuth.isSignedIn() ? googleAuth.getSignedInEmail() : null);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshAccountStatus();
    }, [refreshAccountStatus])
  );

  const onConnectMicrosoft = async () => {
    setConnecting('microsoft');
    try {
      const result = await graphAuth.signIn();
      if (result) await refreshAccountStatus();
    } catch (err: any) {
      Alert.alert('Couldn’t connect Microsoft account', err?.message ?? 'Please try again.');
    } finally {
      setConnecting(null);
    }
  };

  const onDisconnectMicrosoft = () => {
    Alert.alert('Disconnect Microsoft account', 'Teams and Outlook meetings will stop syncing.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: async () => {
          await graphAuth.signOut();
          await refreshAccountStatus();
        },
      },
    ]);
  };

  const onConnectGoogle = async () => {
    setConnecting('google');
    try {
      const ok = await googleAuth.signIn();
      if (ok) await refreshAccountStatus();
    } catch (err: any) {
      Alert.alert('Couldn’t connect Google account', err?.message ?? 'Please try again.');
    } finally {
      setConnecting(null);
    }
  };

  const onDisconnectGoogle = () => {
    Alert.alert('Disconnect Google account', 'Google Calendar meetings will stop syncing.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: async () => {
          await googleAuth.signOut();
          await refreshAccountStatus();
        },
      },
    ]);
  };

  // Meetera has no account system of its own (see src/profile.ts) — it's a
  // single-user app tied to this device. "Signing in" only ever means
  // connecting a Microsoft or Google account so its calendar can sync in;
  // there's nothing else to sign into. The bottom "Sign out" link below is
  // only rendered once one of those is actually connected (see the JSX),
  // which removes the old dead-end "Nothing to sign out of" alert — if
  // there's nothing connected, there's nothing to show a sign-out control
  // for in the first place.
  const hasAnyAccountConnected = !!microsoftAccount || !!googleEmail;

  const onSignOut = () => {
    Alert.alert('Sign out', 'This disconnects every connected account (Microsoft and Google) from Meetera.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await Promise.all([graphAuth.signOut(), googleAuth.signOut()]);
          await refreshAccountStatus();
        },
      },
    ]);
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ padding: 20, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 60 }}
    >
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
      <Text style={[styles.sectionNote, { color: colors.textMuted }]}>
        Meetera is just for this device — there's no separate app account. Connect Microsoft and/or
        Google below to sync their meetings in; "Connect" is also how you sign in.
      </Text>
      <AccountRow
        colors={colors}
        letter="T"
        avatarColor={colors.avatarTeams}
        title="Microsoft (Teams & Outlook)"
        connectedLabel={microsoftAccount}
        included={calendarSources.microsoft}
        onToggleIncluded={() => toggleCalendarSource('microsoft')}
        onConnect={onConnectMicrosoft}
        onDisconnect={onDisconnectMicrosoft}
        connecting={connecting === 'microsoft'}
      />
      <AccountRow
        colors={colors}
        letter="G"
        avatarColor={colors.avatarGoogle}
        title="Google Calendar"
        connectedLabel={googleEmail}
        included={calendarSources.google}
        onToggleIncluded={() => toggleCalendarSource('google')}
        onConnect={onConnectGoogle}
        onDisconnect={onDisconnectGoogle}
        connecting={connecting === 'google'}
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
        <PillGroup options={REMINDER_OPTIONS} selected={reminderOffsets} onToggle={toggleReminderOffset} />

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

      <SectionLabel colors={colors}>Alarm & voice</SectionLabel>
      <View style={[styles.toggleRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.toggleLabel, { color: colors.textPrimary }]}>Require confirmation to stop</Text>
        <TouchableOpacity
          onPress={() => setRequireConfirmation(!requireConfirmation)}
          style={[styles.switchTrack, { backgroundColor: requireConfirmation ? colors.primary : colors.border }]}
        >
          <View style={[styles.switchThumb, { alignSelf: requireConfirmation ? 'flex-end' : 'flex-start' }]} />
        </TouchableOpacity>
      </View>

      <View style={[styles.toggleRow, { backgroundColor: colors.surface, borderColor: colors.border, marginTop: 10 }]}>
        <Text style={[styles.toggleLabel, { color: colors.textPrimary }]}>
          Voice announcement{'\n'}
          <Text style={{ fontSize: 12, fontWeight: '400', color: colors.textMuted }}>
            Says the meeting name aloud when it rings
          </Text>
        </Text>
        <TouchableOpacity
          onPress={() => setVoiceAnnouncementEnabled(!voiceAnnouncementEnabled)}
          style={[styles.switchTrack, { backgroundColor: voiceAnnouncementEnabled ? colors.primary : colors.border }]}
        >
          <View style={[styles.switchThumb, { alignSelf: voiceAnnouncementEnabled ? 'flex-end' : 'flex-start' }]} />
        </TouchableOpacity>
      </View>

      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, marginTop: 10 }]}>
        <Text style={[styles.stepperLabel, { color: colors.textPrimary, marginBottom: 10 }]}>Alarm sound</Text>
        <PillGroup options={ALARM_SOUND_OPTIONS} selected={[alarmSound]} onToggle={onChangeAlarmSound} />
        <Text style={[styles.soundNote, { color: colors.textMuted }]}>
          Chime and Classic need matching sound files added to the app project — Default always works.
        </Text>
      </View>

      {hasAnyAccountConnected && (
        <TouchableOpacity onPress={onSignOut} style={{ marginTop: 28 }}>
          <Text style={[styles.signOut, { color: colors.warning }]}>Sign out</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

function SectionLabel({ children, colors }: { children: string; colors: ReturnType<typeof useThemeColors> }) {
  return <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{children}</Text>;
}

/** A real account connection (Microsoft or Google): shows Connect when
 * signed out, or the connected account + a Disconnect action plus an
 * "include in sync" switch once signed in. */
function AccountRow({
  colors,
  letter,
  avatarColor,
  title,
  connectedLabel,
  included,
  onToggleIncluded,
  onConnect,
  onDisconnect,
  connecting,
}: {
  colors: ReturnType<typeof useThemeColors>;
  letter: string;
  avatarColor: string;
  title: string;
  connectedLabel: string | null;
  included: boolean;
  onToggleIncluded: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  connecting: boolean;
}) {
  const isConnected = !!connectedLabel;

  return (
    <View style={[styles.sourceRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={[styles.sourceAvatar, { backgroundColor: avatarColor }]}>
        <Text style={styles.sourceAvatarText}>{letter}</Text>
      </View>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={[styles.sourceTitle, { color: colors.textPrimary }]}>{title}</Text>
        <Text style={[styles.sourceSub, { color: colors.textMuted }]}>
          {isConnected ? `Connected as ${connectedLabel}` : 'Not connected'}
        </Text>
      </View>
      {isConnected ? (
        <View style={{ alignItems: 'flex-end' }}>
          <TouchableOpacity
            onPress={onToggleIncluded}
            style={[styles.switchTrack, { backgroundColor: included ? colors.primary : colors.border }]}
          >
            <View style={[styles.switchThumb, { alignSelf: included ? 'flex-end' : 'flex-start' }]} />
          </TouchableOpacity>
          <TouchableOpacity onPress={onDisconnect} style={{ marginTop: 8 }}>
            <Text style={{ color: colors.danger, fontSize: 12.5, fontWeight: '600' }}>Disconnect</Text>
          </TouchableOpacity>
        </View>
      ) : connecting ? (
        <ActivityIndicator color={colors.primary} />
      ) : (
        <TouchableOpacity
          onPress={onConnect}
          style={[styles.connectButton, { backgroundColor: colors.primary }]}
        >
          <Text style={styles.connectButtonText}>Connect</Text>
        </TouchableOpacity>
      )}
    </View>
  );
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
  sectionNote: { fontSize: 12.5, lineHeight: 17, marginTop: -4, marginBottom: 12 },

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
  connectButton: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  connectButtonText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  signOut: { textAlign: 'center', fontSize: 14, fontWeight: '700' },
  soundNote: { fontSize: 12.5, marginTop: 12, lineHeight: 17 },
});
