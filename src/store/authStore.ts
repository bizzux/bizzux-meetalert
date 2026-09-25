import { create } from 'zustand';
import { auth, FirebaseAuthTypes } from '../firebase';
import { setCurrentUserId, claimLegacyDataIfNeeded } from '../db/database';
import { useSettingsStore } from './settingsStore';

interface AuthState {
  user: FirebaseAuthTypes.User | null;
  /** True until Firebase has restored (or confirmed there's no) persisted
   * session — RootNavigator shows a loading screen instead of flashing the
   * sign-in screen while this is true. */
  initializing: boolean;
  /** Set by sendPhoneOtp(), consumed by confirmPhoneOtp() — the pending
   * verification for whichever phone number was last submitted. */
  phoneConfirmation: FirebaseAuthTypes.ConfirmationResult | null;
  /** Last auth error, in plain language — cleared on every new attempt. */
  error: string | null;

  /** Call once (from App.tsx) to start listening for sign-in/sign-out.
   * Returns the unsubscribe function. */
  init: () => () => void;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string, displayName?: string) => Promise<void>;
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
    const unsubscribe = auth().onAuthStateChanged((user) => {
      if (user) {
        // Scope every local SQLite read/write to this account, carry over
        // any pre-account data the very first time someone signs in, then
        // load this account's own saved settings (theme, home view, etc.)
        setCurrentUserId(user.uid);
        claimLegacyDataIfNeeded(user.uid);
        useSettingsStore.getState().hydrate();
      } else {
        setCurrentUserId(null);
        useSettingsStore.getState().resetToDefaults();
      }
      set({ user, initializing: false });
    });
    return unsubscribe;
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
      set({ error: 'That code expired — request a new one.' });
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

/** Firebase's error codes translated to what Thilak's screens actually show
 * — the raw "auth/invalid-credential" strings aren't fit for a UI. */
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
      return 'An account already exists with that email — sign in instead.';
    case 'auth/weak-password':
      return 'Password should be at least 6 characters.';
    case 'auth/invalid-phone-number':
      return 'That phone number looks invalid — include the country code, e.g. +91XXXXXXXXXX.';
    case 'auth/invalid-verification-code':
      return 'That code is incorrect. Check and try again.';
    case 'auth/code-expired':
      return 'That code expired — request a new one.';
    case 'auth/too-many-requests':
      return 'Too many attempts — please wait a bit and try again.';
    case 'auth/network-request-failed':
      return 'Network error — check your connection and try again.';
    default:
      return err?.message ?? 'Something went wrong. Please try again.';
  }
}
