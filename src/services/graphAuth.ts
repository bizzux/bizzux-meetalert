// Microsoft Graph OAuth via MSAL. Requires an app registration in Azure AD /
// Microsoft Entra (Azure Portal -> App registrations) with a redirect URI
// matching your app's package id, and the `Calendars.Read` delegated
// permission granted.
//
// Fill in `clientId` below before Connect Microsoft account in Settings
// will do anything — with the placeholder value, signIn() fails cleanly
// (caught below) rather than authenticating.

import PublicClientApplication, { MSALConfiguration, MSALAccount } from 'react-native-msal';

const CLIENT_ID = 'TODO-your-azure-app-client-id';

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
  // reference (not the raw token) in calendar_sources.auth_token_ref — MSAL's
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

/** The currently signed-in Microsoft account, if any — used by SettingsScreen
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
