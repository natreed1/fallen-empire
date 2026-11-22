/**
 * Post-login path. Must stay on this origin.
 * `new URL('/\\evil.com', base)` is `https://evil.com/` — a leading slash is not enough.
 */
const REDIRECT_BASE = 'https://fallen-empire.invalid';

export function safeRedirectPath(from: string | null | undefined): string {
  if (!from) return '/';
  if (/[\u0000-\u001F\u007F\\]/.test(from)) return '/';
  if (!from.startsWith('/') || from.startsWith('//')) return '/';

  let resolved: URL;
  try {
    resolved = new URL(from, REDIRECT_BASE);
  } catch {
    return '/';
  }
  if (resolved.origin !== REDIRECT_BASE) return '/';
  if (resolved.username || resolved.password) return '/';

  const path = resolved.pathname;
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return '/';
  return path + resolved.search + resolved.hash;
}
