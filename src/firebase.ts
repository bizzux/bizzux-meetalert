// Single place the rest of the app imports Firebase Auth from.
//
// @react-native-firebase/auth auto-initializes from the native config
// files Expo bundles at build time — android/app/google-services.json and
// ios/GoogleService-Info.plist (wired via app.json's googleServicesFile
// entries, see RUN.md for how to obtain them from the Firebase console).
// There's no JS-side config object to fill in here; if those native files
// are missing, every call below throws at runtime with a clear
// "No Firebase App" error rather than failing silently.
import auth from '@react-native-firebase/auth';

export { auth };
export type { FirebaseAuthTypes } from '@react-native-firebase/auth';
