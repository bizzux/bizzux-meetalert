const { withProjectBuildGradle } = require('@expo/config-plugins');

/**
 * @notifee/react-native ships its native Android library (app.notifee:core)
 * as a local flat-file maven repo bundled inside the package itself
 * (node_modules/@notifee/react-native/android/libs) rather than publishing
 * it to a public registry like Maven Central or Google's repo. Expo's
 * managed prebuild has no built-in knowledge of this, so every
 * `expo prebuild` regenerates android/build.gradle without the required
 * repository entry — the build then fails with:
 *   "Could not find any matches for app.notifee:core:+"
 *
 * This local config plugin injects that repository into the top-level
 * android/build.gradle's `allprojects { repositories { ... } }` block on
 * every prebuild (including a clean one), so the fix survives regeneration
 * instead of needing to be hand-added each time.
 */
module.exports = function withNotifeeMavenRepo(config) {
  return withProjectBuildGradle(config, (config) => {
    const marker = '// @notifee/react-native (see plugins/withNotifeeMavenRepo.js)';
    if (config.modResults.contents.includes(marker)) {
      return config;
    }
    config.modResults.contents = config.modResults.contents.replace(
      /allprojects\s*\{\s*repositories\s*\{/,
      (match) =>
        `${match}\n    ${marker}\n    maven { url "$rootDir/../node_modules/@notifee/react-native/android/libs" }`
    );
    return config;
  });
};
