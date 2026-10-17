// Home-screen banner shown only while a signed-in user is still inside
// their free trial - hidden once they've ever paid (status.hasPaid) and
// hidden once the trial has actually expired, since RootNavigator's own
// full-screen paywall takes over the whole app at that point instead (see
// navigation/index.tsx). Tapping "Make payment" opens that same
// PaywallScreen early and voluntarily, with Subscribe disabled until the
// trial genuinely ends - see PaywallScreen's own header comment for why
// that screen alone decides whether Subscribe is clickable, not this
// banner.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { format } from 'date-fns';
import { useThemeColors } from '../theme';
import { useTrialStore, daysUntil } from '../store/trialStore';

// Fallback only, for the rare account whose createdAt is missing - NOT
// assumed to be everyone's trial length. BizzMinder Admin's Settings tab
// can change how long a brand-new signup's trial is at any time, so this
// banner can't hardcode one number for the progress bar; it works out each
// account's own actual length from trialEndsAt - createdAt instead (see
// totalDays below).
const FALLBACK_TRIAL_LENGTH_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export default function TrialBanner() {
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const status = useTrialStore((s) => s.status);

  if (!status || status.expired || status.hasPaid || !status.trialEndsAt) return null;

  const remaining = daysUntil(status.trialEndsAt);
  const totalDays = status.createdAt
    ? Math.max(1, Math.round((status.trialEndsAt.getTime() - status.createdAt.getTime()) / DAY_MS))
    : FALLBACK_TRIAL_LENGTH_DAYS;
  const elapsed = Math.min(totalDays, Math.max(0, totalDays - remaining));
  // Floored at a sliver (4%) rather than 0 so the bar still reads as "a
  // countdown in progress" on day one, instead of looking empty/broken.
  const fillPercent = Math.max(4, Math.min(100, (elapsed / totalDays) * 100));

  return (
    <View style={[styles.banner, { backgroundColor: colors.surfaceAlt, borderColor: colors.primary }]}>
      <View style={styles.topRow}>
        <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={1}>
          ⏳ {remaining === 0 ? 'Trial ends today' : `${remaining} ${remaining === 1 ? 'day' : 'days'} left in your trial`}
        </Text>
        <View style={[styles.badge, { backgroundColor: colors.warning }]}>
          <Text style={styles.badgeText}>TRIAL</Text>
        </View>
      </View>

      <View style={[styles.track, { backgroundColor: colors.border }]}>
        <LinearGradient
          colors={[colors.gradientStart, colors.gradientEnd]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.fill, { width: `${fillPercent}%` }]}
        />
      </View>

      <View style={styles.bottomRow}>
        <Text style={[styles.note, { color: colors.textSecondary }]}>Ends {format(status.trialEndsAt, 'd MMM yyyy')}</Text>
        <Text onPress={() => navigation.navigate('Paywall')} style={[styles.link, { color: colors.linkText }]}>
          Make payment
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { borderRadius: 16, padding: 14, borderWidth: 1.5, marginHorizontal: 18, marginBottom: 14 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9, gap: 8 },
  title: { flex: 1, fontSize: 13.5, fontWeight: '800' },
  badge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  badgeText: { color: '#FFFFFF', fontSize: 10.5, fontWeight: '800' },
  track: { height: 7, borderRadius: 4, overflow: 'hidden', marginBottom: 10 },
  fill: { height: '100%', borderRadius: 4 },
  bottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  note: { fontSize: 11, fontWeight: '600' },
  // Color comes from colors.linkText (theme.ts) - a different value per
  // theme so this reads clearly against each one's own card color, no
  // background needed behind it.
  link: { fontSize: 12.5, fontWeight: '800', textDecorationLine: 'underline' },
});
