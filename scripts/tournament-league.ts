/**
 * League-format AI tournament: divisions A/B/C, round-robin, promotion/relegation,
 * mutation, and champion selection. Uses runSimulationWithDiagnostics and
 * configurable scoring (no-combat penalty, all-starving lock penalty).
 *
 * Run: LEAGUE_SEASONS=12 LEAGUE_DIV_SIZE=8 npm run tournament-league
 * Seed pool (strong archetypes, avoid starvation lock):
 *   LEAGUE_SEED_POOL=artifacts/seed_pool_v1.json LEAGUE_MAX_CYCLES=300 npm run tournament-league
 *
 * Robust training (backward-compatible; all new behavior gated by flags):
 *   LEAGUE_DOMAIN_RANDOMIZATION=1 LEAGUE_USE_ROBUST_SELECTION=1 LEAGUE_MUTATION_PROFILE=trend
 *   LEAGUE_INCLUDE_ARCHETYPES=1 LEAGUE_SEASONS=30 npm run tournament-league
 */

import * as path from 'path';
import * as fs from 'fs';
import {
  runSimulationWithDiagnostics,
  DEFAULT_AI_PARAMS,
  type AiParams,
  type RunSimulationOptions,
  type SimResult,
  type RunSimulationDiagnostics,
} from '../src/core/gameCore';
import {
  mutateParams as mutateParamsFromSchema,
  SCALAR_PARAM_KEYS,
  MUTATION_RANGES,
  assertAiParamsConsistency,
  getMutationSpaceSummary,
} from '../src/lib/aiParamsSchema';
import { parseScenarioMix, selectScenario, getScenarioMapOverride } from './lib/scenarios';
import { FIXED_ARCHETYPES } from './lib/archetypes';

/** Minimal shape for trend report (from optimize-trends output). */
type TrendReportParams = Record<string, { recommendedMutationRange: [number, number]; suggestedCenter: number; classification: string }>;
type TrendReportShape = { params: TrendReportParams };

// ─── Config (top-level constants; env overrides for runtime knobs) ───────────
const LEAGUE_SEASONS = parseInt(process.env.LEAGUE_SEASONS || '12', 10) || 12;
const LEAGUE_DIV_SIZE = parseInt(process.env.LEAGUE_DIV_SIZE || '8', 10) || 8;
const LEAGUE_MAX_CYCLES = parseInt(process.env.LEAGUE_MAX_CYCLES || '500', 10) || 500;
const LEAGUE_MAP_SIZE = parseInt(process.env.LEAGUE_MAP_SIZE || '38', 10) || 38;
const LEAGUE_WORKERS = parseInt(process.env.LEAGUE_WORKERS || '0', 10) || 0; // 0 = main thread only
const LEAGUE_SEED_POOL = process.env.LEAGUE_SEED_POOL || ''; // e.g. artifacts/seed_pool_v1.json → 12 candidates, 6/3/3 divisions
const LEAGUE_CHECKPOINT_PATH = process.env.LEAGUE_CHECKPOINT_PATH || 'artifacts/league-checkpoint.json';
const LEAGUE_RESUME = process.env.LEAGUE_RESUME === '1';

// Robust training feature flags (default off for backward compatibility)
const LEAGUE_DOMAIN_RANDOMIZATION = process.env.LEAGUE_DOMAIN_RANDOMIZATION === '1';
const LEAGUE_SCENARIO_MIX = process.env.LEAGUE_SCENARIO_MIX || 'balanced:0.4,tight:0.2,wide:0.2,lean-food:0.1,high-expansion:0.1';
const LEAGUE_INCLUDE_ARCHETYPES = process.env.LEAGUE_INCLUDE_ARCHETYPES === '1'; // default off for backward compatibility
const LEAGUE_ARCHETYPE_WEIGHT = parseFloat(process.env.LEAGUE_ARCHETYPE_WEIGHT || '0.35') || 0.35;
const LEAGUE_USE_ROBUST_SELECTION = process.env.LEAGUE_USE_ROBUST_SELECTION === '1';
const LEAGUE_ROBUST_LAMBDA = parseFloat(process.env.LEAGUE_ROBUST_LAMBDA || '0.35') || 0.35;
const LEAGUE_TAIL_PENALTY = parseFloat(process.env.LEAGUE_TAIL_PENALTY || '0.25') || 0.25;
const LEAGUE_MUTATION_PROFILE = (process.env.LEAGUE_MUTATION_PROFILE || 'legacy') as 'legacy' | 'trend';
const CHAMPION_LIBRARY_CAP = parseInt(process.env.CHAMPION_LIBRARY_CAP || '50', 10) || 50;
const CHAMPION_LIBRARY_PARAM_DISTANCE_THRESHOLD = parseFloat(process.env.CHAMPION_LIBRARY_PARAM_DISTANCE_THRESHOLD || '0.05') || 0.05;

const POPULATION_SIZE = LEAGUE_DIV_SIZE * 3; // 24 = 8 per division (ignored when seed pool)
const TOP_K = LEAGUE_SEED_POOL ? 1 : 2;
const BOT_K = LEAGUE_SEED_POOL ? 1 : 2;
const ELITES_UNCHANGED = 1;
const SEED_POOL_LIGHT_MUTATION = 0.08; // for B/C when using seed pool

// Scoring weights (configurable at top-level)
const WIN_POINTS = 100;
const LOSS_POINTS = -30;
const DRAW_POINTS = 0;
const CITY_W = 15;
const POP_W = 0.2;
const GOLD_W = 0; // SimResult does not expose gold; keep for future
const KILL_W = 2;
const NO_COMBAT_PENALTY = -25; // both sides if totalKills === 0
const STARVING_LOCK_PENALTY = -35; // side-specific if all-starving detected

const BASE_SIM_OPTS: RunSimulationOptions = {
  maxCycles: LEAGUE_MAX_CYCLES,
  mapConfigOverride: { width: LEAGUE_MAP_SIZE, height: LEAGUE_MAP_SIZE },
};

/** Scenario mix for domain randomization (parsed once). */
const SCENARIO_MIX = LEAGUE_DOMAIN_RANDOMIZATION ? parseScenarioMix(LEAGUE_SCENARIO_MIX) : [];

/** Get sim options for a match; when domain randomization is on, pick scenario deterministically from seed. */
function getSimOpts(matchSeed: number): RunSimulationOptions {
  if (!LEAGUE_DOMAIN_RANDOMIZATION) return BASE_SIM_OPTS;
  const scenarioName = selectScenario(SCENARIO_MIX, matchSeed);
  const mapOverride = getScenarioMapOverride(scenarioName);
  return {
    maxCycles: LEAGUE_MAX_CYCLES,
    mapConfigOverride: { width: LEAGUE_MAP_SIZE, height: LEAGUE_MAP_SIZE, ...mapOverride },
  };
}

// ─── Types ─────────────────────────────────────────────────────────────────
export type Division = 'A' | 'B' | 'C';

export type Stats = {
  points: number;
  wins: number;
  losses: number;
  draws: number;
  killsFor: number;
  killsAgainst: number;
  cityDiff: number;
  popDiff: number;
  goldDiff: number;
  decisiveGames: number;
  noCombatGames: number;
  farmsBuiltEarly: number;
  farmsBuiltLate: number;
  marketsBuilt: number;
  minesBuilt: number;
  quarriesBuilt: number;
  barracksBuilt: number;
  factoriesBuilt: number;
  academiesBuilt: number;
  goldMinesBuilt: number;
  /** Points from matches vs fixed archetypes only (when LEAGUE_INCLUDE_ARCHETYPES=1). */
  archetypePoints?: number;
};

export type Candidate = {
  id: string;
  params: AiParams;
  division: Division;
  seasonStats: Stats;
  rating?: number;
  /** Per-game scores for robust selection (when LEAGUE_USE_ROBUST_SELECTION=1). */
  gameScores?: number[];
  /** True if this candidate is a fixed archetype (excluded from promotion/relegation). */
  isArchetype?: boolean;
};

type GameResult = SimResult & { diagnostics: RunSimulationDiagnostics };

function emptyStats(): Stats {
  const s: Stats = {
    points: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    killsFor: 0,
    killsAgainst: 0,
    cityDiff: 0,
    popDiff: 0,
    goldDiff: 0,
    decisiveGames: 0,
    noCombatGames: 0,
    farmsBuiltEarly: 0,
    farmsBuiltLate: 0,
    marketsBuilt: 0,
    minesBuilt: 0,
    quarriesBuilt: 0,
    barracksBuilt: 0,
    factoriesBuilt: 0,
    academiesBuilt: 0,
    goldMinesBuilt: 0,
  };
  if (LEAGUE_INCLUDE_ARCHETYPES) s.archetypePoints = 0;
  return s;
}

/** Deterministic seed for reproducibility. */
function deterministicSeed(
  season: number,
  division: string,
  pairIndex: number,
  leg: number,
  side: number,
): number {
  const h = (season * 7919 + division.charCodeAt(0) * 97 + pairIndex * 31 + leg * 7 + side) | 0;
  return ((h % 1_000_000) + 1_000_000) % 1_000_000;
}

/** Score a single game for one side (ai1 or ai2). */
function scoreGame(
  result: GameResult,
  side: 'ai1' | 'ai2',
): number {
  let s = 0;
  if (result.winner === side) s += WIN_POINTS;
  else if (result.winner !== null) s += LOSS_POINTS;
  else s += DRAW_POINTS;

  const myCities = side === 'ai1' ? result.ai1Cities : result.ai2Cities;
  const oppCities = side === 'ai1' ? result.ai2Cities : result.ai1Cities;
  const myPop = side === 'ai1' ? result.ai1Pop : result.ai2Pop;
  const oppPop = side === 'ai1' ? result.ai2Pop : result.ai1Pop;
  const myKills = side === 'ai1' ? (result.diagnostics.killsByAi1 ?? 0) : (result.diagnostics.killsByAi2 ?? 0);
  const oppKills = side === 'ai1' ? (result.diagnostics.killsByAi2 ?? 0) : (result.diagnostics.killsByAi1 ?? 0);

  s += CITY_W * (myCities - oppCities);
  s += POP_W * (myPop - oppPop);
  s += GOLD_W * 0; // no gold in SimResult yet
  s += KILL_W * (myKills - oppKills);

  if (result.diagnostics.totalKills === 0) s += NO_COMBAT_PENALTY;
  if (result.diagnostics.totalStarvationAbort) s += STARVING_LOCK_PENALTY; // both sides get penalty when game aborted (total starvation)

  return s;
}

/** Update season stats for both candidates after a single game. */
function applyScores(
  c1: Candidate,
  c2: Candidate,
  result: GameResult,
  c1PlayedAs: 'ai1' | 'ai2',
  isArchetypeMatch?: boolean,
): void {
  const c2PlayedAs = c1PlayedAs === 'ai1' ? 'ai2' : 'ai1';
  const pts1 = scoreGame(result, c1PlayedAs);
  const pts2 = scoreGame(result, c2PlayedAs);

  c1.seasonStats.points += pts1;
  c2.seasonStats.points += pts2;
  if (isArchetypeMatch && c2.isArchetype) {
    c1.seasonStats.archetypePoints = (c1.seasonStats.archetypePoints ?? 0) + pts1;
  }
  if (isArchetypeMatch && c1.isArchetype) {
    c2.seasonStats.archetypePoints = (c2.seasonStats.archetypePoints ?? 0) + pts2;
  }
  if (LEAGUE_USE_ROBUST_SELECTION) {
    if (!c1.gameScores) c1.gameScores = [];
    if (!c2.gameScores) c2.gameScores = [];
    c1.gameScores.push(pts1);
    c2.gameScores.push(pts2);
  }

  if (result.winner === c1PlayedAs) {
    c1.seasonStats.wins += 1;
    c2.seasonStats.losses += 1;
    c1.seasonStats.decisiveGames += 1;
  } else if (result.winner === c2PlayedAs) {
    c1.seasonStats.losses += 1;
    c2.seasonStats.wins += 1;
    c2.seasonStats.decisiveGames += 1;
  } else {
    c1.seasonStats.draws += 1;
    c2.seasonStats.draws += 1;
  }

  const k1For = c1PlayedAs === 'ai1' ? (result.diagnostics.killsByAi1 ?? 0) : (result.diagnostics.killsByAi2 ?? 0);
  const k1Against = c1PlayedAs === 'ai1' ? (result.diagnostics.killsByAi2 ?? 0) : (result.diagnostics.killsByAi1 ?? 0);
  const k2For = c2PlayedAs === 'ai1' ? (result.diagnostics.killsByAi1 ?? 0) : (result.diagnostics.killsByAi2 ?? 0);
  const k2Against = c2PlayedAs === 'ai1' ? (result.diagnostics.killsByAi2 ?? 0) : (result.diagnostics.killsByAi1 ?? 0);
  c1.seasonStats.killsFor += k1For;
  c1.seasonStats.killsAgainst += k1Against;
  c2.seasonStats.killsFor += k2For;
  c2.seasonStats.killsAgainst += k2Against;

  const myCities1 = c1PlayedAs === 'ai1' ? result.ai1Cities : result.ai2Cities;
  const oppCities1 = c1PlayedAs === 'ai1' ? result.ai2Cities : result.ai1Cities;
  const myPop1 = c1PlayedAs === 'ai1' ? result.ai1Pop : result.ai2Pop;
  const oppPop1 = c1PlayedAs === 'ai1' ? result.ai2Pop : result.ai1Pop;
  c1.seasonStats.cityDiff += myCities1 - oppCities1;
  c1.seasonStats.popDiff += myPop1 - oppPop1;
  c2.seasonStats.cityDiff += oppCities1 - myCities1;
  c2.seasonStats.popDiff += oppPop1 - myPop1;

  if (result.diagnostics.totalKills === 0) {
    c1.seasonStats.noCombatGames += 1;
    c2.seasonStats.noCombatGames += 1;
  }

  const addBuilds = (c: Candidate, playedAs: 'ai1' | 'ai2') => {
    const early = playedAs === 'ai1' ? result.diagnostics.buildsAi1Early : result.diagnostics.buildsAi2Early;
    const late = playedAs === 'ai1' ? result.diagnostics.buildsAi1Late : result.diagnostics.buildsAi2Late;
    const all = playedAs === 'ai1' ? result.diagnostics.buildsAi1 : result.diagnostics.buildsAi2;
    c.seasonStats.farmsBuiltEarly += early?.farm ?? 0;
    c.seasonStats.farmsBuiltLate += late?.farm ?? 0;
    c.seasonStats.marketsBuilt += all?.market ?? 0;
    c.seasonStats.minesBuilt += all?.mine ?? 0;
    c.seasonStats.quarriesBuilt += all?.quarry ?? 0;
    c.seasonStats.barracksBuilt += all?.barracks ?? 0;
    c.seasonStats.factoriesBuilt += all?.factory ?? 0;
    c.seasonStats.academiesBuilt += all?.academy ?? 0;
    c.seasonStats.goldMinesBuilt += all?.gold_mine ?? 0;
  };
  addBuilds(c1, c1PlayedAs);
  addBuilds(c2, c2PlayedAs);
}

/** Round-robin pairings for one division (each pair plays twice, side-balanced). */
function roundRobinPairings<T>(candidates: T[]): [T, T][] {
  const pairs: [T, T][] = [];
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      pairs.push([candidates[i], candidates[j]]);
    }
  }
  return pairs;
}

/** Robust score: mean - lambda*std - tailPenalty*worstDecile (only when gameScores present). */
function robustScore(c: Candidate): number {
  const scores = c.gameScores;
  if (!scores || scores.length === 0) return c.seasonStats.points;
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((s, x) => s + (x - mean) ** 2, 0) / scores.length;
  const std = Math.sqrt(variance);
  const sorted = [...scores].sort((x, y) => x - y);
  const decileIdx = Math.floor(sorted.length * 0.1);
  const worstDecile = decileIdx < sorted.length ? sorted[decileIdx] : sorted[0] ?? 0;
  return mean - LEAGUE_ROBUST_LAMBDA * std - LEAGUE_TAIL_PENALTY * worstDecile;
}

/** Combined points when archetypes included: (1-w)*divisionPoints + w*archetypePoints. */
function combinedPoints(c: Candidate): number {
  if (!LEAGUE_INCLUDE_ARCHETYPES || c.seasonStats.archetypePoints == null) return c.seasonStats.points;
  const w = LEAGUE_ARCHETYPE_WEIGHT;
  return (1 - w) * c.seasonStats.points + w * c.seasonStats.archetypePoints;
}

/** Tie-breaker order: wins, then head-to-head (we don't track h2h here; use points), killsDiff, cityDiff, popDiff. */
function compareCandidates(a: Candidate, b: Candidate): number {
  const scoreA = LEAGUE_USE_ROBUST_SELECTION ? robustScore(a) : combinedPoints(a);
  const scoreB = LEAGUE_USE_ROBUST_SELECTION ? robustScore(b) : combinedPoints(b);
  if (scoreB !== scoreA) return scoreB - scoreA;
  if (b.seasonStats.wins !== a.seasonStats.wins) return b.seasonStats.wins - a.seasonStats.wins;
  const killsDiffA = a.seasonStats.killsFor - a.seasonStats.killsAgainst;
  const killsDiffB = b.seasonStats.killsFor - b.seasonStats.killsAgainst;
  if (killsDiffB !== killsDiffA) return killsDiffB - killsDiffA;
  if (b.seasonStats.cityDiff !== a.seasonStats.cityDiff) return b.seasonStats.cityDiff - a.seasonStats.cityDiff;
  return b.seasonStats.popDiff - a.seasonStats.popDiff;
}

/** For promotion: prefer candidates with non-zero kills / lower noCombatGames (stronger signal). */
function compareForPromotion(a: Candidate, b: Candidate): number {
  const aCombat = a.seasonStats.killsFor > 0 ? 1 : 0;
  const bCombat = b.seasonStats.killsFor > 0 ? 1 : 0;
  if (bCombat !== aCombat) return bCombat - aCombat;
  if (a.seasonStats.noCombatGames !== b.seasonStats.noCombatGames) return a.seasonStats.noCombatGames - b.seasonStats.noCombatGames;
  return compareCandidates(a, b);
}

/** Bounded random perturbation; all evolvable params, schema ranges. */
function mutateParams(parent: AiParams, strength: number = 0.15): AiParams {
  return mutateParamsFromSchema({ ...DEFAULT_AI_PARAMS, ...parent }, strength);
}

const TREND_REPORT_PATH = path.join(process.cwd(), 'artifacts', 'trend-report.json');

/** Load trend report if present and valid. */
function loadTrendReport(): TrendReportShape | null {
  if (!fs.existsSync(TREND_REPORT_PATH)) return null;
  try {
    const raw = fs.readFileSync(TREND_REPORT_PATH, 'utf8');
    const data = JSON.parse(raw) as TrendReportShape;
    if (data && typeof data.params === 'object') return data;
  } catch {
    // ignore
  }
  return null;
}

/** Trend-shaped mutation: narrow for stable-good, medium for exploratory, corrective for unstable-bad. */
function mutateParamsTrend(parent: AiParams, strength: number = 0.15): AiParams {
  const report = loadTrendReport();
  if (!report) return mutateParams(parent, strength);

  const out: AiParams = { ...DEFAULT_AI_PARAMS, ...parent };
  const params = report.params;
  const parentRecord = parent as unknown as Record<string, number>;

  for (const key of SCALAR_PARAM_KEYS) {
    const entry = params[key];
    if (!entry || !Array.isArray(entry.recommendedMutationRange)) continue;
    const [lo, hi] = entry.recommendedMutationRange;
    const center = typeof entry.suggestedCenter === 'number' ? entry.suggestedCenter : parentRecord[key];
    const classification = entry.classification;
    let halfWidth: number;
    if (classification === 'stable-good') halfWidth = (hi - lo) * 0.4;
    else if (classification === 'unstable-bad') halfWidth = (hi - lo) * 0.6;
    else halfWidth = (hi - lo) * 0.5;
    const delta = (Math.random() - 0.5) * 2 * halfWidth * strength;
    let v = parentRecord[key] ?? center;
    if (classification === 'unstable-bad') {
      v = center + delta;
    } else {
      v = v + delta;
    }
    const range = MUTATION_RANGES[key];
    const clamped = Math.max(lo, Math.min(hi, v));
    (out as unknown as Record<string, number>)[key] = range?.round ? Math.round(clamped) : clamped;
  }
  return out;
}

/** Mutation entry point: trend profile when LEAGUE_MUTATION_PROFILE=trend, else legacy. */
function mutateParamsForLeague(parent: AiParams, strength: number = 0.15): AiParams {
  return LEAGUE_MUTATION_PROFILE === 'trend' ? mutateParamsTrend(parent, strength) : mutateParams(parent, strength);
}

function cloneParams(p: AiParams): AiParams {
  return { ...DEFAULT_AI_PARAMS, ...p };
}

/** Light mutation for seed-pool B/C variants. */
function mutateParamsLight(parent: AiParams, strength: number = SEED_POOL_LIGHT_MUTATION): AiParams {
  return mutateParams(parent, strength);
}

type SeedPoolEntry = { archetype?: string; params: Partial<AiParams> };
type SeedPoolFile = { meta?: unknown; candidates: SeedPoolEntry[] };

/** Load seed pool JSON and return full AiParams[] (merged with defaults). */
function loadSeedPool(filePath: string): AiParams[] {
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  const raw = fs.readFileSync(resolved, 'utf8');
  const data = JSON.parse(raw) as SeedPoolFile;
  if (!Array.isArray(data.candidates) || data.candidates.length < 12) {
    throw new Error(`Seed pool must have at least 12 candidates, got ${data.candidates?.length ?? 0}`);
  }
  return data.candidates.slice(0, 12).map(entry =>
    cloneParams({ ...DEFAULT_AI_PARAMS, ...entry.params } as AiParams),
  );
}

/** Seed A with 2 per archetype (indices 0,1 = Sustain; 4,5 = Pressure; 8,9 = Logistics). B/C get rest + light mutation. */
function initialCandidatesFromSeedPool(poolPath: string): Candidate[] {
  const paramsList = loadSeedPool(poolPath);
  const list: Candidate[] = [];
  const aIndices = [0, 1, 4, 5, 8, 9];
  const bIndices = [2, 6, 10];
  const cIndices = [3, 7, 11];
  let idx = 0;
  for (const i of aIndices) {
    list.push({
      id: `seed_A_${idx}`,
      params: cloneParams(paramsList[i]),
      division: 'A',
      seasonStats: emptyStats(),
    });
    idx++;
  }
  idx = 0;
  for (const i of bIndices) {
    list.push({
      id: `seed_B_${idx}`,
      params: mutateParamsLight(paramsList[i]),
      division: 'B',
      seasonStats: emptyStats(),
    });
    idx++;
  }
  idx = 0;
  for (const i of cIndices) {
    list.push({
      id: `seed_C_${idx}`,
      params: mutateParamsLight(paramsList[i]),
      division: 'C',
      seasonStats: emptyStats(),
    });
    idx++;
  }
  return list;
}

/** Initialize population: one default, rest mutated from default. */
function initialCandidates(): Candidate[] {
  const list: Candidate[] = [];
  const divs: Division[] = ['A', 'B', 'C'];
  for (let d = 0; d < 3; d++) {
    for (let i = 0; i < LEAGUE_DIV_SIZE; i++) {
      const id = `c_${divs[d]}_${i}`;
      const params = i === 0 ? cloneParams(DEFAULT_AI_PARAMS) : mutateParams(DEFAULT_AI_PARAMS, 0.2);
      list.push({
        id,
        params,
        division: divs[d],
        seasonStats: emptyStats(),
      });
    }
  }
  return list;
}

/** Promote/relegate: top TOP_K from B->A (by combat/points), bottom BOT_K from A->B; same B<->C; replace bottom in C with mutations. */
function promoteRelegateAndReplace(
  candidates: Candidate[],
  elites: Candidate[],
): void {
  const A = candidates.filter(c => c.division === 'A').sort(compareCandidates);
  const B = candidates.filter(c => c.division === 'B').sort(compareCandidates);
  const C = candidates.filter(c => c.division === 'C').sort(compareCandidates);

  const BByPromotion = [...B].sort(compareForPromotion);
  const CByPromotion = [...C].sort(compareForPromotion);

  const toA = BByPromotion.slice(0, TOP_K);
  const toBFromA = A.slice(-BOT_K);
  const toB = CByPromotion.slice(0, TOP_K);
  const toCFromB = B.slice(-BOT_K);
  const bottomC = C.slice(-BOT_K);
  const newC = elites.length >= 1
    ? bottomC.map((_, i) => mutateParamsForLeague(elites[Math.min(i, elites.length - 1)].params))
    : bottomC.map(() => mutateParamsForLeague(DEFAULT_AI_PARAMS));

  for (const c of toA) c.division = 'A';
  for (const c of toBFromA) c.division = 'B';
  for (const c of toB) c.division = 'B';
  for (const c of toCFromB) c.division = 'C';
  for (let i = 0; i < bottomC.length; i++) {
    const c = bottomC[i];
    c.params = newC[i];
    c.division = 'C';
    c.seasonStats = emptyStats();
  }
}

/** Select champion: best in A by points, then tie-breakers. */
function selectChampion(divisionA: Candidate[]): Candidate {
  const sorted = [...divisionA].sort(compareCandidates);
  return sorted[0];
}

// ─── Main ─────────────────────────────────────────────────────────────────
type DivisionStanding = { id: string; points: number; wins: number; losses: number; draws: number; killsFor: number; killsAgainst: number; cityDiff: number; popDiff: number; decisiveGames: number; noCombatGames: number; farmsBuiltEarly: number; farmsBuiltLate: number; marketsBuilt: number; minesBuilt: number; quarriesBuilt: number; barracksBuilt: number; factoriesBuilt: number; academiesBuilt: number; goldMinesBuilt: number; archetypePoints?: number; params?: AiParams };

type LeagueReport = {
  seasons: number;
  divSize: number;
  seedPool?: string;
  history: {
    season: number;
    standingsA: DivisionStanding[];
    standingsB: DivisionStanding[];
    standingsC: DivisionStanding[];
    promotionsRelegations: string[];
  }[];
  champion: { id: string; division: string };
  finalStandingsA: { id: string; points: number; wins: number; params?: AiParams }[];
};

type LeagueCheckpointCandidate = {
  id: string;
  params: AiParams;
  division: Division;
};

type LeagueCheckpoint = {
  version: 'v1';
  savedAt: string;
  nextSeason: number;
  seedPool?: string;
  candidates: LeagueCheckpointCandidate[];
  history: LeagueReport['history'];
};

function resolveCheckpointPath(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
}

function saveLeagueCheckpoint(filePath: string, nextSeason: number, candidates: Candidate[], report: LeagueReport, seedPool?: string): void {
  const resolved = resolveCheckpointPath(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const payload: LeagueCheckpoint = {
    version: 'v1',
    savedAt: new Date().toISOString(),
    nextSeason,
    seedPool,
    candidates: candidates.map(c => ({
      id: c.id,
      params: cloneParams(c.params),
      division: c.division,
    })),
    history: report.history,
  };
  fs.writeFileSync(resolved, JSON.stringify(payload, null, 2), 'utf8');
}

function loadLeagueCheckpoint(filePath: string): LeagueCheckpoint | null {
  const resolved = resolveCheckpointPath(filePath);
  if (!fs.existsSync(resolved)) return null;
  try {
    const raw = fs.readFileSync(resolved, 'utf8');
    const data = JSON.parse(raw) as LeagueCheckpoint;
    if (!Array.isArray(data.candidates) || !Array.isArray(data.history) || !Number.isFinite(data.nextSeason)) return null;
    return data;
  } catch {
    return null;
  }
}

function restoreCandidatesFromCheckpoint(checkpoint: LeagueCheckpoint): Candidate[] {
  return checkpoint.candidates.map(c => ({
    id: c.id,
    params: cloneParams(c.params),
    division: c.division,
    seasonStats: emptyStats(),
  }));
}

function main() {
  assertAiParamsConsistency();
  const paramSummary = getMutationSpaceSummary();
  console.log(`Params: ${paramSummary.totalParamCount} total, ${paramSummary.paramsInMutationSpace.length} in mutation space, ${paramSummary.excludedFromMutation.length} excluded (${paramSummary.excludedReason})`);

  const useSeedPool = LEAGUE_SEED_POOL.length > 0;
  const checkpoint = LEAGUE_RESUME ? loadLeagueCheckpoint(LEAGUE_CHECKPOINT_PATH) : null;
  const divLabel = useSeedPool ? '6/3/3 (seed pool)' : `${LEAGUE_DIV_SIZE} each`;

  console.log('League tournament');
  console.log(`  Seasons: ${LEAGUE_SEASONS}  Divisions: ${divLabel}  Map: ${LEAGUE_MAP_SIZE}x${LEAGUE_MAP_SIZE}  MaxCycles: ${LEAGUE_MAX_CYCLES}`);
  if (useSeedPool) console.log(`  Seed pool: ${LEAGUE_SEED_POOL}`);
  if (checkpoint) console.log(`  Resuming from checkpoint: ${LEAGUE_CHECKPOINT_PATH} (next season ${checkpoint.nextSeason})`);
  console.log('');

  let candidates = checkpoint
    ? restoreCandidatesFromCheckpoint(checkpoint)
    : useSeedPool
      ? initialCandidatesFromSeedPool(LEAGUE_SEED_POOL)
      : initialCandidates();
  const report: LeagueReport = checkpoint ? {
    seasons: LEAGUE_SEASONS,
    divSize: checkpoint.seedPool ? 6 : LEAGUE_DIV_SIZE,
    seedPool: checkpoint.seedPool,
    history: checkpoint.history,
    champion: { id: '', division: 'A' },
    finalStandingsA: [],
  } : {
    seasons: LEAGUE_SEASONS,
    divSize: useSeedPool ? 6 : LEAGUE_DIV_SIZE,
    seedPool: useSeedPool ? LEAGUE_SEED_POOL : undefined,
    history: [],
    champion: { id: '', division: 'A' },
    finalStandingsA: [],
  };
  const seedPoolForCheckpoint = checkpoint?.seedPool ?? (useSeedPool ? LEAGUE_SEED_POOL : undefined);
  const startSeason = checkpoint?.nextSeason ?? 1;

  for (let season = startSeason; season <= LEAGUE_SEASONS; season++) {
    for (const c of candidates) {
      c.seasonStats = emptyStats();
      if (LEAGUE_USE_ROBUST_SELECTION) c.gameScores = [];
    }

    for (const div of ['A', 'B', 'C'] as Division[]) {
      const divCandidates = candidates.filter(c => c.division === div);
      const pairs = roundRobinPairings(divCandidates);

      for (let pi = 0; pi < pairs.length; pi++) {
        const [c1, c2] = pairs[pi];
        const seed1 = deterministicSeed(season, div, pi, 0, 0);
        const seed2 = deterministicSeed(season, div, pi, 1, 0);
        const opts1 = getSimOpts(seed1);
        const opts2 = getSimOpts(seed2);

        const r1 = runSimulationWithDiagnostics(c1.params, c2.params, seed1, LEAGUE_MAX_CYCLES, opts1) as GameResult;
        applyScores(c1, c2, r1, 'ai1', false);

        const r2 = runSimulationWithDiagnostics(c2.params, c1.params, seed2, LEAGUE_MAX_CYCLES, opts2) as GameResult;
        applyScores(c2, c1, r2, 'ai1', false);
      }
    }

    // Fixed archetype matches: each candidate plays vs each archetype (both sides), deterministic seeds
    if (LEAGUE_INCLUDE_ARCHETYPES) {
      for (let ai = 0; ai < FIXED_ARCHETYPES.length; ai++) {
        const arch = FIXED_ARCHETYPES[ai];
        for (const c of candidates) {
          const seed1 = deterministicSeed(season, 'arch', ai, 0, 0) + (c.id.length + c.id.split('').reduce((a, ch) => a + ch.charCodeAt(0), 0));
          const seed2 = deterministicSeed(season, 'arch', ai, 1, 0) + (c.id.length + c.id.split('').reduce((a, ch) => a + ch.charCodeAt(0), 0));
          const opts1 = getSimOpts(seed1);
          const opts2 = getSimOpts(seed2);
          const r1 = runSimulationWithDiagnostics(c.params, arch.params, seed1, LEAGUE_MAX_CYCLES, opts1) as GameResult;
          const r2 = runSimulationWithDiagnostics(arch.params, c.params, seed2, LEAGUE_MAX_CYCLES, opts2) as GameResult;
          applyScores(c, { id: arch.id, params: arch.params, division: 'A', seasonStats: emptyStats(), isArchetype: true } as Candidate, r1, 'ai1', true);
          applyScores(c, { id: arch.id, params: arch.params, division: 'A', seasonStats: emptyStats(), isArchetype: true } as Candidate, r2, 'ai2', true);
        }
      }
    }

    const A = candidates.filter(c => c.division === 'A').sort(compareCandidates);
    const B = candidates.filter(c => c.division === 'B').sort(compareCandidates);
    const C = candidates.filter(c => c.division === 'C').sort(compareCandidates);

    const elites = A.slice(0, Math.max(ELITES_UNCHANGED, 2));
    promoteRelegateAndReplace(candidates, elites);

    const toStanding = (c: Candidate): DivisionStanding => {
      const s: DivisionStanding = {
        id: c.id,
        points: c.seasonStats.points,
        wins: c.seasonStats.wins,
        losses: c.seasonStats.losses,
        draws: c.seasonStats.draws,
        killsFor: c.seasonStats.killsFor,
        killsAgainst: c.seasonStats.killsAgainst,
        cityDiff: c.seasonStats.cityDiff,
        popDiff: c.seasonStats.popDiff,
        decisiveGames: c.seasonStats.decisiveGames,
        noCombatGames: c.seasonStats.noCombatGames,
        farmsBuiltEarly: c.seasonStats.farmsBuiltEarly,
        farmsBuiltLate: c.seasonStats.farmsBuiltLate,
        marketsBuilt: c.seasonStats.marketsBuilt,
        minesBuilt: c.seasonStats.minesBuilt,
        quarriesBuilt: c.seasonStats.quarriesBuilt,
        barracksBuilt: c.seasonStats.barracksBuilt,
        factoriesBuilt: c.seasonStats.factoriesBuilt,
        academiesBuilt: c.seasonStats.academiesBuilt,
        goldMinesBuilt: c.seasonStats.goldMinesBuilt,
        params: c.params,
      };
      if (c.seasonStats.archetypePoints != null) s.archetypePoints = c.seasonStats.archetypePoints;
      return s;
    };
    const standingsA = A.map(toStanding);
    const standingsB = B.map(toStanding);
    const standingsC = C.map(toStanding);
    const promos: string[] = [
      'A: bottom 2 -> B; B: top 2 -> A',
      'B: bottom 2 -> C; C: top 2 -> B',
      'C: bottom 2 replaced by mutations from elites',
    ];

    report.history.push({
      season,
      standingsA,
      standingsB,
      standingsC,
      promotionsRelegations: promos,
    });

    console.log(`Season ${season}`);
    console.log('  A:', standingsA.map(s => `${s.id}=${s.points}(W${s.wins}L${s.losses}D${s.draws})`).join('  '));
    console.log('  B:', standingsB.map(s => `${s.id}=${s.points}(W${s.wins}L${s.losses}D${s.draws})`).join('  '));
    console.log('  C:', standingsC.map(s => `${s.id}=${s.points}(W${s.wins}L${s.losses}D${s.draws})`).join('  '));

    saveLeagueCheckpoint(LEAGUE_CHECKPOINT_PATH, season + 1, candidates, report, seedPoolForCheckpoint);
  }

  const finalA = candidates.filter(c => c.division === 'A').sort(compareCandidates);
  const champion = selectChampion(finalA);
  report.champion = { id: champion.id, division: champion.division };
  report.finalStandingsA = finalA.map(c => ({
    id: c.id,
    points: c.seasonStats.points,
    wins: c.seasonStats.wins,
    params: c.params,
  }));

  const championScore = LEAGUE_USE_ROBUST_SELECTION ? robustScore(champion) : combinedPoints(champion);
  console.log('');
  console.log('Champion:', champion.id, '  points:', champion.seasonStats.points, '  wins:', champion.seasonStats.wins);
  if (LEAGUE_INCLUDE_ARCHETYPES) console.log('  archetypePoints:', champion.seasonStats.archetypePoints ?? 0);
  if (LEAGUE_USE_ROBUST_SELECTION) console.log('  robustScore:', championScore.toFixed(2));
  console.log('Promotion/relegation applied each season; bottom 2 in C replaced by mutations of elites.');

  const publicDir = path.join(process.cwd(), 'public');
  const artifactsDir = path.join(process.cwd(), 'artifacts');
  if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
  if (!fs.existsSync(artifactsDir)) fs.mkdirSync(artifactsDir, { recursive: true });

  const paramsPath = path.join(publicDir, 'ai-params.json');
  fs.writeFileSync(paramsPath, JSON.stringify(champion.params, null, 2), 'utf8');
  console.log('Saved champion params to', paramsPath);

  const reportPath = path.join(artifactsDir, 'league-last.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log('Saved league report to', reportPath);

  try {
    fs.unlinkSync(resolveCheckpointPath(LEAGUE_CHECKPOINT_PATH));
    console.log('Cleared league checkpoint at', LEAGUE_CHECKPOINT_PATH);
  } catch {
    // ignore missing checkpoint
  }

  // Champion library: append, dedupe by param distance, cap
  const championLibraryPath = path.join(artifactsDir, 'champion-library.json');
  type LibraryEntry = { id: string; params: AiParams; points: number; robustScore?: number; addedAt: string };
  let library: LibraryEntry[] = [];
  if (fs.existsSync(championLibraryPath)) {
    try {
      library = JSON.parse(fs.readFileSync(championLibraryPath, 'utf8')) as LibraryEntry[];
      if (!Array.isArray(library)) library = [];
    } catch {
      library = [];
    }
  }
  function paramDistance(a: AiParams, b: AiParams): number {
    const ar = a as unknown as Record<string, number>;
    const br = b as unknown as Record<string, number>;
    const keys = ['siegeChance', 'recruitGoldThreshold', 'maxRecruitsWhenRich', 'maxRecruitsWhenPoor', 'targetDefenderWeight', 'nearestTargetDistanceRatio', 'builderRecruitChance', 'foodBufferThreshold', 'sustainableMilitaryMultiplier', 'farmFirstBias', 'farmPriorityThreshold', 'factoryUpgradePriority', 'scoutChance', 'incorporateVillageChance', 'targetPopWeight'] as const;
    let sum = 0;
    for (const k of keys) {
      const va = ar[k] ?? 0;
      const vb = br[k] ?? 0;
      const scale = k === 'recruitGoldThreshold' || k === 'foodBufferThreshold' || k === 'farmPriorityThreshold' ? 1 / 500 : 1;
      sum += ((va - vb) * scale) ** 2;
    }
    return Math.sqrt(sum);
  }
  const newEntry: LibraryEntry = {
    id: champion.id,
    params: champion.params,
    points: champion.seasonStats.points,
    addedAt: new Date().toISOString(),
  };
  if (LEAGUE_USE_ROBUST_SELECTION) newEntry.robustScore = championScore;
  library = library.filter(e => paramDistance(e.params, champion.params) > CHAMPION_LIBRARY_PARAM_DISTANCE_THRESHOLD);
  library.unshift(newEntry);
  if (library.length > CHAMPION_LIBRARY_CAP) library = library.slice(0, CHAMPION_LIBRARY_CAP);
  fs.writeFileSync(championLibraryPath, JSON.stringify(library, null, 2), 'utf8');
  console.log('Updated champion library at', championLibraryPath);
}

main();
