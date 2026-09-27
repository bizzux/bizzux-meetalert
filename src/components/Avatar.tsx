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

/** Small colored chip identifying where a meeting came from — T for Teams, O
 * for Outlook, first-letter for a plain device-calendar entry, and a plain
 * meeting icon (rather than a letter) for a manually-added one — "M" read
 * as if it were someone's initial rather than "Manual", and this app has no
 * logo for that source the way it does for Teams/Outlook/Google. Matches
 * the avatar chips in the concept screens. */
export default function Avatar({ source, title, meetingLink, size = 40 }: Props) {
  const colors = useThemeColors();
  const { letter, color, isManual } = resolve(source, title, meetingLink, colors);

  return (
    <View
      style={[
        styles.circle,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: color },
      ]}
    >
      {isManual ? (
        <MeetingIcon size={size} />
      ) : (
        <Text style={[styles.letter, { fontSize: size * 0.42 }]}>{letter}</Text>
      )}
    </View>
  );
}

/** A tiny calendar glyph drawn from plain Views (no icon library in this
 * project, and no way to install one from here) — a bordered square with a
 * filled header band, same white-on-color treatment as the letter chips. */
function MeetingIcon({ size }: { size: number }) {
  const iconSize = size * 0.5;
  return (
    <View
      style={[
        styles.meetingIcon,
        { width: iconSize, height: iconSize, borderRadius: iconSize * 0.18 },
      ]}
    >
      <View
        style={[
          styles.meetingIconBand,
          {
            height: iconSize * 0.32,
            borderTopLeftRadius: iconSize * 0.16,
            borderTopRightRadius: iconSize * 0.16,
          },
        ]}
      />
    </View>
  );
}

function resolve(
  source: Meeting['source'],
  title: string,
  meetingLink: string | null | undefined,
  colors: ReturnType<typeof useThemeColors>
) {
  if (source === 'manual') return { letter: '', color: colors.avatarManual, isManual: true };
  if (source === 'google') return { letter: 'G', color: colors.avatarGoogle, isManual: false };
  if (source === 'graph') {
    const isTeams = (meetingLink ?? '').includes('teams.microsoft.com');
    return isTeams
      ? { letter: 'T', color: colors.avatarTeams, isManual: false }
      : { letter: 'O', color: colors.avatarOutlook, isManual: false };
  }
  return { letter: (title.trim()[0] ?? '?').toUpperCase(), color: colors.avatarLocal, isManual: false };
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
  letter: { color: '#fff', fontWeight: '700' },
  meetingIcon: { borderWidth: 1.5, borderColor: '#fff', overflow: 'hidden' },
  meetingIconBand: { width: '100%', backgroundColor: '#fff' },
});
