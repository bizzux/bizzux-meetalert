import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { format, addMonths, startOfMonth, endOfMonth, isToday, isSameMonth } from 'date-fns';
import { Meeting } from '../types';
import { ThemeColors } from '../theme';

interface Props {
  meetings: Meeting[];
  colors: ThemeColors;
  onSelectDay: (date: Date) => void;
}

const WEEKDAY_HEADERS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function dayKey(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

/** Mon-first 6x7 grid covering the given month, padding with the trailing
 * days of the previous/next month so every week row is a full 7 — those
 * padding cells render but aren't tappable (they belong to a month rendered
 * in its own section already, or not yet). */
function buildMonthGrid(monthAnchor: Date): Date[] {
  const first = startOfMonth(monthAnchor);
  const last = endOfMonth(monthAnchor);
  // JS getDay(): 0=Sun..6=Sat. Convert to Mon-first offset (0=Mon..6=Sun).
  const leadingOffset = (first.getDay() + 6) % 7;
  const gridStart = new Date(first);
  gridStart.setDate(gridStart.getDate() - leadingOffset);

  const cells: Date[] = [];
  const cursor = new Date(gridStart);
  // 6 rows always covers any month regardless of where it starts/ends.
  while (cells.length < 42) {
    cells.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return cells;
}

/** Compact "which days have something on them" overview, replacing a long
 * list for Year mode — tap any day to jump straight into Day view for it. */
export default function YearOverview({ meetings, colors, onSelectDay }: Props) {
  const meetingDayKeys = useMemo(() => {
    const set = new Set<string>();
    for (const m of meetings) set.add(dayKey(new Date(m.startTime)));
    return set;
  }, [meetings]);

  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => addMonths(startOfMonth(new Date()), i)), []);

  return (
    <View style={{ paddingHorizontal: 16 }}>
      {months.map((monthAnchor) => {
        const grid = buildMonthGrid(monthAnchor);
        return (
          <View key={dayKey(monthAnchor)} style={[styles.monthCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.monthTitle, { color: colors.textPrimary }]}>{format(monthAnchor, 'MMMM yyyy')}</Text>
            <View style={styles.weekRow}>
              {WEEKDAY_HEADERS.map((w) => (
                <Text key={w} style={[styles.weekdayLabel, { color: colors.textMuted }]}>
                  {w}
                </Text>
              ))}
            </View>
            {Array.from({ length: 6 }, (_, row) => (
              <View key={row} style={styles.weekRow}>
                {grid.slice(row * 7, row * 7 + 7).map((day) => {
                  const inMonth = isSameMonth(day, monthAnchor);
                  const hasMeeting = meetingDayKeys.has(dayKey(day));
                  const today = isToday(day);
                  return (
                    <TouchableOpacity
                      key={dayKey(day)}
                      disabled={!inMonth}
                      onPress={() => onSelectDay(day)}
                      style={styles.dayCell}
                    >
                      <View
                        style={[
                          styles.dayCircle,
                          today && { backgroundColor: colors.primary },
                        ]}
                      >
                        <Text
                          style={[
                            styles.dayNumber,
                            { color: !inMonth ? colors.textMuted : today ? colors.textOnPrimary : colors.textPrimary },
                            !inMonth && { opacity: 0.35 },
                          ]}
                        >
                          {format(day, 'd')}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.dot,
                          { backgroundColor: hasMeeting && inMonth ? colors.secondary : 'transparent' },
                        ]}
                      />
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  monthCard: { borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 14 },
  monthTitle: { fontSize: 15, fontWeight: '700', marginBottom: 10 },
  weekRow: { flexDirection: 'row' },
  weekdayLabel: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '700', marginBottom: 4 },
  dayCell: { flex: 1, alignItems: 'center', paddingVertical: 3 },
  dayCircle: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  dayNumber: { fontSize: 12, fontWeight: '600' },
  dot: { width: 4, height: 4, borderRadius: 2, marginTop: 2 },
});
