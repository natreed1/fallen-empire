/**
 * Critical multiplayer/fog regression checks (run with `npm exec -- tsx scripts/verify-multiplayer-authority.ts`).
 */
import fs from 'fs';
import path from 'path';
import assert from 'assert/strict';
import {
  DEFAULT_AI_PARAMS,
  initMultiplayerGame,
  stepSimulation,
  type SimState,
} from '../src/core/gameCore';
import { emptyAiActions } from '../src/lib/ai';
import { mergeClientPlan, sanitizeClientPlanPatch } from '../game-server/src/clientPlans';
import type { Unit } from '../src/types/game';

const P1 = 'player_ai';
const P2 = 'player_ai_2';

function repoFile(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

function testStepSimulationRejectsCrossOwnerMove(): void {
  const state = initMultiplayerGame(4242, { width: 24, height: 24 });
  const p1City = state.cities.find(city => city.ownerId === P1);
  const p2City = state.cities.find(city => city.ownerId === P2);
  assert(p1City, 'expected player 1 city');
  assert(p2City, 'expected player 2 city');

  const p1Unit: Unit = {
    id: 'p1-unit',
    type: 'infantry',
    q: p1City.q,
    r: p1City.r,
    ownerId: P1,
    hp: 10,
    maxHp: 10,
    xp: 0,
    level: 0,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
  } as Unit;
  const p2Unit: Unit = {
    id: 'p2-unit',
    type: 'infantry',
    q: p2City.q,
    r: p2City.r,
    ownerId: P2,
    hp: 10,
    maxHp: 10,
    xp: 0,
    level: 0,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
  } as Unit;

  const withUnits: SimState = {
    ...state,
    units: [p1Unit, p2Unit],
  };

  const next = stepSimulation(
    withUnits,
    DEFAULT_AI_PARAMS,
    DEFAULT_AI_PARAMS,
    undefined,
    undefined,
    {
      humanPlansByPlayerId: {
        [P1]: {
          ...emptyAiActions(),
          moveTargets: [{ unitId: p2Unit.id, toQ: p1City.q, toR: p1City.r }],
        },
        [P2]: emptyAiActions(),
      },
    },
  );

  const p2After = next.units.find(unit => unit.id === p2Unit.id);
  assert(p2After, 'expected player 2 unit after step');
  assert.equal(p2After.status, 'idle', 'cross-owner move must not set enemy unit moving');
  assert.equal(p2After.targetQ, undefined, 'cross-owner move must not set targetQ');
  assert.equal(p2After.targetR, undefined, 'cross-owner move must not set targetR');
}

function testSanitizeClientPlanPatch(): void {
  const state = initMultiplayerGame(5150, { width: 24, height: 24 });
  const p1City = state.cities.find(city => city.ownerId === P1);
  const p2City = state.cities.find(city => city.ownerId === P2);
  assert(p1City, 'expected player 1 city');
  assert(p2City, 'expected player 2 city');

  const p1Unit = {
    id: 'owned-unit',
    type: 'infantry',
    q: p1City.q,
    r: p1City.r,
    ownerId: P1,
    hp: 10,
    maxHp: 10,
    xp: 0,
    level: 0,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
  } as Unit;
  const p2Unit = {
    id: 'enemy-unit',
    type: 'infantry',
    q: p2City.q,
    r: p2City.r,
    ownerId: P2,
    hp: 10,
    maxHp: 10,
    xp: 0,
    level: 0,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
  } as Unit;
  const withUnits: SimState = { ...state, units: [p1Unit, p2Unit] };

  const patch = sanitizeClientPlanPatch(withUnits, P1, {
    builds: [{ cityId: p1City.id, type: 'farm', q: p1City.q, r: p1City.r }],
    moveTargets: [
      { unitId: p1Unit.id, toQ: p1City.q, toR: p1City.r },
      { unitId: p2Unit.id, toQ: p1City.q, toR: p1City.r },
      { unitId: p1Unit.id, toQ: 1.5, toR: p1City.r },
      { unitId: p1Unit.id, toQ: 9999, toR: 9999 },
      { unitId: 123, toQ: p1City.q, toR: p1City.r },
    ],
  });

  assert.deepEqual(patch, {
    moveTargets: [{ unitId: p1Unit.id, toQ: p1City.q, toR: p1City.r }],
  });

  const merged = mergeClientPlan(emptyAiActions(), patch);
  assert.equal(merged.moveTargets.length, 1, 'merge should keep sanitized move');
  assert.equal(merged.builds.length, 0, 'merge must not smuggle non-move actions');
}

function testStaticCriticalGuards(): void {
  const server = repoFile('game-server/src/index.ts');
  assert.match(server, /roomHasRole\(room, 'host'\)/, 'server must reject duplicate host slot');
  assert.match(server, /roomHasRole\(room, 'guest'\)/, 'server must reject duplicate guest slot');
  assert.match(server, /sanitizeClientPlanPatch\(found\.state, meta\.playerId, msg\.plan\)/, 'server must sanitize raw plans');

  const core = repoFile('src/core/gameCore.ts');
  assert.match(core, /u\.id === mt\.unitId && u\.ownerId === aiPlayerId/, 'core move loop must check owner');

  const store = repoFile('src/store/useGameStore.ts');
  assert.match(store, /u\.id === mt\.unitId && u\.ownerId === aiPlayerId/, 'store move loop must check owner');
  assert.match(store, /shouldResetFog[\s\S]*current\.gameMode !== 'multiplayer'/, 'multiplayer snapshots must reset stale fog on entry');

  const hexGrid = repoFile('src/components/game/HexGrid.tsx');
  assert.match(hexGrid, /for \(const tile of discoveredTilesMap\.values\(\)\)/, 'terrain groups must use discovered tiles');
  assert.match(hexGrid, /for \(const t of discoveredTilesMap\.values\(\)\)/, 'shoreline groups must use discovered tiles');
  assert.match(hexGrid, /MountainSnowLayer tiles=\{terrainBiomeGroups\.mountain\} tilesMap=\{discoveredTilesMap\}/, 'snow must use discovered tiles');

  const gameScene = repoFile('src/components/game/GameScene.tsx');
  assert.match(gameScene, /if \(isPlayableCameraMode\) \{[\s\S]*enteredPlaying[\s\S]*setMapTarget\(liveTarget\)/, 'playable camera must sync on entering play');

  const mapController = repoFile('src/components/game/MapController.tsx');
  assert.match(mapController, /lastAppliedTargetRef/, 'map controller must reapply changed initial target');
}

testStepSimulationRejectsCrossOwnerMove();
testSanitizeClientPlanPatch();
testStaticCriticalGuards();

console.log('verify-multiplayer-authority: ok');
