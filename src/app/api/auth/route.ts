import { NextRequest, NextResponse } from 'next/server';
import {
  SITE_AUTH_COOKIE,
  isSiteAuthConfigured,
  signSiteAuthToken,
} from '@/lib/siteAuth';

const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 days

export async function POST(request: NextRequest) {
  if (!isSiteAuthConfigured()) {
    return NextResponse.json(
      { error: 'Site auth is not configured (set SITE_PASSWORD and COOKIE_SECRET).' },
      { status: 503 },
    );
  }

  let body: { password?: string };
  try {
    body = (await request.json()) as { password?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const password = body.password;
  if (typeof password !== 'string') {
    return NextResponse.json({ error: 'Missing password' }, { status: 400 });
  }

  const expected = process.env.SITE_PASSWORD!;
  if (password !== expected) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  }

  const token = await signSiteAuthToken(process.env.COOKIE_SECRET!);
  const secure = process.env.NODE_ENV === 'production';

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SITE_AUTH_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE_SEC,
  });
  return res;
}

/** Clear auth cookie (optional logout). */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SITE_AUTH_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return res;
}
