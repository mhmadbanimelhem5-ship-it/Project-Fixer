type TokenGetter = () => Promise<string | null> | string | null;

let tokenGetter: TokenGetter | null = null;

export function setAuthenticatedTokenGetter(getter: TokenGetter | null): void {
  tokenGetter = getter;
}

/**
 * Resolve a Clerk (or other) bearer token via the registered getter.
 * Retries a few times to absorb short Clerk startup races.
 * Does not perform any network I/O by itself.
 */
export async function resolveAuthToken(maxAttempts = 3, delayMs = 2000): Promise<string | null> {
  if (!tokenGetter) {
    return null;
  }

  let token: string | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      token = await tokenGetter();
    } catch (error) {
      console.warn(
        '[Auryx][API] tokenGetter threw:',
        error instanceof Error ? error.message : 'unknown_error',
      );
      token = null;
    }
    if (token) return token;
    if (attempt < maxAttempts - 1) {
      console.log(`[Auryx][API] Token not ready, waiting ${delayMs / 1000}s (attempt ${attempt + 1}/${maxAttempts})...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return null;
}

export async function authenticatedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  const requestUrl = typeof input === 'string' ? input : input.toString();

  if (!headers.has('Authorization')) {
    if (!tokenGetter) {
      console.warn(`[Auryx][API] no token getter for ${init.method ?? 'GET'} ${requestUrl}`);
    } else {
      const token = await resolveAuthToken();
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      } else {
        console.warn(
          `[Auryx][API] getToken returned null after retries for ${init.method ?? 'GET'} ${requestUrl}`,
        );
      }
    }
  }

  const response = await fetch(input, { ...init, headers });

  if (!response.ok) {
    const hasBearerToken = /^Bearer\s+\S+$/i.test(headers.get('Authorization') ?? '');
    console.warn(
      `[Auryx][API] ${init.method ?? 'GET'} ${requestUrl} -> ${response.status} ` +
        `authHeader=${headers.has('Authorization')} hasBearerToken=${hasBearerToken}` +
        (response.status === 401
          ? ` reasonFor401=${hasBearerToken ? 'server_rejected_or_expired_token' : 'missing_token'}`
          : ''),
    );
  }

  return response;
}
