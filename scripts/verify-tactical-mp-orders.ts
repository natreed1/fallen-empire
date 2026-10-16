/**
 * Army confirm in multiplayer must emit server moveTargets for move/intercept
 * and must not pretend patrol/attack orders were applied.
 * Run: npx tsx scripts/verify-tactical-mp-orders.ts
 */
import { planMultiplayerTacticalOrders } from '../src/lib/tacticalMultiplayerOrders';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const units = {
  '1,2': [
    { id: 'land-a' },
    { id: 'land-b' },
    { id: 'cargo', aboardShipId: 'ship-1' },
  ],
  '4,5': [{ id: 'ship-1' }],
};

const plan = planMultiplayerTacticalOrders(
  {
    '1,2': { type: 'move', toQ: 3, toR: 4, participatingUnitIds: ['land-a', 'cargo'] },
    '4,5': { type: 'intercept', toQ: 6, toR: 6 },
    '8,8': { type: 'patrol' },
    '9,9': { type: 'attack_city' },
  },
  key => units[key as keyof typeof units] ?? [],
  stackKey => stackKey !== '4,5',
);

assert(plan.moveTargets.length === 1, `expected 1 synced move, got ${plan.moveTargets.length}`);
assert(plan.moveTargets[0]?.unitId === 'land-a', 'participation filter must keep land-a');
assert(plan.moveTargets[0]?.toQ === 3 && plan.moveTargets[0]?.toR === 4, 'destination must match the order');
assert(!plan.moveTargets.some(m => m.unitId === 'cargo'), 'embarked cargo must not receive a march');
assert(!plan.moveTargets.some(m => m.unitId === 'ship-1'), 'allowMove rejection must drop the intercept');
assert(plan.unsyncedKinds.includes('patrol'), 'patrol is not a server move');
assert(plan.unsyncedKinds.includes('attack_city'), 'attack orders are not a server move');
assert(!plan.unsyncedKinds.includes('move'), 'a filtered move is not an unsynced kind');

const all = planMultiplayerTacticalOrders(
  { '1,2': { type: 'intercept', toQ: 0, toR: 1 } },
  key => units[key as keyof typeof units] ?? [],
  () => true,
);
assert(
  all.moveTargets.map(m => m.unitId).sort().join(',') === 'land-a,land-b',
  'omitted participatingUnitIds marches every unit not aboard a ship',
);

console.log('verify-tactical-mp-orders: ok');
