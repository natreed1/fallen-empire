/**
 * Types for the tiered seasonal simulation system.
 * Tiers: C (economy/survival), B (combat), A (full strategic).
 * Anchors are permanent benchmark opponents; ineligible for champion.
 */

import type { AiParams } from '../../src/lib/ai';
import type { SimResult } from '../../src/core/gameCore';
import type { RunSimulationDiagnostics } from '../../src/core/gameCore';

export type Tier = 'C' | 'B' | 'A';

/** One agent in the sim: params + lineage + anchor flag. */
export type SimAgent = {
  id: string;
  params: AiParams;
  tier: Tier;
  lineageId: string;
  /** Anchors are fixed benchmarks; never mutated, never champion. */
  isAnchor: boolean;
  /** Per-season game scores for robustness (mean - λ·std). */
  gameScores: number[];
  /** Season stats (wins, draws, kills, etc.) for gates and reporting. */
  wins: number;
  losses: number;
  draws: number;
  totalKills: number;
  noCombatGames: number;
  totalStarvationGames: number;
  decisiveGames: number;
};

/** Result of one game with diagnostics (for scoring and anti-degenerate). */
export type GameResult = SimResult & { diagnostics: RunSimulationDiagnostics };

/** Scenario battle-test: id, min score threshold for promotion/champion. */
export type ScenarioSpec = {
  id: string;
  name: string;
  /** Minimum effective score (after penalties) to pass. */
  minScoreThreshold: number;
  /** Map seed base for this scenario (deterministic). */
  seedBase: number;
  /** Number of games per scenario run (different seeds). */
  gamesPerScenario: number;
};

/** Result of running the scenario battery for one agent. */
export type ScenarioBatteryResult = {
  scenarioId: string;
  passed: boolean;
  score: number;
  gamesPlayed: number;
};

/** Holdout run: fixed seeds/maps/opponents; never used for selection. */
export type HoldoutResult = {
  season: number;
  /** Agent id -> mean score on holdout (for telemetry only). */
  scoresByAgentId: Record<string, number>;
  /** Aggregate: draw rate, starvation rate, etc. */
  drawRate: number;
  totalStarvationRate: number;
  decisiveness: number; // fraction of games with a winner
}

/** Telemetry snapshot for rollback triggers. */
export type TelemetrySnapshot = {
  season: number;
  drawRate: number;
  totalStarvationRate: number;
  decisiveness: number;
  /** Holdout delta vs previous run (if any). */
  holdoutDelta?: number;
  /** Max fraction of one tier from a single lineage (0–1). */
  lineageConcentration: number;
};

/** Checkpoint for rollback: full state to restore. */
export type SimCheckpoint = {
  season: number;
  agents: SimAgent[];
  telemetry: TelemetrySnapshot;
  timestamp: string;
};

/** Champion eligibility result. */
export type ChampionEligibility = {
  eligible: boolean;
  isAnchor: boolean;
  holdoutPass: boolean;
  anchorGauntletPass: boolean;
  scenarioMinimumsPass: boolean;
  reasons: string[];
};
