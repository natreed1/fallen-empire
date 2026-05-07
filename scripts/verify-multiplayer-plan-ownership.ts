/**
 * Regression check: multiplayer clients cannot issue orders for the other player's units.
 * Run with:
 *   npx ts-node -r tsconfig-paths/register --project tsconfig.train.json scripts/verify-multiplayer-plan-ownership.ts
 */

import { DEFAULT_AI_PARAMS, initMultiplayerGame, stepSimulation } from '../src/core/gameCore';
import { emptyAiActions } from '../src/lib/ai';
import { getUnitStats, type Unit } from '../src/types/game';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function makeInfantry(id: string, ownerId: string, q: number, r: number): Unit {
  const stats = getUnitStats({ type: 'infantry', armsLevel: 1 });
  return {
    id,
    type: 'infantry',
    q,
    r,
    ownerId,
    hp: stats.hp,
    maxHp: stats.hp,
    xp: 0,
    level: 0,
    armsLevel: 1,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: Number.MAX_SAFE_INTEGER,
  };
}

const P1 = 'player_ai';
const P2 = 'player_ai_2';

const state = initMultiplayerGame(12345, { width: 24, height: 24 });
const p1City = state.cities.find(c => c.ownerId === P1);
const p2City = state.cities.find(c => c.ownerId === P2);
assert(Boolean(p1City && p2City), 'expected both multiplayer capitals');

state.units = [
  makeInfantry('p1-unit', P1, p1City!.q, p1City!.r),
  makeInfantry('p2-unit', P2, p2City!.q, p2City!.r),
];

const p1Plan = emptyAiActions();
p1Plan.moveTargets.push({ unitId: 'p2-unit', toQ: p1City!.q, toR: p1City!.r });

const next = stepSimulation(state, DEFAULT_AI_PARAMS, DEFAULT_AI_PARAMS, undefined, undefined, {
  humanPlansByPlayerId: {
    [P1]: p1Plan,
    [P2]: emptyAiActions(),
  },
});

const p2Unit = next.units.find(u => u.id === 'p2-unit');
assert(Boolean(p2Unit), 'expected p2 unit to survive');
assert(p2Unit!.targetQ == null && p2Unit!.targetR == null, 'p1 plan must not set p2 unit target');

console.log('verify-multiplayer-plan-ownership: ok');
