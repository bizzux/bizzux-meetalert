import React, { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { initDatabase } from './src/db/database';
import { setUpChannels, requestPermissions } from './src/services/notifications';
import { registerNotificationListeners, handleInitialNotification } from './src/services/notificationEvents';
import { registerBackgroundSweepTask } from './src/services/backgroundTasks';
import { useSettingsStore } from './src/store/settingsStore';
import RootNavigator from './src/navigation';

export default function App() {
  const hydrate = useSettingsStore((s) => s.hydrate);

  useEffect(() => {
    initDatabase();
    hydrate(); // load saved theme/reminder/calendar-source settings — must run after initDatabase()
    setUpChannels();
    requestPermissions();
    registerBackgroundSweepTask();
    const unsubscribe = registerNotificationListeners();
    handleInitialNotification(); // jump to AlarmScreen if launched by tapping a ringing alarm
    return unsubscribe;
  }, []);

  return (
    <SafeAreaProvider>
      <RootNavigator />
    </SafeAreaProvider>
  );
}
