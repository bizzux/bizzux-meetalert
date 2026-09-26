// Google Sign-In for app account authentication (Firebase Auth), via
// @react-native-firebase's companion GoogleSignin native module. Not to be
// confused with src/services/googleAuth.ts, which is the separate OAuth
// flow used to *connect a Google Calendar* for syncing meetings — this
// file is purely about signing a person into their Meetera account.
//
// configureGoogleSignIn() is called once from App.tsx at startup;
// authStore.signInWithGoogle() then calls GoogleSignin.signIn().
import { GoogleSignin } from '@react-native-google-signin/google-signin';

// The "Web client" OAuth ID Firebase auto-creates for this project (visible
// in google-services.json under oauth_client, client_type: 3). GoogleSignin
// needs this so the ID token it returns is one Firebase's GoogleAuthProvider
// will accept — it's a public client identifier, not a secret, so it's fine
// to ship in the app.
const WEB_CLIENT_ID = '947465327304-ottvlu0sbo6e1rn3gd8db8kqcftmbda0.apps.googleusercontent.com';

export function configureGoogleSignIn() {
  GoogleSignin.configure({ webClientId: WEB_CLIENT_ID, offlineAccess: false });
}

export { GoogleSignin };
