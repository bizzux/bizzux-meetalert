import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, Linking } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { format } from 'date-fns';
import { LinearGradient } from 'expo-linear-gradient';
import { Meeting } from '../types';
import { getMeetingsForDay, upsertMeeting, touchCalendarSourceSync } from '../db/database';
import { fetchTodaysGraphMeetings } from '../services/graphCalendar';
import { fetchTodaysLocalMeetings, dedupeAgainstGraph } from '../services/localCalendar';
import { scheduleMeeting, confirmJoined } from '../services/reminderEngine';
import { useThemeColors } from '../theme';
import { useSettingsStore } from '../store/settingsStore';
import { profile, greeting } from '../profile';
import Avatar from '../components/Avatar';
import StatusBadge from '../components/StatusBadge';
import GradientButton from '../components/GradientButton';
import ReminderProgressDots from '../components/ReminderProgressDots';

export default function TodayScreen() {
  const navigation = useNavigation<any>();
  const colors = useThemeColors();
  const reminderOffsets = useSettingsStore((s) => s.reminderOffsets);
  const snoozeMinutes = useSettingsStore((s) => s.snoozeMinutes);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadMeetings = useCallback(async () => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const rows = getMeetingsForDay(start.toISOString(), end.toISOString());
    setMeetings(rows);
  }, []);

  const syncCalendars = useCallback(async () => {
    setRefreshing(true);
    try {
      const graphMeetings = await fetchTodaysGraphMeetings();
      touchCalendarSourceSync('graph', 'graph');
      const localMeetingsRaw = await fetchTodaysLocalMeetings();
      touchCalendarSourceSync('local_calendar', 'local_calendar');
      const localMeetings = dedupeAgainstGraph(localMeetingsRaw, graphMeetings);

      for (const meeting of [...graphMeetings, ...localMeetings]) {
        upsertMeeting(meeting);
        await scheduleMeeting(meeting);
      }
    } finally {
      await loadMeetings();
      setRefreshing(false);
    }
  }, [loadMeetings]);

  useEffect(() => {
    loadMeetings();
  }, [loadMeetings]);

  const now = Date.now();
  const unfinished = meetings.filter((m) => new Date(m.endTime).getTime() > now);
  const heroMeeting = unfinished[0];
  const laterMeetings = unfinished.slice(1);

  const openLink = (link?: string | null) => {
    if (link) Linking.openURL(link).catch(() => {});
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={laterMeetings}
        keyExtractor={(m) => m.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={syncCalendars} tintColor={colors.primary} />
        }
        contentContainerStyle={{ paddingBottom: 100 }}
        ListHeaderComponent={
          <View>
            <Header colors={colors} meetingCount={meetings.length} />

            {heroMeeting ? (
              <HeroCard
                meeting={heroMeeting}
                colors={colors}
                reminderOffsets={reminderOffsets}
                snoozeMinutes={snoozeMinutes}
                onJoin={() => {
                  const ringing = now >= new Date(heroMeeting.startTime).getTime();
                  if (ringing) navigation.navigate('Alarm', { meetingId: heroMeeting.id });
                  else openLink(heroMeeting.meetingLink);
                }}
                onExpand={() => openLink(heroMeeting.meetingLink)}
              />
            ) : (
              <View style={[styles.emptyHero, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                  No meetings today. Pull to sync, or add one manually.
                </Text>
              </View>
            )}

            {laterMeetings.length > 0 && (
              <View style={styles.sectionHeaderRow}>
                <Text style={[styles.sectionHeader, { color: colors.textPrimary }]}>Later today</Text>
                <Text style={[styles.sectionCount, { color: colors.textMuted }]}>
                  {laterMeetings.length} more
                </Text>
              </View>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Avatar source={item.source} title={item.title} meetingLink={item.meetingLink} size={36} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[styles.title, { color: colors.textPrimary }]}>{item.title}</Text>
              <Text style={[styles.time, { color: colors.textSecondary }]}>
                {format(new Date(item.startTime), 'h:mm a')} · {sourceLabel(item)}
              </Text>
            </View>
            <StatusBadge kind="upcoming" />
          </View>
        )}
      />
    </View>
  );
}

function Header({ colors, meetingCount }: { colors: ReturnType<typeof useThemeColors>; meetingCount: number }) {
  return (
    <View>
      <View style={styles.topRow}>
        <View style={styles.brandRow}>
          <LinearGradient colors={[colors.gradientStart, colors.gradientEnd]} style={styles.brandIcon}>
            <Text style={styles.brandIconText}>🔔</Text>
          </LinearGradient>
          <Text style={[styles.brandName, { color: colors.textPrimary }]}>MeetAlert</Text>
        </View>
        <View style={[styles.avatarSmall, { backgroundColor: colors.accent }]}>
          <Text style={styles.avatarSmallText}>{profile.initials}</Text>
        </View>
      </View>
      <Text style={[styles.greeting, { color: colors.textPrimary }]}>
        {greeting()}, {profile.firstName}
      </Text>
      <Text style={[styles.subGreeting, { color: colors.textSecondary }]}>
        {format(new Date(), 'EEEE, d MMMM')} · {meetingCount} meeting{meetingCount === 1 ? '' : 's'} today
      </Text>
    </View>
  );
}

function HeroCard({
  meeting,
  colors,
  reminderOffsets,
  snoozeMinutes,
  onJoin,
  onExpand,
}: {
  meeting: Meeting;
  colors: ReturnType<typeof useThemeColors>;
  reminderOffsets: (30 | 15 | 5 | 2)[];
  snoozeMinutes: number;
  onJoin: () => void;
  onExpand: () => void;
}) {
  const ringing = Date.now() >= new Date(meeting.startTime).getTime();

  return (
    <View style={[styles.hero, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
      <StatusBadge kind={ringing ? 'missed' : 'startingSoon'} label={ringing ? 'Ringing now' : 'Starting soon'} />
      <Text style={[styles.heroTitle, { color: colors.textPrimary }]}>{meeting.title}</Text>
      <View style={styles.heroMetaRow}>
        <Text style={[styles.heroMeta, { color: colors.textSecondary }]}>
          {format(new Date(meeting.startTime), 'h:mm')} – {format(new Date(meeting.endTime), 'h:mm a')}
        </Text>
        <View style={styles.heroMetaDivider} />
        <Avatar source={meeting.source} title={meeting.title} meetingLink={meeting.meetingLink} size={18} />
        <Text style={[styles.heroMeta, { color: colors.textSecondary, marginLeft: 6 }]}>
          {sourceLabel(meeting)}
        </Text>
      </View>

      {!ringing && (
        <View style={{ marginTop: 18, marginBottom: 4 }}>
          <ReminderProgressDots
            startTime={meeting.startTime}
            offsets={reminderOffsets}
            snoozeMinutes={snoozeMinutes}
          />
        </View>
      )}

      <View style={styles.heroActions}>
        <GradientButton
          label={ringing ? "I've joined" : 'Join now'}
          onPress={onJoin}
          style={{ flex: 1 }}
        />
        <TouchableOpacity
          onPress={onExpand}
          style={[styles.chevronButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text style={{ color: colors.textPrimary, fontSize: 16 }}>›</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function sourceLabel(meeting: Meeting): string {
  if (meeting.source === 'graph') {
    return (meeting.meetingLink ?? '').includes('teams.microsoft.com') ? 'Microsoft Teams' : 'Outlook';
  }
  if (meeting.source === 'local_calendar') return 'Device calendar';
  return 'Manual';
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center' },
  brandIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  brandIconText: { fontSize: 15 },
  brandName: { fontSize: 16, fontWeight: '700', marginLeft: 10 },
  avatarSmall: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  avatarSmallText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  greeting: { fontSize: 24, fontWeight: '800', paddingHorizontal: 20, marginTop: 20 },
  subGreeting: { fontSize: 13, paddingHorizontal: 20, marginTop: 4, marginBottom: 18 },

  hero: {
    marginHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    padding: 18,
  },
  heroTitle: { fontSize: 20, fontWeight: '800', marginTop: 10 },
  heroMetaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  heroMeta: { fontSize: 13 },
  heroMetaDivider: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#8888', marginHorizontal: 8 },
  heroActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  chevronButton: {
    width: 52,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  emptyHero: { marginHorizontal: 16, borderRadius: 20, borderWidth: 1, padding: 32, alignItems: 'center' },
  emptyText: { textAlign: 'center', fontSize: 14 },

  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginTop: 26,
    marginBottom: 10,
  },
  sectionHeader: { fontSize: 16, fontWeight: '700' },
  sectionCount: { fontSize: 12, fontWeight: '600' },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 14,
    borderWidth: 1,
  },
  title: { fontSize: 15, fontWeight: '600' },
  time: { fontSize: 12, marginTop: 2 },

  fab: { position: 'absolute', bottom: 24, right: 24 },
  fabGradient: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabIcon: { color: '#fff', fontSize: 28, fontWeight: '400', marginTop: -2 },
});
