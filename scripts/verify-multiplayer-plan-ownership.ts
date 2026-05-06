/**
 * Regression check: multiplayer player plans must not be able to order enemy units.
 * Run with: npx ts-node -r tsconfig-paths/register --project tsconfig.train.json scripts/verify-multiplayer-plan-ownership.ts
 */
import { initMultiplayerGame, stepSimulation, DEFAULT_AI_PARAMS } from '../src/core/gameCore';
import { emptyAiActions } from '../src/lib/ai';
import { hexDistance } from '../src/types/game';

const P1 = 'player_ai';
const P2 = 'player_ai_2';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function pickFarLandTarget(
  state: ReturnType<typeof initMultiplayerGame>,
  fromQ: number,
  fromR: number,
): { q: number; r: number } {
  const target = Array.from(state.tiles.values()).find(
    t =>
      t.biome !== 'water' &&
      t.biome !== 'mountain' &&
      hexDistance(fromQ, fromR, t.q, t.r) >= 4,
  );
  assert(target != null, 'expected a far land target');
  return { q: target!.q, r: target!.r };
}

const state = initMultiplayerGame(424242, { width: 24, height: 24 });
const p1Unit = state.units.find(u => u.ownerId === P1 && u.hp > 0 && u.status !== 'fighting');
const p2Unit = state.units.find(u => u.ownerId === P2 && u.hp > 0 && u.status !== 'fighting');
assert(p1Unit != null, 'expected player 1 unit');
assert(p2Unit != null, 'expected player 2 unit');

const p1Target = pickFarLandTarget(state, p1Unit!.q, p1Unit!.r);
const spoofedP2Target = pickFarLandTarget(state, p2Unit!.q, p2Unit!.r);

const p1Plan = emptyAiActions();
p1Plan.moveTargets = [
  { unitId: p2Unit!.id, toQ: spoofedP2Target.q, toR: spoofedP2Target.r },
  { unitId: p1Unit!.id, toQ: p1Target.q, toR: p1Target.r },
];

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

const p1After = next.units.find(u => u.id === p1Unit!.id);
const p2After = next.units.find(u => u.id === p2Unit!.id);
assert(p1After != null, 'expected player 1 unit after step');
assert(p2After != null, 'expected player 2 unit after step');
assert(
  p1After!.targetQ === p1Target.q && p1After!.targetR === p1Target.r,
  'player 1 should still be able to order its own unit',
);
assert(
  !(p2After!.targetQ === spoofedP2Target.q && p2After!.targetR === spoofedP2Target.r),
  'player 1 plan must not be able to order player 2 unit',
);

console.log('verify-multiplayer-plan-ownership: ok');
