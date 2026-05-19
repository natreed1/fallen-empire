import {
  DEFAULT_AI_PARAMS,
  initMultiplayerGame,
  stepSimulation,
} from '../src/core/gameCore';
import { emptyAiActions } from '../src/lib/ai';

const P1 = 'player_ai';
const P2 = 'player_ai_2';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const state = initMultiplayerGame(424242);
const p1Unit = state.units.find(u => u.ownerId === P1 && u.hp > 0 && u.status !== 'fighting');
const p2Unit = state.units.find(u => u.ownerId === P2 && u.hp > 0 && u.status !== 'fighting');
const p1City = state.cities.find(c => c.ownerId === P1);
const p2City = state.cities.find(c => c.ownerId === P2);

assert(p1Unit, 'expected Player 1 to start with a movable unit');
assert(p2Unit, 'expected Player 2 to start with a movable unit');
assert(p1City, 'expected Player 1 to start with a city');
assert(p2City, 'expected Player 2 to start with a city');

const p2Before = {
  q: p2Unit.q,
  r: p2Unit.r,
  targetQ: p2Unit.targetQ,
  targetR: p2Unit.targetR,
  status: p2Unit.status,
};

const p1Plan = {
  ...emptyAiActions(),
  moveTargets: [
    // Legitimate own-unit order should still be accepted.
    { unitId: p1Unit.id, toQ: p2City.q, toR: p2City.r },
    // Malicious cross-owner order must be ignored.
    { unitId: p2Unit.id, toQ: p1City.q, toR: p1City.r },
  ],
};

const next = stepSimulation(
  state,
  DEFAULT_AI_PARAMS,
  DEFAULT_AI_PARAMS,
  undefined,
  undefined,
  {
    humanPlansByPlayerId: {
      [P1]: p1Plan,
      [P2]: emptyAiActions(),
    },
  },
);

const movedP1 = next.units.find(u => u.id === p1Unit.id);
const hijackedP2 = next.units.find(u => u.id === p2Unit.id);

assert(movedP1, 'expected Player 1 unit to survive simulation step');
assert(hijackedP2, 'expected Player 2 unit to survive simulation step');
assert(
  movedP1.targetQ === p2City.q && movedP1.targetR === p2City.r,
  'expected Player 1 own-unit move target to be applied',
);
assert(
  hijackedP2.targetQ === p2Before.targetQ &&
    hijackedP2.targetR === p2Before.targetR &&
    hijackedP2.q === p2Before.q &&
    hijackedP2.r === p2Before.r &&
    hijackedP2.status === p2Before.status,
  'Player 1 was able to change a Player 2 unit through a forged move target',
);

console.log('multiplayer authority regression passed');
