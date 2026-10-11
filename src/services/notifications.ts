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
  const toSchedule = offsets
    .map((minutesBefore) => ({ minutesBefore, fireAt: start - minutesBefore * 60 * 1000 }))
    .filter((o) => o.fireAt > Date.now()); // don't schedule reminders in the past

  await Promise.all(
    toSchedule.map(({ minutesBefore, fireAt }) => {
      const trigger: TimestampTrigger = { type: TriggerType.TIMESTAMP, timestamp: fireAt };
      return notifee.createTriggerNotification(
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
    })
  );
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
  // Cap the ring series low — this was previously 30, which for a
  // recurring meeting (each occurrence scheduling its own series) could
  // add up to hundreds of native alarm registrations in one save and stall
  // or crash the app. 10 rings is ~20 minutes of intermittent ringing at
  // the default 2-minute snooze, which is plenty to catch a missed start.
  const MAX_RINGS = 10;

  const fireTimes: number[] = [];
  for (let fireAt = start, i = 0; fireAt <= end && i < MAX_RINGS; fireAt += intervalMs, i++) {
    fireTimes.push(fireAt);
  }
  // Scheduled concurrently rather than one at a time — with recurring
  // meetings generating many occurrences at once, sequential awaits here
  // made a single save visibly hang.
  await Promise.all(fireTimes.map((fireAt, i) => scheduleOneAndroidRing(meeting, fireAt, `${meeting.id}-alarm-${i}`)));
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
  const MAX_RINGS = 10; // same cap/rationale as the Android series

  const fireTimes: number[] = [];
  for (let fireAt = start, i = 0; fireAt <= end && i < MAX_RINGS; fireAt += intervalMs, i++) {
    fireTimes.push(fireAt);
  }

  await Promise.all(
    fireTimes.map((fireAt, i) => {
      const trigger: TimestampTrigger = { type: TriggerType.TIMESTAMP, timestamp: fireAt };
      return notifee.createTriggerNotification(
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
    })
  );
}

/**
 * Cancels every notification for a meeting — both ones still waiting to
 * fire (getTriggerNotifications) and, critically, any that already fired
 * and are currently showing/sounding (getDisplayedNotifications). A
 * TimestampTrigger notification drops out of the "trigger" list the moment
 * it fires, since there's nothing left to trigger, so cancelling only
 * trigger notifications silences the rest of the series but leaves an
 * alarm that's actively ringing right now still ringing. Every caller of
 * this — "I've joined", "Mark as missed", and Silence alarm — relies on it
 * to actually go quiet immediately, not just stop future re-rings.
 */
export async function cancelAllForMeeting(meetingId: string): Promise<void> {
  const [pending, displayed] = await Promise.all([
    notifee.getTriggerNotifications(),
    notifee.getDisplayedNotifications(),
  ]);
  const pendingIds = pending
    .filter((n) => n.notification.data?.meetingId === meetingId)
    .map((n) => n.notification.id!)
    .filter(Boolean);
  const displayedIds = displayed
    .filter((n) => n.notification.data?.meetingId === meetingId)
    .map((n) => n.notification.id!)
    .filter(Boolean);

  await Promise.all([
    pendingIds.length ? notifee.cancelTriggerNotifications(pendingIds) : Promise.resolve(),
    displayedIds.length ? notifee.cancelDisplayedNotifications(displayedIds) : Promise.resolve(),
  ]);
}

export async function setUpChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await notifee.createChannel({ id: 'reminders', name: 'Meeting reminders', importance: AndroidImportance.HIGH });
  // Force-recreate on every launch rather than createAlarmChannel() directly:
  // Android locks a channel's sound permanently once that channel id first
  // exists on the device, so calling createChannel() again with a different
  // sound is silently ignored forever. Without this, a device whose 'alarms'
  // channel got created before the sound was wired up correctly (or before a
  // custom tune's file existed) stays silent/vibrate-only no matter what the
  // code says, until something deletes and recreates the channel. Deleting
  // and recreating it on every start guarantees it always matches whatever
  // alarmSound is currently set.
  await recreateAlarmChannel(useSettingsStore.getState().alarmSound);
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
 * recreates the 'alarms' channel. Called when the user picks a different
 * alarm sound in Settings, and on every app start from setUpChannels() so
 * the channel never drifts out of sync with the current setting. deleteChannel
 * on an id that doesn't exist yet (first-ever launch) is a safe no-op. */
export async function recreateAlarmChannel(soundKey: string): Promise<void> {
  if (Platform.OS !== 'android') return;
  await notifee.deleteChannel('alarms');
  await createAlarmChannel(soundKey);
}

/**
 * Fired by the "Preview alarm & voice" button in Settings. Plays the
 * currently selected alarm sound through the real 'alarms' channel — the
 * same channel and sound a live alarm uses — rather than a separate preview
 * sound, so what's heard is exactly what will play for a real meeting. The
 * preview notification auto-dismisses itself a few seconds later so it
 * doesn't linger in the notification shade.
 */
export async function previewAlarmSound(): Promise<void> {
  const id = 'preview-alarm';
  await notifee.displayNotification({
    id,
    title: 'Preview: alarm sound',
    body: 'This is what your alarm sounds like.',
    android: {
      channelId: 'alarms',
      importance: AndroidImportance.HIGH,
      category: AndroidCategory.ALARM,
      autoCancel: true,
      pressAction: { id: 'default' },
    },
    ios: {
      sound: 'default',
      interruptionLevel: 'timeSensitive',
    },
  });
  setTimeout(() => {
    notifee.cancelDisplayedNotification(id).catch(() => {});
  }, 6000);
}
