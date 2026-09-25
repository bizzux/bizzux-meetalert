import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useThemeColors } from '../theme';

export type StatusKind = 'upcoming' | 'startingSoon' | 'attended' | 'missed' | 'pending';

interface Props {
  kind: StatusKind;
  label?: string;
}

export default function StatusBadge({ kind, label }: Props) {
  const colors = useThemeColors();
  const map: Record<StatusKind, { text: string; fg: string; bg: string }> = {
    upcoming: { text: label ?? 'Upcoming', fg: colors.textSecondary, bg: colors.surfaceAlt },
    startingSoon: { text: label ?? 'Starting soon', fg: colors.secondary, bg: `${colors.secondary}22` },
    attended: { text: label ?? 'Attended', fg: colors.success, bg: `${colors.success}22` },
    missed: { text: label ?? 'Missed', fg: colors.warning, bg: `${colors.warning}22` },
    pending: { text: label ?? 'Pending', fg: colors.textMuted, bg: colors.surfaceAlt },
  };
  const { text, fg, bg } = map[kind];

  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      {kind === 'startingSoon' && <View style={[styles.dot, { backgroundColor: colors.secondary }]} />}
      <Text style={[styles.text, { color: fg }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  dot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  text: { fontSize: 12, fontWeight: '700' },
});
