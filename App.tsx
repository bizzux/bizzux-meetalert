import React, { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { initDatabase } from './src/db/database';
import { setUpChannels, requestPermissions } from './src/services/notifications';
import { registerNotificationListeners, handleInitialNotification } from './src/services/notificationEvents';
import { registerBackgroundSweepTask } from './src/services/backgroundTasks';
import { useAuthStore } from './src/store/authStore';
import RootNavigator from './src/navigation';

export default function App() {
  const initAuth = useAuthStore((s) => s.init);

  useEffect(() => {
    initDatabase();
    // Settings are now per-account (see src/store/authStore.ts) — they're
    // hydrated from authStore's onAuthStateChanged handler once Firebase
    // resolves who's signed in, not here.
    setUpChannels();
    requestPermissions();
    registerBackgroundSweepTask();
    const unsubscribeNotifications = registerNotificationListeners();
    handleInitialNotification(); // jump to AlarmScreen if launched by tapping a ringing alarm
    const unsubscribeAuth = initAuth();
    return () => {
      unsubscribeNotifications();
      unsubscribeAuth();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <RootNavigator />
    </SafeAreaProvider>
  );
}
