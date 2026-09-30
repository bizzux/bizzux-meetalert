// Google Sign-In for app account authentication (Firebase Auth), via
// @react-native-firebase's companion GoogleSignin native module. Not to be
// confused with src/services/googleAuth.ts, which is the separate OAuth
// flow used to *connect a Google Calendar* for syncing meetings — this
// file is purely about signing a person into their BizzMinder account.
//
// configureGoogleSignIn() is called once from App.tsx at startup;
// authStore.signInWithGoogle() then calls GoogleSignin.signIn().
import { GoogleSignin } from '@react-native-google-signin/google-signin';

// The debug keystore's SHA-1 fingerprint (package com.bizzux.bizzminder) is
// registered as an Android OAuth client under the "bizzux-meet" Google Cloud
// project (not this Firebase project, "bizzux-meetly" — Google only allows
// one project to own a given package+SHA-1 combo, see support.google.com/
// firebase/answer/6401008). Google Play Services requires the webClientId
// passed below to live in that SAME project as the resolved Android client,
// so this uses bizzux-meet's web client (the same one src/services/
// googleAuth.ts uses for Calendar) rather than bizzux-meetly's own.
//
// The resulting ID token's audience is therefore this bizzux-meet client,
// not a bizzux-meetly one — that's why bizzux-meet's Android client ID is
// whitelisted under Firebase Authentication -> Sign-in method -> Google ->
// "Whitelist client IDs from external projects" in the bizzux-meetly
// project, so bizzux-meetly's Auth backend still accepts it.
const WEB_CLIENT_ID = '349099483713-stu8njgm2c2vsi8eqiuutpt7ijclcrh2.apps.googleusercontent.com';

export function configureGoogleSignIn() {
  GoogleSignin.configure({ webClientId: WEB_CLIENT_ID, offlineAccess: false });
}

export { GoogleSignin };
