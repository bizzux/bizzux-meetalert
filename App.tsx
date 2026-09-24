import React, { useEffect } from 'react';
import { initDatabase } from './src/db/database';
import { setUpChannels, requestPermissions } from './src/services/notifications';
import { registerNotificationListeners } from './src/services/notificationEvents';
import { registerBackgroundSweepTask } from './src/services/backgroundTasks';
import RootNavigator from './src/navigation';

export default function App() {
  useEffect(() => {
    initDatabase();
    setUpChannels();
    requestPermissions();
    registerBackgroundSweepTask();
    const unsubscribe = registerNotificationListeners();
    return unsubscribe;
  }, []);

  return <RootNavigator />;
}
