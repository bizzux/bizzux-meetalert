import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useThemeColors } from '../theme';
import { ReminderOffsetMinutes } from '../types';

interface Props {
  startTime: string; // ISO
  offsets: ReminderOffsetMinutes[]; // e.g. [30, 15, 5, 2], from settings
  snoozeMinutes: number;
}

/** The dot timeline on the Today hero card: which pre-meeting reminders have
 * already fired, which is "current" (next one due), and which are still
 * ahead — plus the "next alert in Xm" caption underneath. */
export default function ReminderProgressDots({ startTime, offsets, snoozeMinutes }: Props) {
  const colors = useThemeColors();
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const start = new Date(startTime).getTime();
  const now = Date.now();
  const sorted = [...offsets].sort((a, b) => b - a); // 30, 15, 5, 2

  const withState = sorted.map((offset) => {
    const triggerAt = start - offset * 60_000;
    return { offset, triggerAt, done: now >= triggerAt };
  });
  const currentIndex = withState.findIndex((o) => !o.done);
  const nextOffset = currentIndex >= 0 ? withState[currentIndex] : null;
  const minutesToNext = nextOffset ? Math.max(0, Math.round((nextOffset.triggerAt - now) / 60_000)) : 0;

  return (
    <View>
      <View style={styles.row}>
        {withState.map((item, i) => {
          const isCurrent = i === currentIndex;
          const isDone = item.done;
          return (
            <React.Fragment key={item.offset}>
              {i > 0 && (
                <View
                  style={[
                    styles.line,
                    { backgroundColor: withState[i - 1].done ? colors.primary : colors.border },
                  ]}
                />
              )}
              <View style={styles.dotWrap}>
                <View
                  style={[
                    styles.dot,
                    isCurrent && styles.dotCurrent,
                    {
                      backgroundColor: isDone || isCurrent ? colors.primary : colors.surfaceAlt,
                      borderColor: isCurrent ? colors.primary : 'transparent',
                    },
                  ]}
                >
                  {isDone && <Text style={styles.check}>✓</Text>}
                  {isCurrent && <View style={styles.currentInnerDot} />}
                </View>
                <Text
                  style={[
                    styles.offsetLabel,
                    { color: isCurrent || isDone ? colors.primary : colors.textMuted },
                    isCurrent && { fontWeight: '700' },
                  ]}
                >
                  {item.offset}m
                </Text>
              </View>
            </React.Fragment>
          );
        })}
      </View>
      <Text style={[styles.caption, { color: colors.textSecondary }]}>
        {nextOffset
          ? `Next alert in ${minutesToNext} minute${minutesToNext === 1 ? '' : 's'} · `
          : ''}
        rings every {snoozeMinutes} min until confirmed
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  dotWrap: { alignItems: 'center' },
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotCurrent: { width: 24, height: 24, borderRadius: 12, borderWidth: 2 },
  currentInnerDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },
  check: { color: '#fff', fontSize: 11, fontWeight: '700' },
  line: { flex: 1, height: 2, marginHorizontal: 2 },
  offsetLabel: { fontSize: 12, marginTop: 4, fontWeight: '500' },
  caption: { fontSize: 12, marginTop: 12 },
});
