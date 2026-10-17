// Live-subscribes to config/pricing (see firestore.rules' own comment -
// any signed-in user can read this one doc, unlike config/trial) so
// PaywallScreen always shows whatever an admin most recently saved from
// BizzMinder Admin's Settings tab, with no app restart needed - same
// listener-driven approach as trialStore.ts, just for a single shared doc
// instead of one scoped to the signed-in user.
import { create } from 'zustand';
import firestore from '@react-native-firebase/firestore';
import { DEFAULT_PLAN_DISPLAY, PlanDisplay, PlanId } from '../services/razorpay';

interface PricingState {
  /** DEFAULT_PLAN_DISPLAY until the first config/pricing snapshot arrives
   * (or forever, if that doc doesn't exist yet - see toPlanDisplay below) -
   * never null/undefined, so PaywallScreen can render immediately without
   * its own loading state. */
  plans: Record<PlanId, PlanDisplay>;
  init: () => () => void;
  reset: () => void;
}

function toPlanDisplay(id: PlanId, raw: any): PlanDisplay {
  const defaults = DEFAULT_PLAN_DISPLAY[id];
  const priceInr = typeof raw?.priceInr === 'number' && raw.priceInr > 0 ? raw.priceInr : defaults.priceInr;
  const regularPriceInr =
    typeof raw?.regularPriceInr === 'number' && raw.regularPriceInr > 0 ? raw.regularPriceInr : defaults.regularPriceInr;
  // Only annual ever shows a "Save %" badge (see razorpay.ts's header
  // comment) - recomputed here from the two live numbers above, never
  // stored as its own field anywhere, so it can't disagree with the prices
  // sitting right next to it on the card.
  const discountPercent =
    id === 'annual' && regularPriceInr > 0 ? Math.round((1 - priceInr / regularPriceInr) * 100) : null;
  return { ...defaults, priceInr, regularPriceInr, discountPercent };
}

export const usePricingStore = create<PricingState>((set) => ({
  plans: DEFAULT_PLAN_DISPLAY,

  init: () => {
    const unsubscribe = firestore()
      .collection('config')
      .doc('pricing')
      .onSnapshot(
        (snap) => {
          const data = snap.data() as Record<string, any> | undefined;
          set({
            plans: {
              annual: toPlanDisplay('annual', data?.annual),
              monthly: toPlanDisplay('monthly', data?.monthly),
            },
          });
        },
        (err) => {
          // Fail open to whatever's already in state (DEFAULT_PLAN_DISPLAY,
          // or the last good snapshot) - a listener error (offline,
          // permission hiccup) must never blank out or freeze the paywall's
          // prices.
          console.warn('[BizzMinder] pricing config listener failed', err);
        },
      );
    return unsubscribe;
  },

  reset: () => set({ plans: DEFAULT_PLAN_DISPLAY }),
}));
