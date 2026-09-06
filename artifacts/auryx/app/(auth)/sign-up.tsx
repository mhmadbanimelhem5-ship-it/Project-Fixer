import { useClerk } from '@clerk/expo';
import { useSignUp } from '@clerk/expo/legacy';
import { Link, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

type ClerkErrorLike = {
  message?: string;
  longMessage?: string;
  errors?: Array<{ message?: string; longMessage?: string }>;
};

function getClerkErrorMessage(error: unknown): string {
  const value = error as ClerkErrorLike | null | undefined;
  const firstError = value?.errors?.[0];
  return (
    firstError?.longMessage ||
    firstError?.message ||
    value?.longMessage ||
    value?.message ||
    'تعذر إنشاء الحساب. تحقق من البيانات وحاول مرة أخرى.'
  );
}

export default function SignUpScreen() {
  const { signUp, isLoaded } = useSignUp();
  const { setActive } = useClerk();
  const router = useRouter();
  const [emailAddress, setEmailAddress] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!isLoaded) return;
    setErrorMessage('');
    setBusy(true);
    try {
      await signUp.create({
        emailAddress: emailAddress.trim(),
        password,
      });
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
      setVerifying(true);
    } catch (error) {
      console.error('[Auryx] Sign-up failed:', error);
      setErrorMessage(getClerkErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!isLoaded) return;
    setErrorMessage('');
    setBusy(true);
    try {
      const result = await signUp.attemptEmailAddressVerification({
        code: code.trim(),
      });
      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        router.replace('/lock');
      }
    } catch (error) {
      console.error('[Auryx] Email verification failed:', error);
      setErrorMessage(getClerkErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.logo}>⬡ Auryx</Text>
      <Text style={styles.title}>{verifying? 'تحقق من بريدك' : 'إنشاء حساب'}</Text>
      <Text style={styles.subtitle}>
        {verifying? 'أدخل رمز التحقق المرسل إلى بريدك' : 'أنشئ حسابًا لحماية خزنتك'}
      </Text>
      {!verifying? (
        <>
          <TextInput
            style={styles.input}
            value={emailAddress}
            onChangeText={setEmailAddress}
            placeholder="البريد الإلكتروني"
            placeholderTextColor="#64748B"
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="كلمة المرور"
            placeholderTextColor="#64748B"
            secureTextEntry
          />
          <Pressable style={[styles.button, busy && styles.disabled]} onPress={submit} disabled={busy}>
            {busy? <ActivityIndicator color="#0A0F1E" /> : <Text style={styles.buttonText}>إنشاء الحساب</Text>}
          </Pressable>
          <Link href="/sign-in" asChild>
            <Pressable>
              <Text style={styles.link}>لديك حساب؟ تسجيل الدخول</Text>
            </Pressable>
          </Link>
        </>
      ) : (
        <>
          <TextInput
            style={styles.input}
            value={code}
            onChangeText={setCode}
            placeholder="رمز التحقق"
            placeholderTextColor="#64748B"
            keyboardType="number-pad"
          />
          <Pressable style={[styles.button, busy && styles.disabled]} onPress={verify} disabled={busy}>
            <Text style={styles.buttonText}>تحقق</Text>
          </Pressable>
        </>
      )}
      {errorMessage? <Text style={styles.error}>{errorMessage}</Text> : null}
      <View nativeID="clerk-captcha" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0F1E', alignItems: 'center', justifyContent: 'center', padding: 24 },
  logo: { color: '#D4AF37', fontSize: 28, fontWeight: '700', letterSpacing: 3, marginBottom: 28 },
  title: { color: '#F8FAFC', fontSize: 25, fontWeight: '700', marginBottom: 8 },
  subtitle: { color: '#94A3B8', fontSize: 14, textAlign: 'center', marginBottom: 24 },
  input: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#111827',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 12,
    color: '#F8FAFC',
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 12,
    textAlign: 'right',
  },
  button: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#D4AF37',
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 18,
  },
  buttonText: { color: '#0A0F1E', fontSize: 15, fontWeight: '700' },
  link: { color: '#D4AF37', fontSize: 14, marginTop: 8 },
  error: { color: '#F87171', marginTop: 18, textAlign: 'center' },
  disabled: { opacity: 0.6 },
});