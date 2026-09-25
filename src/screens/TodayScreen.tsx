import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, Linking, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { format } from 'date-fns';
import { LinearGradient } from 'expo-linear-gradient';
import { Meeting } from '../types';
import { getMeetingsForDay, upsertMeeting, touchCalendarSourceSync } from '../db/database';
import { fetchTodaysGraphMeetings } from '../services/graphCalendar';
import { fetchTodaysGoogleMeetings } from '../services/googleCalendar';
import { fetchTodaysLocalMeetings, dedupeAgainstGraph } from '../services/localCalendar';
import { scheduleMeeting, confirmJoined } from '../services/reminderEngine';
import { confirmDeleteMeeting, sourceLabel } from '../services/meetingActions';
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
  const insets = useSafeAreaInsets();
  const reminderOffsets = useSettingsStore((s) => s.reminderOffsets);
  const snoozeMinutes = useSettingsStore((s) => s.snoozeMinutes);
  const calendarSources = useSettingsStore((s) => s.calendarSources);
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
    const problems: string[] = [];
    try {
      let graphMeetings: Meeting[] = [];
      if (calendarSources.microsoft) {
        try {
          graphMeetings = await fetchTodaysGraphMeetings();
          touchCalendarSourceSync('graph', 'graph');
        } catch {
          problems.push("Couldn't reach Microsoft Teams/Outlook — check that account is connected in Settings.");
        }
      }

      let googleMeetings: Meeting[] = [];
      if (calendarSources.google) {
        try {
          const googleRaw = await fetchTodaysGoogleMeetings();
          touchCalendarSourceSync('google', 'google');
          googleMeetings = dedupeAgainstGraph(googleRaw, graphMeetings);
        } catch {
          problems.push("Couldn't reach Google Calendar — check that account is connected in Settings.");
        }
      }

      let localMeetings: Meeting[] = [];
      if (calendarSources.localCalendar) {
        try {
          const localMeetingsRaw = await fetchTodaysLocalMeetings();
          touchCalendarSourceSync('local_calendar', 'local_calendar');
          localMeetings = dedupeAgainstGraph(localMeetingsRaw, [...graphMeetings, ...googleMeetings]);
        } catch {
          problems.push("Couldn't read your device calendar — check calendar permission for Meetera.");
        }
      }

      const allSynced = [...graphMeetings, ...googleMeetings, ...localMeetings];
      allSynced.forEach(upsertMeeting);
      // Scheduling every synced meeting's reminders concurrently rather than
      // one at a time — sequential awaits here could take a long time (or
      // hang) on a day with many synced meetings, delaying the refresh
      // below. scheduleMeeting() already contains its own errors per
      // meeting, so Promise.all is safe even if one entry fails.
      await Promise.all(allSynced.map((meeting) => scheduleMeeting(meeting)));
    } finally {
      await loadMeetings();
      setRefreshing(false);
      if (problems.length) {
        Alert.alert('Some calendars didn’t sync', problems.join('\n\n'));
      }
    }
  }, [loadMeetings]);

  useEffect(() => {
    loadMeetings();
  }, [loadMeetings]);

  // Reload every time this screen regains focus — e.g. coming back from
  // Add/Edit Meeting — so a newly added meeting shows up immediately
  // instead of needing a manual pull-to-refresh.
  useFocusEffect(
    React.useCallback(() => {
      loadMeetings();
    }, [loadMeetings])
  );

  const now = Date.now();
  const unfinished = meetings.filter((m) => new Date(m.endTime).getTime() > now);
  const heroMeeting = unfinished[0];
  const laterMeetings = unfinished.slice(1);

  const openLink = (link?: string | null) => {
    if (link) Linking.openURL(link).catch(() => {});
  };

  // Manual meetings get Edit + Delete; synced ones (Teams/Outlook/Google/
  // device calendar) only get Delete, since Meetera isn't the source of
  // truth for those — confirmDeleteMeeting explains that a synced delete is
  // local-only. loadMeetings() refreshes the list right away so a delete is
  // reflected immediately, same as a save.
  const openMeetingActions = (meeting: Meeting) => {
    if (meeting.source === 'manual') {
      Alert.alert(meeting.title, undefined, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Edit', onPress: () => navigation.navigate('AddMeeting', { meeting }) },
        { text: 'Delete', style: 'destructive', onPress: () => confirmDeleteMeeting(meeting, loadMeetings) },
      ]);
    } else {
      confirmDeleteMeeting(meeting, loadMeetings);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={laterMeetings}
        keyExtractor={(m) => m.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={syncCalendars} tintColor={colors.primary} />
        }
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        ListHeaderComponent={
          <View>
            <Header colors={colors} meetingCount={meetings.length} topInset={insets.top} />

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
                onExpand={() => {
                  if (heroMeeting.source === 'manual') {
                    navigation.navigate('AddMeeting', { meeting: heroMeeting });
                  } else if (heroMeeting.meetingLink) {
                    openLink(heroMeeting.meetingLink);
                  } else {
                    Alert.alert(
                      sourceLabel(heroMeeting),
                      `This meeting is synced from ${sourceLabel(heroMeeting)}. Edit its time or details there — changes will sync back here automatically.`
                    );
                  }
                }}
                onMore={() => openMeetingActions(heroMeeting)}
              />
            ) : meetings.length > 0 ? (
              // Meetings exist for today — the header count above already
              // reflects them, and they show in History too — but every one
              // has already ended, so there's nothing left to show as
              // "upcoming". Saying "No meetings today" here would read as if
              // the save never landed; this message makes clear it did.
              <View style={[styles.emptyHero, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                  All caught up — {meetings.length} meeting{meetings.length === 1 ? '' : 's'} today already
                  wrapped up. Check History for the full list.
                </Text>
              </View>
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
          <TouchableOpacity
            style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={() => {
              if (item.source === 'manual') navigation.navigate('AddMeeting', { meeting: item });
              else if (item.meetingLink) openLink(item.meetingLink);
            }}
          >
            <Avatar source={item.source} title={item.title} meetingLink={item.meetingLink} size={36} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[styles.title, { color: colors.textPrimary }]}>{item.title}</Text>
              <Text style={[styles.time, { color: colors.textSecondary }]}>
                {format(new Date(item.startTime), 'h:mm a')} · {sourceLabel(item)}
              </Text>
            </View>
            <StatusBadge kind="upcoming" />
            <TouchableOpacity
              onPress={() => openMeetingActions(item)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={styles.moreButtonInline}
            >
              <Text style={[styles.moreDots, { color: colors.textMuted }]}>⋯</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

function Header({
  colors,
  meetingCount,
  topInset,
}: {
  colors: ReturnType<typeof useThemeColors>;
  meetingCount: number;
  topInset: number;
}) {
  return (
    <View>
      <View style={[styles.topRow, { paddingTop: topInset + 12 }]}>
        <View style={styles.brandRow}>
          <LinearGradient colors={[colors.gradientStart, colors.gradientEnd]} style={styles.brandIcon}>
            <Text style={styles.brandIconText}>🔔</Text>
          </LinearGradient>
          <Text style={[styles.brandName, { color: colors.textPrimary }]}>Meetera</Text>
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
  onMore,
}: {
  meeting: Meeting;
  colors: ReturnType<typeof useThemeColors>;
  reminderOffsets: (30 | 15 | 5 | 2)[];
  snoozeMinutes: number;
  onJoin: () => void;
  onExpand: () => void;
  onMore: () => void;
}) {
  const ringing = Date.now() >= new Date(meeting.startTime).getTime();

  return (
    <View style={[styles.hero, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
      <View style={styles.heroTopRow}>
        <StatusBadge kind={ringing ? 'missed' : 'startingSoon'} label={ringing ? 'Ringing now' : 'Starting soon'} />
        <TouchableOpacity
          onPress={onMore}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={[styles.moreButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text style={[styles.moreDots, { color: colors.textSecondary }]}>⋯</Text>
        </TouchableOpacity>
      </View>
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
  subGreeting: { fontSize: 14, paddingHorizontal: 20, marginTop: 4, marginBottom: 18 },

  hero: {
    marginHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    padding: 18,
    // A soft shadow so the card reads as a distinct surface even in light
    // mode, where the background is now pure white and the border alone
    // is subtle.
    shadowColor: '#0B2436',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 1,
  },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  moreButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreButtonInline: { paddingHorizontal: 8, paddingVertical: 4, marginLeft: 4 },
  moreDots: { fontSize: 18, fontWeight: '700', marginTop: -6 },
  heroTitle: { fontSize: 20, fontWeight: '800', marginTop: 10 },
  heroMetaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  heroMeta: { fontSize: 13.5, fontWeight: '500' },
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
  sectionCount: { fontSize: 12.5, fontWeight: '600' },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 14,
    borderWidth: 1,
    shadowColor: '#0B2436',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  title: { fontSize: 15, fontWeight: '600' },
  time: { fontSize: 13, marginTop: 2, fontWeight: '500' },

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
