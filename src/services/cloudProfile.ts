// Lightweight, best-effort sync of account + usage METADATA to Firestore -
// the data source for the separate BizzMinder Admin web app (see RUN.md /
// the project's admin-app notes for the wider plan). Deliberately NOT a
// general-purpose backend: this file only ever writes a small per-user
// summary record (profile basics, a last-active timestamp, and a few usage
// counters). Actual meeting content - titles, times, notes, agendas - never
// leaves the phone; that stays in local SQLite exactly as it always has
// (see db/database.ts). The one field this deliberately never writes from
// here is `trialEndsAt` - it's set server-side only (see below) - which is
// why every write below is scoped to specific fields (never a bare
// top-level `set()` that could clobber it).
//
// Every call here is wrapped in try/catch and never rethrows: a network
// hiccup or Firestore being briefly unavailable must never block or break
// the feature it's attached to (signing in, confirming a meeting, saving a
// new one) - same defensive philosophy as reminderEngine.ts.
import firestore, { FirebaseFirestoreTypes } from '@react-native-firebase/firestore';
import { AppState, AppStateStatus, Platform } from 'react-native';
import Constants from 'expo-constants';
import { FirebaseAuthTypes } from '../firebase';
import { restoreLastKnownUserId } from '../db/database';

function userDoc(uid: string) {
  return firestore().collection('users').doc(uid);
}

/** Called once from authStore's onAuthStateChanged, right after a sign-in
 * resolves. Creates the admin-facing profile record on this account's very
 * first sign-in, or just refreshes the basics (email, name, last active) on
 * every later sign-in.
 *
 * Deliberately does NOT include `trialEndsAt` in the create payload at all -
 * not even as `null`. Leaving the key out entirely is what satisfies
 * firestore.rules' leavesTrialEndsUnchanged() check for a brand-new doc
 * (writing `trialEndsAt: null` explicitly used to fail that check and would
 * have silently broken every first-time regular-user sign-up - this never
 * surfaced before because the only accounts exercised so far were admin
 * accounts, which bypass the check via isAdmin()). The functions/
 * onUserProfileCreated Cloud Function stamps the real trial end date (or
 * leaves it unset, if trials are off - see that function's own comment) a
 * moment later, server-side via the Admin SDK - see functions/index.js.
 * Never touches trialEndsAt or counts on an existing doc either way. */
export async function syncUserProfile(user: FirebaseAuthTypes.User): Promise<void> {
  try {
    const ref = userDoc(user.uid);
    const snap = await ref.get();

    const basics = {
      email: user.email ?? null,
      displayName: user.displayName ?? null,
      platform: Platform.OS,
      appVersion: Constants.expoConfig?.version ?? null,
      lastActiveAt: firestore.FieldValue.serverTimestamp(),
    };

    if (!snap.exists) {
      await ref.set({
        ...basics,
        createdAt: firestore.FieldValue.serverTimestamp(),
        counts: { meetingsCreated: 0, remindersConfirmed: 0, missed: 0 },
      });
    } else {
      // A handful of docs in Firestore predate createdAt being captured at
      // all here (created by hand from BizzMinder Admin, or by an older
      // build of this function) - see BizzMinderAdmin's useUsers.ts for why
      // that used to make those accounts silently vanish from its Users
      // list entirely, with no error shown anywhere. Backfilling it here,
      // once, self-heals any such doc the next time its owner happens to
      // sign in. Never overwrites a createdAt that's already there, so a
      // real account's actual signup date is never touched - this only
      // ever fills in a gap, never corrects one.
      const patch: Record<string, unknown> = { ...basics };
      if (!snap.data()?.createdAt) {
        patch.createdAt = firestore.FieldValue.serverTimestamp();
      }
      await ref.set(patch, { merge: true });
    }
  } catch (err) {
    console.warn('[BizzMinder] cloud profile sync failed', err);
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Fallback-only defaults - used only if config/trial (below) doesn't exist
// yet or the listener hasn't delivered its first snapshot. Matches
// functions/index.js's own readTrialConfig() defaults exactly, so this
// agrees with what the server would use. The live config/trial doc -
// admin-only to write, but now readable by any signed-in user, see
// firestore.rules' own comment on config/{id} - always overrides these the
// moment its snapshot arrives.
const DEFAULT_TRIAL_LENGTH_DAYS = 30;
const DEFAULT_TRIAL_CONFIG: TrialConfig = { enabled: true, lengthDays: DEFAULT_TRIAL_LENGTH_DAYS };

/** BizzMinder Admin's Settings tab writes this (config/trial); see
 * functions/index.js's readTrialConfig for the authoritative read of the
 * same doc, server-side. The mobile app reads it too now, ONLY to derive a
 * stand-in trial end date for an account that hasn't received a real,
 * server-stamped trialEndsAt yet - never to grant or extend a real one
 * itself (see toTrialStatus below). */
interface TrialConfig {
  /** false -> no trial clock at all for an account without a real stamp;
   * treated as "not expired", same as functions/index.js's own comment on
   * this flag. Never retroactively un-expires an account that already has
   * a real, server-stamped trialEndsAt in the past. */
  enabled: boolean;
  lengthDays: number;
}

function toTrialConfig(data: FirebaseFirestoreTypes.DocumentData | undefined): TrialConfig {
  const enabled = data?.enabled !== false; // default true (today's behavior) when unset - matches readTrialConfig
  const lengthDays =
    typeof data?.lengthDays === 'number' && data.lengthDays > 0 ? data.lengthDays : DEFAULT_TRIAL_LENGTH_DAYS;
  return { enabled, lengthDays };
}

/** The shape of the trial/paywall status derived from the user's own
 * Firestore doc - see trialStore.ts, which is the only caller. */
export interface TrialStatus {
  /** The account's trial end date. Comes straight from the server-stamped
   * trialEndsAt field whenever that's present; when it isn't (no Cloud
   * Function deploy yet, or a doc that predates it), this is derived
   * instead as createdAt + BizzMinder Admin's current config/trial
   * lengthDays, so every signed-in user gets a working trial based on
   * their own signup day regardless of whether that deploy has ever
   * happened, and it always matches whatever length an admin has most
   * recently set. Null when config/trial has enabled:false, or for the
   * rare doc that has neither a stamped trialEndsAt nor a createdAt at
   * all. This is a strict, signup-day-based computation - an account that
   * signed up more than the configured length ago and never got a real
   * stamp will show as expired immediately, with no grace window. */
  trialEndsAt: Date | null;
  expired: boolean;
  /** True once this account has ever completed a Razorpay payment - set
   * from lastPaymentPlan, which functions/index.js's verifyRazorpayPayment
   * stamps on a verified payment and never clears afterward. Used only to
   * hide the free-trial countdown banner (TrialBanner.tsx) for someone
   * who's already paid, regardless of how much runway their current paid
   * term still has left - that's a different, not-yet-built reminder (see
   * RUN.md), not this flag's job. */
  hasPaid: boolean;
  /** This account's own createdAt, so TrialBanner.tsx can work out how
   * long the trial it was actually granted was (trialEndsAt - createdAt)
   * instead of assuming a fixed length - BizzMinder Admin's Settings tab
   * can change the length new signups get at any time, so a hardcoded
   * constant here would make the banner's progress bar wrong for anyone
   * signed up under a different length. Null on the rare doc old enough to
   * predate createdAt being captured at all. */
  createdAt: Date | null;
}

function toTrialStatus(
  data: FirebaseFirestoreTypes.DocumentData | undefined,
  config: TrialConfig,
): TrialStatus {
  const raw = data?.trialEndsAt as FirebaseFirestoreTypes.Timestamp | null | undefined;
  const rawCreatedAt = data?.createdAt as FirebaseFirestoreTypes.Timestamp | null | undefined;
  const createdAt = rawCreatedAt ? rawCreatedAt.toDate() : null;

  // Prefer the real, server-stamped trialEndsAt whenever it's there - that
  // always wins, regardless of what config/trial currently says, same as
  // functions/index.js never retroactively touching an already-granted
  // trial when an admin edits the config afterward. Only fall back to
  // deriving one from this account's own signup day, using BizzMinder
  // Admin's live lengthDays, when the server hasn't stamped a real one yet
  // - and only while config/trial's enabled flag is true; see
  // TrialConfig.enabled's own comment for why "disabled" means "no clock",
  // not "expire everyone".
  const trialEndsAt = raw
    ? raw.toDate()
    : config.enabled && createdAt
      ? new Date(createdAt.getTime() + config.lengthDays * DAY_MS)
      : null;

  return {
    trialEndsAt,
    expired: trialEndsAt !== null && trialEndsAt.getTime() <= Date.now(),
    hasPaid: data?.lastPaymentPlan != null,
    createdAt,
  };
}

/** Live-subscribes to this account's own trialEndsAt field AND BizzMinder
 * Admin's config/trial doc together (read access to both is granted by
 * firestore.rules - the user's own doc to its owner, config/trial to any
 * signed-in user), recomputing and re-emitting the combined TrialStatus
 * whenever either one changes. That second subscription is what lets an
 * admin's lengthDays/enabled edit in BizzMinder Admin's Settings tab
 * immediately update the fallback trial every signed-in user without a
 * real stamp is seeing, with no app restart needed - same as how a change
 * to the user's own doc already did. Used by trialStore.ts to gate
 * navigation the moment a trial lapses, or the moment a payment extends
 * it. Returns a single unsubscribe function that tears down both
 * listeners; the callback fires once as soon as the user's own doc has
 * been seen at least once, then again on every later update to either
 * doc. */
export function subscribeTrialStatus(uid: string, onChange: (status: TrialStatus) => void): () => void {
  let latestUserData: FirebaseFirestoreTypes.DocumentData | undefined;
  let latestConfig: TrialConfig = DEFAULT_TRIAL_CONFIG;
  let haveUserDoc = false;

  const emit = () => {
    if (!haveUserDoc) return; // nothing to show yet - wait for the user doc's first snapshot
    onChange(toTrialStatus(latestUserData, latestConfig));
  };

  const unsubscribeUser = userDoc(uid).onSnapshot(
    (snap) => {
      latestUserData = snap.data();
      haveUserDoc = true;
      emit();
    },
    (err) => {
      // Fail open, not closed - a listener error (offline, permission
      // hiccup) must never itself read as "trial expired" and lock someone
      // out of an app they're rightfully still inside their trial for.
      console.warn('[BizzMinder] trial status listener failed', err);
    },
  );

  const unsubscribeConfig = firestore()
    .collection('config')
    .doc('trial')
    .onSnapshot(
      (snap) => {
        latestConfig = toTrialConfig(snap.data());
        emit();
      },
      (err) => {
        // Fail open to whatever config is already in hand (the default, or
        // the last good snapshot) - same reasoning as the listener above;
        // a permission hiccup on this doc must never itself read as an
        // expired trial either.
        console.warn('[BizzMinder] trial config listener failed', err);
      },
    );

  return () => {
    unsubscribeUser();
    unsubscribeConfig();
  };
}

let lastTouchAt = 0;
// At most once every 5 minutes - AppState fires 'change' on every
// foreground/background flip, and this just needs to be roughly accurate
// for an admin glancing at "last active", not a precise session log.
const TOUCH_MIN_INTERVAL_MS = 5 * 60 * 1000;

async function touchLastActive(): Promise<void> {
  const uid = restoreLastKnownUserId();
  if (!uid) return; // signed out, or nothing to attribute this to yet

  const now = Date.now();
  if (now - lastTouchAt < TOUCH_MIN_INTERVAL_MS) return;
  lastTouchAt = now;

  try {
    await userDoc(uid).set({ lastActiveAt: firestore.FieldValue.serverTimestamp() }, { merge: true });
  } catch (err) {
    console.warn('[BizzMinder] last-active sync failed', err);
  }
}

/** Call once from App.tsx's startup effect. Keeps the admin app's "last
 * active" column honest for long-lived sessions that stay signed in for
 * days without ever triggering a fresh onAuthStateChanged event - without
 * this, "last active" would really mean "last signed in", which is a much
 * less useful signal. Returns an unsubscribe function. */
export function registerActivityTracking(): () => void {
  touchLastActive(); // the launch itself counts as activity
  const onChange = (state: AppStateStatus) => {
    if (state === 'active') touchLastActive();
  };
  const subscription = AppState.addEventListener('change', onChange);
  return () => subscription.remove();
}

export type UsageCounter = 'meetingsCreated' | 'remindersConfirmed' | 'missed';

/** Best-effort increment of one of the admin app's usage counters. Uses
 * dot-notation field paths (`counts.<counter>`) in a merge-set rather than
 * a nested object literal - Firestore only merges a nested object's OWN
 * top-level keys when you hand it a plain object, which would otherwise
 * require writing every counter back on every call just to avoid clobbering
 * the siblings; a dot-path targets exactly one leaf field and upserts the
 * document if it somehow doesn't exist yet. */
export async function incrementUsageCount(counter: UsageCounter, amount = 1): Promise<void> {
  const uid = restoreLastKnownUserId();
  if (!uid) return;

  try {
    await userDoc(uid).set({ [`counts.${counter}`]: firestore.FieldValue.increment(amount) }, { merge: true });
  } catch (err) {
    console.warn('[BizzMinder] usage counter sync failed', err);
  }
}
