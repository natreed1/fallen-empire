import assert from 'node:assert/strict';
import {
  getResolvedCookieSecret,
  getResolvedSitePassword,
  isSiteAuthConfigured,
} from '../src/lib/siteAuth';

const original = {
  nodeEnv: process.env.NODE_ENV,
  sitePassword: process.env.SITE_PASSWORD,
  cookieSecret: process.env.COOKIE_SECRET,
};

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

try {
  process.env.NODE_ENV = 'production';
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

  console.log('Site authentication configuration checks passed.');
} finally {
  restoreEnv('NODE_ENV', original.nodeEnv);
  restoreEnv('SITE_PASSWORD', original.sitePassword);
  restoreEnv('COOKIE_SECRET', original.cookieSecret);
}
