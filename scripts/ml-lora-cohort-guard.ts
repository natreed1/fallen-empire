/**
 * Game-side checks aligned with the fallen-empire-lora benchmark / LoRA cohort:
 * stable types, map presets, and headless sim surface must not drift silently.
 *
 * Run from game repo root:
 *   npm run test:ml-cohort
 * Or:
 *   npx ts-node -r tsconfig-paths/register --project tsconfig.train.json scripts/ml-lora-cohort-guard.ts
 */

import type { Biome, Tile } from '../src/types/game';
import { MAP_SIZE_PRESETS, DEFAULT_MAP_CONFIG } from '../src/types/game';
import type { SimResult } from '../src/core/gameCore';
import { runSimulation, DEFAULT_AI_PARAMS } from '../src/core/gameCore';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`[ml-lora-cohort-guard] ${msg}`);
}

const BIOMES: Biome[] = ['water', 'plains', 'forest', 'mountain', 'desert'];

function assertBiomeUnion(): void {
  const seen = new Set<string>(BIOMES);
  assert(seen.size === 5, 'Biome union must have five distinct literals');
}

function assertMapPresets(): void {
  assert(MAP_SIZE_PRESETS.small.width === 38 && MAP_SIZE_PRESETS.small.height === 38, 'MAP_SIZE_PRESETS.small');
  assert(MAP_SIZE_PRESETS.normal.width === 52 && MAP_SIZE_PRESETS.normal.height === 52, 'MAP_SIZE_PRESETS.normal');
  assert(MAP_SIZE_PRESETS.large.width === 67 && MAP_SIZE_PRESETS.large.height === 67, 'MAP_SIZE_PRESETS.large');
  assert(DEFAULT_MAP_CONFIG.width === 67 && DEFAULT_MAP_CONFIG.height === 67, 'DEFAULT_MAP_CONFIG dimensions');
}

function assertTileShape(): void {
  const t: Tile = {
    q: 0,
    r: 0,
    biome: 'plains',
    elevation: 0,
    height: 0,
    hasRoad: false,
    hasRuins: false,
    hasVillage: false,
    isProvinceCenter: false,
    hasQuarryDeposit: false,
    hasMineDeposit: false,
    hasAncientCity: false,
    hasGoldMineDeposit: false,
    hasWoodDeposit: false,
    isIsland: false,
  };
  assert(typeof t.q === 'number' && typeof t.r === 'number', 'Tile axial coords');
}

function assertSimResultShape(): void {
  const r: SimResult = {
    winner: null,
    cycle: 0,
    ai1Cities: 0,
    ai2Cities: 0,
    ai1Pop: 0,
    ai2Pop: 0,
    ai1Ships: 0,
    ai2Ships: 0,
    ai1OverseasCities: 0,
    ai2OverseasCities: 0,
    ai1OverseasLandMilitary: 0,
    ai2OverseasLandMilitary: 0,
    ai1CargoAboard: 0,
    ai2CargoAboard: 0,
  };
  assert('winner' in r && 'cycle' in r && 'ai1Cities' in r, 'SimResult keys for ML eval prompts');
}

function assertHeadlessSimSmoke(): void {
  const res = runSimulation(DEFAULT_AI_PARAMS, DEFAULT_AI_PARAMS, 424242, 80, {
    maxCycles: 80,
    mapConfigOverride: { width: 24, height: 24 },
  });
  assert(res.cycle >= 0, 'runSimulation returns non-negative cycle');
  assert(res.winner === 'ai1' || res.winner === 'ai2' || res.winner === null, 'winner is ai1 | ai2 | null');
}

function main(): void {
  console.log('=== ml-lora-cohort-guard ===');
  assertBiomeUnion();
  console.log('Biome union literals: ok');
  assertMapPresets();
  console.log('MAP_SIZE_PRESETS / DEFAULT_MAP_CONFIG: ok');
  assertTileShape();
  console.log('Tile nominal shape: ok');
  assertSimResultShape();
  console.log('SimResult nominal shape: ok');
  assertHeadlessSimSmoke();
  console.log('runSimulation smoke (tiny map): ok');
  console.log('All cohort guards passed.');
}

main();
