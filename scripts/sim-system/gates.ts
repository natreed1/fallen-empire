/**
 * Tier competency gates and champion eligibility.
 * Tier C: economy/survival (anti-starvation baseline).
 * Tier B: combat proficiency (must clear battle tests).
 * Tier A: full strategic robustness and adaptation.
 * Champion: non-anchor, holdout pass, anchor gauntlet pass, scenario minimums.
 */

import type { SimAgent, ChampionEligibility } from './types';
import type { SimSystemConfig } from './config';
import { robustnessScore } from './scoring';
import { maxLineageConcentration } from './lineage';

/** Lenient gate thresholds when season <= config.gateLenientUntilSeason. */
function isLenientSeason(season: number, config: SimSystemConfig): boolean {
  return season <= config.gateLenientUntilSeason;
}

/** Tier C gate: economy/survival — not in total-starvation abort in majority of games. */
export function passesTierCGate(agent: SimAgent, config: SimSystemConfig, season: number = 999): boolean {
  const total = agent.wins + agent.losses + agent.draws;
  if (total === 0) return true;
  const totalStarvationRate = agent.totalStarvationGames / total;
  const maxRate = isLenientSeason(season, config) ? 0.7 : 0.5;
  return totalStarvationRate <= maxRate;
}

/** Tier B gate: combat proficiency — has wins and some decisive/combat games. */
export function passesTierBGate(agent: SimAgent, config: SimSystemConfig, season: number = 999): boolean {
  const total = agent.wins + agent.losses + agent.draws;
  if (total === 0) return false;
  const lenient = isLenientSeason(season, config);
  if (agent.wins === 0 && !lenient) return false;
  const noCombatRate = agent.noCombatGames / total;
  const maxRate = lenient ? 0.85 : 0.7;
  return noCombatRate <= maxRate;
}

/** Tier A: full strategic — robustness score above threshold (handled by ranking). */
export function passesTierAGate(agent: SimAgent, config: SimSystemConfig, season: number = 999): boolean {
  const score = robustnessScore(agent.gameScores, config);
  const minScore = isLenientSeason(season, config) ? -30 : -20;
  return score > minScore;
}

/** Scenario battery pass for promotion: all scenario scores >= min. Lenient early seasons use lower min. */
export function passesScenarioMinimumForPromotion(
  scenarioResults: { score: number }[],
  config: SimSystemConfig,
  season: number = 999,
): boolean {
  const min = isLenientSeason(season, config)
    ? Math.max(-50, config.scenarioMinScoreForPromotion - 10)
    : config.scenarioMinScoreForPromotion;
  return scenarioResults.every(r => r.score >= min);
}

/** Scenario battery pass for champion: all >= champion threshold. */
export function passesScenarioMinimumForChampion(
  scenarioResults: { score: number }[],
  config: SimSystemConfig,
): boolean {
  return scenarioResults.every(r => r.score >= config.scenarioMinScoreForChampion);
}

/** Champion must be non-anchor, pass holdout, pass anchor gauntlet, pass scenario minimums. */
export function checkChampionEligibility(
  agent: SimAgent,
  holdoutScore: number | undefined,
  holdoutMinScore: number,
  anchorGauntletPass: boolean,
  scenarioResults: { score: number }[],
  config: SimSystemConfig,
): ChampionEligibility {
  const reasons: string[] = [];
  if (agent.isAnchor) {
    reasons.push('Anchors are ineligible for champion');
    return { eligible: false, isAnchor: true, holdoutPass: false, anchorGauntletPass: false, scenarioMinimumsPass: false, reasons };
  }
  const holdoutPass = holdoutScore !== undefined && holdoutScore >= holdoutMinScore;
  if (!holdoutPass) reasons.push('Did not pass holdout robustness');
  if (!anchorGauntletPass) reasons.push('Did not pass full anchor gauntlet');
  const scenarioMinimumsPass = passesScenarioMinimumForChampion(scenarioResults, config);
  if (!scenarioMinimumsPass) reasons.push('Did not meet scenario minimums for champion');

  const eligible = holdoutPass && anchorGauntletPass && scenarioMinimumsPass;
  return {
    eligible,
    isAnchor: false,
    holdoutPass,
    anchorGauntletPass,
    scenarioMinimumsPass,
    reasons,
  };
}

/** Compute lineage concentration for telemetry (max across tiers). */
export function computeLineageConcentration(agents: SimAgent[]): number {
  const tiers: ('C' | 'B' | 'A')[] = ['C', 'B', 'A'];
  let maxConc = 0;
  for (const t of tiers) {
    maxConc = Math.max(maxConc, maxLineageConcentration(agents, t));
  }
  return maxConc;
}
