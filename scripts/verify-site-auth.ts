import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  getResolvedCookieSecret,
  getResolvedSitePassword,
  isSiteAuthConfigured,
} from '../src/lib/siteAuth';

const original = {
  sitePassword: process.env.SITE_PASSWORD,
  cookieSecret: process.env.COOKIE_SECRET,
};

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

try {
  delete process.env.SITE_PASSWORD;
  delete process.env.COOKIE_SECRET;
  assert.equal(getResolvedSitePassword(), '', 'production must not use a built-in password');
  assert.equal(getResolvedCookieSecret(), '', 'production must not use a built-in signing key');
  assert.equal(isSiteAuthConfigured(), false);

  process.env.SITE_PASSWORD = 'deployment-specific-password';
  process.env.COOKIE_SECRET = 'deployment-specific-cookie-secret';
  assert.equal(getResolvedSitePassword(), 'deployment-specific-password');
  assert.equal(getResolvedCookieSecret(), 'deployment-specific-cookie-secret');
  assert.equal(isSiteAuthConfigured(), true);

  const middleware = readFileSync(resolve('src/middleware.ts'), 'utf8');
  assert.ok(
    middleware.includes("process.env.NODE_ENV === 'production'") &&
      middleware.includes("status: 503"),
    'production middleware must fail closed when authentication is missing',
  );

  console.log('Site authentication configuration checks passed.');
} finally {
  restoreEnv('SITE_PASSWORD', original.sitePassword);
  restoreEnv('COOKIE_SECRET', original.cookieSecret);
}
