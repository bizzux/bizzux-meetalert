// Google Sign-In / Calendar OAuth via expo-auth-session (PKCE, no client
// secret needed — safe to ship in a mobile app). Requires a Google Cloud
// OAuth client ID (console.cloud.google.com -> APIs & Services ->
// Credentials -> Create OAuth client ID -> Android, using this app's
// package name `com.bizzux.meetingreminder` and your release/debug
// keystore's SHA-1 fingerprint), plus the Google Calendar API enabled on
// that project.
//
// Fill in `CLIENT_ID` below before "Connect Google" in Settings will do
// anything — with the placeholder value, signIn() fails cleanly (caught by
// the caller) rather than opening a broken auth screen.

import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { getSetting, setSetting } from '../db/database';

WebBrowser.maybeCompleteAuthSession();

const CLIENT_ID = 'TODO-your-google-oauth-client-id.apps.googleusercontent.com';

const discovery = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
};

const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.readonly'];

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;

export function isConfigured(): boolean {
  return CLIENT_ID !== 'TODO-your-google-oauth-client-id.apps.googleusercontent.com';
}

export function isSignedIn(): boolean {
  return !!getSetting<string | null>('googleRefreshToken', null);
}

export function getSignedInEmail(): string | null {
  return getSetting<string | null>('googleEmail', null);
}

export async function signIn(): Promise<boolean> {
  if (!isConfigured()) {
    throw new Error('Google sign-in needs a Google Cloud OAuth client ID set in src/services/googleAuth.ts first.');
  }

  const redirectUri = AuthSession.makeRedirectUri({ scheme: 'meetalert' });
  const request = new AuthSession.AuthRequest({
    clientId: CLIENT_ID,
    scopes: SCOPES,
    redirectUri,
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
  });

  const result = await request.promptAsync(discovery);
  if (result.type !== 'success' || !result.params.code) return false;

  const tokenResult = await AuthSession.exchangeCodeAsync(
    {
      clientId: CLIENT_ID,
      code: result.params.code,
      redirectUri,
      extraParams: { code_verifier: request.codeVerifier ?? '' },
    },
    discovery
  );

  cachedToken = {
    accessToken: tokenResult.accessToken,
    expiresAt: Date.now() + (tokenResult.expiresIn ?? 3600) * 1000,
  };
  setSetting('googleRefreshToken', tokenResult.refreshToken ?? null);

  // Best-effort: fetch the signed-in email for a friendlier "Connected as…"
  // label in Settings; sign-in still succeeds if this call fails.
  try {
    const info = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenResult.accessToken}` },
    }).then((r) => r.json());
    setSetting('googleEmail', info?.email ?? null);
  } catch {
    // non-fatal
  }

  return true;
}

export async function getAccessToken(): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.accessToken;

  const refreshToken = getSetting<string | null>('googleRefreshToken', null);
  if (!refreshToken) return null;

  try {
    const refreshed = await AuthSession.refreshAsync({ clientId: CLIENT_ID, refreshToken }, discovery);
    cachedToken = {
      accessToken: refreshed.accessToken,
      expiresAt: Date.now() + (refreshed.expiresIn ?? 3600) * 1000,
    };
    if (refreshed.refreshToken) setSetting('googleRefreshToken', refreshed.refreshToken);
    return cachedToken.accessToken;
  } catch {
    return null;
  }
}

export async function signOut(): Promise<void> {
  const refreshToken = getSetting<string | null>('googleRefreshToken', null);
  if (refreshToken) {
    try {
      await AuthSession.revokeAsync({ clientId: CLIENT_ID, token: refreshToken }, discovery);
    } catch {
      // token may already be invalid — clearing local state below still counts as signed out
    }
  }
  cachedToken = null;
  setSetting('googleRefreshToken', null);
  setSetting('googleEmail', null);
}
