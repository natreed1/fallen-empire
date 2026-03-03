/**
 * Strategy-flow telemetry: first build cycle by type, first recruit by type,
 * first village expand, first owner flip, first combat. For model-to-model comparison.
 *
 * Run: npx ts-node -r tsconfig-paths/register --project tsconfig.train.json scripts/audit-strategy-flow.ts
 */

import {
  initBotVsBotGame,
  stepSimulation,
  DEFAULT_AI_PARAMS,
  type AiParams,
  type SimState,
  type SimDiagnostics,
} from '../src/core/gameCore';
import type { BuildingType, UnitType } from '../src/types/game';

const MAX_CYCLES = parseInt(process.env.AUDIT_MAX_CYCLES || '220', 10);
const MAP_SIZE = parseInt(process.env.AUDIT_MAP_SIZE || '56', 10);
const SEED = parseInt(process.env.AUDIT_SEED || '42', 10);

function countBuildingsByType(state: SimState): Record<string, number> {
  const m: Record<string, number> = {};
  for (const city of state.cities) {
    for (const b of city.buildings) {
      const t = b.type as BuildingType;
      m[t] = (m[t] ?? 0) + 1;
    }
  }
  return m;
}

function countUnitsByType(state: SimState): Record<string, number> {
  const m: Record<string, number> = {};
  for (const u of state.units) {
    if (u.hp <= 0) continue;
    const t = u.type as UnitType;
    m[t] = (m[t] ?? 0) + 1;
  }
  return m;
}

function main() {
  const paramsA: AiParams = { ...DEFAULT_AI_PARAMS };
  const paramsB: AiParams = { ...DEFAULT_AI_PARAMS };
  const mapOverride = { width: MAP_SIZE, height: MAP_SIZE };

  let state = initBotVsBotGame(SEED, paramsA, paramsB, mapOverride);
  const diagnostics: SimDiagnostics = { totalKills: 0, hadOwnerFlip: false };

  const firstBuildCycle: Record<string, number> = {};
  const firstRecruitCycle: Record<string, number> = {};
  let firstVillageExpandCycle: number | null = null;
  const initialCityCount = state.cities.length;

  while (state.phase === 'playing' && state.cycle < MAX_CYCLES) {
    const prevBuildings = countBuildingsByType(state);
    const prevUnits = countUnitsByType(state);
    const prevCityCount = state.cities.length;

    state = stepSimulation(state, paramsA, paramsB, diagnostics);

    const cycle = state.cycle;
    const nextBuildings = countBuildingsByType(state);
    const nextUnits = countUnitsByType(state);
    const nextCityCount = state.cities.length;

    for (const t of Object.keys(nextBuildings)) {
      if ((nextBuildings[t] ?? 0) > (prevBuildings[t] ?? 0) && firstBuildCycle[t] == null) {
        firstBuildCycle[t] = cycle;
      }
    }
    for (const t of Object.keys(nextUnits)) {
      if ((nextUnits[t] ?? 0) > (prevUnits[t] ?? 0) && firstRecruitCycle[t] == null) {
        firstRecruitCycle[t] = cycle;
      }
    }
    if (nextCityCount > prevCityCount && firstVillageExpandCycle == null) {
      firstVillageExpandCycle = cycle;
    }
  }

  console.log('Strategy flow audit (single game)');
  console.log(`  Seed: ${SEED}  Map: ${MAP_SIZE}x${MAP_SIZE}  MaxCycles: ${MAX_CYCLES}`);
  console.log(`  Final cycle: ${state.cycle}  Phase: ${state.phase}`);
  console.log('');
  console.log('First build cycle by type:');
  const buildTypes = Object.keys(firstBuildCycle).sort();
  if (buildTypes.length === 0) console.log('  (none)');
  else for (const t of buildTypes) console.log(`  ${t}: ${firstBuildCycle[t]}`);
  console.log('');
  console.log('First recruit cycle by type:');
  const recruitTypes = Object.keys(firstRecruitCycle).sort();
  if (recruitTypes.length === 0) console.log('  (none)');
  else for (const t of recruitTypes) console.log(`  ${t}: ${firstRecruitCycle[t]}`);
  console.log('');
  console.log(`First village expand: ${firstVillageExpandCycle ?? '—'}`);
  console.log(`First owner flip: ${diagnostics.firstOwnerFlipCycle ?? '—'}`);
  console.log(`First combat: ${diagnostics.firstCombatCycle ?? '—'}`);
  console.log(`Total kills: ${diagnostics.totalKills}`);
}

main();
