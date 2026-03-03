/**
 * League-format AI tournament: divisions A/B/C, round-robin, promotion/relegation,
 * mutation, and champion selection. Uses runSimulationWithDiagnostics and
 * configurable scoring (no-combat penalty, all-starving lock penalty).
 *
 * Run: LEAGUE_SEASONS=12 LEAGUE_DIV_SIZE=8 npm run tournament-league
 * Seed pool (strong archetypes, avoid starvation lock):
 *   LEAGUE_SEED_POOL=artifacts/seed_pool_v1.json LEAGUE_MAX_CYCLES=300 npm run tournament-league
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

// ─── Config (top-level constants; env overrides for runtime knobs) ───────────
const LEAGUE_SEASONS = parseInt(process.env.LEAGUE_SEASONS || '12', 10) || 12;
const LEAGUE_DIV_SIZE = parseInt(process.env.LEAGUE_DIV_SIZE || '8', 10) || 8;
const LEAGUE_MAX_CYCLES = parseInt(process.env.LEAGUE_MAX_CYCLES || '500', 10) || 500;
const LEAGUE_MAP_SIZE = parseInt(process.env.LEAGUE_MAP_SIZE || '56', 10) || 56;
const LEAGUE_WORKERS = parseInt(process.env.LEAGUE_WORKERS || '0', 10) || 0; // 0 = main thread only
const LEAGUE_SEED_POOL = process.env.LEAGUE_SEED_POOL || ''; // e.g. artifacts/seed_pool_v1.json → 12 candidates, 6/3/3 divisions

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

const SIM_OPTS: RunSimulationOptions = {
  maxCycles: LEAGUE_MAX_CYCLES,
  mapConfigOverride: { width: LEAGUE_MAP_SIZE, height: LEAGUE_MAP_SIZE },
};

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
};

export type Candidate = {
  id: string;
  params: AiParams;
  division: Division;
  seasonStats: Stats;
  rating?: number;
};

type GameResult = SimResult & { diagnostics: RunSimulationDiagnostics };

function emptyStats(): Stats {
  return {
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
  };
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
  const myAllStarvingLock =
    (side === 'ai1' && result.diagnostics.firstCycleAllStarving != null && result.diagnostics.firstCycleFoodZeroAi1 != null) ||
    (side === 'ai2' && result.diagnostics.firstCycleAllStarving != null && result.diagnostics.firstCycleFoodZeroAi2 != null);
  if (myAllStarvingLock) s += STARVING_LOCK_PENALTY;

  return s;
}

/** Update season stats for both candidates after a single game. */
function applyScores(
  c1: Candidate,
  c2: Candidate,
  result: GameResult,
  c1PlayedAs: 'ai1' | 'ai2',
): void {
  const c2PlayedAs = c1PlayedAs === 'ai1' ? 'ai2' : 'ai1';
  const pts1 = scoreGame(result, c1PlayedAs);
  const pts2 = scoreGame(result, c2PlayedAs);

  c1.seasonStats.points += pts1;
  c2.seasonStats.points += pts2;

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

/** Tie-breaker order: wins, then head-to-head (we don't track h2h here; use points), killsDiff, cityDiff, popDiff. */
function compareCandidates(a: Candidate, b: Candidate): number {
  if (b.seasonStats.points !== a.seasonStats.points) return b.seasonStats.points - a.seasonStats.points;
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

/** Bounded random perturbation; clamp to valid ranges. */
function mutateParams(parent: AiParams, strength: number = 0.15): AiParams {
  const m = (x: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, x + (Math.random() - 0.5) * 2 * strength * (hi - lo) * 0.5));
  return {
    siegeChance: m(parent.siegeChance, 0.05, 0.5),
    recruitGoldThreshold: Math.round(m(parent.recruitGoldThreshold, 100, 800)),
    maxRecruitsWhenRich: Math.max(1, Math.min(5, Math.round(parent.maxRecruitsWhenRich + (Math.random() - 0.5) * 2))),
    maxRecruitsWhenPoor: Math.max(1, Math.min(5, Math.round(parent.maxRecruitsWhenPoor + (Math.random() - 0.5) * 2))),
    targetDefenderWeight: m(parent.targetDefenderWeight, 1, 8),
    nearestTargetDistanceRatio: m(parent.nearestTargetDistanceRatio, 0.5, 1),
    builderRecruitChance: m(parent.builderRecruitChance, 0.05, 0.5),
    foodBufferThreshold: Math.max(0, Math.min(30, Math.round((parent.foodBufferThreshold ?? 10) + (Math.random() - 0.5) * 6))),
    sustainableMilitaryMultiplier: m(parent.sustainableMilitaryMultiplier ?? 1, 0.6, 1.2),
    farmFirstBias: m(parent.farmFirstBias ?? 0, 0, 1),
    factoryUpgradePriority: m(parent.factoryUpgradePriority ?? 0.6, 0, 1),
    scoutChance: m(parent.scoutChance ?? 1, 0, 1),
    incorporateVillageChance: m(parent.incorporateVillageChance ?? 1, 0, 1),
    targetPopWeight: m(parent.targetPopWeight ?? 1, 0.5, 2),
  };
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
    ? bottomC.map((_, i) => mutateParams(elites[Math.min(i, elites.length - 1)].params))
    : bottomC.map(() => mutateParams(DEFAULT_AI_PARAMS));

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
type DivisionStanding = { id: string; points: number; wins: number; losses: number; draws: number; killsFor: number; killsAgainst: number; cityDiff: number; popDiff: number; decisiveGames: number; noCombatGames: number };

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
  finalStandingsA: { id: string; points: number; wins: number }[];
};

function main() {
  const useSeedPool = LEAGUE_SEED_POOL.length > 0;
  const divLabel = useSeedPool ? '6/3/3 (seed pool)' : `${LEAGUE_DIV_SIZE} each`;

  console.log('League tournament');
  console.log(`  Seasons: ${LEAGUE_SEASONS}  Divisions: ${divLabel}  Map: ${LEAGUE_MAP_SIZE}x${LEAGUE_MAP_SIZE}  MaxCycles: ${LEAGUE_MAX_CYCLES}`);
  if (useSeedPool) console.log(`  Seed pool: ${LEAGUE_SEED_POOL}`);
  console.log('');

  let candidates = useSeedPool ? initialCandidatesFromSeedPool(LEAGUE_SEED_POOL) : initialCandidates();
  const report: LeagueReport = {
    seasons: LEAGUE_SEASONS,
    divSize: useSeedPool ? 6 : LEAGUE_DIV_SIZE,
    seedPool: useSeedPool ? LEAGUE_SEED_POOL : undefined,
    history: [],
    champion: { id: '', division: 'A' },
    finalStandingsA: [],
  };

  for (let season = 1; season <= LEAGUE_SEASONS; season++) {
    for (const c of candidates) c.seasonStats = emptyStats();

    for (const div of ['A', 'B', 'C'] as Division[]) {
      const divCandidates = candidates.filter(c => c.division === div);
      const pairs = roundRobinPairings(divCandidates);

      for (let pi = 0; pi < pairs.length; pi++) {
        const [c1, c2] = pairs[pi];
        const seed1 = deterministicSeed(season, div, pi, 0, 0);
        const seed2 = deterministicSeed(season, div, pi, 1, 0);

        const r1 = runSimulationWithDiagnostics(c1.params, c2.params, seed1, LEAGUE_MAX_CYCLES, SIM_OPTS) as GameResult;
        applyScores(c1, c2, r1, 'ai1');

        const r2 = runSimulationWithDiagnostics(c2.params, c1.params, seed2, LEAGUE_MAX_CYCLES, SIM_OPTS) as GameResult;
        applyScores(c2, c1, r2, 'ai1');
      }
    }

    const A = candidates.filter(c => c.division === 'A').sort(compareCandidates);
    const B = candidates.filter(c => c.division === 'B').sort(compareCandidates);
    const C = candidates.filter(c => c.division === 'C').sort(compareCandidates);

    const elites = A.slice(0, Math.max(ELITES_UNCHANGED, 2));
    promoteRelegateAndReplace(candidates, elites);

    const toStanding = (c: Candidate): DivisionStanding => ({
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
    });
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
  }

  const finalA = candidates.filter(c => c.division === 'A').sort(compareCandidates);
  const champion = selectChampion(finalA);
  report.champion = { id: champion.id, division: champion.division };
  report.finalStandingsA = finalA.map(c => ({ id: c.id, points: c.seasonStats.points, wins: c.seasonStats.wins }));

  console.log('');
  console.log('Champion:', champion.id, '  points:', champion.seasonStats.points, '  wins:', champion.seasonStats.wins);
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
}

main();
