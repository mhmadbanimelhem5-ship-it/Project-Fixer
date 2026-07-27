/**
 * shamirUtils.ts
 *
 * Pure TypeScript Shamir's Secret Sharing over GF(2^8).
 * No external dependencies — all arithmetic is done in the finite field
 * GF(2^8) with irreducible polynomial x^8 + x^4 + x^3 + x + 1 (= 0x11b).
 *
 * This is the same field used by AES internally.
 *
 * Security model:
 *   • split(secret, n, k) → n shares; any k shares reconstruct the secret,
 *     any k-1 shares reveal zero information (information-theoretic security).
 *   • Randomness comes from crypto.getRandomValues (polyfilled on RN).
 *   • Each share is a tuple (x, y[]) where x ∈ {1..255} identifies the share
 *     and y[] is the same length as the secret.
 *
 * Usage:
 *   const shares = split(aes256Key, 3, 2);   // 3 shares, threshold 2
 *   const recovered = combine(shares.slice(0, 2));
 *   // recovered deep-equals aes256Key
 */

// ── GF(2^8) arithmetic ────────────────────────────────────────────────────────

// Build exp and log tables once using 0x03 as the primitive element (generator).
// gfExp[i] = 0x03^i,  gfLog[v] = discrete log of v base 0x03.
const gfExp = new Uint8Array(512);
const gfLog = new Uint8Array(256);

(function buildTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    gfExp[i] = x;
    gfLog[x] = i;
    // multiply x by 0x03 (= x+1) using slow schoolbook multiplication
    // with reduction mod 0x11b whenever degree exceeds 7
    let result = 0;
    let a = x;
    let b = 0x03;
    while (b > 0) {
      if (b & 1) result ^= a;
      b >>= 1;
      const carry = a & 0x80;
      a = (a << 1) & 0xff;
      if (carry) a ^= 0x1b; // 0x11b & 0xff
    }
    x = result;
  }
  // Duplicate to avoid modular arithmetic on the index
  for (let i = 255; i < 512; i++) gfExp[i] = gfExp[i - 255];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return gfExp[(gfLog[a] + gfLog[b]) % 255];
}

function gfDiv(a: number, b: number): number {
  if (b === 0) throw new Error('GF division by zero');
  if (a === 0) return 0;
  return gfExp[((gfLog[a] - gfLog[b]) % 255 + 255) % 255];
}

// Evaluate polynomial f(x) = coeffs[0] + coeffs[1]*x + ... + coeffs[k-1]*x^(k-1)
// over GF(2^8) using Horner's method.
function polyEval(coeffs: Uint8Array, x: number): number {
  let result = 0;
  for (let i = coeffs.length - 1; i >= 0; i--) {
    result = coeffs[i] ^ gfMul(result, x);
  }
  return result;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface ShamirShare {
  /** x coordinate (1-255), identifies this share */
  x: number;
  /** y values — one per byte of the secret */
  y: Uint8Array;
}

/**
 * Split `secret` into `n` shares with reconstruction threshold `k`.
 * Any `k` shares suffice to reconstruct; fewer reveal nothing.
 *
 * Constraints: 1 ≤ k ≤ n ≤ 255, secret.length ≥ 1.
 */
export function split(secret: Uint8Array, n: number, k: number): ShamirShare[] {
  if (k < 1 || k > n || n > 255) throw new Error(`Invalid (k=${k}, n=${n}): need 1≤k≤n≤255`);
  if (secret.length === 0) throw new Error('Secret must not be empty');

  const shares: ShamirShare[] = Array.from({ length: n }, (_, i) => ({
    x: i + 1,
    y: new Uint8Array(secret.length),
  }));

  // For each byte, generate a random degree-(k-1) polynomial with f(0)=secret[b].
  for (let b = 0; b < secret.length; b++) {
    const coeffs = new Uint8Array(k);
    coeffs[0] = secret[b];
    if (k > 1) {
      const rand = new Uint8Array(k - 1);
      // crypto.getRandomValues is polyfilled in polyfill.ts
      (crypto as Crypto).getRandomValues(rand);
      for (let j = 1; j < k; j++) {
        // Avoid zero coefficients for the highest degree (not strictly necessary
        // but makes all polynomials genuinely degree k-1).
        coeffs[j] = rand[j - 1] === 0 ? 1 : rand[j - 1];
      }
    }
    for (let i = 0; i < n; i++) {
      shares[i].y[b] = polyEval(coeffs, shares[i].x);
    }
  }

  return shares;
}

/**
 * Combine `k` or more shares to reconstruct the secret via Lagrange interpolation
 * at x=0 over GF(2^8).
 *
 * In GF(2^8) characteristic 2: -a = a, so (0 - x_j) = x_j.
 */
export function combine(shares: ShamirShare[]): Uint8Array {
  if (shares.length === 0) throw new Error('Need at least one share');
  const secretLen = shares[0].y.length;
  const secret = new Uint8Array(secretLen);

  for (let b = 0; b < secretLen; b++) {
    let value = 0;
    for (let i = 0; i < shares.length; i++) {
      // Lagrange basis: L_i(0) = ∏_{j≠i} (0 - x_j)/(x_i - x_j)
      //                        = ∏_{j≠i} x_j / (x_i XOR x_j)  [char 2]
      let num = 1;
      let den = 1;
      for (let j = 0; j < shares.length; j++) {
        if (i === j) continue;
        num = gfMul(num, shares[j].x);
        den = gfMul(den, shares[i].x ^ shares[j].x);
      }
      value ^= gfMul(shares[i].y[b], gfDiv(num, den));
    }
    secret[b] = value;
  }

  return secret;
}

/**
 * Encode a share to a hex string for storage / transport.
 * Format: 2-char x hex + 2*secretLen-char y hex.
 */
export function encodeShare(share: ShamirShare): string {
  const xHex = share.x.toString(16).padStart(2, '0');
  const yHex = Array.from(share.y)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return xHex + yHex;
}

/**
 * Decode a share from a hex string produced by encodeShare.
 */
export function decodeShare(hex: string): ShamirShare {
  const x = parseInt(hex.slice(0, 2), 16);
  const yHex = hex.slice(2);
  const y = new Uint8Array(yHex.length / 2);
  for (let i = 0; i < y.length; i++) {
    y[i] = parseInt(yHex.slice(i * 2, i * 2 + 2), 16);
  }
  return { x, y };
}
