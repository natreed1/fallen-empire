import assert from 'node:assert/strict';

import { DEFAULT_AI_PARAMS, initMultiplayerGame, stepSimulation } from '../src/core/gameCore';
import { emptyAiActions } from '../src/lib/ai';
import type { Unit } from '../src/types/game';
import {
  MULTIPLAYER_PLAYER_1_ID,
  MULTIPLAYER_PLAYER_2_ID,
  sanitizeMultiplayerPlan,
  validateRoomJoin,
} from '../game-server/src/multiplayerSecurity';

function testPlanSanitizer(): void {
  assert.deepEqual(sanitizeMultiplayerPlan(null), { moveTargets: [] });
  assert.deepEqual(sanitizeMultiplayerPlan({ moveTargets: { unitId: 'u1', toQ: 1, toR: 2 } }), {
    moveTargets: [],
  });
  assert.deepEqual(
    sanitizeMultiplayerPlan({
      builds: [{ cityId: 'enemy-city', type: 'barracks', q: 1, r: 1 }],
      moveTargets: [
        { unitId: 'u1', toQ: 1, toR: 2 },
        { unitId: 'u2', toQ: Number.POSITIVE_INFINITY, toR: 2 },
        { unitId: 'u3', toQ: 1.5, toR: 2 },
        { unitId: 99, toQ: 1, toR: 2 },
      ],
    }),
    { moveTargets: [{ unitId: 'u1', toQ: 1, toR: 2 }] },
  );
}

function testRoomJoinValidation(): void {
  assert.equal(validateRoomJoin({ clients: [], hasState: false, role: 'guest' }), 'Room not created yet — host must join first.');
  assert.equal(validateRoomJoin({ clients: [], hasState: false, role: 'host' }), null);
  assert.equal(
    validateRoomJoin({ clients: [{ role: 'host' }], hasState: true, role: 'host' }),
    'Host slot is already occupied.',
  );
  assert.equal(validateRoomJoin({ clients: [{ role: 'host' }], hasState: true, role: 'guest' }), null);
  assert.equal(
    validateRoomJoin({ clients: [{ role: 'host' }, { role: 'guest' }], hasState: true, role: 'guest' }),
    'Guest slot is already occupied.',
  );
}

function testHumanPlansCannotMoveOpponentUnits(): void {
  const state = initMultiplayerGame(424242);
  const p1City = state.cities.find(c => c.ownerId === MULTIPLAYER_PLAYER_1_ID);
  const p2City = state.cities.find(c => c.ownerId === MULTIPLAYER_PLAYER_2_ID);
  assert.ok(p1City);
  assert.ok(p2City);

  const opponentUnit: Unit = {
    id: 'p2-unit',
    type: 'infantry',
    q: p2City.q,
    r: p2City.r,
    ownerId: MULTIPLAYER_PLAYER_2_ID,
    hp: 10,
    maxHp: 10,
    xp: 0,
    level: 1,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
  };

  const next = stepSimulation(
    { ...state, units: [opponentUnit] },
    DEFAULT_AI_PARAMS,
    DEFAULT_AI_PARAMS,
    undefined,
    undefined,
    {
      humanPlansByPlayerId: {
        [MULTIPLAYER_PLAYER_1_ID]: {
          ...emptyAiActions(),
          moveTargets: [{ unitId: opponentUnit.id, toQ: p1City.q, toR: p1City.r }],
        },
        [MULTIPLAYER_PLAYER_2_ID]: emptyAiActions(),
      },
    },
  );

  const after = next.units.find(u => u.id === opponentUnit.id);
  assert.equal(after?.targetQ, undefined);
  assert.equal(after?.targetR, undefined);
  assert.equal(after?.status, 'idle');
}

testPlanSanitizer();
testRoomJoinValidation();
testHumanPlansCannotMoveOpponentUnits();

console.log('multiplayer authority checks passed');
