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
 */
const PACKAGE_NAME = 'com.bizzux.bizzminder';
const SIGNATURE_HASH = 'Xo8WBi6jzSxKDVR4drqm84yr9iU=';
const ACTIVITY_NAME = 'com.microsoft.identity.client.BrowserTabActivity';

module.exports = function withMsalManifest(config) {
  return withAndroidManifest(config, (config) => {
    const app = config.modResults.manifest.application[0];
    app.activity = app.activity || [];

    const alreadyPresent = app.activity.some(
      (activity) => activity.$?.['android:name'] === ACTIVITY_NAME
    );
    if (alreadyPresent) return config;

    app.activity.push({
      $: { 'android:name': ACTIVITY_NAME },
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
