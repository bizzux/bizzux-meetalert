import { Alert } from 'react-native';
import { Meeting } from '../types';
import { deleteMeeting, deleteRecurrenceSeries } from '../db/database';
import { cancelForEdit } from './reminderEngine';

/** Human-readable source name, shared by every screen that shows or
 * references where a meeting came from. */
export function sourceLabel(meeting: Meeting): string {
  if (meeting.source === 'graph') {
    return (meeting.meetingLink ?? '').includes('teams.microsoft.com') ? 'Microsoft Teams' : 'Outlook';
  }
  if (meeting.source === 'google') return 'Google Calendar';
  if (meeting.source === 'local_calendar') return 'Device calendar';
  return 'Manual';
}

/**
 * Recurrence- and source-aware delete confirmation, shared by Add/Edit
 * Meeting, Home, and History — so "delete this meeting" behaves and reads
 * identically everywhere in the app instead of three slightly different
 * implementations drifting apart.
 *
 * A synced meeting (Teams/Outlook/Google/device calendar) gets a distinct
 * warning: Meetera isn't the source of truth for it, so removing it here
 * only hides it locally until the next sync brings it back. Deleting it for
 * good means deleting it at the source.
 */
export function confirmDeleteMeeting(meeting: Meeting, onDeleted: () => void): void {
  const isSynced = meeting.source !== 'manual';
  const isRecurring = !!meeting.recurrenceId;

  const doDelete = async (wholeSeries: boolean) => {
    await cancelForEdit(meeting.id);
    if (wholeSeries && meeting.recurrenceId) {
      deleteRecurrenceSeries(meeting.recurrenceId);
    } else {
      deleteMeeting(meeting.id);
    }
    onDeleted();
  };

  const message = isSynced
    ? `This meeting is synced from ${sourceLabel(meeting)}. Removing it here only hides it in Meetera — it'll come back the next time this calendar syncs. To remove it for good, delete it in ${sourceLabel(meeting)} itself.`
    : `Remove "${meeting.title}"?`;

  const buttons = isRecurring
    ? [
        { text: 'Cancel', style: 'cancel' as const },
        { text: 'Just this one', onPress: () => doDelete(false) },
        { text: 'Whole series', style: 'destructive' as const, onPress: () => doDelete(true) },
      ]
    : [
        { text: 'Cancel', style: 'cancel' as const },
        { text: 'Delete', style: 'destructive' as const, onPress: () => doDelete(false) },
      ];

  Alert.alert(isSynced ? 'Remove from Meetera' : 'Delete meeting', message, buttons);
}
