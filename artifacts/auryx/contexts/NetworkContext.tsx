/**
 * NetworkContext.tsx
 *
 * Monitors real-time connectivity using @react-native-community/netinfo.
 * Exposes:
 *   - isConnected          — true when a network interface is up AND internet is reachable
 *   - isChecking           — true during the initial async probe
 *   - recheckConnectivity  — call to re-probe immediately (used by the Retry button)
 *   - offlineMode          — user chose to browse local data without internet
 *   - enableOfflineMode    — enter view-only offline mode (called from OfflineScreen)
 *   - exitOfflineMode      — return to normal mode (auto-called when internet returns)
 *
 * The provider must be mounted early in the tree (before any feature that
 * needs the internet).  Components that need a hard gate use the
 * `useNetworkRequired` hook, which throws a readable error when offline.
 */

import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Platform } from 'react-native';

// ─── Types ────────────────────────────────────────────────────────────────────

interface NetworkContextValue {
  /** Definitive connectivity flag — false means no internet. */
  isConnected: boolean;
  /** True only while the very first probe is running. */
  isChecking: boolean;
  /** Triggers an immediate re-probe (use in Retry buttons). */
  recheckConnectivity: () => void;
  /**
   * True when the user chose to browse local data without internet.
   * Internet-dependent features must check `isConnected || !offlineMode`
   * and refuse to operate when offline.
   */
  offlineMode: boolean;
  /** Enter view-only offline mode — called from OfflineScreen. */
  enableOfflineMode: () => void;
  /** Exit offline mode — called automatically when internet returns. */
  exitOfflineMode: () => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const NetworkContext = createContext<NetworkContextValue>({
  isConnected: true,
  isChecking: true,
  recheckConnectivity: () => {},
  offlineMode: false,
  enableOfflineMode: () => {},
  exitOfflineMode: () => {},
});

// ─── Provider ─────────────────────────────────────────────────────────────────

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const [isConnected, setIsConnected] = useState(true);
  const [isChecking, setIsChecking]   = useState(true);
  const [offlineMode, setOfflineMode] = useState(false);
  const mountedRef                    = useRef(true);

  /** Derive a single boolean from a NetInfoState snapshot. */
  const deriveConnected = (state: NetInfoState): boolean => {
    if (state.isConnected === null) return true;
    if (!state.isConnected) return false;
    if (Platform.OS === 'web') return true;
    if (state.isInternetReachable === null) return true;
    return state.isInternetReachable;
  };

  const recheckConnectivity = useCallback(async () => {
    setIsChecking(true);
    try {
      const state = await NetInfo.fetch();
      if (mountedRef.current) {
        const connected = deriveConnected(state);
        setIsConnected(connected);
        // Auto-exit offline mode when internet is restored
        if (connected) setOfflineMode(false);
      }
    } finally {
      if (mountedRef.current) setIsChecking(false);
    }
  }, []);

  const enableOfflineMode = useCallback(() => setOfflineMode(true), []);
  const exitOfflineMode   = useCallback(() => setOfflineMode(false), []);

  useEffect(() => {
    mountedRef.current = true;
    recheckConnectivity();

    const unsubscribe = NetInfo.addEventListener((state) => {
      if (mountedRef.current) {
        const connected = deriveConnected(state);
        setIsConnected(connected);
        setIsChecking(false);
        // Auto-exit offline mode when internet returns
        if (connected) setOfflineMode(false);
      }
    });

    return () => {
      mountedRef.current = false;
      unsubscribe();
    };
  }, []);

  return (
    <NetworkContext.Provider value={{
      isConnected,
      isChecking,
      recheckConnectivity,
      offlineMode,
      enableOfflineMode,
      exitOfflineMode,
    }}>
      {children}
    </NetworkContext.Provider>
  );
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

/** General hook — returns live connectivity state. */
export function useNetwork() {
  return useContext(NetworkContext);
}

/**
 * Feature-level guard hook.
 * Call at the top of any component that triggers a network operation.
 * Returns an async guard function — throws 'NO_INTERNET' if offline.
 *
 *   const requireNetwork = useNetworkRequired();
 *   await requireNetwork();   // throws if offline
 */
export function useNetworkRequired() {
  const { isConnected } = useContext(NetworkContext);
  return useCallback(async () => {
    const state  = await NetInfo.fetch();
    const online = !!(state.isConnected && (state.isInternetReachable ?? true));
    if (!online) {
      throw new Error('NO_INTERNET');
    }
  }, [isConnected]);
}
