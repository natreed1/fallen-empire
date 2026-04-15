/**
 * Shared password-gate auth: HMAC token for HTTP-only cookie (Edge + Node).
 *
 * - **Production:** If `SITE_PASSWORD` / `COOKIE_SECRET` are unset, built-in defaults apply so
 *   hosted deploys work without Vercel env configuration. Override via env for a custom password.
 * - **Development:** No defaults — set both in `.env.local` to test the gate locally.
 */

export const SITE_AUTH_COOKIE = 'site-auth';

const AUTH_MESSAGE = 'fallen-empire-site-auth-v1';

/** Used only when `NODE_ENV === 'production'` and env vars are empty. */
const PROD_DEFAULT_PASSWORD = 'fallenempire26!';

/** HMAC key for prod when env unset; override `COOKIE_SECRET` to rotate sessions. */
const PROD_DEFAULT_COOKIE_SECRET =
  'fe7a9c2d4b8e1f3056a9c8d7b6e5f4a3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7';

function envOrEmpty(name: string): string {
  const v = process.env[name];
  return typeof v === 'string' && v.length > 0 ? v : '';
}

/** Resolved site password (empty in dev unless `.env.local` sets `SITE_PASSWORD`). */
export function getResolvedSitePassword(): string {
  const fromEnv = envOrEmpty('SITE_PASSWORD');
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === 'production') return PROD_DEFAULT_PASSWORD;
  return '';
}

/** Resolved HMAC secret for the auth cookie. */
export function getResolvedCookieSecret(): string {
  const fromEnv = envOrEmpty('COOKIE_SECRET');
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === 'production') return PROD_DEFAULT_COOKIE_SECRET;
  return '';
}

function bufferToHex(buf: Uint8Array): string {
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

/** Returns hex-encoded HMAC-SHA256 of the fixed auth message. */
export async function signSiteAuthToken(secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(AUTH_MESSAGE));
  return bufferToHex(new Uint8Array(sig));
}

export async function verifySiteAuthToken(
  secret: string,
  tokenHex: string | undefined,
): Promise<boolean> {
  if (!tokenHex) return false;
  const expected = await signSiteAuthToken(secret);
  return timingSafeEqualHex(expected, tokenHex);
}

export function isSiteAuthConfigured(): boolean {
  return Boolean(getResolvedSitePassword() && getResolvedCookieSecret());
}
