// Microsoft Graph OAuth via MSAL. Requires an app registration in Azure AD /
// Microsoft Entra (Azure Portal -> App registrations) with a redirect URI
// matching your app's package id, and the `Calendars.Read` delegated
// permission granted.
//
// Fill in `clientId` below before Connect Microsoft account in Settings
// will do anything - with the placeholder value, signIn() fails cleanly
// (caught below) rather than authenticating.

import PublicClientApplication, { MSALConfiguration, MSALAccount } from 'react-native-msal';

// Bizzux app registration in Entra ID ("BizzMinder"), supported account
// types = Any Entra ID Tenant + Personal Microsoft accounts - so this stays
// on the multi-tenant /common authority rather than a specific tenant ID.
const CLIENT_ID = '0e6cca26-3a8c-4f69-ab73-28fbbdfc4964';

const config: MSALConfiguration = {
  auth: {
    clientId: CLIENT_ID,
    authority: 'https://login.microsoftonline.com/common',
  },
};

const pca = new PublicClientApplication(config);
let initialized = false;

async function ensureInit(): Promise<void> {
  if (!initialized) {
    await pca.init();
    initialized = true;
  }
}

export function isConfigured(): boolean {
  return CLIENT_ID !== 'TODO-your-azure-app-client-id';
}

export async function signIn(): Promise<{ accessToken: string; account: MSALAccount } | null> {
  if (!isConfigured()) {
    throw new Error(
      'Microsoft sign-in needs an Azure app registration client ID set in src/services/graphAuth.ts first.'
    );
  }
  await ensureInit();
  const result = await pca.acquireToken({ scopes: ['Calendars.Read'] });
  if (!result) return null;
  // Store result.account.identifier for silent re-acquisition; store that
  // reference (not the raw token) in calendar_sources.auth_token_ref - MSAL's
  // own secure cache holds the actual token.
  return { accessToken: result.accessToken, account: result.account };
}

export async function acquireTokenSilent(): Promise<string | null> {
  if (!isConfigured()) return null;
  try {
    await ensureInit();
    const accounts = await pca.getAccounts();
    if (!accounts.length) return null;
    const result = await pca.acquireTokenSilent({ scopes: ['Calendars.Read'], account: accounts[0] });
    return result?.accessToken ?? null;
  } catch {
    return null;
  }
}

/** The currently signed-in Microsoft account, if any - used by SettingsScreen
 * to show "Connected as name@example.com" instead of a bare on/off toggle. */
export async function getSignedInAccount(): Promise<MSALAccount | null> {
  if (!isConfigured()) return null;
  try {
    await ensureInit();
    const accounts = await pca.getAccounts();
    return accounts[0] ?? null;
  } catch {
    return null;
  }
}

export async function signOut(): Promise<void> {
  if (!isConfigured()) return;
  await ensureInit();
  const accounts = await pca.getAccounts();
  for (const account of accounts) {
    await pca.signOut({ account });
  }
}

/** True when `err` (from signIn() above) is simply the user backing out of
 * the Microsoft login screen rather than a real failure - MSAL surfaces
 * this as a raw error whose code/message is a short internal token like
 * "userCancel" (iOS) or "USER_CANCELLED" (Android), never as a normal
 * resolved value, so it has to be told apart from a genuine connection
 * problem here rather than in SettingsScreen. Callers should treat a
 * cancellation as "nothing to report" - same as Google's own signIn() in
 * googleAuth.ts, which quietly returns false instead of throwing. */
export function isUserCancelled(err: any): boolean {
  const token = `${err?.code ?? ''} ${err?.message ?? ''}`.toLowerCase();
  return token.includes('cancel');
}

/** A plain-language message for a genuine (non-cancelled) Microsoft connect
 * failure - never the raw MSAL error code/message, which reads like
 * internal debugging text (e.g. "userCancel", "invalid_grant") rather than
 * anything a user should see. */
export function friendlyConnectError(err: any): string {
  if (!isConfigured()) {
    return "Microsoft sign-in isn't set up yet. Please try again later.";
  }
  const token = `${err?.code ?? ''} ${err?.message ?? ''}`.toLowerCase();
  if (token.includes('network') || token.includes('internet') || token.includes('timeout')) {
    return "Couldn't reach Microsoft. Check your internet connection and try again.";
  }
  return "Couldn't connect your Microsoft account. Please try again.";
}
