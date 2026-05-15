import assert from 'node:assert/strict';
import { validateRoomJoin, type RoomOccupant } from './roomAccess.ts';

const host: RoomOccupant = { role: 'host' };
const guest: RoomOccupant = { role: 'guest' };

assert.deepEqual(validateRoomJoin([], 'guest', false), {
  ok: false,
  message: 'Room not created yet — host must join first.',
});

assert.deepEqual(validateRoomJoin([], 'host', false), { ok: true });
assert.deepEqual(validateRoomJoin([host], 'guest', true), { ok: true });

assert.deepEqual(validateRoomJoin([host], 'host', true), {
  ok: false,
  message: 'Host slot is already occupied.',
});

assert.deepEqual(validateRoomJoin([host, guest], 'host', true), {
  ok: false,
  message: 'Host slot is already occupied.',
});

assert.deepEqual(validateRoomJoin([host, guest], 'guest', true), {
  ok: false,
  message: 'Room is full.',
});

assert.deepEqual(validateRoomJoin([guest], 'guest', true), {
  ok: false,
  message: 'Room is full.',
});

assert.deepEqual(validateRoomJoin([guest], 'host', true), { ok: true });

console.log('roomAccess.test: ok');
