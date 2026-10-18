/**
 * Multiplayer map-click raids must become server moveTargets (one per land unit).
 * Run: npx tsx scripts/verify-mp-building-raid.ts
 */
import { buildingRaidMoveTargets } from '../src/lib/multiplayerBuildingRaid';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const targets = buildingRaidMoveTargets(['u1', 'u2', 'u1', ''], 4, 7);
assert(targets.length === 2, `expected 2 raid moves, got ${targets.length}`);
assert(targets[0]?.unitId === 'u1' && targets[0]?.toQ === 4 && targets[0]?.toR === 7, 'first unit destination');
assert(targets[1]?.unitId === 'u2', 'second unit kept');
assert(!targets.some(t => t.unitId === ''), 'blank ids are not orders');

const none = buildingRaidMoveTargets([], 1, 1);
assert(none.length === 0, 'no units means no march');

console.log('verify-mp-building-raid: ok');
