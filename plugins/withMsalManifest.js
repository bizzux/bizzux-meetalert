const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * react-native-msal (Microsoft Graph sign-in - see src/services/graphAuth.ts,
 * "Connect Microsoft account" in Settings) needs a BrowserTabActivity
 * declared in AndroidManifest.xml, so the system browser can hand control
 * back to the app after a Microsoft sign-in redirects through it.
 *
 * Expo's managed prebuild has no built-in knowledge of this, and
 * `expo prebuild` regenerates AndroidManifest.xml from scratch every run
 * (confirmed the hard way, same as the JDK 17 / Notifee maven-repo fixes
 * elsewhere in this plugins/ folder) - a hand-added copy of this activity
 * was wiped out by a `--clean` prebuild run for an unrelated native config
 * change, breaking Microsoft sign-in with:
 *   "Couldn't connect Microsoft account - Intent filter for:
 *   BrowserTabActivity is missing."
 * MSAL's own error dialog named the exact activity/intent-filter block
 * needed (including the signature-hash path below) - this plugin re-adds
 * that same block on every prebuild instead, so the fix survives
 * regeneration.
 *
 * SIGNATURE_HASHES are the base64 hashes of the signing certificates MSAL
 * reads at runtime - each one is tied to one specific keystore, and MSAL
 * (and the matching Azure app registration's Android redirect URI - see
 * RUN.md 5m's Google equivalent of this, the same idea applies here) needs
 * an exact match for whichever keystore actually signed the installed
 * build. Since this project is built with more than one keystore (the
 * stable keystores/debug.keystore for local dev, and the EAS-managed
 * release/preview keystore for `eas build`), this registers BOTH as
 * separate <data> entries so Microsoft sign-in works on either build
 * without having to swap this file back and forth.
 *
 * This was wrong once already: this file used to hardcode a single old
 * debug keystore's hash, which silently stopped matching when the debug
 * keystore got stabilized (see "Google Sign-In and the debug keystore" in
 * RUN.md) without this file being updated to match - breaking Microsoft
 * sign-in the same way a stale SHA-1 broke Google Sign-In. If this ever
 * happens again (keystore rotated, hash not updated here), MSAL's own
 * error dialog names the exact hash it expected - or compute it directly
 * from a known SHA-1 fingerprint (e.g. from `keytool -list -v`, EAS
 * credentials, or Google Cloud Console) by base64-encoding the raw 20
 * bytes of that hex fingerprint, since both are the same certificate hash
 * just in different encodings.
 *
 * Current hashes (17 Oct 2026):
 * - keystores/debug.keystore -> jNT+9SQyNbiOQJ3iDDXAOR6uA1c=
 *   (hex SHA-1: 8C:D4:FE:F5:24:32:35:B8:8E:40:9D:E2:0C:35:C0:39:1E:AE:03:57)
 * - EAS release/preview keystore -> gCzUqkTpsBjDit1V+LyJY3N1HtA=
 *   (hex SHA-1: 80:2C:D4:AA:44:E9:B0:18:C3:8A:DD:55:F8:BC:89:63:73:75:1E:D0)
 *
 * android:exported="true" is required here - Android 12+ (API 31+) refuses
 * to deliver an implicit intent (the browser handing control back after a
 * Microsoft sign-in) to any activity with an intent-filter that doesn't
 * explicitly declare android:exported. Without it, the system browser
 * closes after sign-in but BizzMinder never gets the redirect back, so
 * "Connect Microsoft account" just hangs or silently does nothing - this
 * is the exact block Microsoft's own Android setup docs specify.
 */
const PACKAGE_NAME = 'com.bizzux.bizzminder';
const SIGNATURE_HASHES = [
  'jNT+9SQyNbiOQJ3iDDXAOR6uA1c=', // keystores/debug.keystore (local dev)
  'gCzUqkTpsBjDit1V+LyJY3N1HtA=', // EAS release/preview keystore
];
const ACTIVITY_NAME = 'com.microsoft.identity.client.BrowserTabActivity';

module.exports = function withMsalManifest(config) {
  return withAndroidManifest(config, (config) => {
    const app = config.modResults.manifest.application[0];
    app.activity = app.activity || [];

    const dataEntries = SIGNATURE_HASHES.map((hash) => ({
      $: {
        'android:scheme': 'msauth',
        'android:host': PACKAGE_NAME,
        'android:path': `/${hash}`,
      },
    }));

    const existing = app.activity.find(
      (activity) => activity.$?.['android:name'] === ACTIVITY_NAME
    );
    if (existing) {
      // Patch in place rather than skip - an incremental (non --clean)
      // prebuild can re-run this plugin against a manifest that already has
      // the activity from a version of this file that predated the
      // android:exported fix (or the multi-hash fix below), and a bare
      // "already present" skip would have left that stale, still-broken
      // copy in place.
      existing.$['android:exported'] = 'true';
      existing['intent-filter'] = [
        {
          action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
          category: [
            { $: { 'android:name': 'android.intent.category.DEFAULT' } },
            { $: { 'android:name': 'android.intent.category.BROWSABLE' } },
          ],
          data: dataEntries,
        },
      ];
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
          data: dataEntries,
        },
      ],
    });

    return config;
  });
};
