/**
 * Multi-wave siege: Begin Assault must retarget held echelons (run with npx tsx).
 */
import { unitsBeginSiegeAssaultOnCity, releaseAttackWaveHolds } from '../src/lib/siege';
import type { City, Unit } from '../src/types/game';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const city: City = {
  id: 'enemy_city',
  name: 'Fort',
  q: 5,
  r: 5,
  ownerId: 'player_ai',
  population: 50,
  morale: 80,
  storage: { food: 10, goods: 0, guns: 0, gunsL2: 0, iron: 0, stone: 0, wood: 0, refinedWood: 0 },
  storageCap: { food: 100, goods: 0, guns: 0, gunsL2: 0, iron: 0, stone: 0, wood: 0, refinedWood: 0 },
  buildings: [],
};

const rallyQ = 4;
const rallyR = 5;

function baseUnit(partial: Partial<Unit> & Pick<Unit, 'id' | 'q' | 'r'>): Unit {
  return {
    type: 'infantry',
    ownerId: 'player_human',
    hp: 10,
    maxHp: 10,
    xp: 0,
    level: 0,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
    ...partial,
  } as Unit;
}

// Wave 1 still en route to rally (siegingCityId set at order confirm — Assault UI available).
// Wave 2 held until wave 1 reaches rally.
const wave1EnRoute = baseUnit({
  id: 'w1',
  q: 2,
  r: 2,
  status: 'moving',
  targetQ: rallyQ,
  targetR: rallyR,
  siegingCityId: city.id,
});
const wave2Held = baseUnit({
  id: 'w2',
  q: 1,
  r: 1,
  status: 'idle',
  attackWaveHold: {
    waitForUnitIds: ['w1'],
    cityId: city.id,
    rallyQ,
    rallyR,
    centerQ: city.q,
    centerR: city.r,
    attackStyle: 'siege',
  },
});

// Old bug: assault only moves sieging units. Wave-1 never reaches rally → hold never releases.
const afterOldAssault: Unit[] = [
  {
    ...wave1EnRoute,
    targetQ: city.q,
    targetR: city.r,
    status: 'moving',
    assaulting: true,
  },
  { ...wave2Held },
];
delete afterOldAssault[0].siegingCityId;
releaseAttackWaveHolds(afterOldAssault, [city]);
assert(
  !!afterOldAssault[1].attackWaveHold,
  'repro: held wave stranded when assault starts before wave-1 reaches rally',
);

const afterFix = unitsBeginSiegeAssaultOnCity(
  [wave1EnRoute, wave2Held],
  city,
  'player_human',
  [city],
);
const u1 = afterFix.find(u => u.id === 'w1')!;
const u2 = afterFix.find(u => u.id === 'w2')!;

assert(u1.assaulting === true && u1.targetQ === city.q && u1.targetR === city.r, 'wave1 assaults center');
assert(!u1.siegingCityId, 'wave1 clears siegingCityId');
assert(u2.assaulting === true && u2.targetQ === city.q && u2.targetR === city.r, 'wave2 assaults center');
assert(!u2.attackWaveHold, 'wave2 hold cleared');
assert(u2.status === 'moving', 'wave2 is moving');

// Also when wave-1 is already at rally: held echelons must join the assault, not sit on hold.
const wave1AtRally = baseUnit({
  id: 'w1b',
  q: rallyQ,
  r: rallyR,
  status: 'idle',
  siegingCityId: city.id,
});
const wave2AtHold = baseUnit({
  id: 'w2b',
  q: 0,
  r: 0,
  status: 'idle',
  attackWaveHold: {
    waitForUnitIds: ['w1b'],
    cityId: city.id,
    rallyQ,
    rallyR,
    centerQ: city.q,
    centerR: city.r,
    attackStyle: 'siege',
  },
});
const joined = unitsBeginSiegeAssaultOnCity(
  [wave1AtRally, wave2AtHold],
  city,
  'player_human',
  [city],
);
assert(joined.find(u => u.id === 'w2b')!.assaulting === true, 'held wave at-rally case joins assault');
assert(!joined.find(u => u.id === 'w2b')!.attackWaveHold, 'held wave at-rally case clears hold');

// Unrelated hold must not be touched.
const otherHold = baseUnit({
  id: 'other',
  q: 0,
  r: 0,
  attackWaveHold: {
    waitForUnitIds: ['ghost'],
    cityId: 'other_city',
    rallyQ: 0,
    rallyR: 0,
    centerQ: 0,
    centerR: 0,
    attackStyle: 'siege',
  },
});
const untouched = unitsBeginSiegeAssaultOnCity([otherHold], city, 'player_human', [city])[0];
assert(!!untouched.attackWaveHold, 'holds for other cities untouched');

console.log('verify-siege-assault-waves: ok');
