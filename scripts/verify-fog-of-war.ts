import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const hexGrid = readFileSync(resolve('src/components/game/HexGrid.tsx'), 'utf8');
const store = readFileSync(resolve('src/store/useGameStore.ts'), 'utf8');
const gameScene = readFileSync(resolve('src/components/game/GameScene.tsx'), 'utf8');
const mapController = readFileSync(resolve('src/components/game/MapController.tsx'), 'utf8');

const terrainStart = hexGrid.indexOf('const terrainBiomeGroups = useMemo');
const terrainEnd = hexGrid.indexOf('// Territory by player', terrainStart);
assert.ok(terrainStart >= 0 && terrainEnd > terrainStart, 'terrain visibility block not found');
const terrainVisibilityBlock = hexGrid.slice(terrainStart, terrainEnd);

assert.ok(
  terrainVisibilityBlock.includes('discoveredTilesMap.values()'),
  'terrain must be built from discovered tiles',
);
assert.ok(
  !terrainVisibilityBlock.includes('tiles.values()'),
  'undiscovered terrain is still rendered',
);
assert.ok(
  terrainVisibilityBlock.includes('isCoastalWaterTile(t, discoveredTilesMap)'),
  'shoreline detection can inspect undiscovered terrain',
);
assert.ok(
  hexGrid.includes('tilesMap={discoveredTilesMap}'),
  'mountain snow can inspect undiscovered terrain',
);
assert.ok(hexGrid.includes('opacity: 0.93'), 'unknown fog is not opaque enough');

const snapshotStart = store.indexOf('applyMultiplayerSnapshot:');
const snapshotEnd = store.indexOf('// ─── Vision', snapshotStart);
assert.ok(snapshotStart >= 0 && snapshotEnd > snapshotStart, 'multiplayer snapshot block not found');
const snapshotBlock = store.slice(snapshotStart, snapshotEnd);
assert.ok(
  snapshotBlock.includes('resetMultiplayerVision') &&
    snapshotBlock.includes('exploredHexes: new Set<string>()'),
  'entering a multiplayer map retains stale exploration',
);

const playableCameraStart = gameScene.indexOf('if (isPlayableCameraMode)');
const playableCameraEnd = gameScene.indexOf('prevPhaseForCameraRef.current = phase;', playableCameraStart);
assert.ok(
  playableCameraStart >= 0 &&
    playableCameraEnd > playableCameraStart &&
    gameScene.slice(playableCameraStart, playableCameraEnd).includes('setMapTarget(liveTarget)'),
  'playable modes never retarget the camera when a match starts',
);
assert.ok(
  mapController.includes('targetChanged') &&
    mapController.includes('lastAppliedTargetRef.current = target'),
  'map controls ignore the capital target that arrives after initial mount',
);

console.log('Fog-of-war and camera regression checks passed.');
