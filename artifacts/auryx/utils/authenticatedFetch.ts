type TokenGetter = () => Promise<string | null> | string | null;

let tokenGetter: TokenGetter | null = null;

export function setAuthenticatedTokenGetter(getter: TokenGetter | null): void {
  tokenGetter = getter;
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
      // ✅ نجرب حتى 3 مرات للحصول على التوكن (انتظار Clerk)
      let token: string | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        token = await tokenGetter();
        if (token) break;
        console.log(`[Auryx][API] Token not ready, waiting 2s (attempt ${attempt + 1}/3)...`);
        await new Promise(r => setTimeout(r, 2000));
      }

      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      } else {
        console.warn(`[Auryx][API] getToken returned null after retries for ${init.method ?? 'GET'} ${requestUrl}`);
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