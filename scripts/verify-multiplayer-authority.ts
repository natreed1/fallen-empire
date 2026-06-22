import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { initMultiplayerGame, stepSimulation, DEFAULT_AI_PARAMS, type SimState } from '../src/core/gameCore';
import { emptyAiActions, type AiActions } from '../src/lib/ai';
import { remapSimStateForClient } from '../src/lib/multiplayerRemap';
import { mergeClientPlan } from '../game-server/src/clientPlans';
import { hexDistance, isNavalUnitType, tileKey, type Tile, type Unit } from '../src/types/game';

const P1 = 'player_ai';
const P2 = 'player_ai_2';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function findLandUnit(state: SimState, ownerId: string): Unit {
  const unit = state.units.find(u => u.ownerId === ownerId && u.hp > 0 && !isNavalUnitType(u.type));
  assert(unit, `missing live land unit for ${ownerId}`);
  return unit;
}

function stateWithSeedUnits(seed: number): SimState {
  const state = initMultiplayerGame(seed);
  const city1 = state.cities.find(c => c.ownerId === P1);
  const city2 = state.cities.find(c => c.ownerId === P2);
  assert(city1 && city2, 'missing multiplayer capitals');
  return {
    ...state,
    units: [
      {
        id: 'unit_p1',
        type: 'infantry',
        q: city1.q,
        r: city1.r,
        ownerId: P1,
        hp: 100,
        maxHp: 100,
        xp: 0,
        level: 0,
        status: 'idle',
        stance: 'aggressive',
        nextMoveAt: 0,
      },
      {
        id: 'unit_p2',
        type: 'infantry',
        q: city2.q,
        r: city2.r,
        ownerId: P2,
        hp: 100,
        maxHp: 100,
        xp: 0,
        level: 0,
        status: 'idle',
        stance: 'aggressive',
        nextMoveAt: 0,
      },
    ],
  };
}

function findDistantLandTile(state: SimState, unit: Unit): Tile {
  const target = Array.from(state.tiles.values()).find(
    t => t.biome !== 'water' && hexDistance(unit.q, unit.r, t.q, t.r) >= 4,
  );
  assert(target, `missing distant land tile for ${unit.id}`);
  return target;
}

function planWithMoves(moveTargets: AiActions['moveTargets']): AiActions {
  return { ...emptyAiActions(), moveTargets };
}

function verifyStepSimulationAuthority(): void {
  const state = stateWithSeedUnits(424242);
  const own = findLandUnit(state, P1);
  const enemy = findLandUnit(state, P2);
  const ownTarget = findDistantLandTile(state, own);
  const enemyTarget = findDistantLandTile(state, enemy);

  const next = stepSimulation(
    state,
    DEFAULT_AI_PARAMS,
    DEFAULT_AI_PARAMS,
    undefined,
    undefined,
    {
      humanPlansByPlayerId: {
        [P1]: planWithMoves([
          { unitId: own.id, toQ: ownTarget.q, toR: ownTarget.r },
          { unitId: enemy.id, toQ: enemyTarget.q, toR: enemyTarget.r },
        ]),
        [P2]: emptyAiActions(),
      },
    },
  );

  const ownAfter = next.units.find(u => u.id === own.id);
  const enemyAfter = next.units.find(u => u.id === enemy.id);
  assert(ownAfter?.targetQ === ownTarget.q && ownAfter.targetR === ownTarget.r, 'own move order was not applied');
  assert(
    enemyAfter?.targetQ !== enemyTarget.q || enemyAfter.targetR !== enemyTarget.r,
    'cross-owner move order was applied',
  );
}

function verifyServerPlanSanitizer(): void {
  const state = stateWithSeedUnits(515151);
  const own = findLandUnit(state, P1);
  const enemy = findLandUnit(state, P2);
  const ownTarget = findDistantLandTile(state, own);
  const enemyTarget = findDistantLandTile(state, enemy);

  const merged = mergeClientPlan(
    emptyAiActions(),
    {
      builds: { malformed: true } as unknown as AiActions['builds'],
      recruits: 'not-an-array' as unknown as AiActions['recruits'],
      moveTargets: [
        { unitId: enemy.id, toQ: enemyTarget.q, toR: enemyTarget.r },
        { unitId: own.id, toQ: ownTarget.q, toR: ownTarget.r },
        { unitId: own.id, toQ: Number.NaN, toR: ownTarget.r },
        { unitId: own.id, toQ: ownTarget.q, toR: 999999 },
      ],
    },
    state,
    P1,
  );

  assert(merged.moveTargets.length === 1, 'sanitizer should keep only the owned in-map move');
  assert(merged.moveTargets[0]?.unitId === own.id, 'sanitizer kept the wrong unit move');
  assert(Array.isArray(merged.builds) && merged.builds.length === 0, 'malformed build payload should be dropped');
  assert(Array.isArray(merged.recruits) && merged.recruits.length === 0, 'malformed recruit payload should be dropped');
}

function verifyMultiplayerRemap(): void {
  const state = stateWithSeedUnits(616161);
  const guestUnit = findLandUnit(state, P2);
  const withGuestState: SimState = {
    ...state,
    scoutTowers: [{ id: 'tower_guest', q: guestUnit.q, r: guestUnit.r, ownerId: P2 }],
    combatMoraleState: new Map([[guestUnit.id, { ownerId: P2, morale: 77 }]]),
  };

  const remapped = remapSimStateForClient(withGuestState, 'guest');
  assert(remapped.scoutTowers[0]?.ownerId === 'player_human', 'guest scout tower was not remapped to local human');
  assert(
    remapped.combatMoraleState.get(guestUnit.id)?.ownerId === 'player_human',
    'guest morale owner was not remapped to local human',
  );
}

function verifyStaticGuards(): void {
  const root = process.cwd();
  const hexGrid = readFileSync(join(root, 'src/components/game/HexGrid.tsx'), 'utf8');
  assert(
    hexGrid.includes('for (const tile of discoveredTilesMap.values())'),
    'terrain biome groups must render from discovered tiles',
  );
  assert(
    hexGrid.includes('for (const t of discoveredTilesMap.values())'),
    'shoreline groups must render from discovered tiles',
  );
  assert(
    hexGrid.includes('<MountainSnowLayer tiles={terrainBiomeGroups.mountain} tilesMap={discoveredTilesMap} />'),
    'mountain snow must render from discovered tiles',
  );
  assert(!hexGrid.includes('opacity: 0.62'), 'unknown fog opacity is too transparent');
  assert(hexGrid.includes('if (!tile) return null;'), 'city markers must skip undiscovered tiles');
  assert(hexGrid.includes('if (!tile) continue;'), 'building markers must skip undiscovered tiles');

  const serverIndex = readFileSync(join(root, 'game-server/src/index.ts'), 'utf8');
  assert(serverIndex.includes('Host slot is already occupied.'), 'duplicate host joins must be rejected');
  assert(serverIndex.includes('Guest slot is already occupied.'), 'duplicate guest joins must be rejected');
  assert(serverIndex.includes('mergeClientPlan'), 'server must use sanitized client plan merges');

  const gameServerPackage = JSON.parse(readFileSync(join(root, 'game-server/package.json'), 'utf8'));
  assert(gameServerPackage.type !== 'module', 'game-server package must not force nested ESM startup');

  const rootPackage = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert(rootPackage.dependencies?.ws, 'root package must include ws for npm run game-server');
  assert(rootPackage.dependencies?.tsx, 'root package must include tsx for npm run game-server');
}

verifyStepSimulationAuthority();
verifyServerPlanSanitizer();
verifyMultiplayerRemap();
verifyStaticGuards();

console.log('verify-multiplayer-authority: ok');
