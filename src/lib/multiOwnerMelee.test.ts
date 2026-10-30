/**
 * Same-hex melee must include every empire on the hex.
 * Play setup allows 1–5 opponents, so three stacks can meet on one tile.
 *
 * Run: npx tsx src/lib/multiOwnerMelee.test.ts
 */
import assert from 'node:assert/strict';
import { combatTick } from './military';
import { getUnitStats, type Unit } from '@/types/game';

function infantry(id: string, ownerId: string, q = 3, r = 4): Unit {
  const stats = getUnitStats({ type: 'infantry', armsLevel: 1 });
  return {
    id,
    type: 'infantry',
    q,
    r,
    ownerId,
    hp: stats.maxHp,
    maxHp: stats.maxHp,
    xp: 0,
    level: 0,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
  };
}

const NOW = 1_700_000_000_000;

function fight(units: Unit[]): Unit[] {
  combatTick(units, [], 7, [], new Map(), NOW);
  return units;
}

// Two empires: both sides enter the melee. HP is locked so the N-owner
// generalization cannot drift the common 1v1 resolution (salts 11/21).
{
  const units = fight([
    infantry('a1', 'player_human'),
    infantry('b1', 'player_ai'),
  ]);
  const hp = Object.fromEntries(units.map(u => [u.id, u.hp]));
  assert.deepEqual(hp, { a1: 97, b1: 91 });
  assert.equal(units.every(u => u.status === 'fighting'), true);
}

// You vs 2 AI (opponents slider). The third stack used to stand in the melee
// and neither strike nor be struck.
{
  const units = fight([
    infantry('h', 'player_human'),
    infantry('a', 'player_ai'),
    infantry('c', 'player_ai_2'),
  ]);
  const third = units.find(u => u.id === 'c');
  assert.ok(third);
  assert.equal(third.status, 'fighting');
  assert.ok(third.hp < third.maxHp, `third stack took no damage (hp ${third.hp})`);
  for (const id of ['h', 'a']) {
    const u = units.find(x => x.id === id);
    assert.ok(u);
    assert.equal(u.status, 'fighting');
  }
}

console.log('multiOwnerMelee.test.ts ok');
