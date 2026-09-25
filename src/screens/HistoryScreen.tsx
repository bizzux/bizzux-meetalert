import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, SectionList, StyleSheet } from 'react-native';
import { format, startOfWeek, startOfMonth, isToday, isYesterday } from 'date-fns';
import { getHistorySince, getAttendanceStats } from '../db/database';
import { useThemeColors } from '../theme';
import Avatar from '../components/Avatar';
import StatCard from '../components/StatCard';
import StatusBadge from '../components/StatusBadge';
import PillGroup from '../components/Pill';

type Period = 'week' | 'month' | 'all';

const PERIOD_OPTIONS: { label: string; value: Period }[] = [
  { label: 'This week', value: 'week' },
  { label: 'This month', value: 'month' },
  { label: 'All time', value: 'all' },
];

export default function HistoryScreen() {
  const colors = useThemeColors();
  const [period, setPeriod] = useState<Period>('week');
  const [items, setItems] = useState<ReturnType<typeof getHistorySince>>([]);
  const [stats, setStats] = useState({ attended: 0, missed: 0, attendanceRate: 0 });

  const sinceISO = useMemo(() => {
    const now = new Date();
    if (period === 'week') return startOfWeek(now, { weekStartsOn: 1 }).toISOString();
    if (period === 'month') return startOfMonth(now).toISOString();
    return null;
  }, [period]);

  useEffect(() => {
    setItems(getHistorySince(sinceISO));
    setStats(getAttendanceStats(sinceISO));
  }, [sinceISO]);

  const sections = useMemo(() => groupByDay(items), [items]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.heading, { color: colors.textPrimary }]}>History</Text>

      <View style={styles.statsRow}>
        <StatCard value={String(stats.attended)} label="Attended" color={colors.success} />
        <StatCard value={String(stats.missed)} label="Missed" color={colors.warning} />
        <StatCard value={`${stats.attendanceRate}%`} label="Attendance" color={colors.primary} />
      </View>

      <View style={styles.periodRow}>
        <PillGroup options={PERIOD_OPTIONS} selected={[period]} onToggle={(v) => setPeriod(v)} />
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: 100 }}
        renderSectionHeader={({ section }) => (
          <Text style={[styles.sectionTitle, { color: colors.textSecondary, backgroundColor: colors.background }]}>
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => (
          <View style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Avatar source={item.source} title={item.title} meetingLink={item.meetingLink} size={36} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[styles.title, { color: colors.textPrimary }]}>{item.title}</Text>
              <Text style={[styles.time, { color: colors.textSecondary }]}>
                {format(new Date(item.startTime), 'h:mm a')}
              </Text>
            </View>
            <StatusBadge
              kind={item.status === 'attended' ? 'attended' : item.status === 'missed' ? 'missed' : 'pending'}
            />
          </View>
        )}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: colors.textMuted }]}>No meetings in this period yet.</Text>
        }
      />
    </View>
  );
}

function groupByDay(items: ReturnType<typeof getHistorySince>) {
  const groups = new Map<string, typeof items>();
  for (const item of items) {
    const d = new Date(item.startTime);
    const label = isToday(d) ? 'Today' : isYesterday(d) ? 'Yesterday' : format(d, 'EEEE, MMM d');
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(item);
  }
  return Array.from(groups.entries()).map(([title, data]) => ({ title, data }));
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  heading: { fontSize: 24, fontWeight: '800', paddingHorizontal: 20, paddingTop: 16, marginBottom: 16 },
  statsRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, marginBottom: 16 },
  periodRow: { paddingHorizontal: 20, marginBottom: 16 },
  sectionTitle: { fontSize: 13, fontWeight: '700', paddingHorizontal: 20, paddingTop: 14, paddingBottom: 8 },
  row: {
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
  empty: { textAlign: 'center', marginTop: 48, fontSize: 14, paddingHorizontal: 20 },
});
