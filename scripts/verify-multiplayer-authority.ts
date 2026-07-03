import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { DEFAULT_AI_PARAMS, initMultiplayerGame, stepSimulation } from '../src/core/gameCore';
import { emptyAiActions } from '../src/lib/ai';
import { remapSimStateForClient } from '../src/lib/multiplayerRemap';
import { sanitizeClientPlanPatch } from '../game-server/src/clientPlans';
import { tileKey, type Unit } from '../src/types/game';

const P1 = 'player_ai';
const P2 = 'player_ai_2';

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

function verifyStepSimulationMoveAuthority(): void {
  const state = initMultiplayerGame(424242, { width: 28, height: 28 });
  const p1City = state.cities.find(c => c.ownerId === P1);
  const p2City = state.cities.find(c => c.ownerId === P2);
  assert(p1City, 'missing player 1 city');
  assert(p2City, 'missing player 2 city');

  state.units = [
    makeUnit('p1-unit', P1, p1City.q, p1City.r),
    makeUnit('p2-unit', P2, p2City.q, p2City.r),
  ];

  const next = stepSimulation(
    state,
    DEFAULT_AI_PARAMS,
    DEFAULT_AI_PARAMS,
    undefined,
    undefined,
    {
      humanPlansByPlayerId: {
        [P1]: {
          ...emptyAiActions(),
          moveTargets: [
            { unitId: 'p1-unit', toQ: p2City.q, toR: p2City.r },
            { unitId: 'p2-unit', toQ: p1City.q, toR: p1City.r },
          ],
        },
        [P2]: emptyAiActions(),
      },
    },
  );

  const ownUnit = next.units.find(u => u.id === 'p1-unit');
  const forgedUnit = next.units.find(u => u.id === 'p2-unit');
  assert(ownUnit?.targetQ === p2City.q && ownUnit.targetR === p2City.r, 'owned move target should be applied');
  assert(forgedUnit?.targetQ === undefined && forgedUnit?.targetR === undefined, 'forged opponent move target must be ignored');
}

function verifyServerPlanSanitizer(): void {
  const state = initMultiplayerGame(31337, { width: 28, height: 28 });
  const p1City = state.cities.find(c => c.ownerId === P1);
  const p2City = state.cities.find(c => c.ownerId === P2);
  assert(p1City, 'missing player 1 city');
  assert(p2City, 'missing player 2 city');

  state.units = [
    makeUnit('p1-unit', P1, p1City.q, p1City.r),
    makeUnit('p2-unit', P2, p2City.q, p2City.r),
  ];

  const patch = sanitizeClientPlanPatch(state, P1, {
    moveTargets: [
      { unitId: 'p1-unit', toQ: p2City.q, toR: p2City.r },
      { unitId: 'p2-unit', toQ: p1City.q, toR: p1City.r },
      { unitId: 'p1-unit', toQ: p2City.q + 0.5, toR: p2City.r },
      { unitId: 'p1-unit', toQ: Number.POSITIVE_INFINITY, toR: p2City.r },
      { unitId: 'p1-unit', toQ: -999, toR: -999 },
      { unitId: 42, toQ: p2City.q, toR: p2City.r },
    ],
    recruits: [{ cityId: p1City.id, type: 'infantry' }],
    builds: [{ cityId: p1City.id, type: 'city_center', q: p2City.q, r: p2City.r }],
  });

  assert.deepEqual(patch.moveTargets, [{ unitId: 'p1-unit', toQ: p2City.q, toR: p2City.r }]);
  assert(!('recruits' in patch), 'client recruits must not be accepted by server plan sanitizer');
  assert(!('builds' in patch), 'client builds must not be accepted by server plan sanitizer');
}

function verifyMultiplayerGuestRemap(): void {
  const state = initMultiplayerGame(98765, { width: 28, height: 28 });
  const p2City = state.cities.find(c => c.ownerId === P2);
  assert(p2City, 'missing player 2 city');
  const key = tileKey(p2City.q, p2City.r);
  state.scoutTowers = [{ id: 'tower-guest', q: p2City.q, r: p2City.r, ownerId: P2 }];
  state.combatMoraleState = new Map([[key, { ownerId: P2, morale: 4 }]]);

  const guest = remapSimStateForClient(state, 'guest');
  assert.equal(guest.scoutTowers[0]?.ownerId, 'player_human', 'guest scout towers should remap to local human');
  assert.equal(guest.combatMoraleState.get(key)?.ownerId, 'player_human', 'guest morale state should remap to local human');
}

function verifyStaticRegressionGuards(): void {
  const hexGrid = readFileSync('src/components/game/HexGrid.tsx', 'utf8');
  assert(hexGrid.includes('opacity: 0.93'), 'unknown fog must remain opaque enough to hide terrain');
  assert(
    hexGrid.includes('for (const tile of discoveredTilesMap.values())'),
    'terrain biome groups must render only discovered tiles',
  );
  assert(
    hexGrid.includes('<MountainSnowLayer tiles={terrainBiomeGroups.mountain} tilesMap={discoveredTilesMap} />'),
    'mountain snow must not sample undiscovered tiles',
  );

  const gameScene = readFileSync('src/components/game/GameScene.tsx', 'utf8');
  assert(
    gameScene.includes("if (isPlayableCameraMode) {\n      if (phase !== 'playing' || enteredPlaying)"),
    'playable camera must sync through setup and first playing frame',
  );

  const mapController = readFileSync('src/components/game/MapController.tsx', 'utf8');
  assert(mapController.includes('targetChanged'), 'map controls must apply changed initial target');

  const serverPkg = readFileSync('game-server/package.json', 'utf8');
  assert(!serverPkg.includes('"type": "module"'), 'game-server package-local start must not force ESM');
}

verifyStepSimulationMoveAuthority();
verifyServerPlanSanitizer();
verifyMultiplayerGuestRemap();
verifyStaticRegressionGuards();

console.log('verify-multiplayer-authority: ok');
