/**
 * Regression checks for authoritative multiplayer move ownership.
 *
 * Run with: npm exec --yes tsx -- scripts/verify-multiplayer-authority.ts
 */
import { DEFAULT_AI_PARAMS, initMultiplayerGame, stepSimulation } from '../src/core/gameCore';
import { emptyAiActions, type AiActions } from '../src/lib/ai';
import type { City, Unit } from '../src/types/game';

const P1 = 'player_ai';
const P2 = 'player_ai_2';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function planWithMoves(moves: AiActions['moveTargets']): AiActions {
  return {
    ...emptyAiActions(),
    moveTargets: moves,
  };
}

function testUnit(id: string, ownerId: string, city: City): Unit {
  return {
    id,
    type: 'infantry',
    q: city.q,
    r: city.r,
    ownerId,
    hp: 100,
    maxHp: 100,
    xp: 0,
    level: 0,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
  } as Unit;
}

const generated = initMultiplayerGame(20260522);
const p1City = generated.cities.find(c => c.ownerId === P1);
const p2City = generated.cities.find(c => c.ownerId === P2);
assert(!!p1City && !!p2City, 'expected both multiplayer capitals');

const p1Unit = testUnit('authority_p1', P1, p1City!);
const p2Unit = testUnit('authority_p2', P2, p2City!);
const initial = {
  ...generated,
  units: [p1Unit, p2Unit],
};

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
