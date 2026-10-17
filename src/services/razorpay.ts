// Razorpay checkout flow for unlocking BizzMinder after the trial ends.
//
// The ACTUAL price for each plan is decided server-side, in
// functions/index.js's createRazorpayOrder, which reads it live from
// config/pricing (see that function's own comment) - never trust a
// client-supplied amount for a payment. DEFAULT_PLAN_DISPLAY below is only
// a fallback: the numbers shown for a brief moment before
// store/pricingStore.ts's live listener delivers its first config/pricing
// snapshot, or if that listener never gets a real one at all. It MUST be
// kept in sync with functions/index.js's own
// DEFAULT_PLAN_PRICES by hand - both are fallbacks for the exact same
// still-unset-config/pricing case, on two separate deploy targets with no
// shared config file between them (see this repo's RUN.md for the wider
// note on things kept in sync by hand across BizzMinder / BizzMinder Admin
// / functions). Plan duration (365 / 30 days) is NOT part of config/pricing
// at all - it's fixed, and functions/index.js's PLAN_DURATIONS is its only
// source of truth.
//
// There's deliberately only ONE savings percentage anywhere on the
// paywall: annual.discountPercent, which compares the two real plans
// against each other (annual's price vs. what a year of the monthly plan
// would cost) - never a plan's price compared against some invented
// "regular price" for itself. monthly has its own regularPriceInr too
// (₹399 by default - the standard monthly price this launch rate is a
// markdown from, genuinely chargeable once the launch window ends), so it
// also gets a plain strikethrough on its card, but deliberately no
// discountPercent/badge of its own - it's the baseline annual's one
// comparison is made against, not a second, separate discount claim. An
// earlier version gave each plan its own independently-anchored "% off",
// and having two unrelated percentages on screen at once was exactly what
// read as confusing. pricingStore.ts recomputes discountPercent live from
// whichever priceInr/regularPriceInr are actually in effect (never a
// separately admin-typed badge number), so an admin editing a price in
// BizzMinder Admin can never leave a stale percentage on screen.
//
// Flow: createRazorpayOrder (Cloud Function, creates a real Razorpay order
// server-side with the Key Secret, which never reaches the client) →
// RazorpayCheckout.open() (native Razorpay checkout UI) → the result's
// payment id + order id + signature are sent to verifyRazorpayPayment
// (Cloud Function, checks the HMAC signature against the Key Secret) →
// only on a verified signature does that function extend trialEndsAt.
// Skipping that last verification step - e.g. trusting whatever
// RazorpayCheckout.open() resolves with - would let anyone unlock the app
// for free by forging a fake success response client-side.
import RazorpayCheckout from 'react-native-razorpay';
import { auth, callable } from '../firebase';

export type PlanId = 'annual' | 'monthly';

export interface PlanDisplay {
  id: PlanId;
  label: string;
  priceInr: number;
  /** The crossed-out "was" price shown at the bottom of this plan's card -
   * always a real, chargeable number (see each entry's own comment below),
   * never invented. Set for both plans now; see this file's header comment
   * on why only annual also gets a discountPercent badge. */
  regularPriceInr: number | null;
  /** Rounded, for the "Save N%" badge - not re-derived from priceInr /
   * regularPriceInr at render time so a rounding tweak here can't silently
   * disagree with the copy next to it. null for monthly on purpose - see
   * this file's header comment. */
  discountPercent: number | null;
  durationLabel: string;
}

// Fallback only - see this file's header comment. store/pricingStore.ts is
// what PaywallScreen actually reads for the live numbers; this is just
// what that store starts out showing before its first config/pricing
// snapshot arrives. Keep in sync with functions/index.js's
// DEFAULT_PLAN_PRICES by hand.
export const DEFAULT_PLAN_DISPLAY: Record<PlanId, PlanDisplay> = {
  // ₹2,988 is 12 × monthly's ₹249 - a real number anyone can check against
  // the monthly card right next to it, not an invented "was" price.
  annual: { id: 'annual', label: 'Annual', priceInr: 1999, regularPriceInr: 2988, discountPercent: 33, durationLabel: 'per year' },
  // ₹399 is the standard monthly price - what this plan reverts to once the
  // launch window ends, not a number invented just for the strikethrough.
  monthly: { id: 'monthly', label: 'Monthly', priceInr: 249, regularPriceInr: 399, discountPercent: null, durationLabel: 'per month' },
};

interface CreateOrderResponse {
  orderId: string;
  amountPaise: number;
  currency: string;
  keyId: string; // Razorpay's public Key ID - safe to send to the client, unlike the Key Secret
  regularPaise: number | null;
}

interface VerifyPaymentRequest {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

interface VerifyPaymentResponse {
  trialEndsAt: string; // ISO date string - the new access-until date after this payment
}

export type CheckoutOutcome = { status: 'success'; trialEndsAt: Date } | { status: 'cancelled' } | { status: 'error'; message: string };

/** Runs the full checkout flow for the given plan and resolves once it's
 * fully settled - never throws for an ordinary user-cancelled checkout,
 * only for a genuine failure (network, verification rejected, etc.), so
 * PaywallScreen can switch on `status` instead of wrapping this in
 * try/catch itself. */
export async function startSubscriptionCheckout(plan: PlanId): Promise<CheckoutOutcome> {
  const user = auth().currentUser;
  if (!user) return { status: 'error', message: 'Not signed in.' };

  let order: CreateOrderResponse;
  try {
    const createOrder = callable<{ plan: PlanId }, CreateOrderResponse>('createRazorpayOrder');
    const result = await createOrder({ plan });
    order = result.data;
  } catch (err: any) {
    // Never show err?.message here - a failed Cloud Function call surfaces
    // as an internal string like "[functions/internal] internal", not
    // anything written for a user to read.
    return { status: 'error', message: 'Could not start checkout. Check your connection and try again.' };
  }

  let checkoutResult: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string };
  try {
    checkoutResult = await RazorpayCheckout.open({
      key: order.keyId,
      order_id: order.orderId,
      amount: order.amountPaise,
      currency: order.currency,
      name: 'BizzMinder',
      // Only the plan's label ("annual"/"monthly") goes in this string, not
      // its price - the label never changes with a pricing edit, so reading
      // it from the fallback object here (rather than the live store) is
      // fine and keeps this file from needing a React hook of its own.
      description: `BizzMinder ${DEFAULT_PLAN_DISPLAY[plan].label.toLowerCase()} subscription`,
      prefill: { email: user.email ?? undefined, name: user.displayName ?? undefined },
    });
  } catch (err: any) {
    // Razorpay's SDK rejects (rather than resolving with a failure flag)
    // both for a genuine failure AND for the user simply closing the sheet
    // - code 2 / "Payment Cancelled" or "BAD_REQUEST_ERROR" descriptions
    // mentioning cancellation are the user backing out, not an error to
    // alarm them with.
    const description: string = err?.description ?? err?.error?.description ?? '';
    if (err?.code === 2 || /cancel/i.test(description)) {
      return { status: 'cancelled' };
    }
    return { status: 'error', message: description || 'Payment did not go through. Please try again.' };
  }

  try {
    const verify = callable<VerifyPaymentRequest, VerifyPaymentResponse>('verifyRazorpayPayment');
    const { data } = await verify(checkoutResult);
    return { status: 'success', trialEndsAt: new Date(data.trialEndsAt) };
  } catch (err: any) {
    // Payment went through on Razorpay's side but we couldn't confirm it -
    // most likely a dropped connection right after a real charge. Tell the
    // user plainly rather than silently leaving them paywalled; the
    // trialStore listener will pick up the extension automatically once
    // the retry (or a manual admin check) succeeds, with no app restart
    // needed.
    return {
      status: 'error',
      message: 'Payment received, but we could not confirm it yet. If this keeps happening, contact support. Your payment is safe either way.',
    };
  }
}
