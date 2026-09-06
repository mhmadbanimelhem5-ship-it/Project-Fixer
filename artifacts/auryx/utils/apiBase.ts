const DEFAULT_API_BASE = 'https://project-fixer-api-server-chi.vercel.app';

export function getApiBase(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim();
  return (configured || DEFAULT_API_BASE).replace(/\/+$/, '');
}

export function getSecureApiBase(): string {
  return getApiBase();
}