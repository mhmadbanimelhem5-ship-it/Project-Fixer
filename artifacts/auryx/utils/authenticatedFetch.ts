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
  if (!headers.has('Authorization') && tokenGetter) {
    const token = await tokenGetter();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(input, { ...init, headers });
}