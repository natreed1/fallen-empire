/**
 * Regression checks for authoritative multiplayer move ownership.
 *
 * Run with: npm exec --yes tsx -- scripts/verify-multiplayer-authority.ts
 */
import { DEFAULT_AI_PARAMS, initMultiplayerGame, stepSimulation } from '../src/core/gameCore';
import { emptyAiActions, type AiActions } from '../src/lib/ai';
import type { Unit } from '../src/types/game';

const P1 = 'player_ai';
const P2 = 'player_ai_2';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function firstMobileUnit(units: Unit[], ownerId: string): Unit {
  const unit = units.find(u => u.ownerId === ownerId && u.hp > 0 && u.status !== 'fighting');
  assert(!!unit, `expected mobile unit for ${ownerId}`);
  return unit!;
}

function planWithMoves(moves: AiActions['moveTargets']): AiActions {
  return {
    ...emptyAiActions(),
    moveTargets: moves,
  };
}

const initial = initMultiplayerGame(20260522);
const p1Unit = firstMobileUnit(initial.units, P1);
const p2Unit = firstMobileUnit(initial.units, P2);
const p1City = initial.cities.find(c => c.ownerId === P1);
const p2City = initial.cities.find(c => c.ownerId === P2);
assert(!!p1City && !!p2City, 'expected both multiplayer capitals');

const maliciousTarget = { q: p1City!.q, r: p1City!.r };
const legitimateTarget = { q: p2City!.q, r: p2City!.r };

const next = stepSimulation(
  initial,
  DEFAULT_AI_PARAMS,
  DEFAULT_AI_PARAMS,
  undefined,
  undefined,
  {
    humanPlansByPlayerId: {
      [P1]: planWithMoves([
        { unitId: p1Unit.id, toQ: legitimateTarget.q, toR: legitimateTarget.r },
        { unitId: p2Unit.id, toQ: maliciousTarget.q, toR: maliciousTarget.r },
      ]),
      [P2]: emptyAiActions(),
    },
  },
);

const movedP1 = next.units.find(u => u.id === p1Unit.id);
const hijackedP2 = next.units.find(u => u.id === p2Unit.id);
assert(!!movedP1 && !!hijackedP2, 'expected test units to survive one simulation step');

assert(
  movedP1!.targetQ === legitimateTarget.q && movedP1!.targetR === legitimateTarget.r,
  'own player move target should be accepted',
);

assert(
  hijackedP2!.targetQ !== maliciousTarget.q || hijackedP2!.targetR !== maliciousTarget.r,
  'player plan must not be able to move an enemy unit',
);

console.log('verify-multiplayer-authority: ok');
