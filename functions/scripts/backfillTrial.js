// One-time maintenance script - NOT deployed with functions/ (nothing in
// firebase.json points at this scripts/ folder, and it's never invoked by
// the app or by any Cloud Function). Run it once, locally, with:
//
//   node scripts/backfillTrial.js
//
// from inside functions/ (it reuses that folder's own firebase-admin
// dependency rather than needing a separate package.json).
//
// Why this exists: onUserProfileCreated (see ../index.js) only fires on
// Firestore's onCreate event - it stamps trialEndsAt the moment a brand
// new users/{uid} doc is created, but it has no way to reach back and
// stamp a doc that already existed before this trial system did (or
// before functions were first deployed). Every account signed up before
// today is stuck with no trialEndsAt at all, which both the paywall gate
// and the Home screen's TrialBanner treat as "not expired yet" (see
// cloudProfile.ts's own comment on why that's the safe default) - so
// those accounts silently never see either one. This script is the
// one-time fix: it finds every users/{uid} doc missing trialEndsAt and
// gives it a fresh trial starting now, using whatever config/trial is
// actually set to (see readTrialConfig() below) - the same admin-editable
// enabled/lengthDays BizzMinder Admin's Settings tab controls, not a
// hardcoded length. If trials are currently turned off, this does nothing
// and says so - that mirrors onUserProfileCreated's own behavior for a
// brand-new signup under the same config, rather than giving every
// existing account a trial the admin has since disabled.
//
// Unlike onUserProfileCreated (a Cloud Function, which needs the Blaze
// plan and a deploy before it runs at all - see RUN.md 5b), this script
// only needs Firestore access through the Admin SDK, which works on any
// plan. It can be run right now, independent of whether Cloud Functions
// have been deployed yet - it just won't cover any FUTURE signup, which
// still needs that deploy.
//
// Setup, once:
//   1. Firebase Console → bizzux-meetly → Project settings (gear icon) →
//      Service accounts tab → "Generate new private key". That downloads
//      a JSON file.
//   2. Save it as functions/scripts/serviceAccountKey.json - .gitignore
//      already excludes everything under scripts/*.json, so this never
//      gets committed. Never paste its contents anywhere else either.
//   3. From functions/: node scripts/backfillTrial.js
//
// Safe to run more than once - it only ever touches docs that don't
// already have a trialEndsAt, so it can never reset a trial that's
// already running, already expired, or already converted to a paid term.
"use strict";

const path = require("path");
// The modular API (as opposed to the older `require("firebase-admin")`
// namespaced style functions/index.js uses) - picked here specifically
// because it doesn't depend on the top-level package re-exporting
// `credential`/`firestore` off a default namespace object, which isn't
// consistent across every firebase-admin version. This way works the same
// regardless of exactly which version npm installs.
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");

let serviceAccount;
try {
  serviceAccount = require(path.join(__dirname, "serviceAccountKey.json"));
} catch (err) {
  console.error(
    "Couldn't find scripts/serviceAccountKey.json. Download one from " +
      "Firebase Console -> Project settings -> Service accounts -> " +
      "Generate new private key, and save it at that path (see this " +
      "file's own header comment for the full steps).",
  );
  process.exit(1);
}

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const DAY_MS = 24 * 60 * 60 * 1000;
// Fallback only - same default and same meaning as ../index.js's
// DEFAULT_TRIAL_LENGTH_DAYS (used only when config/trial doesn't exist, or
// doesn't have a valid lengthDays set).
const DEFAULT_TRIAL_LENGTH_DAYS = 30;
// Firestore caps a single batch at 500 writes - staying under that with
// room to spare.
const BATCH_SIZE = 400;

/** Exactly ../index.js's readTrialConfig(), duplicated here rather than
 * imported - this script runs standalone with `node`, outside the Cloud
 * Functions runtime, so it reads config/trial itself through the same
 * Admin SDK instance instead of sharing a module with index.js. Keep this
 * in sync with that function if its defaulting logic ever changes. */
async function readTrialConfig() {
  const snap = await db.collection("config").doc("trial").get();
  const data = snap.exists ? snap.data() : {};
  const enabled = data.enabled !== false; // default true (today's behavior) when unset
  const lengthDays =
    typeof data.lengthDays === "number" && data.lengthDays > 0 ? data.lengthDays : DEFAULT_TRIAL_LENGTH_DAYS;
  return { enabled, lengthDays };
}

async function main() {
  const { enabled, lengthDays } = await readTrialConfig();

  if (!enabled) {
    console.log(
      "config/trial has trials turned off right now, so this did nothing - " +
        "no existing account was touched. Turn trials back on in BizzMinder " +
        "Admin's Settings tab first if you want this backfill to grant one.",
    );
    return;
  }

  const snap = await db.collection("users").get();
  const trialEndsAt = Timestamp.fromMillis(Date.now() + lengthDays * DAY_MS);

  let batch = db.batch();
  let opsInBatch = 0;
  let updated = 0;
  let skipped = 0;

  for (const doc of snap.docs) {
    if (doc.get("trialEndsAt")) {
      skipped++;
      continue; // already has a trial/paid term - never touch it
    }

    batch.set(doc.ref, { trialEndsAt }, { merge: true });
    opsInBatch++;
    updated++;

    if (opsInBatch >= BATCH_SIZE) {
      await batch.commit();
      batch = db.batch();
      opsInBatch = 0;
    }
  }

  if (opsInBatch > 0) {
    await batch.commit();
  }

  console.log(
    `Done. Gave a fresh ${lengthDays} day trial (today's config/trial setting) to ${updated} account(s); ` +
      `left ${skipped} account(s) alone (already had a trialEndsAt). ` +
      `${snap.size} total user doc(s) checked.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  });
