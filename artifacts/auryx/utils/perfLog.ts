/**
 * perfLog.ts — lightweight startup performance logger.
 *
 * Outputs timing information only in __DEV__ builds so production APKs have
 * zero overhead. Call `perfStart` to capture a timestamp, then `perfEnd` to
 * log the elapsed time with a human-readable label.
 */

const marks: Record<string, number> = {};

export function perfStart(label: string): void {
  if (!__DEV__) return;
  marks[label] = Date.now();
}

export function perfEnd(label: string): number {
  if (!__DEV__) return 0;
  const start = marks[label];
  if (start === undefined) {
    console.warn(`[Auryx Perf] perfEnd("${label}") called without matching perfStart`);
    return 0;
  }
  const elapsed = Date.now() - start;
  const tag =
    elapsed < 100  ? '✅' :
    elapsed < 1000 ? '🟡' :
    elapsed < 5000 ? '🟠' : '🔴';
  console.info(`[Auryx Perf] ${tag} ${label}: ${elapsed}ms`);
  delete marks[label];
  return elapsed;
}

export function perfMark(label: string, note?: string): void {
  if (!__DEV__) return;
  const msg = note ? `[Auryx Perf] ⏱ ${label} — ${note}` : `[Auryx Perf] ⏱ ${label}`;
  console.info(msg);
}
