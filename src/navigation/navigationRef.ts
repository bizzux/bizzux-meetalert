import { createNavigationContainerRef } from '@react-navigation/native';

/** Lets non-component code (notification handlers, background events) drive
 * navigation — e.g. jumping straight to the full-screen AlarmScreen when the
 * user taps a ringing alarm notification, even from a cold start. */
export const navigationRef = createNavigationContainerRef();

export function navigateToAlarm(meetingId: string) {
  if (navigationRef.isReady()) {
    navigationRef.navigate('Alarm', { meetingId });
  }
}
