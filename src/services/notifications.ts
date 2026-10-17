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

// Every selectable alarm sound gets its OWN permanent Android notification
// channel (alarms_default / alarms_chime / alarms_classic), each created
// once with its final sound and never touched again. This is deliberate,
// not simpler-than-needed: Android's own NotificationManager docs say that
// re-creating a channel with the SAME id "un-deletes" it with its ORIGINAL
// settings, ignoring whatever new settings createChannel() is called with -
// so the previous approach here (one 'alarms' channel, deleted and
// recreated with a different `sound` whenever the user picked a different
// option) never actually changed the sound at all: Android kept restoring
// the very first sound that channel id was ever created with, which is
// exactly why every option in the "Preview alarm & voice" button played
// back identically regardless of which pill was selected. One channel id
// per sound sidesteps this entirely - switching sounds just switches which
// already-existing channel gets used, never recreates one.
const ALARM_SOUND_KEYS = ['default', 'chime', 'classic'] as const;
type AlarmSoundKey = (typeof ALARM_SOUND_KEYS)[number];

function alarmChannelIdFor(soundKey: string): string {
  return ALARM_SOUND_KEYS.includes(soundKey as AlarmSoundKey) ? `alarms_${soundKey}` : 'alarms_default';
}

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
 * Android: pre-schedules the WHOLE re-ring series up front - one exact
 * AlarmManager-backed notification every `snoozeMinutes` from the meeting's
 * start to its end - rather than a single looping notification. A single
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
  // Cap the ring series low - this was previously 30, which for a
  // recurring meeting (each occurrence scheduling its own series) could
  // add up to hundreds of native alarm registrations in one save and stall
  // or crash the app. 10 rings is ~20 minutes of intermittent ringing at
  // the default 2-minute snooze, which is plenty to catch a missed start.
  const MAX_RINGS = 10;

  const fireTimes: number[] = [];
  for (let fireAt = start, i = 0; fireAt <= end && i < MAX_RINGS; fireAt += intervalMs, i++) {
    fireTimes.push(fireAt);
  }
  // Scheduled concurrently rather than one at a time - with recurring
  // meetings generating many occurrences at once, sequential awaits here
  // made a single save visibly hang.
  await Promise.all(fireTimes.map((fireAt, i) => scheduleOneAndroidRing(meeting, fireAt, `${meeting.id}-alarm-${i}`)));
}

/** Re-fires the alarm `minutes` from now - used by the Snooze action on
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
        channelId: alarmChannelIdFor(useSettingsStore.getState().alarmSound),
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
 * Cancels every notification for a meeting - both ones still waiting to
 * fire (getTriggerNotifications) and, critically, any that already fired
 * and are currently showing/sounding (getDisplayedNotifications). A
 * TimestampTrigger notification drops out of the "trigger" list the moment
 * it fires, since there's nothing left to trigger, so cancelling only
 * trigger notifications silences the rest of the series but leaves an
 * alarm that's actively ringing right now still ringing. Every caller of
 * this - "I've joined", "Mark as missed", and Silence alarm - relies on it
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
  // Create all three sound-specific alarm channels up front, once. Each one
  // is only ever created with its own final sound and never recreated -
  // createChannel() on an id that already exists is a safe no-op (it does
  // NOT let you change that channel's sound after the fact - see the
  // ALARM_SOUND_KEYS comment above), so this is cheap to call on every
  // launch and guarantees every sound option has a working channel even on
  // someone's very first run.
  await Promise.all(ALARM_SOUND_KEYS.map((key) => createAlarmChannel(key)));
}

async function createAlarmChannel(soundKey: AlarmSoundKey): Promise<void> {
  await notifee.createChannel({
    id: alarmChannelIdFor(soundKey),
    name: `Meeting alarms (${soundKey})`,
    importance: AndroidImportance.HIGH,
    sound: soundKey, // 'default' always works; a custom key needs a matching file in android/app/src/main/res/raw/
    vibration: true,
    vibrationPattern: [300, 600, 300, 600],
  });
}

/**
 * Fired by the "Preview alarm & voice" button in Settings. Plays through
 * whichever sound-specific channel matches the CURRENTLY selected alarm
 * sound - the same channel a live alarm for that setting uses - rather than
 * a separate preview sound, so what's heard is exactly what will play for a
 * real meeting. The preview notification auto-dismisses itself a few
 * seconds later so it doesn't linger in the notification shade.
 */
export async function previewAlarmSound(): Promise<void> {
  const id = 'preview-alarm';
  await notifee.displayNotification({
    id,
    title: 'Preview: alarm sound',
    body: 'This is what your alarm sounds like.',
    android: {
      channelId: alarmChannelIdFor(useSettingsStore.getState().alarmSound),
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
