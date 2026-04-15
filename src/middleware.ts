import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  SITE_AUTH_COOKIE,
  isSiteAuthConfigured,
  verifySiteAuthToken,
} from '@/lib/siteAuth';

export async function middleware(request: NextRequest) {
  if (!isSiteAuthConfigured()) {
    return NextResponse.next();
  }

  const secret = process.env.COOKIE_SECRET!;
  const token = request.cookies.get(SITE_AUTH_COOKIE)?.value;
  const ok = await verifySiteAuthToken(secret, token);
  if (ok) {
    return NextResponse.next();
  }

  const login = new URL('/login', request.url);
  login.searchParams.set('from', request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    /*
     * Protect app routes; skip Next assets, static files under /sprites, ai-params.json, login, auth API.
     */
    '/((?!_next/static|_next/image|favicon.ico|sprites/|login|api/auth|ai-params\\.json|.*\\.(?:ico|png|jpg|jpeg|gif|webp|svg|woff2?)$).*)',
  ],
};
