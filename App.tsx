import React, { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ShareIntentProvider, useShareIntentContext } from 'expo-share-intent';
import { initDatabase } from './src/db/database';
import { setUpChannels, requestPermissions } from './src/services/notifications';
import { registerNotificationListeners, handleInitialNotification } from './src/services/notificationEvents';
import { registerBackgroundSweepTask } from './src/services/backgroundTasks';
import { processScreenshotUri } from './src/services/screenshotImport';
import { useAuthStore } from './src/store/authStore';
import { configureGoogleSignIn } from './src/services/googleSignIn';
import RootNavigator from './src/navigation';

export default function App() {
  const initAuth = useAuthStore((s) => s.init);

  useEffect(() => {
    initDatabase();
    // Settings are now per-account (see src/store/authStore.ts) — they're
    // hydrated from authStore's onAuthStateChanged handler once Firebase
    // resolves who's signed in, not here.
    configureGoogleSignIn();
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
    <ShareIntentProvider>
      <SafeAreaProvider>
        <RootNavigator />
        <ShareIntentHandler />
      </SafeAreaProvider>
    </ShareIntentProvider>
  );
}

/** Handles the "Snap & Fill" share-sheet entry point: when the person
 * screenshots a meeting invite elsewhere and shares it to Meetera, this
 * picks up the shared image and runs it through the same import pipeline
 * as the in-app "Import from screenshot" button. Renders nothing — it's
 * purely an effect watching expo-share-intent's context, which is why it's
 * a separate component (useShareIntentContext needs to be inside
 * ShareIntentProvider, not the same component that renders the provider). */
function ShareIntentHandler() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();

  useEffect(() => {
    const path = shareIntent?.files?.[0]?.path;
    if (hasShareIntent && path) {
      processScreenshotUri(path).finally(() => resetShareIntent());
    }
  }, [hasShareIntent]);

  return null;
}
