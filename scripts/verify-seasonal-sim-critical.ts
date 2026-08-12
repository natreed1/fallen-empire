/**
 * Locks in seasonal-sim / league scoring fixes:
 * - C overflow must terminate and restore |C| = target
 * - promotion / mutation elites are best-first by robustness
 * - intra-tier second leg is scored for the player who actually played that side
 * - negative tails are penalized (not rewarded)
 */
import { DEFAULT_AI_PARAMS } from '../src/lib/ai';
import type { SimSystemConfig } from './sim-system/config';
import type { SimAgent } from './sim-system/types';
import type { GameResult } from './sim-system/types';
import {
  applyPromotionRelegation,
  createNewAgentsForCUnderflow,
  recordIntraTierPairResults,
} from './sim-system/season';
import { negativeTailMagnitude, robustnessScore, scoreGame } from './sim-system/scoring';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function testConfig(overrides: Partial<SimSystemConfig> = {}): SimSystemConfig {
  return {
    tierSizeC: 2,
    tierSizeB: 2,
    tierSizeA: 2,
    promoteCount: 1,
    relegateCount: 1,
    mutationStableRatio: 0.65,
    mutationMediumRatio: 0.25,
    mutationWildcardRatio: 0.1,
    mutationStableStrength: 0.08,
    mutationMediumStrength: 0.18,
    mutationWildcardStrength: 0.35,
    robustnessLambda: 0.35,
    robustnessTailPenalty: 0.25,
    drawPenalty: 10,
    noCombatPenalty: 25,
    totalStarvationPenalty: 50,
    holdoutEveryNSeasons: 3,
    holdoutNumGames: 20,
    holdoutSeedBase: 999001,
    scenarioMinScoreForPromotion: -50,
    scenarioMinScoreForChampion: 10,
    fortressClosureMinScore: -20,
    supplyStressMaxRatio: 0.5,
    probationSeasonsBeforeRelegate: 2,
    gateLenientUntilSeason: 3,
    lineageCapPerTier: 1,
    maxDrawRateTrigger: 0.92,
    maxTotalStarvationRateTrigger: 0.6,
    minDecisivenessTrigger: 0.08,
    maxHoldoutDeltaRegressTrigger: -15,
    maxLineageConcentrationTrigger: 0.85,
    maxCycles: 300,
    mapSize: 38,
    matchesPerPair: 4,
    ...overrides,
  };
}

function makeAgent(id: string, tier: 'A' | 'B' | 'C', scores: number[], extra: Partial<SimAgent> = {}): SimAgent {
  return {
    id,
    params: { ...DEFAULT_AI_PARAMS },
    tier,
    lineageId: `lin_${id}`,
    isAnchor: false,
    gameScores: scores,
    wins: extra.wins ?? 3,
    losses: extra.losses ?? 1,
    draws: extra.draws ?? 0,
    totalKills: extra.totalKills ?? 10,
    noCombatGames: extra.noCombatGames ?? 0,
    totalStarvationGames: extra.totalStarvationGames ?? 0,
    decisiveGames: extra.decisiveGames ?? 3,
    ...extra,
  };
}

function fakeResult(partial: {
  winner: 'ai1' | 'ai2' | null;
  ai1Cities?: number;
  ai2Cities?: number;
  killsByAi1?: number;
  killsByAi2?: number;
  totalKills?: number;
  totalStarvationAbort?: boolean;
}): GameResult {
  const killsByAi1 = partial.killsByAi1 ?? 4;
  const killsByAi2 = partial.killsByAi2 ?? 1;
  return {
    winner: partial.winner,
    cycle: 10,
    ai1Cities: partial.ai1Cities ?? 3,
    ai2Cities: partial.ai2Cities ?? 1,
    ai1Pop: 100,
    ai2Pop: 40,
    diagnostics: {
      totalKills: partial.totalKills ?? killsByAi1 + killsByAi2,
      killsByAi1,
      killsByAi2,
      hadOwnerFlip: false,
      buildsAi1: {},
      buildsAi2: {},
      buildsAi1Early: {},
      buildsAi2Early: {},
      buildsAi1Late: {},
      buildsAi2Late: {},
      unitsAtEnd: 8,
      totalStarvationAbort: partial.totalStarvationAbort ?? false,
    },
  };
}

function countTier(agents: SimAgent[], tier: 'A' | 'B' | 'C'): number {
  return agents.filter(a => a.tier === tier && !a.isAnchor).length;
}

// ── Tail penalty sign ──────────────────────────────────────────────
{
  const cfg = testConfig();
  assert(negativeTailMagnitude(-40) === 40, 'negative tail magnitude of -40');
  assert(negativeTailMagnitude(20) === 0, 'positive worst-decile is not a tail penalty');
  const stable = robustnessScore([10, 12, 11, 9, 10], cfg);
  const catastrophe = robustnessScore([10, 12, 11, 9, -80], cfg);
  assert(catastrophe < stable, 'catastrophic tail must lower robustness, not raise it');
}

// ── Intra-tier second leg attribution ──────────────────────────────
{
  const cfg = testConfig();
  const c1 = makeAgent('c1', 'C', [], { wins: 0, losses: 0, draws: 0, totalKills: 0, decisiveGames: 0 });
  const c2 = makeAgent('c2', 'C', [], { wins: 0, losses: 0, draws: 0, totalKills: 0, decisiveGames: 0 });
  // r1: c1 (ai1) crushes c2. r2: c2 (ai1) crushes c1.
  const r1 = fakeResult({ winner: 'ai1', ai1Cities: 4, ai2Cities: 0, killsByAi1: 8, killsByAi2: 0 });
  const r2 = fakeResult({ winner: 'ai1', ai1Cities: 4, ai2Cities: 0, killsByAi1: 7, killsByAi2: 0 });
  recordIntraTierPairResults(c1, c2, r1, r2, cfg);

  const s1c1 = scoreGame(r1, 'ai1', cfg);
  const s2c1 = scoreGame(r2, 'ai2', cfg);
  const s1c2 = scoreGame(r1, 'ai2', cfg);
  const s2c2 = scoreGame(r2, 'ai1', cfg);
  assert(c1.gameScores[0] === s1c1 && c1.gameScores[1] === s2c1, 'c1 scores are own performances');
  assert(c2.gameScores[0] === s1c2 && c2.gameScores[1] === s2c2, 'c2 scores are own performances');
  assert(c1.wins === 1 && c1.losses === 1, 'c1 W/L includes both legs');
  assert(c2.wins === 1 && c2.losses === 1, 'c2 W/L includes both legs');
  assert(c1.totalKills === 8, 'c1 kills from r1.ai1 + r2.ai2');
  assert(c2.totalKills === 7, 'c2 kills from r1.ai2 + r2.ai1');
}

// ── Promotion is best-first ────────────────────────────────────────
{
  const cfg = testConfig();
  const agents = [
    makeAgent('a_best', 'A', [90, 90, 90]),
    makeAgent('a_worst', 'A', [-20, -20, -20], { wins: 1 }),
    makeAgent('b_best', 'B', [80, 80, 80]),
    makeAgent('b_worst', 'B', [-25, -25, -25], { wins: 1 }),
    makeAgent('c_best', 'C', [40, 40, 40]),
    makeAgent('c_worst', 'C', [-15, -15, -15], { wins: 1 }),
  ];
  applyPromotionRelegation(agents, cfg, new Map(), 1);
  const inA = new Set(agents.filter(a => a.tier === 'A').map(a => a.id));
  assert(inA.has('b_best'), 'highest-robustness B is promoted to A');
  assert(!inA.has('b_worst'), 'lowest-robustness B is not promoted to A');
  assert(inA.has('a_best'), 'best A stays in A');
}

// ── C overflow terminates and restores target size ─────────────────
{
  const cfg = testConfig();
  const agents = [
    makeAgent('a1', 'A', [50, 50]),
    makeAgent('a2', 'A', [40, 40]),
    makeAgent('b1', 'B', [30, 30]),
    makeAgent('b2', 'B', [20, 20]),
    makeAgent('c1', 'C', [10, 10]),
    makeAgent('c2', 'C', [5, 5]),
    makeAgent('c3', 'C', [-5, -5], { wins: 1 }),
    makeAgent('c4', 'C', [-40, -40], { wins: 1 }),
  ];
  const started = Date.now();
  applyPromotionRelegation(agents, cfg, new Map(), 1);
  assert(Date.now() - started < 2000, 'C overflow must not hang');
  assert(countTier(agents, 'A') === 2, 'A restored to target');
  assert(countTier(agents, 'B') === 2, 'B restored to target');
  assert(countTier(agents, 'C') === 2, 'C overflow dropped extras to target');
  assert(!agents.some(a => a.id === 'c4'), 'worst extra C agent is removed');
}

// ── Gate-fail relegations + stale inB used to hang ─────────────────
{
  const cfg = testConfig({ gateLenientUntilSeason: 1 });
  const agents = [
    makeAgent('a1', 'A', [50], { wins: 2 }),
    makeAgent('a2', 'A', [40], { wins: 2 }),
    makeAgent('b1', 'B', [10], { wins: 0, losses: 4 }),
    makeAgent('b2', 'B', [8], { wins: 0, losses: 4 }),
    makeAgent('c1', 'C', [-10], { wins: 1, losses: 0, totalStarvationGames: 4, draws: 3 }),
    makeAgent('c2', 'C', [-12], { wins: 1, losses: 0, totalStarvationGames: 4, draws: 3 }),
  ];
  const started = Date.now();
  applyPromotionRelegation(agents, cfg, new Map(), 10);
  assert(Date.now() - started < 2000, 'gate-fail rebalance must not hang');
  assert(countTier(agents, 'A') === 2, 'A at target after failed promotions');
  assert(countTier(agents, 'B') === 2, 'B refilled from C after A-fill');
  assert(countTier(agents, 'C') === 2, 'C drained back to target');
}

// ── Underflow elites are the best A/B, not the worst ───────────────
{
  const cfg = testConfig();
  const agents = [
    makeAgent('elite', 'A', [100, 100, 100]),
    makeAgent('weak_a', 'A', [-50, -50, -50], { wins: 1 }),
    makeAgent('b1', 'B', [20, 20]),
    makeAgent('b2', 'B', [10, 10]),
  ];
  const created = createNewAgentsForCUnderflow(agents, 1, cfg, () => 'new_c');
  assert(created.length === 1, 'created one underflow agent');
  assert(created[0].lineageId === 'lin_elite', 'new C mutates from highest-robustness parent');
}

console.log('verify-seasonal-sim-critical: all assertions passed');
