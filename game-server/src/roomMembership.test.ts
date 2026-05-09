import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getRoomJoinRejection } from './roomMembership.ts';

test('rejects a second host in an existing room', () => {
  assert.equal(getRoomJoinRejection([{ role: 'host' }], 'host', true), 'duplicate-host');
});

test('rejects a guest before a host creates room state', () => {
  assert.equal(getRoomJoinRejection([], 'guest', false), 'missing-host');
});

test('rejects a second guest in an existing room', () => {
  assert.equal(
    getRoomJoinRejection([{ role: 'host' }, { role: 'guest' }], 'guest', true),
    'duplicate-guest',
  );
});

test('allows one host and one guest', () => {
  assert.equal(getRoomJoinRejection([], 'host', false), null);
  assert.equal(getRoomJoinRejection([{ role: 'host' }], 'guest', true), null);
});
