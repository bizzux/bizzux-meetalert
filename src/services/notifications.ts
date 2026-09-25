import { Platform } from 'react-native';
import notifee, { AndroidImportance, AndroidCategory, TriggerType, TimestampTrigger } from '@notifee/react-native';
import { Meeting } from '../types';

/**
 * Platform split:
 * - Android: a real exact alarm (AlarmManager under the hood via Notifee),
 *   full-screen + looping, matching the spec doc's "Ringing" state exactly.
 * - iOS: cannot loop a background alarm without Apple's Critical Alerts
 *   entitlement (see spec doc, "Platform constraints"). Instead we schedule
 *   a *series* of Time Sensitive notifications every 2 minutes from the
 *   meeting's start to its end, each cancellable the moment the user confirms.
 */

export async function requestPermissions(): Promise<void> {
  await notifee.requestPermission();
  if (Platform.OS === 'android') {
    // Android 12+ requires this to be granted for exact alarms to fire reliably.
    // Notifee surfaces a helper for this; fall back to documenting the manual
    // Settings path if the user declines.
  }
}

export async function scheduleAdvanceReminders(meeting: Meeting, offsets: readonly number[] = [30, 15, 5, 2]): Promise<void> {
  const start = new Date(meeting.startTime).getTime();

  for (const minutesBefore of offsets) {
    const fireAt = start - minutesBefore * 60 * 1000;
    if (fireAt <= Date.now()) continue; // don't schedule reminders in the past

    const trigger: TimestampTrigger = { type: TriggerType.TIMESTAMP, timestamp: fireAt };

    await notifee.createTriggerNotification(
      {
        id: `${meeting.id}-reminder-${minutesBefore}`,
        title: meeting.title,
        body: `Starts in ${minutesBefore} minutes`,
        android: {
          channelId: 'reminders',
          importance: AndroidImportance.HIGH,
          pressAction: { id: 'open-meeting' },
        },
        ios: {
          sound: 'default',
          interruptionLevel: minutesBefore <= 5 ? 'timeSensitive' : 'active',
        },
        data: { meetingId: meeting.id, kind: 'advance-reminder', minutesBefore: String(minutesBefore) },
      },
      trigger
    );
  }
}

export async function scheduleAlarmAtStart(meeting: Meeting): Promise<void> {
  if (Platform.OS === 'android') {
    await scheduleAndroidAlarm(meeting, meeting.startTime, `${meeting.id}-alarm`);
  } else {
    await scheduleIosNotificationSeries(meeting);
  }
}

/** Re-fires the alarm `minutes` from now — used by the Snooze action on
 * AlarmScreen (Android path; iOS's pre-scheduled series already covers this
 * cadence on its own). */
export async function scheduleSnoozeAlarm(meeting: Meeting, minutes: number): Promise<void> {
  if (Platform.OS !== 'android') return;
  const fireAt = Date.now() + minutes * 60 * 1000;
  await scheduleAndroidAlarm(meeting, new Date(fireAt).toISOString(), `${meeting.id}-alarm-snooze-${fireAt}`);
}

async function scheduleAndroidAlarm(meeting: Meeting, whenISO: string, notificationId: string): Promise<void> {
  const when = new Date(whenISO).getTime();
  const trigger: TimestampTrigger = { type: TriggerType.TIMESTAMP, timestamp: when, alarmManager: { allowWhileIdle: true } };

  await notifee.createTriggerNotification(
    {
      id: notificationId,
      title: `Join now: ${meeting.title}`,
      body: 'Tap "I\'ve joined" to stop this alarm.',
      android: {
        channelId: 'alarms',
        importance: AndroidImportance.HIGH,
        category: AndroidCategory.ALARM,
        fullScreenAction: { id: 'default' },
        loopSound: true,
        actions: [{ title: "I've joined", pressAction: { id: 'confirm-join' } }],
      },
      data: { meetingId: meeting.id, kind: 'alarm' },
    },
    trigger
  );
  // The re-ring/snooze loop is driven by reminderEngine.ts (scheduleSnoozeAlarm),
  // which re-schedules this same notification until confirmed or the
  // meeting's end time passes.
}

async function scheduleIosNotificationSeries(meeting: Meeting): Promise<void> {
  const start = new Date(meeting.startTime).getTime();
  const end = new Date(meeting.endTime).getTime();
  const intervalMs = 2 * 60 * 1000;

  let fireAt = start;
  let i = 0;
  while (fireAt <= end) {
    const trigger: TimestampTrigger = { type: TriggerType.TIMESTAMP, timestamp: fireAt };
    await notifee.createTriggerNotification(
      {
        id: `${meeting.id}-alarm-${i}`,
        title: `Join now: ${meeting.title}`,
        body: "Tap \"I've joined\" to stop these reminders.",
        ios: {
          sound: 'default',
          interruptionLevel: 'timeSensitive',
          categoryId: 'MEETING_ALARM',
        },
        data: { meetingId: meeting.id, kind: 'alarm' },
      },
      trigger
    );
    fireAt += intervalMs;
    i += 1;
  }
}

export async function cancelAllForMeeting(meetingId: string): Promise<void> {
  const notifications = await notifee.getTriggerNotifications();
  const idsToCancel = notifications
    .filter((n) => n.notification.data?.meetingId === meetingId)
    .map((n) => n.notification.id!)
    .filter(Boolean);
  if (idsToCancel.length) {
    await notifee.cancelTriggerNotifications(idsToCancel);
  }
}

export async function setUpChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await notifee.createChannel({ id: 'reminders', name: 'Meeting reminders', importance: AndroidImportance.HIGH });
  await notifee.createChannel({
    id: 'alarms',
    name: 'Meeting alarms',
    importance: AndroidImportance.HIGH,
    sound: 'default',
  });
}
