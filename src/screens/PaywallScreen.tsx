// Reached two different ways, and looks slightly different depending on
// which one:
//   1. Forced - RootNavigator shows this instead of the main tab stack the
//      moment a signed-in user's trial has actually expired (see
//      trialStore.ts / navigation/index.tsx). The one and only screen
//      reachable from that state besides signing out, no back button.
//   2. Voluntary - TrialBanner's "Make payment" link pushes this onto the
//      main stack early, any time during the trial, so someone can look at
//      pricing before they're forced to. Subscribe is disabled the whole
//      time this way (see `locked` below), and a close button appears
//      (navigation.canGoBack() is how this screen tells the two apart,
//      rather than a route param) so there's a way back to the app.
// Either way, it's the live trialStore status - not which path got you
// here - that decides whether Subscribe is actually clickable, so the two
// entry points can never disagree about it.
//
// Once payment succeeds (forced path only - Subscribe is disabled on the
// voluntary path, see below), trialStore's own Firestore listener notices
// the extended trialEndsAt and RootNavigator swaps back to the main app on
// its own - no restart, no manual "refresh" step needed.
//
// Visual design below matches the approved paywall mockup (gradient hero +
// white sheet, launch pricing tag, feature checklist, two plan cards with
// the sale price as the centered focal point and the original price as a
// quiet strikethrough at the bottom of each card) - see the mockup file
// shared during design review for the reference screenshots this was built
// from, plus this repo's RUN.md for the pricing numbers' own rationale.
import React, { useState } from 'react';
import { View, Text, Image, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useThemeColors, GALAXY_BLUE } from '../theme';
import { useAuthStore } from '../store/authStore';
import { useTrialStore, daysUntil } from '../store/trialStore';
import { usePricingStore } from '../store/pricingStore';
import { startSubscriptionCheckout, PlanId } from '../services/razorpay';
import { showAlert } from '../services/appAlert';
import GradientButton from '../components/GradientButton';

// Same three lines shown on the paywall mockup - kept as a plain array
// instead of inline JSX so the checklist can't drift between edits.
const FEATURES = [
  'Escalating alerts until you confirm',
  'Automatic attendance tracking',
  'Synced with Outlook and Teams',
];

export default function PaywallScreen() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const signOut = useAuthStore((s) => s.signOut);
  const status = useTrialStore((s) => s.status);
  // Live prices (see pricingStore.ts) - starts out showing
  // DEFAULT_PLAN_DISPLAY and updates the moment config/pricing changes or
  // its first snapshot arrives, with no re-render logic needed here beyond
  // this one selector.
  const planDisplay = usePricingStore((s) => s.plans);
  const [selectedPlan, setSelectedPlan] = useState<PlanId>('annual');
  const [loading, setLoading] = useState(false);

  // Locked (Subscribe disabled) for as long as the trial hasn't actually
  // expired yet - true whether that's because this screen was reached
  // voluntarily mid-trial, or (defensively) any other time status isn't a
  // confirmed expiry. The forced path only ever mounts this screen once
  // status.expired is already true, so in practice `locked` is false there
  // and true on the voluntary path - but it's status that decides, not the
  // path, so the two can never disagree.
  const locked = !!status && !status.expired;
  const daysLeft = status?.trialEndsAt ? daysUntil(status.trialEndsAt) : null;
  // Only true when this screen was PUSHED onto a stack that has somewhere
  // to go back to (the voluntary path) - the forced path mounts it as the
  // only screen in its own navigator, where canGoBack() is false, so no
  // close button appears there and signing out stays the only way out.
  const canGoBack = navigation.canGoBack?.() ?? false;

  const onSubscribe = async () => {
    if (locked) return;
    setLoading(true);
    try {
      const outcome = await startSubscriptionCheckout(selectedPlan);
      if (outcome.status === 'success') {
        // Nothing else to do here - trialStore's Firestore listener picks
        // up the new trialEndsAt within a moment and RootNavigator swaps
        // this screen out for the main app on its own.
        showAlert('You’re all set', 'Thanks! Your subscription is active.');
      } else if (outcome.status === 'error') {
        showAlert('Payment didn’t go through', outcome.message);
      }
      // 'cancelled': user backed out of the Razorpay sheet - nothing to show.
    } finally {
      setLoading(false);
    }
  };

  const onSignOut = () => {
    showAlert('Sign out?', undefined, [
      { text: 'Sign out', style: 'destructive', onPress: () => signOut() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const plan = planDisplay[selectedPlan];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ flexGrow: 1 }}>
      <LinearGradient
        colors={[colors.gradientStart, colors.gradientEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.hero, { paddingTop: insets.top + 28 }]}
      >
        {/* Purely decorative soft circles, clipped by the hero's own
            overflow: hidden - a flat-opacity stand-in for the mockup's
            radial-gradient glow, which React Native has no direct
            equivalent for. */}
        <View style={styles.glow1} pointerEvents="none" />
        <View style={styles.glow2} pointerEvents="none" />

        {canGoBack && (
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={[styles.closeBtn, { top: insets.top + 10 }]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.closeBtnMark}>✕</Text>
          </TouchableOpacity>
        )}

        <View style={styles.iconTile}>
          <Image source={require('../../assets/icon.png')} style={styles.iconImage} />
        </View>
        <Text style={styles.heroTitle}>
          {locked
            ? daysLeft != null
              ? `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left in your trial`
              : 'Still in your trial'
            : 'Your trial has ended'}
        </Text>
        <Text style={styles.heroSub}>
          {locked
            ? 'Lock in launch pricing now, or decide anytime before your trial ends'
            : 'Unlock BizzMinder to keep every meeting covered'}
        </Text>
      </LinearGradient>

      <View style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: insets.bottom + 20 }]}>
        <View style={styles.launchRow}>
          <View style={styles.launchTag}>
            <Text style={[styles.launchTagText, { color: colors.accent }]}>Launch pricing for early users</Text>
          </View>
        </View>

        <View style={styles.features}>
          {FEATURES.map((line) => (
            <View key={line} style={styles.feature}>
              <View style={[styles.tick, { backgroundColor: `${colors.success}20` }]}>
                <Text style={[styles.tickMark, { color: colors.success }]}>✓</Text>
              </View>
              <Text style={[styles.featureTxt, { color: colors.textSecondary }]}>{line}</Text>
            </View>
          ))}
        </View>

        <View style={styles.plansRow}>
          {Object.values(planDisplay).map((p) => {
            const isAnnual = p.id === 'annual';
            const selected = p.id === selectedPlan;
            return (
              <TouchableOpacity
                key={p.id}
                activeOpacity={0.85}
                onPress={() => setSelectedPlan(p.id)}
                style={[
                  styles.planCard,
                  {
                    backgroundColor: isAnnual ? colors.surfaceAlt : colors.surface,
                    borderColor: isAnnual ? colors.primary : colors.border,
                    borderWidth: isAnnual ? 2 : 1.5,
                  },
                  !selected && styles.planCardDimmed,
                ]}
              >
                {isAnnual && (
                  <View style={styles.ribbonWrap}>
                    <LinearGradient
                      colors={[colors.gradientStart, colors.gradientEnd]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.ribbon}
                    >
                      <Text style={styles.ribbonText}>⭐ BEST VALUE</Text>
                    </LinearGradient>
                  </View>
                )}

                {selected && (
                  <View style={[styles.selectedDot, { backgroundColor: colors.primary }]}>
                    <Text style={styles.selectedDotMark}>✓</Text>
                  </View>
                )}

                <Text style={[styles.planLabel, { color: colors.textPrimary }]}>{p.label}</Text>

                {/* Sale price is the card's one focal point - bold, in the
                    app's own "discount orange" token (theme.ts's warning
                    color), the same role it already plays elsewhere in the
                    app. The crossed-out original price sits at the bottom
                    of the card instead, after everything else, as a quiet
                    supporting detail rather than competing with it. */}
                <Text style={[styles.priceAmount, { color: colors.warning }]}>₹{p.priceInr}</Text>
                <Text style={[styles.pricePeriod, { color: colors.textSecondary }]}>{p.durationLabel}</Text>

                {p.discountPercent != null ? (
                  <View style={[styles.saveBadge, { backgroundColor: colors.success }]}>
                    <Text style={styles.saveBadgeText}>🎯 Save {p.discountPercent}%</Text>
                  </View>
                ) : (
                  <Text style={[styles.cancelNote, { color: colors.textMuted }]}>Cancel anytime</Text>
                )}

                {p.regularPriceInr != null && (
                  <Text style={[styles.strike, { color: colors.linkText }]}>₹{p.regularPriceInr}</Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        <GradientButton
          label={`Subscribe for ₹${plan.priceInr} ${plan.durationLabel}`}
          icon={locked ? '🔒' : undefined}
          onPress={onSubscribe}
          loading={loading}
          disabled={locked}
          style={{ width: '100%', marginTop: 20 }}
        />

        {locked && (
          <Text style={[styles.unlockNote, { color: colors.textMuted }]}>
            {daysLeft != null
              ? `Unlocks once your trial ends in ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}`
              : 'Unlocks once your trial ends'}
          </Text>
        )}

        <Text onPress={onSignOut} style={[styles.signOutLink, { color: colors.textMuted }]}>
          Sign out
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  hero: {
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingBottom: 40,
    overflow: 'hidden',
  },
  glow1: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: 'rgba(255,255,255,0.18)',
    top: -45,
    right: -35,
  },
  glow2: {
    position: 'absolute',
    width: 170,
    height: 170,
    borderRadius: 85,
    backgroundColor: 'rgba(255,255,255,0.12)',
    bottom: -70,
    left: -45,
  },
  iconTile: {
    width: 58,
    height: 58,
    borderRadius: 17,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 5,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  closeBtn: {
    position: 'absolute',
    left: 18,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
  },
  closeBtnMark: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  iconImage: { width: '100%', height: '100%', borderRadius: 12 },
  heroTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: '800', textAlign: 'center', marginBottom: 6 },
  heroSub: { color: 'rgba(255,255,255,0.92)', fontSize: 12.5, lineHeight: 18, textAlign: 'center', paddingHorizontal: 8 },

  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    marginTop: -16,
    paddingHorizontal: 18,
    paddingTop: 18,
  },
  launchRow: { alignItems: 'center', marginBottom: 16 },
  launchTag: {
    backgroundColor: GALAXY_BLUE,
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  launchTagText: { fontSize: 11.5, fontWeight: '800' },

  features: { marginBottom: 18, gap: 9 },
  feature: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  tick: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  tickMark: { fontSize: 11, fontWeight: '900' },
  featureTxt: { flex: 1, fontSize: 12.5, fontWeight: '600' },

  plansRow: { flexDirection: 'row', width: '100%', gap: 12, marginBottom: 6 },
  planCard: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'flex-start',
    minHeight: 180,
    position: 'relative',
  },
  // Non-selected card dims slightly so the tap target the user actually
  // chose is unambiguous - the "BEST VALUE" styling on the annual card is a
  // permanent design accent, not a selection state, so this is the only
  // visual difference selection makes.
  planCardDimmed: { opacity: 0.55 },
  ribbonWrap: { position: 'absolute', top: -11, left: 0, right: 0, alignItems: 'center', zIndex: 2 },
  ribbon: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  ribbonText: { color: '#FFFFFF', fontSize: 9.5, fontWeight: '800', letterSpacing: 0.4 },
  selectedDot: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  selectedDotMark: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  planLabel: { fontSize: 12.5, fontWeight: '800', marginTop: 6, marginBottom: 8 },
  priceAmount: { fontSize: 26, fontWeight: '900' },
  pricePeriod: { fontSize: 12, marginTop: 1, marginBottom: 10 },
  saveBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 4 },
  saveBadgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  cancelNote: { fontSize: 11.5, fontWeight: '600' },
  // Plain strikethrough, no explanatory caption next to it, no background
  // behind it - see razorpay.ts's header comment for what this number is
  // and why it's a real one, not an invented "was" price. Color comes from
  // colors.linkText (theme.ts), which is a different value per theme
  // specifically so this reads clearly against each one's own card color.
  strike: {
    fontSize: 14.5,
    fontWeight: '700',
    textDecorationLine: 'line-through',
    marginTop: 8,
  },
  unlockNote: { fontSize: 11.5, fontWeight: '700', textAlign: 'center', marginTop: 10 },
  signOutLink: { fontSize: 13.5, fontWeight: '600', marginTop: 20, textDecorationLine: 'underline', textAlign: 'center' },
});
