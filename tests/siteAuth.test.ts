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

function resetEnv() {
  process.env.NODE_ENV = originalNodeEnv;
  if (originalSitePassword === undefined) delete process.env.SITE_PASSWORD;
  else process.env.SITE_PASSWORD = originalSitePassword;
  if (originalCookieSecret === undefined) delete process.env.COOKIE_SECRET;
  else process.env.COOKIE_SECRET = originalCookieSecret;
}

try {
  delete process.env.SITE_PASSWORD;
  delete process.env.COOKIE_SECRET;

  process.env.NODE_ENV = 'production';
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

  process.env.NODE_ENV = 'development';
  delete process.env.SITE_PASSWORD;
  delete process.env.COOKIE_SECRET;
  assert.equal(isSiteAuthConfigured(), false);
  assert.equal(isProductionSiteAuthMisconfigured(), false);
} finally {
  resetEnv();
}
