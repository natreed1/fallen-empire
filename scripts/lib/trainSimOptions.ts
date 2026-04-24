/**
 * Shared headless sim options for `npm run train-ai`, regression harness, and other tools.
 * Keeps scenario selection + naval gauntlet postInit aligned with training defaults.
 */

import type { RunSimulationOptions } from '../../src/core/gameCore';
import { parseScenarioMix, selectScenario, getScenarioMapOverride, type ScenarioName } from './scenarios';

export type ScenarioMixEntry = { name: ScenarioName; weight: number };

/** Knobs that mirror `scripts/train-ai.ts` env-driven behavior. */
export type TrainSimMatchConfig = {
  maxCycles: number;
  mapSize: number;
  useScenarioMix: boolean;
  navalPostInit: boolean;
  navalEducation: boolean;
  /** Used when `useScenarioMix` is true (typically from `parseScenarioMix(...)`). */
  scenarioMix: ScenarioMixEntry[];
};

/**
 * Same per-seed map options as `train-ai` uses for each match.
 * When `navalEducation`, every game is naval-islands (+ optional gauntlet).
 */
export function getTrainSimOptsForSeed(matchSeed: number, c: TrainSimMatchConfig): RunSimulationOptions {
  if (c.navalEducation) {
    const override = getScenarioMapOverride('naval-islands');
    const postInit: RunSimulationOptions['postInit'] = c.navalPostInit ? 'naval-gauntlet' : undefined;
    return {
      maxCycles: c.maxCycles,
      mapConfigOverride: { width: c.mapSize, height: c.mapSize, ...override },
      ...(postInit ? { postInit } : {}),
    };
  }
  if (!c.useScenarioMix) {
    return { maxCycles: c.maxCycles, mapConfigOverride: { width: c.mapSize, height: c.mapSize } };
  }
  const mix = c.scenarioMix.length > 0 ? c.scenarioMix : parseScenarioMix(undefined);
  const scenarioName = selectScenario(mix, matchSeed);
  const override = getScenarioMapOverride(scenarioName);
  const postInit: RunSimulationOptions['postInit'] =
    c.navalPostInit && scenarioName === 'naval-islands' ? 'naval-gauntlet' : undefined;
  return {
    maxCycles: c.maxCycles,
    mapConfigOverride: { width: c.mapSize, height: c.mapSize, ...override },
    ...(postInit ? { postInit } : {}),
  };
}

/** Read training-related env vars (same semantics as `train-ai.ts`). */
export function readTrainSimMatchConfigFromEnv(): TrainSimMatchConfig {
  const maxCycles = parseInt(process.env.TRAIN_MAX_CYCLES || process.env.REGRESSION_MAX_CYCLES || '250', 10) || 250;
  const mapSize = parseInt(process.env.TRAIN_MAP_SIZE || process.env.REGRESSION_MAP_SIZE || '38', 10) || 38;
  const useScenarioMix =
    process.env.TRAIN_USE_SCENARIO_MIX !== '0' && process.env.TRAIN_USE_SCENARIO_MIX !== 'false';
  const navalPostInit =
    process.env.TRAIN_NAVAL_POSTINIT !== '0' && process.env.TRAIN_NAVAL_POSTINIT !== 'false';
  const navalEducation =
    process.env.TRAIN_NAVAL_EDUCATION === '1' || process.env.TRAIN_NAVAL_EDUCATION === 'true';
  const mixEnv = process.env.TRAIN_SCENARIO_MIX?.trim();
  const scenarioMix = useScenarioMix
    ? parseScenarioMix(mixEnv && mixEnv.length > 0 ? mixEnv : undefined)
    : [];
  return { maxCycles, mapSize, useScenarioMix, navalPostInit, navalEducation, scenarioMix };
}
