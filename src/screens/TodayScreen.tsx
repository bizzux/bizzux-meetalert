import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, Linking, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { format, addDays, isToday, isTomorrow } from 'date-fns';
import { LinearGradient } from 'expo-linear-gradient';
import { Meeting } from '../types';
import { getUpcomingMeetings, upsertMeeting, touchCalendarSourceSync } from '../db/database';
import { fetchTodaysGraphMeetings } from '../services/graphCalendar';
import { fetchTodaysGoogleMeetings } from '../services/googleCalendar';
import { fetchTodaysLocalMeetings, dedupeAgainstGraph } from '../services/localCalendar';
import { scheduleMeeting, confirmJoined } from '../services/reminderEngine';
import { confirmDeleteMeeting, sourceLabel } from '../services/meetingActions';
import { pickAndImportScreenshot } from '../services/screenshotImport';
import { useThemeColors, ThemeColors } from '../theme';
import { useSettingsStore } from '../store/settingsStore';
import { useProfile, greeting } from '../profile';
import Avatar from '../components/Avatar';
import StatusBadge, { StatusKind } from '../components/StatusBadge';
import GradientButton from '../components/GradientButton';
import ReminderProgressDots from '../components/ReminderProgressDots';

const STRIP_DAYS = 7;

// ---------------------------------------------------------------------------
// Pure helpers — grouping, labeling, the "Starting in {time}" countdown.
// Kept outside the component so they're easy to reason about independently
// of render/state.
// ---------------------------------------------------------------------------

function dayKeyOf(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return format(d, 'yyyy-MM-dd');
}

function dayLabelOf(d: Date): string {
  if (isToday(d)) return 'Today';
  if (isTomorrow(d)) return 'Tomorrow';
  return format(d, 'EEE, d MMM');
}

/** Groups a list (already sorted by startTime) into day sections, in the
 * order the days first appear — used by the Agenda view. */
function buildDaySections(items: Meeting[]): { key: string; label: string; items: Meeting[] }[] {
  const order: string[] = [];
  const map = new Map<string, Meeting[]>();
  for (const m of items) {
    const key = dayKeyOf(m.startTime);
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(m);
  }
  return order.map((key) => ({ key, label: dayLabelOf(new Date(map.get(key)![0].startTime)), items: map.get(key)! }));
}

/** Same grouping, but keyed for lookup by day (used by the Timeline view's
 * date strip to know which days have anything on them, and to pull the
 * selected day's meetings). */
function groupByDayKey(items: Meeting[]): Map<string, Meeting[]> {
  const map = new Map<string, Meeting[]>();
  for (const m of items) {
    const key = dayKeyOf(m.startTime);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(m);
  }
  return map;
}

/**
 * The "Starting in {time}" text for the single next upcoming meeting —
 * shown on the hero card in Agenda view and on the next-up card in
 * Timeline view, so the same live countdown appears in both, as asked.
 *
 * Past 24 hours out, a countdown like "Starting in 2d 4h" stops being
 * useful at a glance, so it falls back to a plain date/time instead of
 * forcing the "Starting in" framing on something days away.
 */
function startingInInfo(startTime: string, now: number): { label: string; kind: 'ringing' | 'countdown' | 'later' } {
  const diffMin = Math.round((new Date(startTime).getTime() - now) / 60000);
  if (diffMin <= 0) return { label: 'Ringing now', kind: 'ringing' };
  if (diffMin < 60) return { label: `Starting in ${diffMin} min`, kind: 'countdown' };
  const hours = Math.floor(diffMin / 60);
  if (hours < 24) {
    const mins = diffMin % 60;
    return { label: mins > 0 ? `Starting in ${hours}h ${mins}m` : `Starting in ${hours}h`, kind: 'countdown' };
  }
  return { label: format(new Date(startTime), 'EEE, d MMM · h:mm a'), kind: 'later' };
}

function badgeKindFor(kind: 'ringing' | 'countdown' | 'later'): StatusKind {
  if (kind === 'ringing') return 'missed';
  if (kind === 'countdown') return 'startingSoon';
  return 'upcoming';
}

function minutesSinceMidnight(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

export default function TodayScreen() {
  const navigation = useNavigation<any>();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const reminderOffsets = useSettingsStore((s) => s.reminderOffsets);
  const snoozeMinutes = useSettingsStore((s) => s.snoozeMinutes);
  const calendarSources = useSettingsStore((s) => s.calendarSources);
  const homeView = useSettingsStore((s) => s.homeView);
  const setHomeView = useSettingsStore((s) => s.setHomeView);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  // Every meeting that hasn't finished yet, from now onward — today and
  // every day after. This single list feeds both views and the header
  // count, so the count can never again disagree with what's shown below
  // it (the bug the header/body mismatch came from originally).
  const loadMeetings = useCallback(async () => {
    const rows = getUpcomingMeetings(new Date().toISOString());
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
      await Promise.all(allSynced.map((meeting) => scheduleMeeting(meeting)));
    } finally {
      await loadMeetings();
      setRefreshing(false);
      if (problems.length) {
        Alert.alert('Some calendars didn’t sync', problems.join('\n\n'));
      }
    }
  }, [loadMeetings, calendarSources]);

  useEffect(() => {
    loadMeetings();
  }, [loadMeetings]);

  useFocusEffect(
    React.useCallback(() => {
      loadMeetings();
    }, [loadMeetings])
  );

  const now = Date.now();

  const openLink = (link?: string | null) => {
    if (link) Linking.openURL(link).catch(() => {});
  };

  const openMeeting = (meeting: Meeting) => {
    if (meeting.source === 'manual') navigation.navigate('AddMeeting', { meeting });
    else if (meeting.meetingLink) openLink(meeting.meetingLink);
  };

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

  const heroMeeting = meetings[0];

  return (
    <LinearGradient colors={colors.screenGradient} style={styles.container}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={syncCalendars} tintColor={colors.primary} />}
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
      >
        <Header colors={colors} meetingCount={meetings.length} topInset={insets.top} />

        <ViewToggle value={homeView} onChange={setHomeView} colors={colors} />

        {meetings.length === 0 ? (
          <View style={[styles.emptyHero, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              No meetings coming up. Pull to sync, or add one manually.
            </Text>
          </View>
        ) : homeView === 'agenda' ? (
          <AgendaView
            meetings={meetings}
            now={now}
            colors={colors}
            reminderOffsets={reminderOffsets}
            snoozeMinutes={snoozeMinutes}
            onJoin={(m) => {
              const ringing = now >= new Date(m.startTime).getTime();
              if (ringing) navigation.navigate('Alarm', { meetingId: m.id });
              else openLink(m.meetingLink);
            }}
            onExpandHero={(m) => {
              if (m.source === 'manual') navigation.navigate('AddMeeting', { meeting: m });
              else if (m.meetingLink) openLink(m.meetingLink);
              else {
                Alert.alert(
                  sourceLabel(m),
                  `This meeting is synced from ${sourceLabel(m)}. Edit its time or details there — changes will sync back here automatically.`
                );
              }
            }}
            onOpen={openMeeting}
            onMore={openMeetingActions}
          />
        ) : (
          <TimelineView
            meetings={meetings}
            now={now}
            colors={colors}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            onOpen={openMeeting}
            onMore={openMeetingActions}
            heroId={heroMeeting?.id}
          />
        )}
      </ScrollView>
    </LinearGradient>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function Header({
  colors,
  meetingCount,
  topInset,
}: {
  colors: ThemeColors;
  meetingCount: number;
  topInset: number;
}) {
  const profile = useProfile();
  return (
    <View>
      <View style={[styles.topRow, { paddingTop: topInset + 12 }]}>
        <View style={styles.brandRow}>
          <LinearGradient colors={[colors.gradientStart, colors.gradientEnd]} style={styles.brandIcon}>
            <Text style={styles.brandIconText}>🔔</Text>
          </LinearGradient>
          <Text style={[styles.brandName, { color: colors.textPrimary }]}>Meetera</Text>
        </View>
        <View style={styles.headerRightRow}>
          <TouchableOpacity
            onPress={pickAndImportScreenshot}
            style={[styles.scanButton, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.scanButtonIcon}>📷</Text>
          </TouchableOpacity>
          <View style={[styles.avatarSmall, { backgroundColor: colors.accent }]}>
            <Text style={styles.avatarSmallText}>{profile.initials}</Text>
          </View>
        </View>
      </View>
      <Text style={[styles.greeting, { color: colors.textPrimary }]}>
        {greeting()}, {profile.firstName}
      </Text>
      {/* Single source of truth: this is exactly how many meetings render
          below, across both views — so it can never contradict the body
          the way "X meetings today" used to when some had already ended. */}
      <Text style={[styles.subGreeting, { color: colors.textSecondary }]}>
        {meetingCount} meeting{meetingCount === 1 ? '' : 's'} coming up
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// View toggle
// ---------------------------------------------------------------------------

function ViewToggle({
  value,
  onChange,
  colors,
}: {
  value: 'agenda' | 'timeline';
  onChange: (v: 'agenda' | 'timeline') => void;
  colors: ThemeColors;
}) {
  return (
    <View style={[styles.toggleRow, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <ToggleSegment label="Agenda" active={value === 'agenda'} colors={colors} onPress={() => onChange('agenda')} />
      <ToggleSegment label="Timeline" active={value === 'timeline'} colors={colors} onPress={() => onChange('timeline')} />
    </View>
  );
}

function ToggleSegment({
  label,
  active,
  colors,
  onPress,
}: {
  label: string;
  active: boolean;
  colors: ThemeColors;
  onPress: () => void;
}) {
  if (!active) {
    return (
      <TouchableOpacity accessibilityRole="button" accessibilityState={{ selected: false }} onPress={onPress} style={styles.toggleSegment}>
        <Text style={[styles.toggleTextInactive, { color: colors.textSecondary }]}>{label}</Text>
      </TouchableOpacity>
    );
  }
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityState={{ selected: true }} onPress={onPress} style={styles.toggleSegment}>
      <LinearGradient colors={[colors.gradientStart, colors.gradientEnd]} style={styles.toggleSegmentActive}>
        <Text style={styles.toggleTextActive}>{label}</Text>
      </LinearGradient>
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// Agenda view — hero (next meeting) + everything after, grouped by day
// ---------------------------------------------------------------------------

function AgendaView({
  meetings,
  now,
  colors,
  reminderOffsets,
  snoozeMinutes,
  onJoin,
  onExpandHero,
  onOpen,
  onMore,
}: {
  meetings: Meeting[];
  now: number;
  colors: ThemeColors;
  reminderOffsets: (30 | 15 | 5 | 2)[];
  snoozeMinutes: number;
  onJoin: (m: Meeting) => void;
  onExpandHero: (m: Meeting) => void;
  onOpen: (m: Meeting) => void;
  onMore: (m: Meeting) => void;
}) {
  const heroMeeting = meetings[0];
  const rest = meetings.slice(1);
  const sections = useMemo(() => buildDaySections(rest), [rest]);

  return (
    <View>
      <HeroCard
        meeting={heroMeeting}
        now={now}
        colors={colors}
        reminderOffsets={reminderOffsets}
        snoozeMinutes={snoozeMinutes}
        onJoin={() => onJoin(heroMeeting)}
        onExpand={() => onExpandHero(heroMeeting)}
        onMore={() => onMore(heroMeeting)}
      />

      {sections.map((section) => (
        <View key={section.key}>
          <View style={styles.sectionHeaderRow}>
            <Text style={[styles.sectionHeader, { color: colors.textPrimary }]}>{section.label}</Text>
            <Text style={[styles.sectionCount, { color: colors.textMuted }]}>
              {section.items.length} {section.items.length === 1 ? 'meeting' : 'meetings'}
            </Text>
          </View>
          {section.items.map((item) => (
            <AgendaRow key={item.id} item={item} colors={colors} onPress={() => onOpen(item)} onMore={() => onMore(item)} />
          ))}
        </View>
      ))}
    </View>
  );
}

function AgendaRow({
  item,
  colors,
  onPress,
  onMore,
}: {
  item: Meeting;
  colors: ThemeColors;
  onPress: () => void;
  onMore: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}
      onPress={onPress}
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
        onPress={onMore}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        style={styles.moreButtonInline}
      >
        <Text style={[styles.moreDots, { color: colors.textMuted }]}>⋯</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

function HeroCard({
  meeting,
  now,
  colors,
  reminderOffsets,
  snoozeMinutes,
  onJoin,
  onExpand,
  onMore,
}: {
  meeting: Meeting;
  now: number;
  colors: ThemeColors;
  reminderOffsets: (30 | 15 | 5 | 2)[];
  snoozeMinutes: number;
  onJoin: () => void;
  onExpand: () => void;
  onMore: () => void;
}) {
  const info = startingInInfo(meeting.startTime, now);

  return (
    <LinearGradient colors={colors.heroGradient} style={[styles.hero, { borderColor: colors.border }]}>
      <View style={styles.heroTopRow}>
        <StatusBadge kind={badgeKindFor(info.kind)} label={info.label} />
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

      {info.kind !== 'ringing' && (
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
          label={info.kind === 'ringing' ? "I've joined" : 'Join now'}
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
    </LinearGradient>
  );
}

// ---------------------------------------------------------------------------
// Timeline view — a week's date strip + the selected day laid out against
// hour markers
// ---------------------------------------------------------------------------

function TimelineView({
  meetings,
  now,
  colors,
  selectedDate,
  onSelectDate,
  onOpen,
  onMore,
  heroId,
}: {
  meetings: Meeting[];
  now: number;
  colors: ThemeColors;
  selectedDate: Date;
  onSelectDate: (d: Date) => void;
  onOpen: (m: Meeting) => void;
  onMore: (m: Meeting) => void;
  heroId?: string;
}) {
  const byDay = useMemo(() => groupByDayKey(meetings), [meetings]);
  const stripDays = useMemo(() => Array.from({ length: STRIP_DAYS }, (_, i) => addDays(new Date(), i)), []);
  const selectedKey = dayKeyOf(selectedDate);
  const dayMeetings = byDay.get(selectedKey) ?? [];

  return (
    <View>
      <DateStrip days={stripDays} byDay={byDay} selectedKey={selectedKey} onSelect={onSelectDate} colors={colors} />

      {dayMeetings.length === 0 ? (
        <View style={[styles.emptyDay, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            {isToday(selectedDate) ? 'Nothing left today.' : `Nothing on ${dayLabelOf(selectedDate)}.`} Pick another day above, or add one manually.
          </Text>
        </View>
      ) : (
        <TimelineDay meetings={dayMeetings} colors={colors} onOpen={onOpen} onMore={onMore} heroId={heroId} />
      )}
    </View>
  );
}

function DateStrip({
  days,
  byDay,
  selectedKey,
  onSelect,
  colors,
}: {
  days: Date[];
  byDay: Map<string, Meeting[]>;
  selectedKey: string;
  onSelect: (d: Date) => void;
  colors: ThemeColors;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateStripContent}>
      {days.map((d) => {
        const key = dayKeyOf(d);
        const isSelected = key === selectedKey;
        const hasMeetings = (byDay.get(key)?.length ?? 0) > 0;
        const topLabel = isToday(d) ? 'TODAY' : format(d, 'EEE').toUpperCase();

        return (
          <TouchableOpacity key={key} onPress={() => onSelect(d)}>
            {isSelected ? (
              <LinearGradient colors={[colors.gradientStart, colors.gradientEnd]} style={styles.dateChip}>
                <Text style={[styles.dateChipLabel, { color: '#E7FFFC' }]}>{topLabel}</Text>
                <Text style={[styles.dateChipNum, { color: '#FFFFFF' }]}>{format(d, 'd')}</Text>
                <View style={[styles.dateDot, { backgroundColor: hasMeetings ? '#FFFFFF' : 'transparent' }]} />
              </LinearGradient>
            ) : (
              <View style={[styles.dateChip, styles.dateChipInactive, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                <Text style={[styles.dateChipLabel, { color: colors.textMuted }]}>{topLabel}</Text>
                <Text style={[styles.dateChipNum, { color: colors.textPrimary }]}>{format(d, 'd')}</Text>
                <View style={[styles.dateDot, { backgroundColor: hasMeetings ? colors.secondary : 'transparent' }]} />
              </View>
            )}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const HOUR_HEIGHT = 64;

function TimelineDay({
  meetings,
  colors,
  onOpen,
  onMore,
  heroId,
}: {
  meetings: Meeting[];
  colors: ThemeColors;
  onOpen: (m: Meeting) => void;
  onMore: (m: Meeting) => void;
  heroId?: string;
}) {
  // meetings is guaranteed non-empty by the caller.
  const startMins = meetings.map((m) => minutesSinceMidnight(new Date(m.startTime)));
  const endMins = meetings.map((m) => minutesSinceMidnight(new Date(m.endTime)));
  const rangeStartHour = Math.max(0, Math.floor(Math.min(...startMins) / 60) - 1);
  const rangeEndHour = Math.min(23, Math.ceil(Math.max(...endMins) / 60) + 1);
  const hours: number[] = [];
  for (let h = rangeStartHour; h <= rangeEndHour; h++) hours.push(h);
  const bodyHeight = hours.length * HOUR_HEIGHT;

  return (
    <View style={styles.timelineWrap}>
      <View style={styles.timelineHours}>
        {hours.map((h) => (
          <View key={h} style={{ height: HOUR_HEIGHT }}>
            <Text style={[styles.timelineHourLabel, { color: colors.textMuted }]}>{formatHourLabel(h)}</Text>
          </View>
        ))}
      </View>
      <View style={[styles.timelineTrack, { height: bodyHeight, borderLeftColor: colors.border }]}>
        {meetings.map((m) => {
          const startMin = minutesSinceMidnight(new Date(m.startTime));
          const endMin = minutesSinceMidnight(new Date(m.endTime));
          const top = ((startMin - rangeStartHour * 60) / 60) * HOUR_HEIGHT;
          const height = Math.max(((endMin - startMin) / 60) * HOUR_HEIGHT, 50);
          const isNext = m.id === heroId;

          const cardContent = (
            <>
              <View style={{ flex: 1 }}>
                <Text style={[styles.timelineCardTitle, { color: colors.textPrimary }]} numberOfLines={1}>
                  {m.title}
                </Text>
                <Text style={[styles.timelineCardMeta, { color: colors.textSecondary }]} numberOfLines={1}>
                  {format(new Date(m.startTime), 'h:mm')} – {format(new Date(m.endTime), 'h:mm a')} · {sourceLabel(m)}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => onMore(m)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={styles.moreButtonInline}
              >
                <Text style={[styles.moreDots, { color: colors.textMuted }]}>⋯</Text>
              </TouchableOpacity>
            </>
          );

          // The one card that's also the overall next-up meeting gets the
          // same gradient treatment as the Agenda view's hero card, so the
          // "what's next" emphasis reads the same in both views.
          if (isNext) {
            return (
              <TouchableOpacity
                key={m.id}
                onPress={() => onOpen(m)}
                activeOpacity={0.85}
                style={[styles.timelineCardTouchable, { top, height }]}
              >
                <LinearGradient colors={colors.heroGradient} style={[styles.timelineCardInner, { borderColor: colors.secondary }]}>
                  {cardContent}
                </LinearGradient>
              </TouchableOpacity>
            );
          }

          return (
            <TouchableOpacity
              key={m.id}
              onPress={() => onOpen(m)}
              activeOpacity={0.85}
              style={[
                styles.timelineCardTouchable,
                styles.timelineCardInner,
                { top, height, borderColor: colors.border, backgroundColor: colors.surface },
              ]}
            >
              {cardContent}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function formatHourLabel(hour: number): string {
  const h = hour % 24;
  const period = h < 12 ? 'AM' : 'PM';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display} ${period}`;
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
  headerRightRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  scanButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanButtonIcon: { fontSize: 15 },
  greeting: { fontSize: 24, fontWeight: '800', paddingHorizontal: 20, marginTop: 20 },
  subGreeting: { fontSize: 14, paddingHorizontal: 20, marginTop: 4, marginBottom: 16 },

  toggleRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 18,
    padding: 4,
    borderRadius: 14,
    borderWidth: 1,
  },
  toggleSegment: { flex: 1 },
  toggleSegmentActive: { height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  toggleTextActive: { color: '#FFFFFF', fontSize: 13.5, fontWeight: '700' },
  toggleTextInactive: { fontSize: 13.5, fontWeight: '600', textAlign: 'center', height: 36, lineHeight: 36 },

  hero: {
    marginHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    padding: 18,
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
  emptyDay: { marginHorizontal: 16, borderRadius: 16, borderWidth: 1, padding: 24, alignItems: 'center' },
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

  dateStripContent: { paddingHorizontal: 16, paddingBottom: 20, gap: 10 },
  dateChip: { width: 54, paddingVertical: 10, borderRadius: 14, alignItems: 'center' },
  dateChipInactive: { borderWidth: 1 },
  dateChipLabel: { fontSize: 11, fontWeight: '700' },
  dateChipNum: { fontSize: 17, fontWeight: '800', marginTop: 2 },
  dateDot: { width: 4, height: 4, borderRadius: 2, marginTop: 5 },

  timelineWrap: { flexDirection: 'row', paddingHorizontal: 20, paddingBottom: 24 },
  timelineHours: { width: 52, flexShrink: 0, paddingTop: 2 },
  timelineHourLabel: { fontSize: 12, fontWeight: '600' },
  timelineTrack: { flex: 1, position: 'relative', borderLeftWidth: 2, marginLeft: 4 },
  // The touchable sets position/size; the inner view carries the visual
  // treatment (border, padding, background or gradient) so a plain View
  // and a LinearGradient can share identical layout.
  timelineCardTouchable: { position: 'absolute', left: 14, right: 4 },
  timelineCardInner: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  timelineCardTitle: { fontSize: 14.5, fontWeight: '700' },
  timelineCardMeta: { fontSize: 12, marginTop: 3 },
});
