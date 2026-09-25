import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Meeting } from '../types';
import { useThemeColors } from '../theme';

interface Props {
  source: Meeting['source'];
  title: string;
  meetingLink?: string | null;
  size?: number;
}

/** Small colored letter-chip identifying where a meeting came from — T for
 * Teams, O for Outlook, first-letter for a plain device-calendar entry, M
 * for a manual one. Matches the avatar chips in the concept screens. */
export default function Avatar({ source, title, meetingLink, size = 40 }: Props) {
  const colors = useThemeColors();
  const { letter, color } = resolve(source, title, meetingLink, colors);

  return (
    <View
      style={[
        styles.circle,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: color },
      ]}
    >
      <Text style={[styles.letter, { fontSize: size * 0.42 }]}>{letter}</Text>
    </View>
  );
}

function resolve(
  source: Meeting['source'],
  title: string,
  meetingLink: string | null | undefined,
  colors: ReturnType<typeof useThemeColors>
) {
  if (source === 'manual') return { letter: 'M', color: colors.avatarManual };
  if (source === 'google') return { letter: 'G', color: colors.avatarGoogle };
  if (source === 'graph') {
    const isTeams = (meetingLink ?? '').includes('teams.microsoft.com');
    return isTeams
      ? { letter: 'T', color: colors.avatarTeams }
      : { letter: 'O', color: colors.avatarOutlook };
  }
  return { letter: (title.trim()[0] ?? '?').toUpperCase(), color: colors.avatarLocal };
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
  letter: { color: '#fff', fontWeight: '700' },
});
