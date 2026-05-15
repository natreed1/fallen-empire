/**
 * Regression checks for authoritative multiplayer plan handling.
 * Run: npx ts-node -r tsconfig-paths/register --project tsconfig.train.json scripts/verify-multiplayer-authority.ts
 */
import assert from 'node:assert/strict';
import {
  DEFAULT_AI_PARAMS,
  initMultiplayerGame,
  stepSimulation,
} from '../src/core/gameCore';
import { emptyAiActions } from '../src/lib/ai';
import type { Unit } from '../src/types/game';

const P1 = 'player_ai';
const P2 = 'player_ai_2';

const state = initMultiplayerGame(12345, { width: 38, height: 38 });
const p1City = state.cities.find(c => c.ownerId === P1);
const p2City = state.cities.find(c => c.ownerId === P2);

assert.ok(p1City, 'expected a player 1 city in multiplayer initial state');
assert.ok(p2City, 'expected a player 2 city in multiplayer initial state');

const p1Unit: Unit = {
  id: 'p1-test-unit',
  type: 'infantry',
  q: p1City.q,
  r: p1City.r,
  ownerId: P1,
  hp: 30,
  maxHp: 30,
  xp: 0,
  level: 0,
  status: 'idle',
  stance: 'aggressive',
  nextMoveAt: 0,
};
const p2Unit: Unit = {
  id: 'p2-test-unit',
  type: 'infantry',
  q: p2City.q,
  r: p2City.r,
  ownerId: P2,
  hp: 30,
  maxHp: 30,
  xp: 0,
  level: 0,
  status: 'idle',
  stance: 'aggressive',
  nextMoveAt: 0,
};

state.units = [p1Unit, p2Unit];

const stolenTarget = { q: p2Unit.q + 3, r: p2Unit.r };
const legitimateTarget = { q: p1Unit.q + 3, r: p1Unit.r };

const next = stepSimulation(
  state,
  DEFAULT_AI_PARAMS,
  DEFAULT_AI_PARAMS,
  undefined,
  undefined,
  {
    humanPlansByPlayerId: {
      [P1]: {
        ...emptyAiActions(),
        moveTargets: [
          { unitId: p2Unit.id, toQ: stolenTarget.q, toR: stolenTarget.r },
          { unitId: p1Unit.id, toQ: legitimateTarget.q, toR: legitimateTarget.r },
        ],
      },
      [P2]: emptyAiActions(),
    },
  },
);

const p2After = next.units.find(u => u.id === p2Unit.id);
const p1After = next.units.find(u => u.id === p1Unit.id);

assert.ok(p2After, 'expected player 2 unit to survive one simulation step');
assert.ok(p1After, 'expected player 1 unit to survive one simulation step');
assert.notEqual(p2After.targetQ, stolenTarget.q, 'player 1 plan must not retarget player 2 unit');
assert.notEqual(p2After.targetR, stolenTarget.r, 'player 1 plan must not retarget player 2 unit');
assert.equal(p1After.targetQ, legitimateTarget.q, 'player 1 should still control its own unit');
assert.equal(p1After.targetR, legitimateTarget.r, 'player 1 should still control its own unit');

console.log('verify-multiplayer-authority: ok');
