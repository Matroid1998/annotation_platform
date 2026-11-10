export type AuthMode = 'local' | 'chatgpt';
export type AuthUser = { id: string; name: string; email: string };
export type AuthResult = { user: AuthUser; isAdmin: boolean };
export type AuthSession = { user: AuthUser | null; isAdmin: boolean; authMode: AuthMode; configured?: boolean };

export function safeReturnPath(value: string | null | undefined, fallback = '/'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(value)) return fallback;
  try {
    const url = new URL(value, 'https://annotation.invalid');
    if (url.origin !== 'https://annotation.invalid') return fallback;
    if (['/login', '/account/password', '/signin-with-chatgpt', '/signout-with-chatgpt', '/callback'].some(path => url.pathname === path || url.pathname.startsWith(`${path}/`)) || url.pathname === '/api' || url.pathname.startsWith('/api/')) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return fallback; }
}

export function accountDestination(account: { isAdmin: boolean; mustChangePassword?: boolean }, requested?: string | null): string {
  const fallback = account.isAdmin ? '/admin' : '/';
  let target = safeReturnPath(requested, fallback);
  const pathname = new URL(target, 'https://annotation.invalid').pathname;
  if (!account.isAdmin && (pathname === '/admin' || pathname.startsWith('/admin/'))) target = '/';
  return target;
}

export async function authRequest<T>(url: string, body?: unknown, expectedActor?: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(expectedActor ? { 'X-Annotation-Actor': expectedActor } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      const detail = typeof data.error === 'object' && data.error !== null ? (data.error as { message?: unknown }).message : data.error;
      throw new Error(typeof detail === 'string' ? detail : typeof data.message === 'string' ? data.message : 'The request could not be completed. Please try again.');
    }
    return data as T;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('The server did not respond in time. Please try again.');
    throw error;
  } finally { clearTimeout(timer); }
}
