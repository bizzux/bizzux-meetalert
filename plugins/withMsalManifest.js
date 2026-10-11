const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * react-native-msal (Microsoft Graph sign-in — see src/services/graphAuth.ts,
 * "Connect Microsoft account" in Settings) needs a BrowserTabActivity
 * declared in AndroidManifest.xml, so the system browser can hand control
 * back to the app after a Microsoft sign-in redirects through it.
 *
 * Expo's managed prebuild has no built-in knowledge of this, and
 * `expo prebuild` regenerates AndroidManifest.xml from scratch every run
 * (confirmed the hard way, same as the JDK 17 / Notifee maven-repo fixes
 * elsewhere in this plugins/ folder) — a hand-added copy of this activity
 * was wiped out by a `--clean` prebuild run for an unrelated native config
 * change, breaking Microsoft sign-in with:
 *   "Couldn't connect Microsoft account — Intent filter for:
 *   BrowserTabActivity is missing."
 * MSAL's own error dialog named the exact activity/intent-filter block
 * needed (including the signature-hash path below) — this plugin re-adds
 * that same block on every prebuild instead, so the fix survives
 * regeneration.
 *
 * SIGNATURE_HASH is the base64 hash of the signing certificate MSAL reads
 * at runtime — it's tied to whichever keystore signed the currently
 * installed build (the debug keystore, right now). It will need updating
 * to whichever new hash MSAL's own error reports if the signing key ever
 * changes, e.g. moving to a real Play Store release build signed by EAS /
 * Google Play App Signing.
 *
 * android:exported="true" is required here — Android 12+ (API 31+) refuses
 * to deliver an implicit intent (the browser handing control back after a
 * Microsoft sign-in) to any activity with an intent-filter that doesn't
 * explicitly declare android:exported. Without it, the system browser
 * closes after sign-in but BizzMinder never gets the redirect back, so
 * "Connect Microsoft account" just hangs or silently does nothing — this
 * is the exact block Microsoft's own Android setup docs specify.
 */
const PACKAGE_NAME = 'com.bizzux.bizzminder';
const SIGNATURE_HASH = 'Xo8WBi6jzSxKDVR4drqm84yr9iU=';
const ACTIVITY_NAME = 'com.microsoft.identity.client.BrowserTabActivity';

module.exports = function withMsalManifest(config) {
  return withAndroidManifest(config, (config) => {
    const app = config.modResults.manifest.application[0];
    app.activity = app.activity || [];

    const existing = app.activity.find(
      (activity) => activity.$?.['android:name'] === ACTIVITY_NAME
    );
    if (existing) {
      // Patch in place rather than skip — an incremental (non --clean)
      // prebuild can re-run this plugin against a manifest that already has
      // the activity from a version of this file that predated the
      // android:exported fix, and a bare "already present" skip would have
      // left that stale, still-broken copy in place.
      existing.$['android:exported'] = 'true';
      return config;
    }

    app.activity.push({
      $: { 'android:name': ACTIVITY_NAME, 'android:exported': 'true' },
      'intent-filter': [
        {
          action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
          category: [
            { $: { 'android:name': 'android.intent.category.DEFAULT' } },
            { $: { 'android:name': 'android.intent.category.BROWSABLE' } },
          ],
          data: [
            {
              $: {
                'android:scheme': 'msauth',
                'android:host': PACKAGE_NAME,
                'android:path': `/${SIGNATURE_HASH}`,
              },
            },
          ],
        },
      ],
    });

    return config;
  });
};
