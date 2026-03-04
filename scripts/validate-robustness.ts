/**
 * Validation harness for robust training. Runs 100+ randomized matches and reports
 * draw rate, owner flip rate, no-combat rate, starvation lock frequency, and
 * robust score vs baseline. Exits non-zero if regression thresholds are violated.
 *
 * Run: npm run validate-robustness
 * Env: VALIDATE_NUM_MATCHES=100 (default 100), VALIDATE_MAX_CYCLES=500, VALIDATE_MAP_SIZE=38
 */

import * as path from 'path';
import * as fs from 'fs';
import {
  runSimulationWithDiagnostics,
  DEFAULT_AI_PARAMS,
  type AiParams,
  type RunSimulationOptions,
  type RunSimulationDiagnostics,
} from '../src/core/gameCore';
import { FIXED_ARCHETYPES } from './lib/archetypes';
import { parseScenarioMix, selectScenario, getScenarioMapOverride } from './lib/scenarios';

const NUM_MATCHES = parseInt(process.env.VALIDATE_NUM_MATCHES || '100', 10);
const MAX_CYCLES = parseInt(process.env.VALIDATE_MAX_CYCLES || '500', 10);
const MAP_SIZE = parseInt(process.env.VALIDATE_MAP_SIZE || '38', 10);
const USE_DOMAIN_RANDOMIZATION = process.env.LEAGUE_DOMAIN_RANDOMIZATION === '1';
const SCENARIO_MIX = parseScenarioMix(process.env.LEAGUE_SCENARIO_MIX || 'balanced:0.4,tight:0.2,wide:0.2,lean-food:0.1,high-expansion:0.1');

// Regression thresholds (fail if below or above)
const MIN_GAMES_WITH_DEATHS = 1;
const MAX_DRAW_RATE = 0.95;
const MIN_OWNER_FLIP_RATE = 0.01;
const MAX_STARVATION_LOCK_RATE = 0.7;

const WIN_POINTS = 100;
const LOSS_POINTS = -30;
const DRAW_POINTS = 0;
const CITY_W = 15;
const POP_W = 0.2;
const KILL_W = 2;
const NO_COMBAT_PENALTY = -25;
const STARVING_LOCK_PENALTY = -35;

function scoreGame(
  result: { winner: 'ai1' | 'ai2' | null; ai1Cities: number; ai2Cities: number; ai1Pop: number; ai2Pop: number },
  diagnostics: RunSimulationDiagnostics,
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
  const myKills = side === 'ai1' ? (diagnostics.killsByAi1 ?? 0) : (diagnostics.killsByAi2 ?? 0);
  const oppKills = side === 'ai1' ? (diagnostics.killsByAi2 ?? 0) : (diagnostics.killsByAi1 ?? 0);
  s += CITY_W * (myCities - oppCities);
  s += POP_W * (myPop - oppPop);
  s += KILL_W * (myKills - oppKills);
  if (diagnostics.totalKills === 0) s += NO_COMBAT_PENALTY;
  const myAllStarvingLock =
    (side === 'ai1' && diagnostics.firstCycleAllStarving != null && diagnostics.firstCycleFoodZeroAi1 != null) ||
    (side === 'ai2' && diagnostics.firstCycleAllStarving != null && diagnostics.firstCycleFoodZeroAi2 != null);
  if (myAllStarvingLock) s += STARVING_LOCK_PENALTY;
  return s;
}

function main() {
  const n = Math.max(100, NUM_MATCHES);
  console.log('Validate robustness');
  console.log(`  Matches: ${n}  Map: ${MAP_SIZE}x${MAP_SIZE}  MaxCycles: ${MAX_CYCLES}  DomainRandomization: ${USE_DOMAIN_RANDOMIZATION}`);
  console.log('');

  let gamesWithDeaths = 0;
  let gamesWithOwnerFlip = 0;
  let draws = 0;
  let noCombatGames = 0;
  let starvationLockGames = 0;
  const baselineScores: number[] = [];
  const candidateScores: number[] = [];

  // Baseline: default vs default (half of runs)
  // Candidate: load from public/ai-params.json if present, else default
  let candidateParams: AiParams = { ...DEFAULT_AI_PARAMS };
  const candidatePath = path.join(process.cwd(), 'public', 'ai-params.json');
  if (fs.existsSync(candidatePath)) {
    try {
      const raw = fs.readFileSync(candidatePath, 'utf8');
      candidateParams = { ...DEFAULT_AI_PARAMS, ...JSON.parse(raw) } as AiParams;
    } catch {
      // keep default
    }
  }

  for (let i = 0; i < n; i++) {
    const seed = (10000 + i * 7919) % 1_000_000;
    const scenarioName = USE_DOMAIN_RANDOMIZATION ? selectScenario(SCENARIO_MIX, seed) : 'balanced';
    const mapOverride = USE_DOMAIN_RANDOMIZATION ? getScenarioMapOverride(scenarioName) : {};
    const opts: RunSimulationOptions = {
      maxCycles: MAX_CYCLES,
      mapConfigOverride: { width: MAP_SIZE, height: MAP_SIZE, ...mapOverride },
    };

    const result = runSimulationWithDiagnostics(
      candidateParams,
      DEFAULT_AI_PARAMS,
      seed,
      MAX_CYCLES,
      opts,
    );
    const { winner, diagnostics, ai1Cities, ai2Cities, ai1Pop, ai2Pop } = result;

    if (diagnostics.totalKills > 0) gamesWithDeaths++;
    if (diagnostics.hadOwnerFlip) gamesWithOwnerFlip++;
    if (winner === null) draws++;
    if (diagnostics.totalKills === 0) noCombatGames++;
    if (diagnostics.firstCycleAllStarving != null) starvationLockGames++;

    const scoreAi1 = scoreGame(
      { winner, ai1Cities, ai2Cities, ai1Pop, ai2Pop },
      diagnostics,
      'ai1',
    );
    const scoreAi2 = scoreGame(
      { winner, ai1Cities, ai2Cities, ai1Pop, ai2Pop },
      diagnostics,
      'ai2',
    );
    candidateScores.push(scoreAi1);
    baselineScores.push(scoreAi2);
  }

  const drawRate = draws / n;
  const ownerFlipRate = gamesWithOwnerFlip / n;
  const noCombatRate = noCombatGames / n;
  const starvationLockRate = starvationLockGames / n;

  const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const std = (arr: number[]) => {
    const m = mean(arr);
    return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length);
  };
  const robustScore = (arr: number[], lambda = 0.35, tailPenalty = 0.25) => {
    const m = mean(arr);
    const s = std(arr);
    const sorted = [...arr].sort((a, b) => a - b);
    const worstDecile = sorted[Math.floor(sorted.length * 0.1)] ?? sorted[0] ?? 0;
    return m - lambda * s - tailPenalty * worstDecile;
  };

  const candidateRobust = robustScore(candidateScores);
  const baselineRobust = robustScore(baselineScores);

  console.log('Results');
  console.log('  gamesWithAnyDeaths:', gamesWithDeaths);
  console.log('  drawRate:', drawRate.toFixed(3));
  console.log('  ownerFlipRate:', ownerFlipRate.toFixed(3));
  console.log('  noCombatRate:', noCombatRate.toFixed(3));
  console.log('  starvationLockRate:', starvationLockRate.toFixed(3));
  console.log('  candidateRobustScore:', candidateRobust.toFixed(2));
  console.log('  baselineRobustScore:', baselineRobust.toFixed(2));
  console.log('');

  let failed = false;
  if (gamesWithDeaths < MIN_GAMES_WITH_DEATHS) {
    console.error(`Regression: gamesWithDeaths ${gamesWithDeaths} < ${MIN_GAMES_WITH_DEATHS}`);
    failed = true;
  }
  if (drawRate > MAX_DRAW_RATE) {
    console.error(`Regression: drawRate ${drawRate.toFixed(3)} > ${MAX_DRAW_RATE}`);
    failed = true;
  }
  if (ownerFlipRate < MIN_OWNER_FLIP_RATE && n >= 50) {
    console.error(`Regression: ownerFlipRate ${ownerFlipRate.toFixed(3)} < ${MIN_OWNER_FLIP_RATE}`);
    failed = true;
  }
  if (starvationLockRate > MAX_STARVATION_LOCK_RATE) {
    console.error(`Regression: starvationLockRate ${starvationLockRate.toFixed(3)} > ${MAX_STARVATION_LOCK_RATE}`);
    failed = true;
  }

  if (failed) process.exit(1);
  console.log('All regression thresholds passed.');
}

main();
