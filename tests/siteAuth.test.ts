import assert from 'node:assert/strict';

import {
  getResolvedCookieSecret,
  getResolvedSitePassword,
  isProductionSiteAuthMisconfigured,
  isSiteAuthConfigured,
} from '../src/lib/siteAuth';

const originalNodeEnv = process.env.NODE_ENV;
const originalSitePassword = process.env.SITE_PASSWORD;
const originalCookieSecret = process.env.COOKIE_SECRET;
const mutableEnv = process.env as Record<string, string | undefined>;

function resetEnv() {
  if (originalNodeEnv === undefined) delete mutableEnv.NODE_ENV;
  else mutableEnv.NODE_ENV = originalNodeEnv;
  if (originalSitePassword === undefined) delete process.env.SITE_PASSWORD;
  else process.env.SITE_PASSWORD = originalSitePassword;
  if (originalCookieSecret === undefined) delete process.env.COOKIE_SECRET;
  else process.env.COOKIE_SECRET = originalCookieSecret;
}

try {
  delete process.env.SITE_PASSWORD;
  delete process.env.COOKIE_SECRET;

  mutableEnv.NODE_ENV = 'production';
  assert.equal(getResolvedSitePassword(), '');
  assert.equal(getResolvedCookieSecret(), '');
  assert.equal(isSiteAuthConfigured(), false);
  assert.equal(isProductionSiteAuthMisconfigured(), true);

  process.env.SITE_PASSWORD = 'pw';
  process.env.COOKIE_SECRET = 'secret';
  assert.equal(getResolvedSitePassword(), 'pw');
  assert.equal(getResolvedCookieSecret(), 'secret');
  assert.equal(isSiteAuthConfigured(), true);
  assert.equal(isProductionSiteAuthMisconfigured(), false);

  mutableEnv.NODE_ENV = 'development';
  delete process.env.SITE_PASSWORD;
  delete process.env.COOKIE_SECRET;
  assert.equal(isSiteAuthConfigured(), false);
  assert.equal(isProductionSiteAuthMisconfigured(), false);
} finally {
  resetEnv();
}
