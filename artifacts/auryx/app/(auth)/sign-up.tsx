import { useSignUp } from '@clerk/expo';
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
  const { signUp, errors, fetchStatus } = useSignUp();
  const router = useRouter();
  const [emailAddress, setEmailAddress] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const busy = fetchStatus === 'fetching';
  const verifying = signUp.status === 'missing_requirements' && signUp.unverifiedFields.includes('email_address');

  const submit = async () => {
    setErrorMessage('');
    try {
      const result = await signUp.password({ emailAddress: emailAddress.trim(), password });
      if (result.error) {
        setErrorMessage(getClerkErrorMessage(result.error));
        return;
      }
      await signUp.verifications.sendEmailCode();
    } catch (error) {
      console.error('[Auryx] Sign-up failed:', error);
      setErrorMessage(getClerkErrorMessage(error));
    }
  };

  const verify = async () => {
    setErrorMessage('');
    try {
      await signUp.verifications.verifyEmailCode({ code: code.trim() });
      if (signUp.status === 'complete') {
        await signUp.finalize({ navigate: () => router.replace('/lock') });
      }
    } catch (error) {
      console.error('[Auryx] Email verification failed:', error);
      setErrorMessage(getClerkErrorMessage(error));
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.logo}>⬡ Auryx</Text>
      <Text style={styles.title}>{verifying ? 'تحقق من بريدك' : 'إنشاء حساب'}</Text>
      <Text style={styles.subtitle}>
        {verifying ? 'أدخل رمز التحقق المرسل إلى بريدك الإلكتروني' : 'أنشئ حسابًا لحماية خزنتك'}
      </Text>
      {!verifying ? (
        <>
          <TextInput style={styles.input} value={emailAddress} onChangeText={setEmailAddress} placeholder="البريد الإلكتروني" placeholderTextColor="#64748B" autoCapitalize="none" keyboardType="email-address" />
          <TextInput style={styles.input} value={password} onChangeText={setPassword} placeholder="كلمة المرور" placeholderTextColor="#64748B" secureTextEntry />
          <Pressable style={[styles.button, busy && styles.disabled]} onPress={submit} disabled={busy}>
            {busy ? <ActivityIndicator color="#0A0F1E" /> : <Text style={styles.buttonText}>إنشاء الحساب</Text>}
          </Pressable>
          <Link href="/sign-in" asChild><Pressable><Text style={styles.link}>لديك حساب؟ تسجيل الدخول</Text></Pressable></Link>
        </>
      ) : (
        <>
          <TextInput style={styles.input} value={code} onChangeText={setCode} placeholder="رمز التحقق" placeholderTextColor="#64748B" keyboardType="number-pad" />
          <Pressable style={[styles.button, busy && styles.disabled]} onPress={verify} disabled={busy}><Text style={styles.buttonText}>تحقق</Text></Pressable>
          <Pressable
            onPress={async () => {
              setErrorMessage('');
              try {
                await signUp.verifications.sendEmailCode();
              } catch (error) {
                setErrorMessage(getClerkErrorMessage(error));
              }
            }}
          >
            <Text style={styles.link}>إرسال رمز جديد</Text>
          </Pressable>
        </>
      )}
      {(errorMessage || errors?.fields) && (
        <Text style={styles.error}>
          {errorMessage || 'تعذر إنشاء الحساب. تحقق من البيانات وحاول مرة أخرى.'}
        </Text>
      )}
      <View nativeID="clerk-captcha" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0F1E', alignItems: 'center', justifyContent: 'center', padding: 24 },
  logo: { color: '#D4AF37', fontSize: 28, fontWeight: '700', letterSpacing: 3, marginBottom: 28 },
  title: { color: '#F8FAFC', fontSize: 25, fontWeight: '700', marginBottom: 8 },
  subtitle: { color: '#94A3B8', fontSize: 14, textAlign: 'center', marginBottom: 24 },
  input: { width: '100%', maxWidth: 420, backgroundColor: '#111827', borderColor: '#334155', borderWidth: 1, borderRadius: 12, color: '#F8FAFC', paddingHorizontal: 16, paddingVertical: 14, marginBottom: 12, textAlign: 'right' },
  button: { width: '100%', maxWidth: 420, backgroundColor: '#D4AF37', borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 8, marginBottom: 18 },
  buttonText: { color: '#0A0F1E', fontSize: 15, fontWeight: '700' },
  link: { color: '#D4AF37', fontSize: 14, marginTop: 8 },
  error: { color: '#F87171', marginTop: 18, textAlign: 'center' },
  disabled: { opacity: 0.6 },
});