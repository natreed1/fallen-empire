/**
 * Configuration for the tiered seasonal simulation system.
 * Env overrides with guardrails for mutation ratios and tier sizes.
 */

export type SimSystemConfig = {
  // Tier sizes (fixed every season; auto-rebalance on underflow/overflow)
  tierSizeC: number;
  tierSizeB: number;
  tierSizeA: number;

  // Fixed movement quotas per season (competitive ladder: promote top N, relegate bottom N)
  promoteCount: number;  // e.g. 2: top 2 from B→A, top 2 from C→B
  relegateCount: number; // e.g. 2: bottom 2 from A→B, bottom 2 from B→C

  // Mutation portfolio (must sum to 1; guardrails enforce)
  mutationStableRatio: number;   // 0.65
  mutationMediumRatio: number;  // 0.25
  mutationWildcardRatio: number; // 0.10

  // Mutation strengths per bucket
  mutationStableStrength: number;
  mutationMediumStrength: number;
  mutationWildcardStrength: number;

  // Robustness scoring
  robustnessLambda: number;     // variance penalty
  robustnessTailPenalty: number; // worst decile

  // Anti-degenerate penalties
  drawPenalty: number;
  noCombatPenalty: number;
  /** Penalty when game aborted (both sides irrecoverable starvation). Both AIs get this. */
  totalStarvationPenalty: number;

  // Holdout
  holdoutEveryNSeasons: number;
  holdoutNumGames: number;
  holdoutSeedBase: number;

  // Scenario battery: min thresholds for promotion / champion
  scenarioMinScoreForPromotion: number;
  scenarioMinScoreForChampion: number;

  // Probation: fallback-promoted bots must improve within N seasons or auto-relegate
  probationSeasonsBeforeRelegate: number;
  // Gate scheduling: seasons 1..gateLenientUntilSeason use lenient gates; then tighten
  gateLenientUntilSeason: number;

  // Lineage diversity: max fraction of a tier that can be one lineage
  lineageCapPerTier: number; // e.g. 0.4 = at most 40% of tier from one lineage

  // Telemetry rollback triggers (regression => rollback to last checkpoint)
  maxDrawRateTrigger: number;
  maxTotalStarvationRateTrigger: number;
  minDecisivenessTrigger: number;
  maxHoldoutDeltaRegressTrigger: number; // if holdout delta drops below this (negative = regression)
  maxLineageConcentrationTrigger: number;

  // Game/sim
  maxCycles: number;
  mapSize: number;
  matchesPerPair: number; // per opponent per season (side-balanced)
};

function parseEnvInt(name: string, defaultVal: number, min: number, max: number): number {
  const v = parseInt(process.env[name] ?? String(defaultVal), 10);
  if (!Number.isFinite(v)) return defaultVal;
  return Math.max(min, Math.min(max, v));
}

function parseEnvFloat(name: string, defaultVal: number, min: number, max: number): number {
  const v = parseFloat(process.env[name] ?? String(defaultVal));
  if (!Number.isFinite(v)) return defaultVal;
  return Math.max(min, Math.min(max, v));
}

/** Load config from env with guardrails. Mutation ratios are normalized to sum to 1. */
export function loadSimSystemConfig(): SimSystemConfig {
  const tierSize = parseEnvInt('SIM_TIER_SIZE', 8, 4, 24);
  let stable = parseEnvFloat('SIM_MUTATION_STABLE_RATIO', 0.65, 0.1, 0.9);
  let medium = parseEnvFloat('SIM_MUTATION_MEDIUM_RATIO', 0.25, 0.05, 0.5);
  let wildcard = parseEnvFloat('SIM_MUTATION_WILDCARD_RATIO', 0.1, 0.02, 0.3);
  const sum = stable + medium + wildcard;
  if (sum <= 0) {
    stable = 0.65;
    medium = 0.25;
    wildcard = 0.1;
  } else {
    stable /= sum;
    medium /= sum;
    wildcard /= sum;
  }

  return {
    tierSizeC: parseEnvInt('SIM_TIER_SIZE_C', tierSize, 4, 24),
    tierSizeB: parseEnvInt('SIM_TIER_SIZE_B', tierSize, 4, 24),
    tierSizeA: parseEnvInt('SIM_TIER_SIZE_A', tierSize, 4, 24),

    promoteCount: parseEnvInt('SIM_PROMOTE_COUNT', 2, 1, 8),
    relegateCount: parseEnvInt('SIM_RELEGATE_COUNT', 2, 1, 8),

    mutationStableRatio: stable,
    mutationMediumRatio: medium,
    mutationWildcardRatio: wildcard,

    mutationStableStrength: parseEnvFloat('SIM_MUTATION_STABLE_STRENGTH', 0.08, 0.02, 0.3),
    mutationMediumStrength: parseEnvFloat('SIM_MUTATION_MEDIUM_STRENGTH', 0.18, 0.05, 0.4),
    mutationWildcardStrength: parseEnvFloat('SIM_MUTATION_WILDCARD_STRENGTH', 0.35, 0.1, 0.6),

    robustnessLambda: parseEnvFloat('SIM_ROBUST_LAMBDA', 0.35, 0.1, 0.8),
    robustnessTailPenalty: parseEnvFloat('SIM_ROBUST_TAIL_PENALTY', 0.25, 0, 0.5),

    drawPenalty: parseEnvFloat('SIM_DRAW_PENALTY', 10, 0, 50),
    noCombatPenalty: parseEnvFloat('SIM_NO_COMBAT_PENALTY', 25, 0, 80),
    totalStarvationPenalty: parseEnvFloat('SIM_TOTAL_STARVATION_PENALTY', 50, 0, 100),

    holdoutEveryNSeasons: parseEnvInt('SIM_HOLDOUT_EVERY_N', 3, 1, 20),
    holdoutNumGames: parseEnvInt('SIM_HOLDOUT_NUM_GAMES', 20, 5, 100),
    holdoutSeedBase: parseInt(process.env.SIM_HOLDOUT_SEED_BASE || '999001', 10) || 999001,

    scenarioMinScoreForPromotion: parseEnvFloat('SIM_SCENARIO_MIN_PROMOTION', 0, -50, 100),
    scenarioMinScoreForChampion: parseEnvFloat('SIM_SCENARIO_MIN_CHAMPION', 10, -50, 100),

    probationSeasonsBeforeRelegate: parseEnvInt('SIM_PROBATION_SEASONS', 2, 1, 8),
    gateLenientUntilSeason: parseEnvInt('SIM_GATE_LENIENT_UNTIL_SEASON', 3, 1, 20),

    lineageCapPerTier: parseEnvFloat('SIM_LINEAGE_CAP_PER_TIER', 0.4, 0.2, 0.8),

    maxDrawRateTrigger: parseEnvFloat('SIM_ROLLBACK_MAX_DRAW_RATE', 0.92, 0.5, 1),
    maxTotalStarvationRateTrigger: parseEnvFloat('SIM_ROLLBACK_MAX_TOTAL_STARVATION_RATE', 0.6, 0.2, 1),
    minDecisivenessTrigger: parseEnvFloat('SIM_ROLLBACK_MIN_DECISIVENESS', 0.08, 0, 0.5),
    maxHoldoutDeltaRegressTrigger: parseEnvFloat('SIM_ROLLBACK_HOLDOUT_DELTA_REGRESS', -15, -50, 0),
    maxLineageConcentrationTrigger: parseEnvFloat('SIM_ROLLBACK_MAX_LINEAGE_CONCENTRATION', 0.85, 0.5, 1),

    maxCycles: parseEnvInt('SIM_MAX_CYCLES', 300, 100, 600),
    mapSize: parseEnvInt('SIM_MAP_SIZE', 38, 24, 64),
    matchesPerPair: parseEnvInt('SIM_MATCHES_PER_PAIR', 4, 2, 16),
  };
}
