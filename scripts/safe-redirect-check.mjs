import assert from 'node:assert/strict';
import { safeRedirectPath } from '../src/lib/safeRedirect.ts';

const home = '/';

assert.equal(safeRedirectPath(null), home);
assert.equal(safeRedirectPath(undefined), home);
assert.equal(safeRedirectPath(''), home);
assert.equal(safeRedirectPath('https://evil.com'), home);
assert.equal(safeRedirectPath('//evil.com'), home);
assert.equal(safeRedirectPath('//evil.com/phish'), home);
assert.equal(safeRedirectPath('/\\evil.com'), home);
assert.equal(safeRedirectPath('/\\\\evil.com'), home);
assert.equal(safeRedirectPath('/\\/evil.com'), home);
assert.equal(safeRedirectPath('/\\@evil.com'), home);
assert.equal(safeRedirectPath('/\\t/evil.com'), home);
assert.equal(safeRedirectPath('/\t/evil.com'), home);
assert.equal(safeRedirectPath('/\n/evil.com'), home);
assert.equal(safeRedirectPath('/login/..//evil.com'), home);
assert.equal(safeRedirectPath('workflow'), home);

assert.equal(safeRedirectPath('/'), '/');
assert.equal(safeRedirectPath('/workflow'), '/workflow');
assert.equal(safeRedirectPath('/workflow?tab=notes'), '/workflow?tab=notes');
assert.equal(safeRedirectPath('/foo/bar'), '/foo/bar');
assert.equal(safeRedirectPath('/foo/../workflow'), '/workflow');
assert.equal(safeRedirectPath('/play#map'), '/play#map');

console.log('safeRedirectPath: ok');
