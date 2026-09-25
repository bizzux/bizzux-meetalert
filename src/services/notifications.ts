import { Platform } from 'react-native';
import notifee, { AndroidImportance, AndroidCategory, TriggerType, TimestampTrigger } from '@notifee/react-native';
import { Meeting } from '../types';
import { useSettingsStore } from '../store/settingsStore';

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

/**
 * Android: pre-schedules the WHOLE re-ring series up front — one exact
 * AlarmManager-backed notification every `snoozeMinutes` from the meeting's
 * start to its end — rather than a single looping notification. A single
 * notification with loopSound just loops the same short tone forever, which
 * reads as one continuous buzz rather than a series of distinct alarm
 * rings; discrete re-scheduled alarms (same approach already used for iOS)
 * behave far more like a real alarm clock and don't depend on a background
 * JS task waking up on time (expo-background-fetch's interval is
 * best-effort and often much coarser than 2 minutes).
 */
async function scheduleAndroidAlarm(meeting: Meeting): Promise<void> {
  const snoozeMinutes = useSettingsStore.getState().snoozeMinutes;
  const start = new Date(meeting.startTime).getTime();
  const end = new Date(meeting.endTime).getTime();
  const intervalMs = Math.max(1, snoozeMinutes) * 60 * 1000;
  const MAX_RINGS = 30; // safety cap so a long/open-ended meeting can't schedule hundreds of alarms

  let fireAt = start;
  let i = 0;
  while (fireAt <= end && i < MAX_RINGS) {
    await scheduleOneAndroidRing(meeting, fireAt, `${meeting.id}-alarm-${i}`);
    fireAt += intervalMs;
    i += 1;
  }
}

/** Re-fires the alarm `minutes` from now — used by the Snooze action on
 * AlarmScreen for an extra, ad-hoc snooze on top of the pre-scheduled
 * series (Android path; iOS's pre-scheduled series already covers this
 * cadence on its own). */
export async function scheduleSnoozeAlarm(meeting: Meeting, minutes: number): Promise<void> {
  if (Platform.OS !== 'android') return;
  const fireAt = Date.now() + minutes * 60 * 1000;
  await scheduleOneAndroidRing(meeting, fireAt, `${meeting.id}-alarm-snooze-${fireAt}`);
}

async function scheduleOneAndroidRing(meeting: Meeting, whenMs: number, notificationId: string): Promise<void> {
  const trigger: TimestampTrigger = {
    type: TriggerType.TIMESTAMP,
    timestamp: whenMs,
    alarmManager: { allowWhileIdle: true },
  };

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
}

export async function scheduleAlarmAtStart(meeting: Meeting): Promise<void> {
  if (Platform.OS === 'android') {
    await scheduleAndroidAlarm(meeting);
  } else {
    await scheduleIosNotificationSeries(meeting);
  }
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
  await createAlarmChannel(useSettingsStore.getState().alarmSound);
}

async function createAlarmChannel(soundKey: string): Promise<void> {
  await notifee.createChannel({
    id: 'alarms',
    name: 'Meeting alarms',
    importance: AndroidImportance.HIGH,
    sound: soundKey, // 'default' always works; a custom key needs a matching file in android/app/src/main/res/raw/
    vibration: true,
    vibrationPattern: [300, 600, 300, 600],
  });
}

/** Android channel sound can't be changed once created — this deletes and
 * recreates the 'alarms' channel, called when the user picks a different
 * alarm sound in Settings. */
export async function recreateAlarmChannel(soundKey: string): Promise<void> {
  if (Platform.OS !== 'android') return;
  await notifee.deleteChannel('alarms');
  await createAlarmChannel(soundKey);
}
