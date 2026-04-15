/**
 * Shared password-gate auth: HMAC token for HTTP-only cookie (Edge + Node).
 * Set SITE_PASSWORD + COOKIE_SECRET to enable protection.
 */

export const SITE_AUTH_COOKIE = 'site-auth';

const AUTH_MESSAGE = 'fallen-empire-site-auth-v1';

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
  return Boolean(
    process.env.SITE_PASSWORD &&
      process.env.SITE_PASSWORD.length > 0 &&
      process.env.COOKIE_SECRET &&
      process.env.COOKIE_SECRET.length > 0,
  );
}
