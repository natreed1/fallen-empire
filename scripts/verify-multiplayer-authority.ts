/**
 * Regression checks for multiplayer client plan safety.
 * Run with: npm exec --yes tsx -- scripts/verify-multiplayer-authority.ts
 */
import { initMultiplayerGame, stepSimulation, DEFAULT_AI_PARAMS } from '../src/core/gameCore';
import { emptyAiActions, type AiActions } from '../src/lib/ai';
import { mergeClientPlan } from '../game-server/src/clientPlans';
import type { Unit } from '../src/types/game';

const P1 = 'player_ai';
const P2 = 'player_ai_2';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function makeUnit(id: string, ownerId: string, q: number, r: number): Unit {
  return {
    id,
    type: 'infantry',
    q,
    r,
    ownerId,
    hp: 30,
    maxHp: 30,
    xp: 0,
    level: 0,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 1_000_000_000,
  };
}

const toxicPlan = {
  builds: null,
  recruits: null,
  moveTargets: [
    { unitId: 'p2-unit', toQ: 4, toR: 4 },
    { unitId: 'bad', toQ: Number.NaN, toR: 2 },
    'not-a-target',
  ],
};

const merged = mergeClientPlan(emptyAiActions(), toxicPlan);
assert(Array.isArray(merged.builds), 'toxic builds payload must not poison plan shape');
assert(Array.isArray(merged.recruits), 'toxic recruits payload must not poison plan shape');
assert(merged.moveTargets.length === 1, 'only finite move targets should be accepted');
assert(merged.moveTargets[0].unitId === 'p2-unit', 'valid move target should survive sanitization');

let state = initMultiplayerGame(420_420);
const p2City = state.cities.find(c => c.ownerId === P2);
assert(!!p2City, 'expected P2 city');
state = {
  ...state,
  units: [makeUnit('p2-unit', P2, p2City!.q, p2City!.r)],
};

const maliciousP1Plan: AiActions = {
  ...emptyAiActions(),
  moveTargets: [{ unitId: 'p2-unit', toQ: p2City!.q - 3, toR: p2City!.r - 3 }],
};
const afterRejected = stepSimulation(
  state,
  DEFAULT_AI_PARAMS,
  DEFAULT_AI_PARAMS,
  undefined,
  undefined,
  { humanPlansByPlayerId: { [P1]: maliciousP1Plan, [P2]: emptyAiActions() } },
);
const rejectedUnit = afterRejected.units.find(u => u.id === 'p2-unit');
assert(rejectedUnit?.targetQ === undefined && rejectedUnit?.targetR === undefined, 'P1 must not retarget a P2 unit');
assert(rejectedUnit?.status === 'idle', 'unauthorized move must not change unit status');

const authorizedP2Plan: AiActions = {
  ...emptyAiActions(),
  moveTargets: [{ unitId: 'p2-unit', toQ: p2City!.q - 3, toR: p2City!.r - 3 }],
};
const afterAccepted = stepSimulation(
  state,
  DEFAULT_AI_PARAMS,
  DEFAULT_AI_PARAMS,
  undefined,
  undefined,
  { humanPlansByPlayerId: { [P1]: emptyAiActions(), [P2]: authorizedP2Plan } },
);
const acceptedUnit = afterAccepted.units.find(u => u.id === 'p2-unit');
assert(acceptedUnit?.targetQ === p2City!.q - 3 && acceptedUnit?.targetR === p2City!.r - 3, 'owner should still control own unit');
assert(acceptedUnit?.status === 'moving', 'authorized move should set unit moving');

console.log('verify-multiplayer-authority: ok');
