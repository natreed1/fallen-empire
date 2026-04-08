/**
 * Sanity checks for major engagement thresholds (run: npx ts-node --transpile-only -r tsconfig-paths/register --project tsconfig.train.json scripts/verify-major-engagement.ts)
 */
import type { Unit } from '../src/types/game';
import {
  globalLandArmyPower,
  engagedLandPower,
  majorEngagementThresholdMet,
  bothSidesMeetMajorThreshold,
} from '../src/lib/majorEngagement';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const base = (partial: Partial<Unit> & Pick<Unit, 'id' | 'type' | 'ownerId' | 'q' | 'r'>): Unit =>
  ({
    hp: 100,
    maxHp: 100,
    level: 1,
    status: 'idle' as const,
    ...partial,
  }) as Unit;

const p1 = 'player_human';
const p2 = 'ai_0';

// Global: 500 HP for p2 (5 infantry), engaged 100 (1 infantry) => 20% — on threshold
const globalEnemy: Unit[] = [
  base({ id: 'e1', type: 'infantry', ownerId: p2, q: 0, r: 0 }),
  base({ id: 'e2', type: 'infantry', ownerId: p2, q: 1, r: 0 }),
  base({ id: 'e3', type: 'infantry', ownerId: p2, q: 2, r: 0 }),
  base({ id: 'e4', type: 'infantry', ownerId: p2, q: 3, r: 0 }),
  base({ id: 'e5', type: 'infantry', ownerId: p2, q: 4, r: 0 }),
];
const engagedSmall: Unit[] = [
  base({ id: 'a1', type: 'infantry', ownerId: p1, q: 5, r: 5 }),
];
assert(globalLandArmyPower(p2, globalEnemy) === 500, 'global sum');
assert(engagedLandPower(engagedSmall) === 100, 'engaged sum');
assert(
  majorEngagementThresholdMet(engagedSmall, p2, [...globalEnemy, ...engagedSmall]),
  '20% threshold met',
);

const engagedTooSmall: Unit[] = [
  base({ id: 'a2', type: 'infantry', ownerId: p1, q: 5, r: 5, maxHp: 99, hp: 99 }),
];
assert(
  !majorEngagementThresholdMet(engagedTooSmall, p2, [...globalEnemy, ...engagedTooSmall]),
  '19% should not meet',
);

// Builder excluded from land military
const withBuilder: Unit[] = [
  ...globalEnemy,
  base({ id: 'b1', type: 'builder', ownerId: p2, q: 0, r: 1 }),
];
assert(globalLandArmyPower(p2, withBuilder) === 500, 'builder excluded from global');

const side1 = [base({ id: 's1', type: 'cavalry', ownerId: p1, q: 0, r: 0, maxHp: 200, hp: 200 })];
const side2 = [base({ id: 's2', type: 'infantry', ownerId: p2, q: 0, r: 0, maxHp: 200, hp: 200 })];
const globalP1: Unit[] = [base({ id: 'g1', type: 'infantry', ownerId: p1, q: 10, r: 0, maxHp: 500, hp: 500 })];
const globalP2: Unit[] = globalEnemy;
const all = [...side1, ...side2, ...globalP1, ...globalP2];
assert(
  bothSidesMeetMajorThreshold(side1, side2, p1, p2, all),
  'both sides symmetric threshold',
);

console.log('verify-major-engagement: OK');
