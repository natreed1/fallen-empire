/**
 * Shared password-gate auth: HMAC token for HTTP-only cookie (Edge + Node).
 *
 * - **Production:** `SITE_PASSWORD` and `COOKIE_SECRET` must be set. Missing values fail closed.
 * - **Development:** No defaults — set both in `.env.local` to test the gate locally.
 */

export const SITE_AUTH_COOKIE = 'site-auth';

const AUTH_MESSAGE = 'fallen-empire-site-auth-v1';

function envOrEmpty(name: string): string {
  const v = process.env[name];
  return typeof v === 'string' && v.length > 0 ? v : '';
}

/** Resolved site password (empty in dev unless `.env.local` sets `SITE_PASSWORD`). */
export function getResolvedSitePassword(): string {
  return envOrEmpty('SITE_PASSWORD');
}

/** Resolved HMAC secret for the auth cookie. */
export function getResolvedCookieSecret(): string {
  return envOrEmpty('COOKIE_SECRET');
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

export function isProductionSiteAuthMisconfigured(): boolean {
  return process.env.NODE_ENV === 'production' && !isSiteAuthConfigured();
}
