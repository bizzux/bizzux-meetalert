import { registerRootComponent } from 'expo';
import notifee from '@notifee/react-native';
import { handleBackgroundNotificationEvent } from './src/services/notificationEvents';
import App from './App';

// Must be registered at the top level, before registerRootComponent, so the
// OS can invoke it even if the app process isn't running (e.g. the user
// taps "I've joined" on a notification while the app was killed).
notifee.onBackgroundEvent(handleBackgroundNotificationEvent);

registerRootComponent(App);
