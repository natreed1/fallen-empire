/**
 * Scenario battle-test battery: defense rush, siege break, resource shock, village timing.
 * Promotion/champion eligibility must satisfy scenario minimum thresholds.
 */

import {
  runSimulationWithDiagnostics,
  type AiParams,
  type RunSimulationOptions,
} from '../../src/core/gameCore';
import { getAnchorParamsById } from './anchors';
import { FIXED_ARCHETYPES } from '../lib/archetypes';
import { getScenarioMapOverride } from '../lib/scenarios';
import type { ScenarioSpec, ScenarioBatteryResult } from './types';
import type { SimSystemConfig } from './config';
import { scoreGame } from './scoring';
import type { GameResult } from './types';

/** Scenario definitions: id, min threshold, seed base, games per scenario. */
export const SCENARIO_SPECS: ScenarioSpec[] = [
  { id: 'defense_rush', name: 'Defense rush', minScoreThreshold: 0, seedBase: 50001, gamesPerScenario: 4 },
  { id: 'siege_break', name: 'Siege break', minScoreThreshold: 0, seedBase: 50002, gamesPerScenario: 4 },
  { id: 'resource_shock', name: 'Resource shock (lean-food map)', minScoreThreshold: -30, seedBase: 50003, gamesPerScenario: 4 },
  { id: 'village_timing', name: 'Village timing (high-expansion)', minScoreThreshold: 0, seedBase: 50004, gamesPerScenario: 4 },
];

/** Opponent and map per scenario (deterministic). */
const SCENARIO_OPPONENT: Record<string, string> = {
  defense_rush: 'arch_berserker',   // vs rush
  siege_break: 'arch_siege_attrition',
  resource_shock: 'arch_turtle',
  village_timing: 'arch_expansion',
};

const SCENARIO_MAP: Record<string, string> = {
  defense_rush: 'balanced',
  siege_break: 'balanced',
  resource_shock: 'lean-food',
  village_timing: 'high-expansion',
};

function getSimOpts(mapName: string, mapSize: number, maxCycles: number): RunSimulationOptions {
  const override = getScenarioMapOverride(mapName as 'balanced' | 'tight' | 'wide' | 'lean-food' | 'high-expansion');
  return {
    maxCycles,
    mapConfigOverride: { width: mapSize, height: mapSize, ...override },
  };
}

/** Run one scenario for candidate; return pass and mean score. */
export function runScenario(
  candidateParams: AiParams,
  scenarioId: string,
  config: SimSystemConfig,
): ScenarioBatteryResult {
  const spec = SCENARIO_SPECS.find(s => s.id === scenarioId);
  if (!spec) return { scenarioId, passed: false, score: 0, gamesPlayed: 0 };

  const opponentId = SCENARIO_OPPONENT[scenarioId] ?? FIXED_ARCHETYPES[0].id;
  const opponentParams = getAnchorParamsById(opponentId) ?? FIXED_ARCHETYPES[0].params;
  const mapName = SCENARIO_MAP[scenarioId] ?? 'balanced';
  const opts = getSimOpts(mapName, config.mapSize, config.maxCycles);

  const scores: number[] = [];
  for (let i = 0; i < spec.gamesPerScenario; i++) {
    const seed = (spec.seedBase + i * 1000) % 1_000_000;
    const asAi1 = runSimulationWithDiagnostics(candidateParams, opponentParams, seed, config.maxCycles, opts);
    const asAi2 = runSimulationWithDiagnostics(opponentParams, candidateParams, seed + 1, config.maxCycles, opts);
    const result1: GameResult = { ...asAi1, diagnostics: asAi1.diagnostics };
    const result2: GameResult = { ...asAi2, diagnostics: asAi2.diagnostics };
    scores.push(scoreGame(result1, 'ai1', config) + scoreGame(result2, 'ai2', config));
  }
  const score = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const passed = score >= spec.minScoreThreshold;
  return { scenarioId, passed, score, gamesPlayed: scores.length };
}

/** Run full battery for candidate; return all results. */
export function runScenarioBattery(
  candidateParams: AiParams,
  config: SimSystemConfig,
): ScenarioBatteryResult[] {
  return SCENARIO_SPECS.map(spec => runScenario(candidateParams, spec.id, config));
}
