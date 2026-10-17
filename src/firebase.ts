// Single place the rest of the app imports Firebase Auth/Functions from.
//
// @react-native-firebase/auth and .../functions both auto-initialize from
// the native config files Expo bundles at build time -
// android/app/google-services.json and ios/GoogleService-Info.plist (wired
// via app.json's googleServicesFile entries, see RUN.md for how to obtain
// them from the Firebase console). There's no JS-side config object to fill
// in here; if those native files are missing, every call below throws at
// runtime with a clear "No Firebase App" error rather than failing silently.
//
// functions() calls the project's default Cloud Functions region
// (us-central1) - functions/index.js deploys there too, deliberately kept
// at the default rather than pinning a region here, since the namespaced
// (v25.x) client API's region-selection call wasn't one we could verify
// without a live build to test against. Revisit together if India latency
// ever turns out to matter (functions/index.js's own comment flags this).
import auth from '@react-native-firebase/auth';
import functions from '@react-native-firebase/functions';

export { auth };
export const callable = <Req = unknown, Res = unknown>(name: string) =>
  functions().httpsCallable<Req, Res>(name);
export type { FirebaseAuthTypes } from '@react-native-firebase/auth';
