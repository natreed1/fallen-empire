/**
 * Automated telemetry and rollback triggers.
 * Track draw rate, starvation-lock frequency, decisiveness, holdout delta, lineage concentration.
 * If thresholds regress, auto-rollback to last stable checkpoint.
 */

import type { SimAgent } from './types';
import type { TelemetrySnapshot } from './types';
import type { HoldoutResult } from './types';
import type { SimSystemConfig } from './config';
import { computeLineageConcentration } from './gates';

export function buildTelemetrySnapshot(
  season: number,
  agents: SimAgent[],
  holdoutResult: HoldoutResult | null,
  previousHoldoutMean: number | null,
): TelemetrySnapshot {
  const nonAnchor = agents.filter(a => !a.isAnchor);
  let totalGames = 0;
  let draws = 0;
  let starvationLocks = 0;
  let decisive = 0;
  for (const a of nonAnchor) {
    const g = a.wins + a.losses + a.draws;
    totalGames += g;
    draws += a.draws;
    starvationLocks += a.starvationLockGames;
    decisive += a.decisiveGames;
  }
  const drawRate = totalGames > 0 ? draws / totalGames : 0;
  const starvationLockRate = totalGames > 0 ? starvationLocks / totalGames : 0;
  const decisiveness = totalGames > 0 ? decisive / totalGames : 0;

  let holdoutDelta: number | undefined;
  if (holdoutResult && previousHoldoutMean != null) {
    const currentMean = Object.values(holdoutResult.scoresByAgentId).length
      ? Object.values(holdoutResult.scoresByAgentId).reduce((a, b) => a + b, 0) / Object.values(holdoutResult.scoresByAgentId).length
      : 0;
    holdoutDelta = currentMean - previousHoldoutMean;
  }

  const lineageConcentration = computeLineageConcentration(agents);

  return {
    season,
    drawRate,
    starvationLockRate,
    decisiveness,
    holdoutDelta,
    lineageConcentration,
  };
}

/** Return true if any trigger threshold is violated (should rollback). */
export function shouldRollback(
  snapshot: TelemetrySnapshot,
  config: SimSystemConfig,
): boolean {
  if (snapshot.drawRate > config.maxDrawRateTrigger) return true;
  if (snapshot.starvationLockRate > config.maxStarvationLockRateTrigger) return true;
  if (snapshot.decisiveness < config.minDecisivenessTrigger) return true;
  if (snapshot.holdoutDelta != null && snapshot.holdoutDelta < config.maxHoldoutDeltaRegressTrigger) return true;
  if (snapshot.lineageConcentration > config.maxLineageConcentrationTrigger) return true;
  return false;
}
