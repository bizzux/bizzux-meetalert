const { withGradleProperties } = require('@expo/config-plugins');

/**
 * React Native's native (CMake) build step is only stable on JDK 17 —
 * Android Studio's bundled JBR on this machine is JDK 24/25, which makes
 * Gradle's own internal native-library loader print a "restricted method in
 * java.lang.System" warning (JEP 472). Android Gradle Plugin's
 * configureCMakeDebug/Release step treats that stray warning text as broken
 * JSON and fails outright, even though nothing is actually wrong (known
 * Gradle bug: gradle/gradle#31625).
 *
 * `expo prebuild` fully regenerates android/gradle.properties on every run
 * (not just `--clean` — confirmed by a "Cleared android code" prebuild log
 * even without that flag), so a manual edit to that file does not survive.
 * This plugin re-applies `org.gradle.java.home` on every prebuild instead.
 *
 * Override the path per machine with the JDK_17_HOME environment variable
 * (e.g. set it before running `expo prebuild` / `expo run:android`) — useful
 * if a teammate's JDK 17 lives somewhere other than the default below.
 */
const DEFAULT_JDK_17_HOME = 'C:\\\\Program Files\\\\Microsoft\\\\jdk-17.0.20.101-hotspot';

module.exports = function withJdk17(config) {
  return withGradleProperties(config, (config) => {
    const jdkHome = process.env.JDK_17_HOME || DEFAULT_JDK_17_HOME;

    config.modResults = config.modResults.filter(
      (item) => !(item.type === 'property' && item.key === 'org.gradle.java.home')
    );
    config.modResults.push({
      type: 'property',
      key: 'org.gradle.java.home',
      value: jdkHome,
    });

    return config;
  });
};
