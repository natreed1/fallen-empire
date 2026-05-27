import assert from 'node:assert/strict';
import { initMultiplayerGame, stepSimulation, DEFAULT_AI_PARAMS } from '../src/core/gameCore';
import { emptyAiActions, type AiActions } from '../src/lib/ai';
import { getUnitStats, type Unit } from '../src/types/game';
import { mergeClientMovePlan, sanitizeClientPlanPatch } from '../game-server/src/clientPlans';
import { validateRoomJoin } from '../game-server/src/roomAccess';

const P1 = 'player_ai';
const P2 = 'player_ai_2';

function makeInfantry(id: string, ownerId: string, q: number, r: number): Unit {
  const stats = getUnitStats({ type: 'infantry', armsLevel: 1 });
  return {
    id,
    type: 'infantry',
    q,
    r,
    ownerId,
    hp: stats.maxHp,
    maxHp: stats.maxHp,
    xp: 0,
    level: 0,
    armsLevel: 1,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
  };
}

function planWithMoves(moveTargets: AiActions['moveTargets']): AiActions {
  return {
    ...emptyAiActions(),
    moveTargets,
  };
}

function verifyCrossOwnerMoveTargetsAreIgnored(): void {
  const state = initMultiplayerGame(12345, { width: 28, height: 28 });
  const p1City = state.cities.find(city => city.ownerId === P1);
  const p2City = state.cities.find(city => city.ownerId === P2);
  assert.ok(p1City, 'expected P1 city');
  assert.ok(p2City, 'expected P2 city');

  const p1Unit = makeInfantry('p1_unit', P1, p1City.q, p1City.r);
  const p2Unit = makeInfantry('p2_unit', P2, p2City.q, p2City.r);

  const next = stepSimulation(
    {
      ...state,
      units: [p1Unit, p2Unit],
    },
    DEFAULT_AI_PARAMS,
    DEFAULT_AI_PARAMS,
    undefined,
    undefined,
    {
      humanPlansByPlayerId: {
        [P1]: planWithMoves([{ unitId: p2Unit.id, toQ: p1City.q, toR: p1City.r }]),
        [P2]: emptyAiActions(),
      },
    },
  );

  const p2After = next.units.find(unit => unit.id === p2Unit.id);
  assert.ok(p2After, 'expected P2 unit to survive');
  assert.equal(p2After.ownerId, P2);
  assert.equal(p2After.q, p2Unit.q);
  assert.equal(p2After.r, p2Unit.r);
  assert.equal(p2After.status, 'idle');
  assert.equal(p2After.targetQ, undefined);
  assert.equal(p2After.targetR, undefined);
}

function verifyClientPlansAreSanitized(): void {
  const sanitized = sanitizeClientPlanPatch({
    builds: [{ cityId: 'enemy_city', type: 'factory', q: 1, r: 1 }],
    recruits: [{ cityId: 'enemy_city', type: 'cavalry' }],
    moveTargets: [
      { unitId: 'unit_1', toQ: 4, toR: 5 },
      { unitId: '', toQ: 4, toR: 5 },
      { unitId: 'unit_2', toQ: Number.NaN, toR: 5 },
      { unitId: 'unit_3', toQ: 4.5, toR: 5 },
    ],
  });

  assert.deepEqual(Object.keys(sanitized), ['moveTargets']);
  assert.deepEqual(sanitized.moveTargets, [{ unitId: 'unit_1', toQ: 4, toR: 5 }]);

  const merged = mergeClientMovePlan(emptyAiActions(), sanitized);
  assert.deepEqual(merged.moveTargets, [{ unitId: 'unit_1', toQ: 4, toR: 5 }]);
  assert.deepEqual(merged.builds, []);
  assert.deepEqual(merged.recruits, []);
}

function verifyRoomRoleAdmission(): void {
  assert.equal(validateRoomJoin([], 'guest'), 'Room not created yet - host must join first.');
  assert.equal(validateRoomJoin([], 'host'), null);
  assert.equal(validateRoomJoin(['host'], 'host'), 'Room already has a host.');
  assert.equal(validateRoomJoin(['host'], 'guest'), null);
  assert.equal(validateRoomJoin(['host', 'guest'], 'host'), 'Room is full.');
}

verifyCrossOwnerMoveTargetsAreIgnored();
verifyClientPlansAreSanitized();
verifyRoomRoleAdmission();

console.log('verify-multiplayer-authority: ok');
