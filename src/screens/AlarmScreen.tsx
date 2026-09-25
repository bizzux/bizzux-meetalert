import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Easing } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { getMeeting, getReminderProgress } from '../db/database';
import { confirmJoined, snoozeAlarm, markMissed } from '../services/reminderEngine';
import { useThemeColors } from '../theme';
import { useSettingsStore } from '../store/settingsStore';
import GradientButton from '../components/GradientButton';

/**
 * Full-screen ringing alert — shown when a meeting's alarm fires (tapped
 * from the notification / full-screen intent) or opened manually. This is
 * the ONLY place that stops the alarm: "I've joined" confirms attendance,
 * Snooze re-rings after the configured interval, and "Mark as missed" is an
 * explicit opt-out. Closing the screen with × does not stop the alarm.
 */
export default function AlarmScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const meetingId: string = route.params?.meetingId;
  const colors = useThemeColors();
  const snoozeMinutes = useSettingsStore((s) => s.snoozeMinutes);

  const meeting = useMemo(() => getMeeting(meetingId), [meetingId]);
  const [busy, setBusy] = useState(false);

  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1200, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  if (!meeting) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, justifyContent: 'center' }]}>
        <Text style={{ color: colors.textSecondary, textAlign: 'center' }}>This meeting is no longer available.</Text>
        <GradientButton label="Close" onPress={() => navigation.goBack()} style={{ margin: 24 }} />
      </View>
    );
  }

  const progress = getReminderProgress(meeting.id);
  const alertNumber = Object.values(progress.sent).filter(Boolean).length + 1;

  const onConfirm = async () => {
    setBusy(true);
    try {
      await confirmJoined(meeting.id);
      navigation.goBack();
    } finally {
      setBusy(false);
    }
  };

  const onSnooze = async () => {
    setBusy(true);
    try {
      await snoozeAlarm(meeting.id, snoozeMinutes);
      navigation.goBack();
    } finally {
      setBusy(false);
    }
  };

  const onMarkMissed = async () => {
    setBusy(true);
    try {
      await markMissed(meeting.id);
      navigation.goBack();
    } finally {
      setBusy(false);
    }
  };

  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] });

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.topBar}>
        <View style={[styles.pill, { backgroundColor: colors.surfaceAlt }]}>
          <Text style={[styles.pillText, { color: colors.textSecondary }]}>Meeting reminder</Text>
        </View>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={[styles.closeButton, { backgroundColor: colors.surfaceAlt }]}
        >
          <Text style={{ color: colors.textSecondary, fontSize: 16 }}>✕</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.center}>
        <View style={styles.bellWrap}>
          <Animated.View
            style={[
              styles.ring,
              { borderColor: colors.primary, transform: [{ scale: ringScale }], opacity: ringOpacity },
            ]}
          />
          <LinearGradient colors={[colors.gradientStart, colors.gradientEnd]} style={styles.bellCircle}>
            <Text style={{ fontSize: 40 }}>🔔</Text>
          </LinearGradient>
        </View>

        <Text style={[styles.title, { color: colors.textPrimary }]}>{meeting.title}</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Starting now · {sourceLabel(meeting)}
        </Text>

        <View style={[styles.alertBadge, { backgroundColor: `${colors.secondary}22` }]}>
          <Text style={[styles.alertBadgeText, { color: colors.secondary }]}>
            Alert {Math.min(alertNumber, 4)} of 4 · re-ringing every {snoozeMinutes} min
          </Text>
        </View>
      </View>

      <View style={styles.actions}>
        <GradientButton
          label="I've joined — stop alarm"
          icon="✓"
          onPress={onConfirm}
          loading={busy}
          disabled={busy}
        />
        <GradientButton
          label={`Snooze · ring again in ${snoozeMinutes} min`}
          onPress={onSnooze}
          variant="muted"
          disabled={busy}
          style={{ marginTop: 12 }}
        />
        <TouchableOpacity onPress={onMarkMissed} disabled={busy} style={{ marginTop: 16 }}>
          <Text style={[styles.missedLink, { color: colors.textMuted }]}>Mark this meeting as missed</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function sourceLabel(meeting: { source: string; meetingLink?: string | null }): string {
  if (meeting.source === 'graph') {
    return (meeting.meetingLink ?? '').includes('teams.microsoft.com') ? 'Microsoft Teams' : 'Outlook';
  }
  if (meeting.source === 'local_calendar') return 'Device calendar';
  return 'Manual';
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 16 },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  pill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999 },
  pillText: { fontSize: 12, fontWeight: '600' },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  bellWrap: { alignItems: 'center', justifyContent: 'center', width: 140, height: 140, marginBottom: 32 },
  ring: { position: 'absolute', width: 140, height: 140, borderRadius: 70, borderWidth: 2 },
  bellCircle: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '800', textAlign: 'center' },
  subtitle: { fontSize: 14, marginTop: 8 },
  alertBadge: { marginTop: 20, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  alertBadgeText: { fontSize: 12, fontWeight: '700' },
  actions: { paddingHorizontal: 24, paddingBottom: 32 },
  missedLink: { textAlign: 'center', fontSize: 13, textDecorationLine: 'underline' },
});
