import { useSignIn } from '@clerk/expo';
import { Link, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

export default function SignInScreen() {
  const { signIn, errors, fetchStatus } = useSignIn();
  const router = useRouter();
  const [emailAddress, setEmailAddress] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const busy = fetchStatus === 'fetching';

  const finish = async () => {
    await signIn.finalize({
      navigate: () => router.replace('/lock'),
    });
  };

  const submit = async () => {
    const result = await signIn.password({ emailAddress: emailAddress.trim(), password });
    if (result.error) return;
    if (signIn.status === 'complete') {
      await finish();
    } else if (signIn.status === 'needs_client_trust') {
      const factor = signIn.supportedSecondFactors?.find(
        (item) => item.strategy === 'email_code',
      );
      if (factor) {
        await signIn.mfa.sendEmailCode();
        setNeedsCode(true);
      }
    }
  };

  const verify = async () => {
    await signIn.mfa.verifyEmailCode({ code: code.trim() });
    if (signIn.status === 'complete') await finish();
  };

  return (
    <View style={styles.container}>
      <Text style={styles.logo}>⬡ Auryx</Text>
      <Text style={styles.title}>{needsCode ? 'تحقق من بريدك' : 'تسجيل الدخول'}</Text>
      <Text style={styles.subtitle}>
        {needsCode ? 'أدخل الرمز المرسل إلى بريدك الإلكتروني' : 'سجّل الدخول للوصول إلى خزنتك'}
      </Text>
      {!needsCode ? (
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
            {busy ? <ActivityIndicator color="#0A0F1E" /> : <Text style={styles.buttonText}>دخول</Text>}
          </Pressable>
          <Link href="/sign-up" asChild>
            <Pressable><Text style={styles.link}>ليس لديك حساب؟ إنشاء حساب</Text></Pressable>
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
          <Pressable onPress={() => { signIn.reset(); setNeedsCode(false); }}>
            <Text style={styles.link}>العودة</Text>
          </Pressable>
        </>
      )}
      {errors?.fields && <Text style={styles.error}>تعذر تسجيل الدخول. تحقق من البيانات وحاول مرة أخرى.</Text>}
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