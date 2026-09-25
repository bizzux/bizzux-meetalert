import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useThemeColors } from '../../theme';
import { useAuthStore } from '../../store/authStore';
import AuthTextField from '../../components/AuthTextField';
import GradientButton from '../../components/GradientButton';

export default function ForgotPasswordScreen() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { resetPassword, error, clearError } = useAuthStore();

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const onSend = async () => {
    if (!email.trim()) return;
    setLoading(true);
    try {
      await resetPassword(email);
      setSent(true);
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

        <Text style={[styles.title, { color: colors.textPrimary }]}>Reset your password</Text>

        {sent ? (
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            If an account exists for {email}, a reset link is on its way — check your inbox.
          </Text>
        ) : (
          <>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Enter your account email and we'll send you a link to reset your password.
            </Text>
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
            {!!error && <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>}
            <GradientButton label="Send reset link" onPress={onSend} loading={loading} disabled={!email.trim()} />
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 24, fontWeight: '800', marginBottom: 8 },
  subtitle: { fontSize: 14, lineHeight: 20, marginBottom: 26 },
  error: { fontSize: 13, marginBottom: 14, marginTop: -8 },
  link: { fontSize: 13.5, fontWeight: '700' },
});
