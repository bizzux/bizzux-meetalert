import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useThemeColors } from '../../theme';
import { useAuthStore } from '../../store/authStore';
import AuthTextField from '../../components/AuthTextField';
import GradientButton from '../../components/GradientButton';

/** Two steps in one screen: enter a phone number → get a code → enter the
 * code. Firebase's native phone auth (via @react-native-firebase/auth)
 * handles the SMS delivery and device verification itself — there's no
 * reCAPTCHA widget to render here the way the web SDK would need. */
export default function PhoneSignInScreen() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { sendPhoneOtp, confirmPhoneOtp, phoneConfirmation, error, clearError } = useAuthStore();

  const [phoneNumber, setPhoneNumber] = useState('+91');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  const step: 'phone' | 'code' = phoneConfirmation ? 'code' : 'phone';

  const onSendCode = async () => {
    if (phoneNumber.trim().length < 8) return;
    setLoading(true);
    try {
      await sendPhoneOtp(phoneNumber);
    } catch {
      // error already set in the store
    } finally {
      setLoading(false);
    }
  };

  const onVerify = async () => {
    if (code.trim().length < 4) return;
    setLoading(true);
    try {
      await confirmPhoneOtp(code);
      // onAuthStateChanged picks this up and RootNavigator swaps screens.
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

        {step === 'phone' ? (
          <>
            <Text style={[styles.title, { color: colors.textPrimary }]}>Sign in with phone</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              We'll text you a one-time code. Include the country code.
            </Text>
            <AuthTextField
              label="Phone number"
              value={phoneNumber}
              onChangeText={(t) => {
                setPhoneNumber(t);
                if (error) clearError();
              }}
              keyboardType="phone-pad"
              placeholder="+91XXXXXXXXXX"
            />
            {!!error && <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>}
            <GradientButton
              label="Send code"
              onPress={onSendCode}
              loading={loading}
              disabled={phoneNumber.trim().length < 8}
            />
          </>
        ) : (
          <>
            <Text style={[styles.title, { color: colors.textPrimary }]}>Enter the code</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Sent to {phoneNumber}.</Text>
            <AuthTextField
              label="6-digit code"
              value={code}
              onChangeText={(t) => {
                setCode(t);
                if (error) clearError();
              }}
              keyboardType="number-pad"
              placeholder="123456"
              maxLength={6}
            />
            {!!error && <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>}
            <GradientButton label="Verify" onPress={onVerify} loading={loading} disabled={code.trim().length < 4} />
            <TouchableOpacity onPress={onSendCode} style={{ alignSelf: 'center', marginTop: 18 }}>
              <Text style={[styles.link, { color: colors.primary }]}>Resend code</Text>
            </TouchableOpacity>
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
