/**
 * Returns the base URL of the shared proxy (where the API server lives at /api).
 *
 * In development the Expo web app runs on its own domain
 * (*.expo.pike.replit.dev), distinct from the shared proxy domain.
 * We strip the ".expo." subdomain segment to reach the proxy domain.
 *
 * In production both the Expo web build and the API are behind the same
 * domain, so window.location.origin works directly.
 *
 * On React Native (iOS / Android):
 *   1. EXPO_PUBLIC_API_URL  — explicit override (highest priority)
 *   2. EXPO_PUBLIC_DOMAIN   — injected by the Expo workflow (REPLIT_DEV_DOMAIN)
 *   Both are publicly-accessible HTTPS URLs, so a real phone on any network
 *   can reach the Replit API server without a local tunnel.
 *
 * HTTPS enforcement:
 *   On native (Android / iOS) we REQUIRE HTTPS for all network operations that
 *   touch encrypted keys. `assertHttpsBase()` throws a clear error if the
 *   resolved base URL is HTTP-only so callers fail loudly instead of sending
 *   key material over a plain-text channel.
 */

import { Platform } from 'react-native';

export function getApiBase(): string {
  if (typeof window !== 'undefined' && window.location?.hostname) {
    const h = window.location.hostname;
    // Expo dev preview: f87141...expo.pike.replit.dev
    //              → f87141...pike.replit.dev  (shared proxy)
    const apiHost = h.replace(/^([^.]+)\.expo\./, '$1.');
    return `https://${apiHost}`;
  }

  // React Native native build (iOS / Android on a real device or simulator)
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (explicit) return explicit;

  // Fallback: EXPO_PUBLIC_DOMAIN is always injected by the workflow
  // (set to $REPLIT_DEV_DOMAIN which is a stable public HTTPS domain)
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (domain) return `https://${domain}`;

  return '';
}

/**
 * Returns the API base URL, throwing a clear error if it is not HTTPS
 * and we are on a native device (Android / iOS).
 *
 * Use this instead of `getApiBase()` for any operation that sends or
 * receives encrypted key material (RSA key registration, vault sealing, OTP).
 */
export function getSecureApiBase(): string {
  const base = getApiBase();

  if (Platform.OS !== 'web' && base !== '' && !base.startsWith('https://')) {
    throw new Error(
      `[Auryx] HTTPS مطلوب لعمليات التشفير — الرابط الحالي غير آمن: ${base.slice(0, 30)}…\n` +
      'تأكد من ضبط EXPO_PUBLIC_DOMAIN أو EXPO_PUBLIC_API_URL على نطاق HTTPS.',
    );
  }

  return base;
}
