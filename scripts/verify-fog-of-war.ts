import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const hexGrid = readFileSync(resolve('src/components/game/HexGrid.tsx'), 'utf8');
const store = readFileSync(resolve('src/store/useGameStore.ts'), 'utf8');

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

console.log('Fog-of-war regression checks passed.');
