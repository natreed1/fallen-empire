/**
 * Regression checks for multiplayer plan authority.
 * Run with: npm exec --yes tsx -- scripts/verify-multiplayer-authority.ts
 */
import { initMultiplayerGame, stepSimulation, DEFAULT_AI_PARAMS, type SimState } from '../src/core/gameCore';
import { emptyAiActions, type AiActions } from '../src/lib/ai';
import { mergeClientPlan } from '../game-server/src/clientPlans';

const P1 = 'player_ai';
const P2 = 'player_ai_2';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function planWithMove(unitId: string, toQ: number, toR: number): AiActions {
  const plan = emptyAiActions();
  plan.moveTargets = [{ unitId, toQ, toR }];
  return plan;
}

function stepWithPlans(state: SimState, p1Plan: AiActions, p2Plan: AiActions): SimState {
  return stepSimulation(
    state,
    DEFAULT_AI_PARAMS,
    DEFAULT_AI_PARAMS,
    undefined,
    undefined,
    { humanPlansByPlayerId: { [P1]: p1Plan, [P2]: p2Plan } },
  );
}

function firstUnit(state: SimState, ownerId: string) {
  const unit = state.units.find(u => u.ownerId === ownerId && u.hp > 0);
  if (!unit) throw new Error(`missing unit for ${ownerId}`);
  return unit;
}

function firstCity(state: SimState, ownerId: string) {
  const city = state.cities.find(c => c.ownerId === ownerId);
  if (!city) throw new Error(`missing city for ${ownerId}`);
  return city;
}

const emptyP2Plan = emptyAiActions();

{
  const state = initMultiplayerGame(9981, { width: 38, height: 38 });
  const p2Unit = firstUnit(state, P2);
  const p1City = firstCity(state, P1);

  const next = stepWithPlans(state, planWithMove(p2Unit.id, p1City.q, p1City.r), emptyP2Plan);
  const after = next.units.find(u => u.id === p2Unit.id);

  assert(after != null, 'opponent unit still exists');
  assert(after.targetQ === undefined && after.targetR === undefined, 'player 1 must not be able to target player 2 units');
  assert(after.status !== 'moving', 'player 1 must not be able to move player 2 units');
}

{
  const state = initMultiplayerGame(9982, { width: 38, height: 38 });
  const p2Unit = firstUnit(state, P2);
  const p1City = firstCity(state, P1);

  const next = stepWithPlans(state, emptyAiActions(), planWithMove(p2Unit.id, p1City.q, p1City.r));
  const after = next.units.find(u => u.id === p2Unit.id);

  assert(after != null, 'own unit still exists');
  assert(after.targetQ === p1City.q && after.targetR === p1City.r, 'owner move target should be preserved');
  assert(after.status === 'moving', 'owner move should still be applied');
}

{
  const base = emptyAiActions();
  const merged = mergeClientPlan(base, {
    moveTargets: [
      { unitId: 'unit-1', toQ: 1, toR: 2 },
      { unitId: 'unit-1', toQ: 3, toR: 4 },
      { unitId: 'unit-2', toQ: Infinity, toR: 0 },
      null,
      'not-a-move',
    ],
    recruits: [{ cityId: 'enemy-city', type: 'infantry' }],
    builds: [{ cityId: 'enemy-city', type: 'barracks', q: 0, r: 0 }],
  });

  assert(merged.moveTargets.length === 1, 'sanitizer should keep only valid move targets');
  assert(merged.moveTargets[0].unitId === 'unit-1', 'sanitizer should preserve the valid unit id');
  assert(merged.moveTargets[0].toQ === 3 && merged.moveTargets[0].toR === 4, 'latest move per unit wins');
  assert(merged.recruits.length === 0 && merged.builds.length === 0, 'client plan patches cannot inject non-move actions');
}

console.log('verify-multiplayer-authority: ok');
