/**
 * Frozen holdout suite: run every N seasons.
 * Holdout set is never used for mutation/selection decisions directly; telemetry only.
 */

import {
  runSimulationWithDiagnostics,
  type AiParams,
  type RunSimulationOptions,
} from '../../src/core/gameCore';
import { getAnchors } from './anchors';
import type { SimAgent } from './types';
import type { HoldoutResult } from './types';
import type { SimSystemConfig } from './config';
import { scoreGame } from './scoring';
import type { GameResult } from './types';

function getHoldoutSeeds(config: SimSystemConfig): number[] {
  const seeds: number[] = [];
  for (let i = 0; i < config.holdoutNumGames; i++) {
    seeds.push((config.holdoutSeedBase + i * 7919) % 1_000_000);
  }
  return seeds;
}

/** Run holdout for all non-anchor agents; return aggregate and per-agent mean score. */
export function runHoldoutSuite(
  agents: SimAgent[],
  season: number,
  config: SimSystemConfig,
): HoldoutResult {
  const candidates = agents.filter(a => !a.isAnchor);
  const anchors = getAnchors();
  const opts: RunSimulationOptions = {
    maxCycles: config.maxCycles,
    mapConfigOverride: { width: config.mapSize, height: config.mapSize },
  };

  const scoresByAgentId: Record<string, number[]> = {};
  let totalDraws = 0;
  let totalStarvation = 0;
  let totalDecisive = 0;
  let totalGames = 0;

  const seeds = getHoldoutSeeds(config);
  for (const candidate of candidates) {
    scoresByAgentId[candidate.id] = [];
  }

  for (let g = 0; g < seeds.length; g++) {
    const seed = seeds[g];
    const anchor = anchors[g % anchors.length];
    for (const candidate of candidates) {
      const asAi1 = runSimulationWithDiagnostics(candidate.params, anchor.params, seed, config.maxCycles, opts);
      const asAi2 = runSimulationWithDiagnostics(anchor.params, candidate.params, seed + 1, config.maxCycles, opts);
      const r1: GameResult = { ...asAi1, diagnostics: asAi1.diagnostics };
      const r2: GameResult = { ...asAi2, diagnostics: asAi2.diagnostics };
      const s1 = scoreGame(r1, 'ai1', config);
      const s2 = scoreGame(r2, 'ai2', config);
      const total = s1 + s2;
      scoresByAgentId[candidate.id].push(total);

      totalDraws += (asAi1.winner === null ? 1 : 0) + (asAi2.winner === null ? 1 : 0);
      totalDecisive += (asAi1.winner !== null ? 1 : 0) + (asAi2.winner !== null ? 1 : 0);
      if (asAi1.diagnostics.firstCycleAllStarving != null) totalStarvation++;
      if (asAi2.diagnostics.firstCycleAllStarving != null) totalStarvation++;
      totalGames += 2;
    }
  }

  const scoresByAgentIdMean: Record<string, number> = {};
  for (const [id, scores] of Object.entries(scoresByAgentId)) {
    scoresByAgentIdMean[id] = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  }

  return {
    season,
    scoresByAgentId: scoresByAgentIdMean,
    drawRate: totalGames > 0 ? totalDraws / totalGames : 0,
    starvationLockRate: totalGames > 0 ? totalStarvation / totalGames : 0,
    decisiveness: totalGames > 0 ? totalDecisive / totalGames : 0,
  };
}
