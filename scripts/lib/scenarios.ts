/**
 * Domain-randomized scenario definitions for robust league training.
 * Each scenario is a Partial<MapConfig> applied as mapConfigOverride.
 * Selection is deterministic via seed for reproducibility.
 */

import type { MapConfig } from '../../src/types/game';
import { DEFAULT_MAP_CONFIG } from '../../src/types/game';

export type ScenarioName =
  | 'balanced'
  | 'tight'
  | 'wide'
  | 'lean-food'
  | 'high-expansion';

/** Map override for each named scenario. Uses map knobs when available. */
const SCENARIO_OVERRIDES: Record<ScenarioName, Partial<MapConfig>> = {
  balanced: {
    width: 38,
    height: 38,
    noiseScale: DEFAULT_MAP_CONFIG.noiseScale,
    moistureScale: DEFAULT_MAP_CONFIG.moistureScale,
    provinceDensity: DEFAULT_MAP_CONFIG.provinceDensity,
    villageDensity: DEFAULT_MAP_CONFIG.villageDensity,
  },
  tight: {
    width: 28,
    height: 28,
    noiseScale: 0.04,
    moistureScale: DEFAULT_MAP_CONFIG.moistureScale,
    provinceDensity: 0.02,
    villageDensity: 0.015,
  },
  wide: {
    width: 52,
    height: 52,
    noiseScale: 0.03,
    moistureScale: DEFAULT_MAP_CONFIG.moistureScale,
    provinceDensity: 0.012,
    villageDensity: 0.025,
  },
  /** Scarcer food (higher moisture/less plains) — map knobs for harvest pressure. */
  'lean-food': {
    width: 38,
    height: 38,
    moistureScale: 0.06,
    provinceDensity: 0.02,
    villageDensity: DEFAULT_MAP_CONFIG.villageDensity,
  },
  /** More villages for expansion-focused games. */
  'high-expansion': {
    width: 38,
    height: 38,
    villageDensity: 0.045,
    provinceDensity: DEFAULT_MAP_CONFIG.provinceDensity,
    moistureScale: DEFAULT_MAP_CONFIG.moistureScale,
  },
};

/** Parse LEAGUE_SCENARIO_MIX env (e.g. "balanced:0.4,tight:0.2,wide:0.2,lean-food:0.1,high-expansion:0.1"). */
export function parseScenarioMix(
  mixEnv: string = 'balanced:0.4,tight:0.2,wide:0.2,lean-food:0.1,high-expansion:0.1',
): { name: ScenarioName; weight: number }[] {
  const entries: { name: ScenarioName; weight: number }[] = [];
  const seen = new Set<string>();
  for (const part of mixEnv.split(',')) {
    const [name, wStr] = part.split(':').map(s => s.trim());
    if (!name || !wStr) continue;
    const weight = parseFloat(wStr);
    if (!Number.isFinite(weight) || weight <= 0 || seen.has(name)) continue;
    if (!Object.prototype.hasOwnProperty.call(SCENARIO_OVERRIDES, name)) continue;
    seen.add(name);
    entries.push({ name: name as ScenarioName, weight });
  }
  if (entries.length === 0) {
    return [{ name: 'balanced', weight: 1 }];
  }
  return entries;
}

/** Deterministic scenario selection from mix using seed. Returns scenario name. */
export function selectScenario(
  mix: { name: ScenarioName; weight: number }[],
  seed: number,
): ScenarioName {
  const total = mix.reduce((s, e) => s + e.weight, 0);
  if (total <= 0) return 'balanced';
  const r = (Math.abs(seed) % 1e6) / 1e6;
  let acc = 0;
  for (const e of mix) {
    acc += e.weight / total;
    if (r < acc) return e.name;
  }
  return mix[mix.length - 1].name;
}

/** Get mapConfigOverride for a scenario (seed only used for selection; map seed is separate). */
export function getScenarioMapOverride(scenarioName: ScenarioName): Partial<MapConfig> {
  return { ...SCENARIO_OVERRIDES[scenarioName] };
}
