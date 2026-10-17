// Two jobs, both deliberately kept server-side instead of in the mobile
// app, because both are exactly the kind of thing a modified client could
// otherwise fake:
//
//   1. onUserProfileCreated - stamps a new trial end date the moment a new
//      users/{uid} doc appears, reading HOW LONG (and whether to grant one
//      at all) from config/trial - see readTrialConfig() below, which is
//      the only place that doc is read or interpreted. The mobile app's
//      cloudProfile.ts create payload never includes trialEndsAt at all
//      (see its own comment); this is what actually sets it, via the Admin
//      SDK, which bypasses firestore.rules entirely - so there is no
//      client code path that can set or extend trialEndsAt except by
//      paying (#2) or an admin editing it by hand from BizzMinderAdmin.
//
//   2. createRazorpayOrder / verifyRazorpayPayment - the Razorpay checkout
//      flow services/razorpay.ts (mobile app) drives. The order amount is
//      decided here, not by the client, and the payment is only trusted
//      once its HMAC signature is verified here with the Razorpay Key
//      Secret - which never leaves this file. A client that skipped
//      straight to claiming success without a verified signature would
//      otherwise unlock the app for free. createRazorpayOrder reads each
//      plan's current price from config/pricing (see readPricingConfig
//      below) at the moment the order is created - a price change in
//      BizzMinder Admin's Settings tab takes effect immediately, for every
//      user, the next time anyone starts a checkout.
//
// Setup this needs before these will actually run - see the repo's RUN.md
// for the full walkthrough:
//   - The bizzux-meetly Firebase project upgraded to the Blaze (pay-as-you-
//     go) plan - Cloud Functions don't run on the free Spark plan. The free
//     monthly quota (2M invocations etc.) still applies on Blaze; this app's
//     volume is nowhere near it today.
//   - A Razorpay account, in Live mode, with its Key ID and Key Secret
//     stored as Cloud Functions secrets (`firebase functions:secrets:set
//     RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`) - never hard-coded here,
//     never committed.
//   - `firebase deploy --only functions` run from this project's root.
"use strict";

const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const crypto = require("crypto");
const Razorpay = require("razorpay");

admin.initializeApp();

const RAZORPAY_KEY_ID = defineSecret("RAZORPAY_KEY_ID");
const RAZORPAY_KEY_SECRET = defineSecret("RAZORPAY_KEY_SECRET");

const DAY_MS = 24 * 60 * 60 * 1000;
// Fallback only - used when config/trial (below) doesn't exist yet, e.g.
// right after this feature first deploys, before an admin has ever opened
// BizzMinder Admin's Settings tab and saved anything. Matches this app's
// original, pre-Settings-tab behavior so deploying this change is a no-op
// until an admin actually changes something.
const DEFAULT_TRIAL_LENGTH_DAYS = 30;

// The single doc BizzMinder Admin's Settings tab reads and writes (via
// firestore.rules' isAdmin()-only `config/{id}` rule) to control what a
// BRAND-NEW signup gets going forward - never touches anyone already
// signed up, same as hand-editing one person's trialEndsAt always has.
//   enabled: false -> no trial is granted at all; trialEndsAt is left unset,
//     which both the mobile app's cloudProfile.ts (toTrialStatus) and
//     RootNavigator's paywall gate already read as "not expired" - i.e.
//     unlimited free access for as long as this stays off. This is a
//     deliberate choice (see RUN.md), not a bug: "disabled" here means "no
//     trial clock, nothing to expire," not "paywalled immediately."
//   lengthDays: how many days from signup `trialEndsAt` is set to, when
//     enabled. Ignored entirely while enabled is false.
async function readTrialConfig() {
  const snap = await admin.firestore().collection("config").doc("trial").get();
  const data = snap.exists ? snap.data() : {};
  const enabled = data.enabled !== false; // default true (today's behavior) when unset
  const lengthDays =
    typeof data.lengthDays === "number" && data.lengthDays > 0 ? data.lengthDays : DEFAULT_TRIAL_LENGTH_DAYS;
  return { enabled, lengthDays };
}

// How many days each plan grants is NOT admin-editable (a deliberate
// choice - see RUN.md) - only each plan's price is. This is the one
// remaining source of truth for plan length; verifyRazorpayPayment reads
// it directly rather than through readPricingConfig below, since duration
// never changes with a price edit.
const PLAN_DURATIONS = {
  annual: 365,
  monthly: 30,
};

// Fallback prices only - used for any plan/field config/pricing (below)
// doesn't have yet, e.g. right after this feature first deploys, before an
// admin has ever opened BizzMinder Admin's Settings tab and saved pricing.
// Matches this app's original hardcoded prices so deploying this change is
// a no-op until an admin actually changes something (same pattern as
// DEFAULT_TRIAL_LENGTH_DAYS above). services/razorpay.ts in the mobile app
// has its own copy of these same numbers, under the same name
// (DEFAULT_PLAN_DISPLAY), for the same reason - its own fallback for
// before the live config/pricing listener has delivered its first
// snapshot.
//
// There is deliberately only ONE savings percentage anywhere on the
// paywall, and it compares the two real plans against each other - annual
// vs. what a year of the monthly plan would actually cost (monthly's price
// * 12) - never an invented "regular price" for a plan compared against
// itself. `annual.regularPaise` below IS that number (249 * 12 = 2,988),
// not a fictitious pre-discount annual price. `monthly.regularPaise` is
// ₹399 - the standard monthly price this launch rate is a markdown from,
// genuinely chargeable once the launch window ends, not a number invented
// just for a strikethrough - it gets a plain crossed-out price on its card
// but deliberately no "Save %" badge of its own (an earlier version gave
// monthly its own separate "off regular price" badge, and having two
// differently-anchored percentages on screen at once was exactly what read
// as confusing). The mobile app recomputes the Save % badge live from
// whichever priceInPaise/regularPaise are actually in effect, rather than
// storing a separate badge number anywhere, so an admin changing a price
// can never leave a stale percentage on screen.
const DEFAULT_PLAN_PRICES = {
  annual: { priceInPaise: 199900, regularPaise: 298800 }, // ₹1,999/yr vs ₹2,988/yr paid monthly (33% off)
  monthly: { priceInPaise: 24900, regularPaise: 39900 }, // ₹249/mo launch rate, ₹399/mo standard
};

// The single doc BizzMinder Admin's Settings tab reads and writes (via
// firestore.rules' config/{id} rule - admin-only to write, and also
// readable by any signed-in mobile user so the paywall can show live
// prices before checkout even starts - see firestore.rules' own comment)
// to control what every user is charged for each plan, starting the
// moment it's saved. Unlike config/trial, this has no "new signups only"
// scope - a price change applies globally and immediately, because unlike
// a trial there's no concept of "the price someone already locked in" to
// leave alone (an already-paid term's end date isn't touched either way,
// same as it never was before this existed).
async function readPricingConfig() {
  const snap = await admin.firestore().collection("config").doc("pricing").get();
  const data = snap.exists ? snap.data() : {};
  const plans = {};
  for (const key of Object.keys(DEFAULT_PLAN_PRICES)) {
    const raw = (data && data[key]) || {};
    const fallback = DEFAULT_PLAN_PRICES[key];
    const priceInr = typeof raw.priceInr === "number" && raw.priceInr > 0 ? raw.priceInr : null;
    const regularPriceInr = typeof raw.regularPriceInr === "number" && raw.regularPriceInr > 0 ? raw.regularPriceInr : null;
    plans[key] = {
      priceInPaise: priceInr !== null ? Math.round(priceInr * 100) : fallback.priceInPaise,
      regularPaise: regularPriceInr !== null ? Math.round(regularPriceInr * 100) : fallback.regularPaise,
      durationDays: PLAN_DURATIONS[key],
    };
  }
  return plans;
}

/** Fires once per brand-new users/{uid} doc. Idempotent against retries -
 * if trialEndsAt is already set (shouldn't happen for a doc that was just
 * created, but cheap to guard anyway), this does nothing rather than reset
 * the clock. Reads config/trial (see readTrialConfig above) to decide
 * whether this new signup gets a trial at all, and if so, how long it is -
 * never affects any account that already exists by the time either value
 * changes. */
exports.onUserProfileCreated = onDocumentCreated("users/{uid}", async (event) => {
  const snap = event.data;
  if (!snap || snap.get("trialEndsAt")) return;

  const { enabled, lengthDays } = await readTrialConfig();
  if (!enabled) return; // no trial clock for this signup - see readTrialConfig's comment

  const trialEndsAt = admin.firestore.Timestamp.fromMillis(Date.now() + lengthDays * DAY_MS);
  await snap.ref.set({ trialEndsAt }, { merge: true });
});

/** Callable from the mobile app once a signed-in user picks a plan and taps
 * "Subscribe now". `request.data.plan` picks WHICH plan's already-fixed
 * price and duration apply - the client never gets to supply an amount or
 * a duration directly, only a plan key, so there's no path for a modified
 * client to order itself a discount. The chosen plan key is stored in the
 * order's `notes` so verifyRazorpayPayment (below) knows how many days to
 * grant once the signature checks out, without trusting the client to say
 * so again at that point either. */
exports.createRazorpayOrder = onCall({ secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in first.");
  }

  const planKey = request.data && request.data.plan;
  const plans = await readPricingConfig();
  const plan = plans[planKey];
  if (!plan) {
    throw new HttpsError("invalid-argument", `Unknown plan "${planKey}". Expected one of: ${Object.keys(plans).join(", ")}.`);
  }

  const razorpay = new Razorpay({
    key_id: RAZORPAY_KEY_ID.value(),
    key_secret: RAZORPAY_KEY_SECRET.value(),
  });

  const order = await razorpay.orders.create({
    amount: plan.priceInPaise,
    currency: "INR",
    // Razorpay requires this to be unique and <= 40 chars.
    receipt: `${request.auth.uid}-${Date.now()}`.slice(0, 40),
    notes: { uid: request.auth.uid, plan: planKey },
  });

  return {
    orderId: order.id,
    amountPaise: order.amount,
    currency: order.currency,
    keyId: RAZORPAY_KEY_ID.value(),
    regularPaise: plan.regularPaise,
  };
});

/** Callable right after RazorpayCheckout.open() resolves. Verifies the
 * payment signature server-side (the one step that can't be skipped - see
 * this file's header comment) and, only once verified, extends
 * trialEndsAt by whichever plan's duration was actually ordered - read back
 * from the order's own notes.plan (set by createRazorpayOrder above, not
 * re-supplied by the client here), from whichever is later: right now, or
 * the account's current trialEndsAt (so renewing a few days early stacks
 * on top of the remaining time instead of wasting it). */
exports.verifyRazorpayPayment = onCall({ secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in first.");
  }

  const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = request.data || {};
  if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
    throw new HttpsError("invalid-argument", "Missing payment details.");
  }

  const expectedSignature = crypto
    .createHmac("sha256", RAZORPAY_KEY_SECRET.value())
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");

  // Constant-time compare - this is a security check, not a UI diff.
  const signaturesMatch =
    expectedSignature.length === razorpay_signature.length &&
    crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(razorpay_signature));

  if (!signaturesMatch) {
    throw new HttpsError("permission-denied", "Payment signature did not verify.");
  }

  const razorpay = new Razorpay({
    key_id: RAZORPAY_KEY_ID.value(),
    key_secret: RAZORPAY_KEY_SECRET.value(),
  });
  const order = await razorpay.orders.fetch(razorpay_order_id);
  const planKey = order.notes && order.notes.plan;
  // Duration only - the price was already locked in on the Razorpay order
  // itself back when createRazorpayOrder created it, so there's no need to
  // re-read config/pricing here; PLAN_DURATIONS never changes on a price
  // edit (see its own comment above).
  const durationDays = PLAN_DURATIONS[planKey];
  if (!durationDays || order.notes.uid !== request.auth.uid) {
    // Either a plan key we don't recognize (shouldn't happen - we're the
    // only ones who ever set it, at order creation above) or this order
    // belongs to a different account than the one calling us now.
    throw new HttpsError("failed-precondition", "This order doesn't match a known plan for this account.");
  }

  const uid = request.auth.uid;
  const userRef = admin.firestore().collection("users").doc(uid);
  const db = admin.firestore();

  const newTrialEndsAt = await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const current = snap.get("trialEndsAt");
    const base = current && current.toMillis() > Date.now() ? current.toMillis() : Date.now();
    const next = admin.firestore.Timestamp.fromMillis(base + durationDays * DAY_MS);

    tx.set(
      userRef,
      {
        trialEndsAt: next,
        lastPaymentAt: admin.firestore.FieldValue.serverTimestamp(),
        lastPaymentId: razorpay_payment_id,
        lastPaymentPlan: planKey,
      },
      { merge: true },
    );

    return next;
  });

  return { trialEndsAt: newTrialEndsAt.toDate().toISOString() };
});
