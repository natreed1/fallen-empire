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

const P1 = 'player_ai';
const P2 = 'player_ai_2';

const state = initMultiplayerGame(12345, { width: 38, height: 38 });
const p1Unit = state.units.find(u => u.ownerId === P1 && u.hp > 0);
const p2Unit = state.units.find(u => u.ownerId === P2 && u.hp > 0);

assert.ok(p1Unit, 'expected a player 1 unit in multiplayer initial state');
assert.ok(p2Unit, 'expected a player 2 unit in multiplayer initial state');

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
