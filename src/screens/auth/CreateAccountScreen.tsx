import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useThemeColors } from '../../theme';
import { useAuthStore } from '../../store/authStore';
import AuthTextField from '../../components/AuthTextField';
import GradientButton from '../../components/GradientButton';

export default function CreateAccountScreen() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { signUpWithEmail, error, clearError } = useAuthStore();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const passwordsMismatch = confirmPassword.length > 0 && password !== confirmPassword;
  const canSubmit = email.trim().length > 0 && password.length >= 6 && password === confirmPassword;

  const onCreate = async () => {
    if (!canSubmit) return;
    setLoading(true);
    try {
      await signUpWithEmail(email, password, name);
      // onAuthStateChanged in authStore.init() picks this up automatically
      // and RootNavigator swaps to the main app — nothing else to do here.
    } catch {
      // error already set in the store
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={{ padding: 24, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginBottom: 16 }}>
          <Text style={[styles.link, { color: colors.primary }]}>← Back</Text>
        </TouchableOpacity>

        <Text style={[styles.title, { color: colors.textPrimary }]}>Create your account</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Your meetings, reminders, and settings will be kept separately under this account.
        </Text>

        <AuthTextField label="Name (optional)" value={name} onChangeText={setName} placeholder="Your name" autoCapitalize="words" />
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
          placeholder="At least 6 characters"
        />
        <AuthTextField
          label="Confirm password"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
          placeholder="Re-enter password"
          error={passwordsMismatch}
        />
        {passwordsMismatch && <Text style={[styles.error, { color: colors.danger }]}>Passwords don't match.</Text>}
        {!!error && <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>}

        <GradientButton label="Create account" onPress={onCreate} loading={loading} disabled={!canSubmit} style={{ marginTop: 6 }} />

        <View style={styles.footerRow}>
          <Text style={{ color: colors.textSecondary }}>Already have an account? </Text>
          <TouchableOpacity onPress={() => navigation.navigate('SignIn')}>
            <Text style={[styles.link, { color: colors.primary }]}>Sign in</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 24, fontWeight: '800', marginBottom: 8 },
  subtitle: { fontSize: 14, lineHeight: 20, marginBottom: 26 },
  error: { fontSize: 13, marginBottom: 14, marginTop: -8 },
  link: { fontSize: 13.5, fontWeight: '700' },
  footerRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 24 },
});
