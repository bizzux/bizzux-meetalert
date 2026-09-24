import notifee, { EventType, Event as NotifeeEvent } from '@notifee/react-native';
import { confirmJoined } from './reminderEngine';

/**
 * Central handler for every notification interaction: tapping the body,
 * tapping the "I've joined" action, or dismissing it. Both the foreground
 * and background listeners route through this so the confirm-to-stop
 * behavior is identical no matter where the app was when the user tapped.
 */
async function handleNotificationEvent({ type, detail }: NotifeeEvent): Promise<void> {
  const meetingId = detail.notification?.data?.meetingId as string | undefined;
  if (!meetingId) return;

  const isConfirmAction = detail.pressAction?.id === 'confirm-join';
  const isDefaultOpenPress = type === EventType.PRESS && detail.pressAction?.id !== 'confirm-join';

  if (type === EventType.ACTION_PRESS && isConfirmAction) {
    await confirmJoined(meetingId);
    return;
  }

  if (isDefaultOpenPress) {
    // Opening the app from a tap on the notification body doesn't confirm
    // attendance by itself — the user still has to tap "I've joined" in the
    // app, on purpose: opening the app isn't the same as joining the call.
    // A navigation ref could be used here to deep-link straight to the
    // meeting; omitted from this scaffold for simplicity.
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
