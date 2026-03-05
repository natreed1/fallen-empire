/**
 * One season: round-robin within tier + vs anchors, robustness scoring,
 * scenario battery for promotion, fixed tier sizes, promotion/relegation, rebalance.
 */

import {
  runSimulationWithDiagnostics,
  type RunSimulationOptions,
} from '../../src/core/gameCore';
import { DEFAULT_AI_PARAMS } from '../../src/lib/ai';
import type { SimAgent } from './types';
import type { SimSystemConfig } from './config';
import { getAnchors } from './anchors';
import { scoreGame } from './scoring';
import { robustnessScore } from './scoring';
import type { GameResult } from './types';
import { runScenarioBattery } from './scenario-battery';
import {
  passesTierCGate,
  passesTierBGate,
  passesTierAGate,
  passesScenarioMinimumForPromotion,
} from './gates';
import { lineagesAtCap, wouldExceedLineageCap } from './lineage';
import { chooseMutationBucket, mutateWithBucket } from './mutation';

const WIN_POINTS = 100;

function roundRobinPairs<T>(list: T[]): [T, T][] {
  const pairs: [T, T][] = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      pairs.push([list[i], list[j]]);
    }
  }
  return pairs;
}

function deterministicSeed(season: number, tier: string, i: number, j: number, leg: number): number {
  const h = (season * 7919 + tier.charCodeAt(0) * 97 + i * 31 + j * 7 + leg) | 0;
  return ((h % 1_000_000) + 1_000_000) % 1_000_000;
}

/** Reset season stats for all non-anchor agents. */
export function resetSeasonStats(agents: SimAgent[]): void {
  for (const a of agents) {
    if (a.isAnchor) continue;
    a.gameScores = [];
    a.wins = 0;
    a.losses = 0;
    a.draws = 0;
    a.totalKills = 0;
    a.noCombatGames = 0;
    a.totalStarvationGames = 0;
    a.decisiveGames = 0;
  }
}

/** Run all games for one season: tier round-robin + each tier vs all anchors. */
export function runSeasonGames(
  agents: SimAgent[],
  season: number,
  config: SimSystemConfig,
): void {
  const opts: RunSimulationOptions = {
    maxCycles: config.maxCycles,
    mapConfigOverride: { width: config.mapSize, height: config.mapSize },
  };
  const anchors = getAnchors();

  const tiers: ('C' | 'B' | 'A')[] = ['C', 'B', 'A'];
  for (const tier of tiers) {
    const inTier = agents.filter(a => a.tier === tier && !a.isAnchor);
    const pairs = roundRobinPairs(inTier);
    for (let p = 0; p < pairs.length; p++) {
      const [c1, c2] = pairs[p];
      for (let leg = 0; leg < config.matchesPerPair; leg++) {
        const seed = deterministicSeed(season, tier, p * 2, leg, 0);
        const r1 = runSimulationWithDiagnostics(c1.params, c2.params, seed, config.maxCycles, opts);
        const r2 = runSimulationWithDiagnostics(c2.params, c1.params, seed + 1, config.maxCycles, opts);
        const res1: GameResult = { ...r1, diagnostics: r1.diagnostics };
        const res2: GameResult = { ...r2, diagnostics: r2.diagnostics };
        const s1 = scoreGame(res1, 'ai1', config);
        const s2 = scoreGame(res2, 'ai2', config);
        c1.gameScores.push(s1);
        c2.gameScores.push(s2);
        if (r1.winner === 'ai1') { c1.wins++; c2.losses++; c1.decisiveGames++; }
        else if (r1.winner === 'ai2') { c2.wins++; c1.losses++; c2.decisiveGames++; }
        else { c1.draws++; c2.draws++; }
        if (r1.diagnostics.totalKills === 0) { c1.noCombatGames++; c2.noCombatGames++; }
        if (r1.diagnostics.totalStarvationAbort) { c1.totalStarvationGames++; c2.totalStarvationGames++; }
        c1.totalKills += r1.diagnostics.killsByAi1 ?? 0;
        c2.totalKills += r1.diagnostics.killsByAi2 ?? 0;
        c2.totalKills += r2.diagnostics.killsByAi1 ?? 0;
        c1.totalKills += r2.diagnostics.killsByAi2 ?? 0;
      }
    }

    for (const candidate of inTier) {
      for (let a = 0; a < anchors.length; a++) {
        const anchor = anchors[a];
        for (let leg = 0; leg < config.matchesPerPair; leg++) {
          const seed = deterministicSeed(season, tier + 'a', a, leg, 0);
          const r1 = runSimulationWithDiagnostics(candidate.params, anchor.params, seed, config.maxCycles, opts);
          const r2 = runSimulationWithDiagnostics(anchor.params, candidate.params, seed + 1, config.maxCycles, opts);
          const res1: GameResult = { ...r1, diagnostics: r1.diagnostics };
          const res2: GameResult = { ...r2, diagnostics: r2.diagnostics };
          const s1 = scoreGame(res1, 'ai1', config);
          const s2 = scoreGame(res2, 'ai2', config);
          candidate.gameScores.push(s1);
          candidate.gameScores.push(s2);
          if (r1.winner === 'ai1') { candidate.wins++; candidate.decisiveGames++; }
          else if (r1.winner === 'ai2') { candidate.losses++; }
          else candidate.draws++;
          if (r2.winner === 'ai2') { candidate.wins++; candidate.decisiveGames++; }
          else if (r2.winner === 'ai1') { candidate.losses++; }
          else candidate.draws++;
          if (r1.diagnostics.totalKills === 0) candidate.noCombatGames++;
          if (r2.diagnostics.totalKills === 0) candidate.noCombatGames++;
          if (r1.diagnostics.totalStarvationAbort) candidate.totalStarvationGames++;
          if (r2.diagnostics.totalStarvationAbort) candidate.totalStarvationGames++;
          candidate.totalKills += r1.diagnostics.killsByAi1 ?? 0;
          candidate.totalKills += r2.diagnostics.killsByAi2 ?? 0;
        }
      }
    }
  }
}

/** Compare two agents by robustness score (desc). */
function compareByRobustness(a: SimAgent, b: SimAgent, config: SimSystemConfig): number {
  const sa = robustnessScore(a.gameScores, config);
  const sb = robustnessScore(b.gameScores, config);
  if (sb !== sa) return sb - sa;
  if (b.wins !== a.wins) return b.wins - a.wins;
  return (b.totalKills - b.noCombatGames) - (a.totalKills - a.noCombatGames);
}

/** Promote from B: best-first by robustness; respect scenario gate + lineage cap. Fixed quota. */
function selectForPromotionToA(
  agents: SimAgent[],
  config: SimSystemConfig,
  scenarioResultsByAgentId: Map<string, { score: number }[]>,
): SimAgent[] {
  const B = agents.filter(a => a.tier === 'B' && !a.isAnchor).sort((a, b) => compareByRobustness(b, a, config));
  const atCapA = lineagesAtCap(agents, 'A', config.lineageCapPerTier);
  const promoted: SimAgent[] = [];
  const need = config.promoteCount;
  for (const b of B) {
    if (promoted.length >= need) break;
    const scenarioResults = scenarioResultsByAgentId.get(b.id) ?? [];
    if (!passesScenarioMinimumForPromotion(scenarioResults, config)) continue;
    if (!passesTierBGate(b, config)) continue;
    if (atCapA.has(b.lineageId) && wouldExceedLineageCap([...agents, ...promoted], 'A', b.lineageId, config.lineageCapPerTier)) continue;
    promoted.push(b);
  }
  return promoted;
}

/** Promote from C to B: best-first by robustness; respect tier gate + lineage cap. Fixed quota. */
function selectForPromotionToB(
  agents: SimAgent[],
  config: SimSystemConfig,
): SimAgent[] {
  const C = agents.filter(a => a.tier === 'C' && !a.isAnchor).sort((a, b) => compareByRobustness(b, a, config));
  const atCapB = lineagesAtCap(agents, 'B', config.lineageCapPerTier);
  const promoted: SimAgent[] = [];
  const need = config.promoteCount;
  for (const c of C) {
    if (promoted.length >= need) break;
    if (!passesTierCGate(c, config)) continue;
    if (atCapB.has(c.lineageId) && wouldExceedLineageCap([...agents, ...promoted], 'B', c.lineageId, config.lineageCapPerTier)) continue;
    promoted.push(c);
  }
  return promoted;
}

/** Relegate from A to B: worst-first by robustness (bottom N). */
function selectForRelegationToB(agents: SimAgent[], config: SimSystemConfig, count: number): SimAgent[] {
  const A = agents.filter(a => a.tier === 'A' && !a.isAnchor).sort((a, b) => compareByRobustness(b, a, config));
  return A.slice(0, count);
}

/** Relegate from B to C: worst-first by robustness (bottom N). */
function selectForRelegationToC(agents: SimAgent[], config: SimSystemConfig, count: number): SimAgent[] {
  const B = agents.filter(a => a.tier === 'B' && !a.isAnchor).sort((a, b) => compareByRobustness(b, a, config));
  return B.slice(0, count);
}

/** Apply promotion/relegation and refill C with mutations. Fixed quotas: promote top N, relegate bottom N. */
export function applyPromotionRelegation(
  agents: SimAgent[],
  config: SimSystemConfig,
  scenarioResultsByAgentId: Map<string, { score: number }[]>,
): void {
  const targetC = config.tierSizeC;

  const toA = selectForPromotionToA(agents, config, scenarioResultsByAgentId);
  const toBFromC = selectForPromotionToB(agents, config);
  const A = agents.filter(a => a.tier === 'A' && !a.isAnchor);
  const B = agents.filter(a => a.tier === 'B' && !a.isAnchor);

  const relegateCountA = Math.min(config.relegateCount, A.length);
  const toBFromA = relegateCountA > 0 ? selectForRelegationToB(agents, config, relegateCountA) : [];
  const relegateCountB = Math.min(config.relegateCount, B.length);
  const toCFromB = relegateCountB > 0 ? selectForRelegationToC(agents, config, relegateCountB) : [];

  for (const a of toA) a.tier = 'A';
  for (const a of toBFromA) a.tier = 'B';
  for (const a of toBFromC) a.tier = 'B';
  for (const a of toCFromB) a.tier = 'C';

  const remainingC = agents.filter(a => a.tier === 'C' && !a.isAnchor);
  const inCAfterMoves = remainingC.length;
  const toReplace = Math.max(0, inCAfterMoves - targetC);
  const bottomC = [...remainingC].sort((a, b) => compareByRobustness(b, a, config)).slice(0, toReplace);
  const elites = agents.filter(a => (a.tier === 'A' || a.tier === 'B') && !a.isAnchor).sort((a, b) => compareByRobustness(b, a, config)).slice(0, 5);
  for (let i = 0; i < bottomC.length; i++) {
    const parent = elites[Math.min(i, elites.length - 1)];
    const parentParams = parent ? parent.params : DEFAULT_AI_PARAMS;
    const lineageId = parent ? parent.lineageId : `gen_${Date.now()}`;
    const bucket = chooseMutationBucket(config);
    const params = mutateWithBucket(parentParams, bucket, config);
    const c = bottomC[i];
    c.params = params;
    c.lineageId = lineageId;
    c.tier = 'C';
    resetSeasonStats([c]);
  }
}

/** Create new agents for C underflow (caller appends to agents). */
export function createNewAgentsForCUnderflow(
  agents: SimAgent[],
  count: number,
  config: SimSystemConfig,
  nextId: () => string,
): SimAgent[] {
  const elites = agents.filter(a => (a.tier === 'A' || a.tier === 'B') && !a.isAnchor).sort((a, b) => compareByRobustness(b, a, config)).slice(0, 5);
  const newAgents: SimAgent[] = [];
  for (let i = 0; i < count; i++) {
    const parent = elites[Math.min(i, elites.length - 1)];
    const parentParams = parent ? parent.params : DEFAULT_AI_PARAMS;
    const lineageId = parent ? parent.lineageId : `gen_${Date.now()}_${i}`;
    const bucket = chooseMutationBucket(config);
    const params = mutateWithBucket(parentParams, bucket, config);
    newAgents.push({
      id: nextId(),
      params,
      tier: 'C',
      lineageId,
      isAnchor: false,
      gameScores: [],
      wins: 0,
      losses: 0,
      draws: 0,
      totalKills: 0,
      noCombatGames: 0,
      totalStarvationGames: 0,
      decisiveGames: 0,
    });
  }
  return newAgents;
}
