// Microsoft Graph OAuth via MSAL. Requires an app registration in Azure AD /
// Microsoft Entra (Azure Portal -> App registrations) with a redirect URI
// matching your app's bundle/package id, and the `Calendars.Read` delegated
// permission granted.
//
// Fill in `clientId` and `authority` (tenant or 'common') below before use.

import PublicClientApplication, { MSALConfiguration, MSALAccount } from 'react-native-msal';

const config: MSALConfiguration = {
  auth: {
    clientId: 'TODO-your-azure-app-client-id',
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

export async function signIn(): Promise<{ accessToken: string; account: MSALAccount } | null> {
  await ensureInit();
  const result = await pca.acquireToken({ scopes: ['Calendars.Read'] });
  if (!result) return null;
  // Store result.account.identifier for silent re-acquisition; store that
  // reference (not the raw token) in calendar_sources.auth_token_ref — MSAL's
  // own secure cache holds the actual token.
  return { accessToken: result.accessToken, account: result.account };
}

export async function acquireTokenSilent(): Promise<string | null> {
  await ensureInit();
  const accounts = await pca.getAccounts();
  if (!accounts.length) return null;
  const result = await pca.acquireTokenSilent({ scopes: ['Calendars.Read'], account: accounts[0] });
  return result?.accessToken ?? null;
}

export async function signOut(): Promise<void> {
  await ensureInit();
  const accounts = await pca.getAccounts();
  for (const account of accounts) {
    await pca.signOut({ account });
  }
}
