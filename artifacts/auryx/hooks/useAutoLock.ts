/**
 * useAutoLock.ts — P1-3 session auto-lock.
 *
 * Locks the vault when:
 *   1. The app stays in background/inactive longer than BACKGROUND_GRACE_MS
 *      (evaluated on return to foreground). 20 s is deliberately short: enough
 *      to copy a value and paste it elsewhere, but anything longer means the
 *      user forgot to lock — so we lock for them.
 *   2. The user produces no touch activity for longer than IDLE_TIMEOUT_MS
 *      while the app is in the foreground (device left open on a table).
 *
 * Touch activity is reported by the caller through `markActive`, attached to a
 * root wrapper View's onTouchStart/onTouchMove. RN touch events bubble from
 * children, so a single wrapper observes all interaction (taps AND scrolls).
 *
 * After locking, the app routes to /lock which offers biometrics first (when
 * enabled) then PIN — no extra code needed here.
 *
 * Design notes:
 * - `onLock` is held in a ref so listeners never capture a stale callback.
 * - When disabled (locked / vault not ready) all timers are torn down and the
 *   background timestamp is cleared, so the lock screen can never auto-lock.
 * - Thresholds are exported constants so a future Settings screen can tune them.
 */
import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

/** Background budget: copy/paste window; beyond this = forgot to lock. */
export const BACKGROUND_GRACE_MS = 20_000; // 20 seconds

/** Foreground no-touch budget before the vault locks itself. */
export const IDLE_TIMEOUT_MS = 120_000; // 2 minutes

/** How often the inactivity budget is evaluated. */
const IDLE_CHECK_INTERVAL_MS = 30_000;

export function useAutoLock(
  enabled: boolean,
  onLock: () => void,
): { markActive: () => void } {
  const backgroundAtRef = useRef<number | null>(null);
  const lastActiveRef = useRef<number>(Date.now());

  const lockRef = useRef(onLock);
  useEffect(() => { lockRef.current = onLock; }, [onLock]);

  // Stable identity: safe to pass straight into JSX touch props.
  const markActive = useRef(() => { lastActiveRef.current = Date.now(); }).current;

  useEffect(() => {
    if (!enabled) {
      backgroundAtRef.current = null;
      lastActiveRef.current = Date.now();
      return;
    }

    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'background' || next === 'inactive') {
        backgroundAtRef.current = Date.now();
      } else if (next === 'active') {
        const bgAt = backgroundAtRef.current;
        backgroundAtRef.current = null;
        if (bgAt !== null && Date.now() - bgAt > BACKGROUND_GRACE_MS) {
          lockRef.current();
          return;
        }
        lastActiveRef.current = Date.now();
      }
    });

    const timer = setInterval(() => {
      if (Date.now() - lastActiveRef.current > IDLE_TIMEOUT_MS) {
        lockRef.current();
        // Reset so we don't re-fire every tick while the lock screen shows;
        // the effect tears down once `enabled` flips false anyway.
        lastActiveRef.current = Date.now();
      }
    }, IDLE_CHECK_INTERVAL_MS);

    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [enabled]);

  return { markActive };
}