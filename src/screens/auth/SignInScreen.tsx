import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useThemeColors } from '../../theme';
import { useAuthStore } from '../../store/authStore';
import AuthTextField from '../../components/AuthTextField';
import GradientButton from '../../components/GradientButton';

export default function SignInScreen() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { signInWithEmail, error, clearError } = useAuthStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const onSignIn = async () => {
    if (!email.trim() || !password) return;
    setLoading(true);
    try {
      await signInWithEmail(email, password);
    } catch {
      // error is already set in the store; swallow here so we don't throw
      // an unhandled promise rejection in the UI layer.
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={{ padding: 24, paddingTop: insets.top + 48, paddingBottom: insets.bottom + 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <LinearGradient colors={[colors.gradientStart, colors.gradientEnd]} style={styles.brandIcon}>
          <Text style={styles.brandIconText}>🔔</Text>
        </LinearGradient>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Welcome back</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Sign in to see your meetings.</Text>

        <AuthTextField
          label="Email"
          value={email}
          onChangeText={(t) => {
            setEmail(t);
            if (error) clearError();
          }}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          placeholder="you@example.com"
        />
        <AuthTextField
          label="Password"
          value={password}
          onChangeText={(t) => {
            setPassword(t);
            if (error) clearError();
          }}
          secureTextEntry
          placeholder="••••••••"
        />

        {!!error && <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>}

        <TouchableOpacity onPress={() => navigation.navigate('ForgotPassword')} style={{ alignSelf: 'flex-end', marginBottom: 20 }}>
          <Text style={[styles.link, { color: colors.primary }]}>Forgot password?</Text>
        </TouchableOpacity>

        <GradientButton label="Sign in" onPress={onSignIn} loading={loading} disabled={!email.trim() || !password} />

        <View style={styles.dividerRow}>
          <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
          <Text style={[styles.dividerText, { color: colors.textMuted }]}>or</Text>
          <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
        </View>

        <GradientButton
          label="Sign in with phone number"
          icon="📱"
          variant="outline"
          onPress={() => navigation.navigate('PhoneSignIn')}
        />

        <View style={styles.footerRow}>
          <Text style={{ color: colors.textSecondary }}>Don't have an account? </Text>
          <TouchableOpacity onPress={() => navigation.navigate('CreateAccount')}>
            <Text style={[styles.link, { color: colors.primary }]}>Create one</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  brandIcon: { width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  brandIconText: { fontSize: 26 },
  title: { fontSize: 26, fontWeight: '800', marginBottom: 6 },
  subtitle: { fontSize: 14.5, marginBottom: 28 },
  error: { fontSize: 13, marginBottom: 14, marginTop: -6 },
  link: { fontSize: 13.5, fontWeight: '700' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 22 },
  dividerLine: { flex: 1, height: 1 },
  dividerText: { marginHorizontal: 12, fontSize: 12.5, fontWeight: '600' },
  footerRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 26 },
});
