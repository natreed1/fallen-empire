/**
 * Regression checks for authoritative multiplayer plan application.
 * Run with: npm exec --yes tsx -- scripts/verify-multiplayer-authority.ts
 */
import {
  DEFAULT_AI_PARAMS,
  initMultiplayerGame,
  stepSimulation,
} from '../src/core/gameCore';
import { emptyAiActions } from '../src/lib/ai';
import { tileKey } from '../src/types/game';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const P1 = 'player_ai';
const P2 = 'player_ai_2';

const state = initMultiplayerGame(4242, {
  width: 24,
  height: 24,
  mapTerrain: 'no_water',
});

const p1Unit = state.units.find(u => u.ownerId === P1 && u.hp > 0);
const p2Unit = state.units.find(u => u.ownerId === P2 && u.hp > 0);
assert(!!p1Unit, 'expected a live Player 1 unit');
assert(!!p2Unit, 'expected a live Player 2 unit');

const destination = Array.from(state.tiles.values()).find(
  t => t.biome !== 'water' && tileKey(t.q, t.r) !== tileKey(p1Unit!.q, p1Unit!.r),
);
assert(!!destination, 'expected a valid move destination');

const p2Before = {
  targetQ: p2Unit!.targetQ,
  targetR: p2Unit!.targetR,
  status: p2Unit!.status,
  q: p2Unit!.q,
  r: p2Unit!.r,
};

const p1Plan = emptyAiActions();
p1Plan.moveTargets.push(
  { unitId: p1Unit!.id, toQ: destination!.q, toR: destination!.r },
  { unitId: p2Unit!.id, toQ: destination!.q, toR: destination!.r },
);

const p2Plan = emptyAiActions();

const next = stepSimulation(
  state,
  DEFAULT_AI_PARAMS,
  DEFAULT_AI_PARAMS,
  undefined,
  undefined,
  { humanPlansByPlayerId: { [P1]: p1Plan, [P2]: p2Plan } },
);

const p1After = next.units.find(u => u.id === p1Unit!.id);
const p2After = next.units.find(u => u.id === p2Unit!.id);

assert(!!p1After, 'expected Player 1 unit after simulation step');
assert(!!p2After, 'expected Player 2 unit after simulation step');
assert(
  p1After!.targetQ === destination!.q &&
    p1After!.targetR === destination!.r &&
    p1After!.status === 'moving',
  'owner move target should be accepted',
);
assert(p2After!.q === p2Before.q && p2After!.r === p2Before.r, 'opponent unit position should not be changed by P1 plan');
assert(p2After!.targetQ === p2Before.targetQ, 'opponent targetQ should not be changed by P1 plan');
assert(p2After!.targetR === p2Before.targetR, 'opponent targetR should not be changed by P1 plan');
assert(p2After!.status === p2Before.status, 'opponent status should not be changed by P1 plan');

console.log('verify-multiplayer-authority: ok');
