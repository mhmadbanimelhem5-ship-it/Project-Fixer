import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';

type BiometricType = 'fingerprint' | 'facial' | 'iris' | 'none';

interface BiometricsHook {
  isAvailable: boolean;
  biometricType: BiometricType;
  authenticate: (reason?: string) => Promise<boolean>;
}

export function useBiometrics(): BiometricsHook {
  const [isAvailable, setIsAvailable] = useState(false);
  const [biometricType, setBiometricType] = useState<BiometricType>('none');

  useEffect(() => {
    if (Platform.OS === 'web') {
      setIsAvailable(false);
      return;
    }

    const check = async () => {
      try {
        const LocalAuth = await import('expo-local-authentication');
        const compatible = await LocalAuth.hasHardwareAsync();
        if (!compatible) return;
        const enrolled = await LocalAuth.isEnrolledAsync();
        if (!enrolled) return;
        const types = await LocalAuth.supportedAuthenticationTypesAsync();
        const AuthType = LocalAuth.AuthenticationType;
        if (types.includes(AuthType.FACIAL_RECOGNITION)) {
          setBiometricType('facial');
        } else if (types.includes(AuthType.FINGERPRINT)) {
          setBiometricType('fingerprint');
        } else if (types.includes(AuthType.IRIS)) {
          setBiometricType('iris');
        }
        setIsAvailable(true);
      } catch {
        setIsAvailable(false);
      }
    };
    check();
  }, []);

  const authenticate = useCallback(async (reason = 'Authenticate to unlock Auryx'): Promise<boolean> => {
    if (Platform.OS === 'web') return false;
    try {
      const LocalAuth = await import('expo-local-authentication');
      const result = await LocalAuth.authenticateAsync({
        promptMessage: reason,
        fallbackLabel: 'Use PIN',
        disableDeviceFallback: false,
      });
      return result.success;
    } catch {
      return false;
    }
  }, []);

  return { isAvailable, biometricType, authenticate };
}
