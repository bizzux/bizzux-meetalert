// Google Sign-In / Calendar OAuth via @react-native-google-signin/google-signin
// — Google's native sign-in flow (Play Services / Credential Manager), not a
// manual browser-redirect OAuth flow. This library is already installed and
// registered as a native Expo config plugin in app.json.
//
// Requires TWO OAuth clients in the same Google Cloud project
// (console.cloud.google.com -> APIs & Services -> Credentials):
//  - Android: package name `com.bizzux.bizzminder` + your debug/release
//    keystore's SHA-1 fingerprint. Google Play Services picks this up
//    automatically from the signed APK — it is never referenced directly in
//    this file.
//  - Web application: no redirect URIs or JavaScript origins needed — leave
//    both empty when creating it. Its Client ID (NOT the client secret; a
//    mobile app can't store a secret securely, and this library never asks
//    for one) goes in WEB_CLIENT_ID below.
//
// Fill in WEB_CLIENT_ID below before "Connect Google" in Settings will do
// anything — with the placeholder value, signIn() fails cleanly (caught by
// the caller) rather than opening a broken auth screen.

import {
  GoogleSignin,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import { getSetting, setSetting } from '../db/database';

// "BizzMinder Web (backend audience)" client in the bizzux-meet project —
// no redirect URIs registered on it; it's only used as a token audience.
const WEB_CLIENT_ID = '349099483713-stu8njgm2c2vsi8eqiuutpt7ijclcrh2.apps.googleusercontent.com';

const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

let configured = false;

function ensureConfigured(): void {
  if (configured) return;
  GoogleSignin.configure({
    webClientId: WEB_CLIENT_ID,
    scopes: SCOPES,
  });
  configured = true;
}

export function isConfigured(): boolean {
  return WEB_CLIENT_ID !== 'TODO-your-google-web-client-id.apps.googleusercontent.com';
}

export function isSignedIn(): boolean {
  return !!getSetting<string | null>('googleSignedIn', null);
}

export function getSignedInEmail(): string | null {
  return getSetting<string | null>('googleEmail', null);
}

export async function signIn(): Promise<boolean> {
  if (!isConfigured()) {
    throw new Error(
      'Google sign-in needs a Web application OAuth client ID set in src/services/googleAuth.ts first.'
    );
  }
  ensureConfigured();

  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) return false; // user cancelled the sign-in sheet

    setSetting('googleSignedIn', 'true');
    setSetting('googleEmail', response.data.user.email ?? null);
    return true;
  } catch (err) {
    if (isErrorWithCode(err) && err.code === statusCodes.SIGN_IN_CANCELLED) return false;
    throw err;
  }
}

// No manual token caching here — GoogleSignin.getTokens() refreshes the
// access token transparently via Play Services when the cached one has
// expired, so every call is safe to await directly.
export async function getAccessToken(): Promise<string | null> {
  if (!isConfigured()) return null;
  ensureConfigured();

  try {
    if (!GoogleSignin.hasPreviousSignIn()) return null;
    const tokens = await GoogleSignin.getTokens();
    return tokens.accessToken;
  } catch {
    return null;
  }
}

export async function signOut(): Promise<void> {
  ensureConfigured();
  try {
    await GoogleSignin.signOut();
  } catch {
    // token may already be invalid — clearing local state below still counts as signed out
  }
  setSetting('googleSignedIn', null);
  setSetting('googleEmail', null);
}
