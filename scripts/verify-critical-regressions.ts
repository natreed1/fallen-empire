import fs from 'node:fs';
import path from 'node:path';
import { initMultiplayerGame, stepSimulation, DEFAULT_AI_PARAMS, type SimState } from '../src/core/gameCore';
import { emptyAiActions } from '../src/lib/ai';

const P1 = 'player_ai';
const P2 = 'player_ai_2';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function playableState(state: SimState, unitId: string): SimState {
  return {
    ...state,
    phase: 'playing',
    units: state.units.map(u =>
      u.id === unitId
        ? {
            ...u,
            hp: Math.max(1, u.hp),
            status: 'idle',
            targetQ: u.q,
            targetR: u.r,
          }
        : u,
    ),
  };
}

function verifyMoveAuthority(): void {
  const base = initMultiplayerGame(424242, { width: 24, height: 24 });
  const p1Unit = base.units.find(u => u.ownerId === P1 && u.hp > 0);
  const p2Unit = base.units.find(u => u.ownerId === P2 && u.hp > 0);
  const p1City = base.cities.find(c => c.ownerId === P1);
  const p2City = base.cities.find(c => c.ownerId === P2);

  assert(p1Unit, 'expected a Player 1 unit in seeded multiplayer state');
  assert(p2Unit, 'expected a Player 2 unit in seeded multiplayer state');
  assert(p1City, 'expected a Player 1 city in seeded multiplayer state');
  assert(p2City, 'expected a Player 2 city in seeded multiplayer state');

  const hijackPlan = emptyAiActions();
  hijackPlan.moveTargets = [{ unitId: p1Unit.id, toQ: p2City.q, toR: p2City.r }];
  const afterHijackAttempt = stepSimulation(
    playableState(base, p1Unit.id),
    DEFAULT_AI_PARAMS,
    DEFAULT_AI_PARAMS,
    undefined,
    undefined,
    { humanPlansByPlayerId: { [P1]: emptyAiActions(), [P2]: hijackPlan } },
  );
  const protectedUnit = afterHijackAttempt.units.find(u => u.id === p1Unit.id);
  assert(protectedUnit, 'expected protected unit to remain in state');
  assert(
    protectedUnit.targetQ !== p2City.q || protectedUnit.targetR !== p2City.r,
    'opponent moveTarget changed a Player 1 unit target',
  );

  const ownedPlan = emptyAiActions();
  ownedPlan.moveTargets = [{ unitId: p2Unit.id, toQ: p1City.q, toR: p1City.r }];
  const afterOwnedMove = stepSimulation(
    playableState(base, p2Unit.id),
    DEFAULT_AI_PARAMS,
    DEFAULT_AI_PARAMS,
    undefined,
    undefined,
    { humanPlansByPlayerId: { [P1]: emptyAiActions(), [P2]: ownedPlan } },
  );
  const movedOwnedUnit = afterOwnedMove.units.find(u => u.id === p2Unit.id);
  assert(movedOwnedUnit, 'expected owned unit to remain in state');
  assert(
    movedOwnedUnit.targetQ === p1City.q && movedOwnedUnit.targetR === p1City.r,
    'owned moveTarget was not preserved for the issuing player',
  );
}

function verifyStaticGuards(): void {
  const server = readRepoFile('game-server/src/index.ts');
  assert(server.includes('function sanitizeClientPlan'), 'server must sanitize client plans');
  assert(server.includes('Array.isArray(patch.moveTargets)'), 'server must tolerate malformed moveTargets');
  assert(server.includes('unit.ownerId !== playerId'), 'server must reject cross-owner moveTargets');
  assert(server.includes('room.state.tiles.has(tileKey(m.toQ, m.toR))'), 'server must reject off-map moveTargets');
  assert(server.includes("hasClientWithRole(room, 'host')"), 'server must reject duplicate hosts');
  assert(server.includes("hasClientWithRole(room, 'guest')"), 'server must reject duplicate guests');
  assert(server.includes("msg.role !== 'host' && msg.role !== 'guest'"), 'server must reject invalid roles');

  const core = readRepoFile('src/core/gameCore.ts');
  assert(
    core.includes('units.find(u => u.id === mt.unitId && u.ownerId === aiPlayerId)'),
    'shared stepSimulation must enforce moveTarget ownership',
  );

  const store = readRepoFile('src/store/useGameStore.ts');
  assert(
    store.includes('units.find(u => u.id === mt.unitId && u.ownerId === aiPlayerId)'),
    'store runCycle must enforce moveTarget ownership',
  );

  const hexGrid = readRepoFile('src/components/game/HexGrid.tsx');
  assert(hexGrid.includes('for (const tile of discoveredTilesMap.values())'), 'terrain biome groups must use discovered tiles');
  assert(hexGrid.includes('for (const t of discoveredTilesMap.values())'), 'shoreline groups must use discovered tiles');
  assert(hexGrid.includes('isCoastalWaterTile(t, discoveredTilesMap)'), 'coastal water must not inspect undiscovered tiles');
  assert(hexGrid.includes('isBeachLandTile(t, discoveredTilesMap)'), 'beach layer must not inspect undiscovered tiles');
  assert(hexGrid.includes('<MountainSnowLayer tiles={terrainBiomeGroups.mountain} tilesMap={discoveredTilesMap} />'), 'snow layer must not inspect undiscovered tiles');
  assert(hexGrid.includes('const visibleTowers = useMemo'), 'scout towers must be filtered to discovered tiles');
  assert(hexGrid.includes('const visibleSites = useMemo'), 'construction markers must be filtered to discovered tiles');

  const gameScene = readRepoFile('src/components/game/GameScene.tsx');
  assert(gameScene.includes('phase !== \'playing\' || enteredPlaying'), 'playable camera must sync before and on match start');

  const mapController = readRepoFile('src/components/game/MapController.tsx');
  assert(mapController.includes('targetChanged'), 'map controls must apply changed initial targets');
  assert(
    mapController.includes('!applyTargetUpdates && appliedInitialTargetRef.current && !targetChanged'),
    'map controls must preserve user panning after applying the current target',
  );

  const auth = readRepoFile('src/lib/siteAuth.ts');
  assert(!auth.includes('fallenempire26'), 'site auth must not contain a hardcoded production password');
  assert(!auth.includes('PROD_DEFAULT'), 'site auth must not contain hardcoded production defaults');

  const middleware = readRepoFile('src/middleware.ts');
  assert(middleware.includes("process.env.NODE_ENV === 'production'"), 'middleware must fail closed in production when auth is missing');
  assert(middleware.includes('NextResponse.redirect(login)'), 'missing production auth config must block app routes');
}

verifyMoveAuthority();
verifyStaticGuards();
console.log('Critical regression guards passed.');
