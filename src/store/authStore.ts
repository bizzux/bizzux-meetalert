import { create } from 'zustand';
import { auth, FirebaseAuthTypes } from '../firebase';
import { setCurrentUserId, claimLegacyDataIfNeeded } from '../db/database';
import { useSettingsStore } from './settingsStore';
import { useTrialStore } from './trialStore';
import { usePricingStore } from './pricingStore';
import { GoogleSignin } from '../services/googleSignIn';
import { syncUserProfile } from '../services/cloudProfile';

interface AuthState {
  user: FirebaseAuthTypes.User | null;
  /** True until Firebase has restored (or confirmed there's no) persisted
   * session - RootNavigator shows a loading screen instead of flashing the
   * sign-in screen while this is true. */
  initializing: boolean;
  /** Set by sendPhoneOtp(), consumed by confirmPhoneOtp() - the pending
   * verification for whichever phone number was last submitted. */
  phoneConfirmation: FirebaseAuthTypes.ConfirmationResult | null;
  /** Last auth error, in plain language - cleared on every new attempt. */
  error: string | null;

  /** Call once (from App.tsx) to start listening for sign-in/sign-out.
   * Returns the unsubscribe function. */
  init: () => () => void;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string, displayName?: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  sendPhoneOtp: (phoneNumber: string) => Promise<void>;
  confirmPhoneOtp: (code: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  initializing: true,
  phoneConfirmation: null,
  error: null,

  init: () => {
    // Re-created every time a different account signs in - trialStore has
    // its own uid-scoped Firestore listener, so this just needs to tear the
    // previous one down before (or instead of) starting the next.
    let unsubscribeTrial: (() => void) | null = null;
    // Same idea, for pricingStore's config/pricing listener - config/pricing
    // isn't scoped to a uid (it's one shared doc), but firestore.rules still
    // requires someone signed in to read it at all, so this starts/stops on
    // the same sign-in/sign-out edges as the trial listener rather than
    // staying open across a sign-out.
    let unsubscribePricing: (() => void) | null = null;

    const unsubscribe = auth().onAuthStateChanged((user) => {
      unsubscribeTrial?.();
      unsubscribeTrial = null;
      unsubscribePricing?.();
      unsubscribePricing = null;

      if (user) {
        // Scope every local SQLite read/write to this account, carry over
        // any pre-account data the very first time someone signs in, then
        // load this account's own saved settings (theme, home view, etc.)
        setCurrentUserId(user.uid);
        claimLegacyDataIfNeeded(user.uid);
        useSettingsStore.getState().hydrate();
        // Best-effort - never awaited here, never allowed to block sign-in
        // (see cloudProfile.ts's own internal try/catch). Feeds the admin
        // app's user list; does not affect anything on this device.
        syncUserProfile(user);
        // Starts the live trialEndsAt listener RootNavigator gates on - see
        // trialStore.ts / cloudProfile.ts's subscribeTrialStatus().
        unsubscribeTrial = useTrialStore.getState().init(user.uid);
        // Starts the live config/pricing listener PaywallScreen reads via
        // pricingStore.ts, so the prices it shows can never go stale while
        // someone's signed in.
        unsubscribePricing = usePricingStore.getState().init();
      } else {
        setCurrentUserId(null);
        useSettingsStore.getState().resetToDefaults();
        useTrialStore.getState().reset();
        usePricingStore.getState().reset();
      }
      set({ user, initializing: false });
    });
    return () => {
      unsubscribeTrial?.();
      unsubscribePricing?.();
      unsubscribe();
    };
  },

  signInWithEmail: async (email, password) => {
    set({ error: null });
    try {
      await auth().signInWithEmailAndPassword(email.trim(), password);
    } catch (err: any) {
      set({ error: friendlyAuthError(err) });
      throw err;
    }
  },

  signUpWithEmail: async (email, password, displayName) => {
    set({ error: null });
    try {
      const credential = await auth().createUserWithEmailAndPassword(email.trim(), password);
      if (displayName?.trim()) {
        await credential.user.updateProfile({ displayName: displayName.trim() });
      }
    } catch (err: any) {
      set({ error: friendlyAuthError(err) });
      throw err;
    }
  },

  signInWithGoogle: async () => {
    set({ error: null });
    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const response = await GoogleSignin.signIn();
      if (response.type === 'cancelled') return; // user closed the picker - not an error
      const idToken = response.data.idToken;
      if (!idToken) throw new Error('Google did not return an ID token.');
      // credential(idToken) alone hits a known react-native-firebase 25.x bug
      // on Android: with no access token, the credential it builds carries an
      // empty-string secret, which the native SDK rejects with "accessToken
      // cannot be empty" (invertase/react-native-firebase#9081). Fetching the
      // access token separately and passing both avoids it.
      const { accessToken } = await GoogleSignin.getTokens();
      const credential = auth.GoogleAuthProvider.credential(idToken, accessToken);
      await auth().signInWithCredential(credential);
    } catch (err: any) {
      // Temporary: the friendly message below hides exactly which step
      // failed and why. Logging the raw code/message here so the real
      // cause shows up in the Metro terminal - safe to remove once Google
      // sign-in is confirmed working end to end.
      console.warn('[BizzMinder] Google sign-in failed', { code: err?.code, message: err?.message, err });
      // NOT friendlyAuthError() - that function's auth/invalid-credential case
      // says "Incorrect email or password", which is actively wrong here: this
      // path never shows an email or password field at all. auth/invalid-
      // credential from signInWithCredential (above) almost always means the
      // Google ID token Firebase received doesn't check out - most commonly a
      // signing-certificate (SHA-1) mismatch between this specific build and
      // whatever's registered for Google Sign-In (see googleSignIn.ts's own
      // comment - only the debug keystore's SHA-1 is registered today, so a
      // release/preview build signed with a different keystore hits exactly
      // this). See the console.warn above for the real err.code during setup.
      set({ error: friendlyGoogleSignInError(err) });
      throw err;
    }
  },

  sendPhoneOtp: async (phoneNumber) => {
    set({ error: null });
    try {
      const confirmation = await auth().signInWithPhoneNumber(phoneNumber.trim());
      set({ phoneConfirmation: confirmation });
    } catch (err: any) {
      set({ error: friendlyAuthError(err) });
      throw err;
    }
  },

  confirmPhoneOtp: async (code) => {
    const confirmation = get().phoneConfirmation;
    if (!confirmation) {
      set({ error: 'That code expired. Request a new one.' });
      throw new Error('No pending phone confirmation');
    }
    set({ error: null });
    try {
      await confirmation.confirm(code.trim());
      set({ phoneConfirmation: null });
    } catch (err: any) {
      set({ error: friendlyAuthError(err) });
      throw err;
    }
  },

  resetPassword: async (email) => {
    set({ error: null });
    try {
      await auth().sendPasswordResetEmail(email.trim());
    } catch (err: any) {
      set({ error: friendlyAuthError(err) });
      throw err;
    }
  },

  signOut: async () => {
    await auth().signOut();
    // onAuthStateChanged above handles clearing currentUserId + settings.
  },

  clearError: () => set({ error: null }),
}));

/** Same idea as friendlyAuthError() below, but for signInWithGoogle()
 * specifically - that flow never shows an email or password field, so
 * friendlyAuthError's "Incorrect email or password" (its case for
 * auth/invalid-credential, which is also the most common code Google
 * sign-in fails with - see this function's one caller for why) would be
 * actively misleading here, not just generic. Codes that genuinely are
 * about something the person can retry (network, Play Services) still get
 * their own specific message; anything else - most often a signing-
 * certificate mismatch on this build - gets one honest, non-email/password
 * message instead of guessing at a cause in the UI. */
function friendlyGoogleSignInError(err: any): string {
  const code: string = err?.code ?? '';
  switch (code) {
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a bit and try again.';
    case 'auth/account-exists-with-different-credential':
      return 'An account already exists with that email, signed in a different way. Try email sign-in instead.';
    default:
      return "Google sign-in didn't go through. Please try again, or sign in with email instead.";
  }
}

/** Firebase's error codes translated to what Thilak's screens actually show
 * - the raw "auth/invalid-credential" strings aren't fit for a UI. */
function friendlyAuthError(err: any): string {
  const code: string = err?.code ?? '';
  switch (code) {
    case 'auth/invalid-email':
      return 'That email address looks invalid.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Incorrect email or password.';
    case 'auth/email-already-in-use':
      return 'An account already exists with that email. Sign in instead.';
    case 'auth/weak-password':
      return 'Password should be at least 6 characters.';
    case 'auth/invalid-phone-number':
      return 'That phone number looks invalid. Include the country code, e.g. +91XXXXXXXXXX.';
    case 'auth/invalid-verification-code':
      return 'That code is incorrect. Check and try again.';
    case 'auth/code-expired':
      return 'That code expired. Request a new one.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a bit and try again.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.';
    default:
      // Never fall back to err?.message here - an unmapped Firebase Auth
      // code means this switch doesn't recognize it yet, not that
      // err.message is safe to show: it can be a raw internal string (e.g.
      // from the Google sign-in path above) rather than anything written
      // for a user to read.
      return 'Something went wrong. Please try again.';
  }
}
