/**
 * Run: npx tsx src/lib/instantCaptureOwner.test.ts
 * Locks the economy-cycle instant-capture rule to the real-time hold.
 */
import assert from 'node:assert/strict';
import { instantCaptureOwnerId } from './military';

const enemy = (id: string) => ({ ownerId: id });

// Sole attacker, no garrison, no wall: city flips.
assert.equal(
  instantCaptureOwnerId([enemy('player_ai')], [], 12, false),
  'player_ai',
);

// Population 0 bypasses an intact wall when the attacker is alone.
assert.equal(
  instantCaptureOwnerId([enemy('player_ai')], [], 0, true),
  'player_ai',
);

// Intact wall and living population stay on the hold timer.
assert.equal(
  instantCaptureOwnerId([enemy('player_ai'), enemy('player_ai')], [], 8, true),
  null,
);

// A garrison still on a depopulated city blocks the flip.
assert.equal(
  instantCaptureOwnerId([enemy('player_ai')], [enemy('player_human')], 0, false),
  null,
);

// Two empires on an empty city do not award it to whichever unit is listed first.
assert.equal(
  instantCaptureOwnerId(
    [enemy('player_ai'), enemy('player_ai_2')],
    [],
    0,
    false,
  ),
  null,
);

// No attacker: nothing to capture.
assert.equal(instantCaptureOwnerId([], [], 0, false), null);

console.log('instantCaptureOwnerId: ok');
