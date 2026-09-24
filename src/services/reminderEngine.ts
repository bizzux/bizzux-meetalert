import { Platform } from 'react-native';
import { Meeting } from '../types';
import {
  getUnresolvedStartedMeetings,
  recordAttendance,
} from '../db/database';
import { scheduleAdvanceReminders, scheduleAlarmAtStart, cancelAllForMeeting } from './notifications';
import * as Speech from 'expo-speech';

const SNOOZE_INTERVAL_MS = 2 * 60 * 1000;

/**
 * Called once when a meeting is created/synced. Schedules everything that
 * can be scheduled in advance: the four pre-meeting reminders and the
 * platform-appropriate alarm/notification series starting at T-0.
 * This is the only place that needs to know about the escalation timeline
 * described in the spec doc.
 */
export async function scheduleMeeting(meeting: Meeting): Promise<void> {
  await scheduleAdvanceReminders(meeting);
  await scheduleAlarmAtStart(meeting);
}

/**
 * Called when the user taps "I've joined" — from a notification action,
 * the lock screen, or in-app. This is the ONLY thing that stops an alarm;
 * there is no auto-detection of joining (see spec doc).
 */
export async function confirmJoined(meetingId: string): Promise<void> {
  await cancelAllForMeeting(meetingId);
  recordAttendance({
    meetingId,
    status: 'attended',
    confirmedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  });
}

/**
 * Called by the periodic background task (see backgroundTasks.ts) to sweep
 * for meetings whose end time has passed with no confirmation, marking
 * them Missed, and to re-announce (by name, via TTS) any Android meeting
 * that's still ringing and unconfirmed. Notifee's own scheduled alarm
 * covers the sound/re-ring itself even if this sweep runs late or not at
 * all in a given interval — this is a supplementary announcement layer,
 * not the primary mechanism (see backgroundTasks.ts comments on
 * `minimumInterval` being best-effort).
 */
export async function sweepMeetingStates(): Promise<void> {
  const now = new Date();
  const unresolved = getUnresolvedStartedMeetings(now.toISOString());

  for (const meeting of unresolved) {
    const end = new Date(meeting.endTime).getTime();

    if (now.getTime() >= end) {
      await cancelAllForMeeting(meeting.id);
      recordAttendance({
        meetingId: meeting.id,
        status: 'missed',
        confirmedAt: null,
        createdAt: new Date().toISOString(),
      });
      continue;
    }

    // Still within the meeting window and unconfirmed.
    if (Platform.OS === 'android') {
      announceMeetingName(meeting);
    }
    // On iOS the pre-scheduled Time Sensitive notification series (set up
    // in scheduleAlarmAtStart) handles the every-2-minutes cadence on its
    // own; there's nothing additional to trigger from here.
  }
}

export function announceMeetingName(meeting: Meeting): void {
  Speech.speak(`Time to join: ${meeting.title}`, { rate: 0.95 });
}

export const __constants = { SNOOZE_INTERVAL_MS };
