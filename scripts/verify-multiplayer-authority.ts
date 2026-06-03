/**
 * Regression checks for multiplayer plan authority (run with npx tsx).
 */
import {
  DEFAULT_AI_PARAMS,
  initMultiplayerGame,
  stepSimulation,
} from '../src/core/gameCore';
import { emptyAiActions } from '../src/lib/ai';
import type { Unit } from '../src/types/game';

const P1 = 'player_ai';
const P2 = 'player_ai_2';

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function makeUnit(id: string, ownerId: string, q: number, r: number): Unit {
  return {
    id,
    type: 'infantry',
    q,
    r,
    ownerId,
    hp: 10,
    maxHp: 10,
    xp: 0,
    level: 0,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
  };
}

const state = initMultiplayerGame(12345, { width: 38, height: 38 });
const p1City = state.cities.find(c => c.ownerId === P1);
const p2City = state.cities.find(c => c.ownerId === P2);
assert(p1City !== undefined, 'expected player 1 city');
assert(p2City !== undefined, 'expected player 2 city');

const p1Unit = makeUnit('p1-unit', P1, p1City.q, p1City.r);
const p2Unit = makeUnit('p2-unit', P2, p2City.q, p2City.r);
const withUnits = { ...state, units: [p1Unit, p2Unit] };

const after = stepSimulation(
  withUnits,
  DEFAULT_AI_PARAMS,
  DEFAULT_AI_PARAMS,
  undefined,
  undefined,
  {
    humanPlansByPlayerId: {
      [P1]: emptyAiActions(),
      [P2]: {
        ...emptyAiActions(),
        moveTargets: [
          { unitId: p1Unit.id, toQ: p2City.q, toR: p2City.r },
          { unitId: p2Unit.id, toQ: p1City.q, toR: p1City.r },
        ],
      },
    },
  },
);

const p1After = after.units.find(u => u.id === p1Unit.id);
const p2After = after.units.find(u => u.id === p2Unit.id);
assert(p1After !== undefined, 'expected player 1 unit to survive');
assert(p2After !== undefined, 'expected player 2 unit to survive');

assert(p1After.status === 'idle', 'player 2 plan must not move a player 1 unit');
assert(p1After.targetQ === undefined && p1After.targetR === undefined, 'player 1 unit must not receive cross-owner targets');
assert(p2After.status === 'moving', 'player 2 plan should still move its own unit');
assert(p2After.targetQ === p1City.q && p2After.targetR === p1City.r, 'player 2 own-unit target should be preserved');

console.log('verify-multiplayer-authority: ok');
