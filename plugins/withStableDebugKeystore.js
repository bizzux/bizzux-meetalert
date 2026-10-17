const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * `expo prebuild` (and especially `expo prebuild --clean`, or just deleting
 * android/) does not preserve android/app/debug.keystore - if it isn't
 * already on disk when the Android project gets generated, a brand new one
 * gets created with a brand new random signing key. That silently breaks
 * Google Sign-In: the app's SHA-1 fingerprint no longer matches the Android
 * OAuth client registered for it in Google Cloud ("bizzux-meet" project -
 * see src/services/googleSignIn.ts), so sign-in fails with DEVELOPER_ERROR
 * until someone notices and re-registers the new fingerprint.
 *
 * This happened once already (that's why this plugin exists) - the keystore
 * that was registered got silently swapped out by a prebuild at some point.
 *
 * Fix: keep exactly one debug keystore, committed to git at
 * keystores/debug.keystore (outside android/, which is gitignored and fully
 * regenerated), and copy it into android/app/debug.keystore on every single
 * prebuild - clean or not - so the signing key, and therefore the SHA-1
 * fingerprint Google has on file, never changes again.
 */
module.exports = function withStableDebugKeystore(config) {
  return withDangerousMod(config, [
    'android',
    (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const source = path.join(projectRoot, 'keystores', 'debug.keystore');
      const destDir = path.join(config.modRequest.platformProjectRoot, 'app');
      const dest = path.join(destDir, 'debug.keystore');

      if (!fs.existsSync(source)) {
        throw new Error(
          `withStableDebugKeystore: expected a tracked debug keystore at ${source} but it's missing. ` +
            `Without it, prebuild will mint a new one and break Google Sign-In again (see this file's header comment).`
        );
      }

      fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(source, dest);

      return config;
    },
  ]);
};
