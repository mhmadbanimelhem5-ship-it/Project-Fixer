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
      const token = await tokenGetter();
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      } else {
        console.warn(`[Auryx][API] getToken returned null for ${init.method ?? 'GET'} ${requestUrl}`);
      }
    }
  }
  const response = await fetch(input, { ...init, headers });
  if (!response.ok) {
    console.warn(
      `[Auryx][API] ${init.method ?? 'GET'} ${requestUrl} -> ${response.status} ` +
        `authHeader=${headers.has('Authorization')}`,
    );
  }
  return response;
}