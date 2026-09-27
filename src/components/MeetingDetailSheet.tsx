import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Linking, ScrollView } from 'react-native';
import { format } from 'date-fns';
import { Meeting } from '../types';
import { useThemeColors } from '../theme';
import { sourceLabel } from '../services/meetingActions';
import Avatar from './Avatar';
import StatusBadge, { StatusKind } from './StatusBadge';
import GradientButton from './GradientButton';

interface Props {
  meeting: Meeting | null;
  badge: { kind: StatusKind; label?: string } | null;
  onClose: () => void;
  onEdit: () => void;
  onMarkJoined: () => void;
  onDelete: () => void;
}

/**
 * The "tap a Timeline block to see everything" card asked for — Timeline's
 * blocks only ever show a title (see TodayScreen's TimelineDay), so this is
 * where the rest (full time range, source, link, notes, attendance, and
 * every action that used to live on the block itself) actually lives.
 */
export default function MeetingDetailSheet({ meeting, badge, onClose, onEdit, onMarkJoined, onDelete }: Props) {
  const colors = useThemeColors();
  if (!meeting) return null;

  const openLink = () => {
    if (meeting.meetingLink) Linking.openURL(meeting.meetingLink).catch(() => {});
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={[styles.backdrop, { backgroundColor: colors.overlay }]} activeOpacity={1} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={[styles.grabber, { backgroundColor: colors.border }]} />
        <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
          <View style={styles.headerRow}>
            <Avatar source={meeting.source} title={meeting.title} meetingLink={meeting.meetingLink} size={40} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[styles.title, { color: colors.textPrimary }]}>{meeting.title}</Text>
              <Text style={[styles.meta, { color: colors.textSecondary }]}>{sourceLabel(meeting)}</Text>
            </View>
            {badge && <StatusBadge kind={badge.kind} label={badge.label} />}
          </View>

          <View style={[styles.infoBlock, { borderColor: colors.border }]}>
            <Text style={[styles.infoLabel, { color: colors.textMuted }]}>When</Text>
            <Text style={[styles.infoValue, { color: colors.textPrimary }]}>
              {format(new Date(meeting.startTime), 'EEE, d MMM yyyy')}
            </Text>
            <Text style={[styles.infoValue, { color: colors.textPrimary }]}>
              {format(new Date(meeting.startTime), 'h:mm a')} to {format(new Date(meeting.endTime), 'h:mm a')}
            </Text>
          </View>

          {!!meeting.meetingLink && (
            <TouchableOpacity style={[styles.infoBlock, { borderColor: colors.border }]} onPress={openLink}>
              <Text style={[styles.infoLabel, { color: colors.textMuted }]}>Meeting link</Text>
              <Text style={[styles.linkValue, { color: colors.primary }]} numberOfLines={1}>
                {meeting.meetingLink}
              </Text>
            </TouchableOpacity>
          )}

          {!!meeting.organizer && (
            <View style={[styles.infoBlock, { borderColor: colors.border }]}>
              <Text style={[styles.infoLabel, { color: colors.textMuted }]}>Organiser</Text>
              <Text style={[styles.infoValue, { color: colors.textPrimary }]}>{meeting.organizer}</Text>
            </View>
          )}

          {!!meeting.notes && (
            <View style={[styles.infoBlock, { borderColor: colors.border }]}>
              <Text style={[styles.infoLabel, { color: colors.textMuted }]}>Notes</Text>
              <Text style={[styles.infoValue, { color: colors.textPrimary }]}>{meeting.notes}</Text>
            </View>
          )}

          <View style={{ marginTop: 20, gap: 10 }}>
            {!!meeting.meetingLink && (
              <GradientButton label="Open meeting link" onPress={openLink} />
            )}
            {meeting.status !== 'attended' && (
              <GradientButton label="✓ Mark attended" onPress={onMarkJoined} variant="outline" />
            )}
            {meeting.source === 'manual' && (
              <GradientButton label="Edit meeting" onPress={onEdit} variant="outline" />
            )}
          </View>

          {meeting.source === 'manual' && (
            <TouchableOpacity onPress={onDelete} style={{ marginTop: 18, alignItems: 'center' }}>
              <Text style={[styles.deleteLink, { color: colors.danger }]}>Delete this meeting</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '80%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    padding: 20,
  },
  grabber: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  title: { fontSize: 17, fontWeight: '800' },
  meta: { fontSize: 13, marginTop: 2, fontWeight: '500' },
  infoBlock: { borderTopWidth: 1, paddingTop: 14, marginTop: 14 },
  infoLabel: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  infoValue: { fontSize: 15, fontWeight: '600', marginTop: 4 },
  linkValue: { fontSize: 14, fontWeight: '600', marginTop: 4 },
  deleteLink: { fontSize: 14, fontWeight: '600' },
});
