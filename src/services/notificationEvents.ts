import notifee, { EventType, Event as NotifeeEvent } from '@notifee/react-native';
import { confirmJoined, announceMeetingName } from './reminderEngine';
import { getMeeting, restoreLastKnownUserId } from '../db/database';
import { navigateToAlarm } from '../navigation/navigationRef';

/**
 * Central handler for every notification interaction: tapping the body,
 * tapping the "I've joined" action, or dismissing it. Both the foreground
 * and background listeners route through this so the confirm-to-stop
 * behavior is identical no matter where the app was when the user tapped.
 */
async function handleNotificationEvent({ type, detail }: NotifeeEvent): Promise<void> {
  const meetingId = detail.notification?.data?.meetingId as string | undefined;
  const kind = detail.notification?.data?.kind as string | undefined;
  if (!meetingId) return;

  // Voice-announce the meeting the moment the alarm notification is
  // actually DELIVERED - not just when someone opens it. Previously this
  // only ever spoke from AlarmScreen's own mount effect (which depends on
  // the full-screen alarm intent actually being allowed to launch the UI -
  // not guaranteed on every device/OS version/lock-screen state) or from
  // the background sweep's best-effort re-announce, which can run up to
  // ~15 minutes late. Hooking DELIVERED here means the announcement fires
  // reliably, in the foreground or background (this same handler is also
  // registered as the background event handler in index.js), right when
  // the alarm actually starts ringing - matching "on receiving the
  // notification" rather than "once the screen happens to open".
  if (type === EventType.DELIVERED && kind === 'alarm') {
    try {
      // This handler can run in a headless JS context after the OS killed
      // the app process - App.tsx's onAuthStateChanged never ran there, so
      // database.ts wouldn't otherwise know which account to scope this
      // read to (same recovery backgroundTasks.ts does for the same
      // reason). No signed-in user has ever completed a sign-in yet (fresh
      // install) -> nothing to announce.
      const uid = restoreLastKnownUserId();
      if (!uid) return;
      const meeting = getMeeting(meetingId);
      if (meeting) announceMeetingName(meeting);
    } catch (err) {
      console.warn('[BizzMinder] delivery-time voice announcement failed', err);
    }
    return;
  }

  const isConfirmAction = detail.pressAction?.id === 'confirm-join';
  const isDefaultOpenPress = type === EventType.PRESS && detail.pressAction?.id !== 'confirm-join';

  if (type === EventType.ACTION_PRESS && isConfirmAction) {
    await confirmJoined(meetingId);
    return;
  }

  if (isDefaultOpenPress) {
    // Tapping the notification body (or the full-screen alarm intent on
    // Android) opens straight to AlarmScreen when it's the alarm firing -
    // that's where "I've joined" / Snooze / Mark as missed live. This does
    // NOT confirm attendance by itself: opening the app isn't the same as
    // joining the call, the user still has to act on that screen.
    if (kind === 'alarm') {
      navigateToAlarm(meetingId);
    }
  }
}

/**
 * Call once, early in App.tsx, to wire up the foreground listener (app is
 * open) and background listener (app is backgrounded/killed) for
 * notification presses.
 */
export function registerNotificationListeners(): () => void {
  const unsubscribeForeground = notifee.onForegroundEvent(handleNotificationEvent);

  // The background handler must ALSO be registered at the top level of the
  // JS bundle (outside any React component), because it can be invoked by
  // the OS while the app process is not yet running. See index.js, which
  // calls notifee.onBackgroundEvent(handleBackgroundNotificationEvent)
  // before the app is even registered.

  return unsubscribeForeground;
}

export async function handleBackgroundNotificationEvent(event: NotifeeEvent): Promise<void> {
  await handleNotificationEvent(event);
}

/** Called once at startup to check whether the app was cold-launched by
 * tapping a ringing alarm notification (vs. a normal app icon launch), and
 * if so, jump straight to AlarmScreen once navigation is ready. */
export async function handleInitialNotification(): Promise<void> {
  const initial = await notifee.getInitialNotification();
  const meetingId = initial?.notification.data?.meetingId as string | undefined;
  const kind = initial?.notification.data?.kind as string | undefined;
  if (meetingId && kind === 'alarm') {
    // Navigation may not be mounted yet on a true cold start; a short defer
    // gives NavigationContainer time to attach its ref.
    setTimeout(() => navigateToAlarm(meetingId), 300);
  }
}
