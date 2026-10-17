// Drives the app-wide trial/paywall gate (see navigation/index.tsx). This is
// deliberately a separate store from authStore - auth answers "who is signed
// in", this answers "are they allowed past the front door right now", and
// the two change independently (trialEndsAt can tick over to expired while
// the user stays signed in the whole time, with no auth event at all).
import { create } from 'zustand';
import { subscribeTrialStatus, TrialStatus } from '../services/cloudProfile';

interface TrialState {
  /** null until the first Firestore snapshot arrives (or there's no signed-
   * in user) - RootNavigator treats this the same as "not expired" so it
   * never flashes the paywall before status is actually known. */
  status: TrialStatus | null;
  /** True once the hourly re-check below has fired at least once with a
   * stale-but-still-valid cached status - exists only so a long-foregrounded
   * session (open since before midnight, say) still notices an expiry that
   * happened without any new Firestore write to trigger a fresh snapshot. */
  init: (uid: string) => () => void;
  reset: () => void;
}

let recheckTimer: ReturnType<typeof setInterval> | null = null;

export const useTrialStore = create<TrialState>((set, get) => ({
  status: null,

  init: (uid: string) => {
    const unsubscribeSnapshot = subscribeTrialStatus(uid, (status) => set({ status }));

    // Firestore only pushes a new snapshot when the document changes - if
    // nobody touches it, a session left open across the trial's expiry
    // moment would otherwise keep showing the last (still "active") status
    // indefinitely. Re-derive `expired` from the wall clock every few
    // minutes against whatever trialEndsAt is already cached, no network
    // call needed.
    if (recheckTimer) clearInterval(recheckTimer);
    recheckTimer = setInterval(() => {
      const current = get().status;
      if (!current?.trialEndsAt) return;
      const expired = current.trialEndsAt.getTime() <= Date.now();
      if (expired !== current.expired) set({ status: { ...current, expired } });
    }, 2 * 60 * 1000);

    return () => {
      unsubscribeSnapshot();
      if (recheckTimer) {
        clearInterval(recheckTimer);
        recheckTimer = null;
      }
    };
  },

  reset: () => {
    if (recheckTimer) {
      clearInterval(recheckTimer);
      recheckTimer = null;
    }
    set({ status: null });
  },
}));

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days left until `date`, rounded up and floored at 0 - shared by
 * TrialBanner.tsx (the Home-screen countdown) and PaywallScreen.tsx (the
 * "N days left" hero title and the "unlocks in N days" caption under a
 * disabled Subscribe button), so the two can never show different numbers
 * for the same trialEndsAt. */
export function daysUntil(date: Date): number {
  return Math.max(0, Math.ceil((date.getTime() - Date.now()) / DAY_MS));
}
