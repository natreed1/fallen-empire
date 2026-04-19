/**
 * Train AI parameters by running fast bot-vs-bot simulations and evolving
 * the param set that wins most. Run from project root: npm run train-ai
 *
 * Method: evolutionary (population + elite selection + mutation). Research shows
 * this is the best fit for noisy game outcomes and many cheap evaluations — see docs/OPTIMIZATION.md.
 * Evaluation runs on the main thread only (no worker_threads) so it works with npx/ts-node
 * without requiring ts-node in node_modules for child processes.
 *
 * Env overrides: TRAIN_POPULATION_SIZE, TRAIN_GENERATIONS, TRAIN_MATCHES_PER_PAIR,
 * TRAIN_MAX_CYCLES, TRAIN_MAP_SIZE, TRAIN_ELITE_COUNT, TRAIN_MUTATION_STRENGTH,
 * TRAIN_DRAW_PENALTY, TRAIN_VARIANCE_PENALTY, TRAIN_FROM_CHAMPION (set 0 to skip), TRAIN_SEED_JSON,
 * TRAIN_SHOW_BATTLES, TRAIN_WON_QUICKLY_BONUS, TRAIN_LOST_SLOWLY_BONUS,
 * TRAIN_USE_SCENARIO_MIX, TRAIN_SCENARIO_MIX, TRAIN_NAVAL_POSTINIT (see docs/AI_TRAINING.md).
 */

import * as path from 'path';
import * as fs from 'fs';
import { spawnSync } from 'child_process';
import {
  runSimulation,
  DEFAULT_AI_PARAMS,
  type AiParams,
  type SimResult,
  type RunSimulationOptions,
} from '../src/core/gameCore';
import {
  mutateParams as mutateParamsFromSchema,
  assertAiParamsConsistency,
  getMutationSpaceSummary,
  EVOLVABLE_PARAM_KEYS,
  type TrendMutationOverrides,
} from '../src/lib/aiParamsSchema';
import { parseScenarioMix, selectScenario, getScenarioMapOverride } from './lib/scenarios';

// ─── Config (env overrides for main knobs only) ────────────────────────
const POPULATION_SIZE = parseInt(process.env.TRAIN_POPULATION_SIZE || '12', 10) || 12;
const GENERATIONS = parseInt(process.env.TRAIN_GENERATIONS || '20', 10) || 20;
const MATCHES_PER_PAIR = parseInt(process.env.TRAIN_MATCHES_PER_PAIR || '12', 10) || 12;
const MAX_CYCLES = parseInt(process.env.TRAIN_MAX_CYCLES || '250', 10) || 250;
const MAP_SIZE = parseInt(process.env.TRAIN_MAP_SIZE || '38', 10) || 38;
let ELITE_COUNT = Math.max(2, parseInt(process.env.TRAIN_ELITE_COUNT || '4', 10) || 4);
ELITE_COUNT = Math.min(ELITE_COUNT, Math.max(2, POPULATION_SIZE - 1));
const MUTATION_STRENGTH = Math.min(0.5, Math.max(0.05, parseFloat(process.env.TRAIN_MUTATION_STRENGTH || '0.15') || 0.15));
const VARIANCE_PENALTY = parseFloat(process.env.TRAIN_VARIANCE_PENALTY || '0.5') || 0.5;
const SHOW_BATTLES = Math.max(0, parseInt((process.env.TRAIN_SHOW_BATTLES ?? process.env.SHOW_BATTLES) || '4', 10) || 4);

const DRAW_PENALTY = parseFloat(process.env.TRAIN_DRAW_PENALTY || '10') || 10;
const WON_QUICKLY_BONUS_PER_CYCLE = parseFloat(process.env.TRAIN_WON_QUICKLY_BONUS || '0.05') || 0.05;
const LOST_SLOWLY_BONUS_PER_CYCLE = parseFloat(process.env.TRAIN_LOST_SLOWLY_BONUS || '0.03') || 0.03;

/** Domain-randomized maps + optional naval gauntlet seed (set TRAIN_USE_SCENARIO_MIX=0 for legacy flat map only). */
const TRAIN_USE_SCENARIO_MIX =
  process.env.TRAIN_USE_SCENARIO_MIX !== '0' && process.env.TRAIN_USE_SCENARIO_MIX !== 'false';
const TRAIN_NAVAL_POSTINIT =
  process.env.TRAIN_NAVAL_POSTINIT !== '0' && process.env.TRAIN_NAVAL_POSTINIT !== 'false';
const TRAIN_SCENARIO_MIX_ENV = process.env.TRAIN_SCENARIO_MIX?.trim();
const SCENARIO_MIX = TRAIN_USE_SCENARIO_MIX
  ? parseScenarioMix(TRAIN_SCENARIO_MIX_ENV && TRAIN_SCENARIO_MIX_ENV.length > 0 ? TRAIN_SCENARIO_MIX_ENV : undefined)
  : [];

/**
 * Per-match sim options: scenario picked deterministically from `matchSeed` (same as league/tournament).
 * When `naval-islands` is selected and TRAIN_NAVAL_POSTINIT is on, seeds ships/infantry (see gameCore postInit).
 */
function getTrainSimOpts(matchSeed: number): RunSimulationOptions {
  if (!TRAIN_USE_SCENARIO_MIX) {
    return { maxCycles: MAX_CYCLES, mapConfigOverride: { width: MAP_SIZE, height: MAP_SIZE } };
  }
  const scenarioName = selectScenario(SCENARIO_MIX, matchSeed);
  const override = getScenarioMapOverride(scenarioName);
  const postInit: RunSimulationOptions['postInit'] =
    TRAIN_NAVAL_POSTINIT && scenarioName === 'naval-islands' ? 'naval-gauntlet' : undefined;
  return {
    maxCycles: MAX_CYCLES,
    mapConfigOverride: { width: MAP_SIZE, height: MAP_SIZE, ...override },
    ...(postInit ? { postInit } : {}),
  };
}

/** Ensure params have all keys (merge with defaults). */
function ensureFullParams(p: Partial<AiParams>): AiParams {
  return { ...DEFAULT_AI_PARAMS, ...p };
}

/** Seed evolution from public/ai-params.json (champion) unless TRAIN_FROM_CHAMPION=0. */
function loadSeedBaseline(): AiParams {
  const overridePath = process.env.TRAIN_SEED_JSON;
  const defaultChampion = path.join(process.cwd(), 'public', 'ai-params.json');
  const useChampion = process.env.TRAIN_FROM_CHAMPION !== '0';
  const jsonPath = overridePath || (useChampion && fs.existsSync(defaultChampion) ? defaultChampion : null);
  if (!jsonPath || !fs.existsSync(jsonPath)) {
    console.log('Seed baseline: DEFAULT_AI_PARAMS (no champion file)');
    return ensureFullParams({});
  }
  try {
    const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as Partial<AiParams>;
    console.log(`Seed baseline: loaded ${jsonPath}`);
    return ensureFullParams(raw);
  } catch (e) {
    console.warn('Seed baseline: failed to parse champion, using defaults:', (e as Error).message);
    return ensureFullParams({});
  }
}


function formatParamsShort(p: AiParams): string {
  const k = EVOLVABLE_PARAM_KEYS.length;
  return `[${k} params] ` + JSON.stringify(p).slice(0, 100) + '…';
}

function formatResult(r: SimResult): string {
  const winner = r.winner === 'ai1' ? 'North' : r.winner === 'ai2' ? 'South' : 'draw';
  return `cycle ${r.cycle}, ${r.ai1Cities}-${r.ai2Cities} cities, ${r.ai1Pop}-${r.ai2Pop} pop → ${winner}`;
}

function cloneParams(p: Partial<AiParams>): AiParams {
  return ensureFullParams(p);
}

function mutateParams(p: Partial<AiParams>, trendOverrides?: TrendMutationOverrides): AiParams {
  const mutated = mutateParamsFromSchema(ensureFullParams(p), MUTATION_STRENGTH, trendOverrides);
  return { ...DEFAULT_AI_PARAMS, ...mutated };
}

/** Load trend report and build mutation overrides. Returns undefined if not found. */
function loadTrendReportOverrides(): TrendMutationOverrides | undefined {
  const p = path.join(process.cwd(), 'artifacts', 'trend-report.json');
  if (!fs.existsSync(p)) return undefined;
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
    const params = data.params ?? data;
    const overrides: TrendMutationOverrides = {};
    const strengthByClass: Record<string, number> = {
      'stable-good': 0.7,
      exploratory: 1.2,
      'unstable-bad': 1.2,
      default: 1,
    };
    for (const [key, entry] of Object.entries(params)) {
      if (key === 'militaryLevelMixTarget' || !entry || typeof entry !== 'object') continue;
      const rec = (entry as { recommendedMutationRange?: number[]; classification?: string });
      const rng = rec.recommendedMutationRange;
      if (!Array.isArray(rng) || rng.length < 2) continue;
      const [a, b] = rng;
      const min = Math.min(a, b);
      const max = Math.max(a, b);
      const strengthMultiplier = strengthByClass[rec.classification ?? ''] ?? strengthByClass.default;
      overrides[key as keyof TrendMutationOverrides] = { min, max, strengthMultiplier };
    }
    return Object.keys(overrides).length > 0 ? overrides : undefined;
  } catch {
    return undefined;
  }
}

function scoreResult(
  result: SimResult,
  playedAs: 'ai1' | 'ai2',
  maxCycles: number = MAX_CYCLES,
): number {
  let sc = 0;
  if (result.winner === playedAs) {
    sc += 100;
    sc += (maxCycles - result.cycle) * WON_QUICKLY_BONUS_PER_CYCLE;
  } else if (result.winner !== null) {
    sc -= 30;
    sc += result.cycle * LOST_SLOWLY_BONUS_PER_CYCLE;
  } else {
    sc -= DRAW_PENALTY;
  }
  sc += result.cycle * 0.1;
  const myCities = playedAs === 'ai1' ? result.ai1Cities : result.ai2Cities;
  const myPop = playedAs === 'ai1' ? result.ai1Pop : result.ai2Pop;
  const oppCities = playedAs === 'ai1' ? result.ai2Cities : result.ai1Cities;
  const oppPop = playedAs === 'ai1' ? result.ai2Pop : result.ai1Pop;
  sc += (myCities - oppCities) * 15;
  sc += (myPop - oppPop) * 0.2;
  return sc;
}

function runMatch(paramsA: AiParams, paramsB: AiParams, seed: number): SimResult {
  return runSimulation(paramsA, paramsB, seed, MAX_CYCLES, getTrainSimOpts(seed));
}

function mean(arr: number[]): number {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function std(arr: number[]): number {
  if (arr.length <= 1) return 0;
  const m = mean(arr);
  const variance = arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

function effectiveScore(matchScores: number[]): number {
  return mean(matchScores) - VARIANCE_PENALTY * std(matchScores);
}

/** Aggregates from every SimResult in a candidate evaluation (two sims per match pair). */
type FlowStats = {
  avg_cycle: number;
  draw_rate: number;
  max_cycle_rate: number;
  avg_city_margin: number;
  game_count: number;
};

function accumulateFlowStats(results: SimResult[]): FlowStats {
  const n = results.length;
  if (n === 0) {
    return { avg_cycle: 0, draw_rate: 0, max_cycle_rate: 0, avg_city_margin: 0, game_count: 0 };
  }
  let sumCycle = 0;
  let draws = 0;
  let maxHits = 0;
  let sumMargin = 0;
  for (const r of results) {
    sumCycle += r.cycle;
    if (r.winner === null) draws += 1;
    if (r.cycle >= MAX_CYCLES) maxHits += 1;
    sumMargin += Math.abs(r.ai1Cities - r.ai2Cities);
  }
  return {
    avg_cycle: sumCycle / n,
    draw_rate: draws / n,
    max_cycle_rate: maxHits / n,
    avg_city_margin: sumMargin / n,
    game_count: n,
  };
}

/** One candidate vs baseline: MATCHES_PER_PAIR match pairs (two sims each). Seeds vary by candidate index. */
function evaluateCandidate(
  candidate: AiParams,
  baseline: AiParams,
  candidateIndex: number,
): { matchScores: number[]; flowStats: FlowStats } {
  const matchScores: number[] = [];
  const simResults: SimResult[] = [];
  const t0 = Date.now();
  for (let i = 0; i < MATCHES_PER_PAIR; i++) {
    const seed = (t0 + candidateIndex * 1000 + i * 997) % 1_000_000;
    const asAi1 = runMatch(candidate, baseline, seed);
    const asAi2 = runMatch(baseline, candidate, seed + 1);
    simResults.push(asAi1, asAi2);
    matchScores.push(
      scoreResult(asAi1, 'ai1') + scoreResult(asAi2, 'ai2'),
    );
  }
  return { matchScores, flowStats: accumulateFlowStats(simResults) };
}

function logMetricsToPython(payload: Record<string, unknown>): void {
  const script = path.join(process.cwd(), 'log_metrics.py');
  const py = process.env.PYTHON || 'python3';
  try {
    const r = spawnSync(py, [script], {
      input: JSON.stringify(payload),
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024,
    });
    if (r.status !== 0) {
      console.warn('[metrics]', (r.stderr || r.stdout || '').trim() || 'log_metrics failed');
    }
  } catch (e) {
    console.warn('[metrics] could not run Python logger:', (e as Error).message);
  }
}

function appendTrainingLiveLog(line: string): void {
  try {
    const logPath = path.join(process.cwd(), 'artifacts', 'training-live.log');
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `${line}\n`, 'utf-8');
  } catch (e) {
    console.warn('[training-live.log]', (e as Error).message);
  }
}

function main() {
  assertAiParamsConsistency();
  const summary = getMutationSpaceSummary();
  const trendOverrides = loadTrendReportOverrides();
  console.log('Training AI parameters (evolutionary + multi-game evaluation)...');
  console.log(`Param count: ${summary.totalParamCount}  In mutation space: ${summary.paramsInMutationSpace.length}  Excluded: ${summary.excludedFromMutation.length} (${summary.excludedReason})`);
  console.log(`Evolvable params: ${EVOLVABLE_PARAM_KEYS.join(', ')}`);
  if (TRAIN_USE_SCENARIO_MIX) {
    const mixStr =
      TRAIN_SCENARIO_MIX_ENV && TRAIN_SCENARIO_MIX_ENV.length > 0
        ? TRAIN_SCENARIO_MIX_ENV
        : '(default mix from scripts/lib/scenarios.ts — includes naval-islands)';
    console.log(
      `Maps: scenario mix ON  ${mixStr}  naval postInit: ${TRAIN_NAVAL_POSTINIT ? 'on (when naval-islands)' : 'off'}  base size: ${MAP_SIZE} (overridden by scenario)  maxCycles: ${MAX_CYCLES}`,
    );
  } else {
    console.log(`Map: ${MAP_SIZE}x${MAP_SIZE} (flat; set TRAIN_USE_SCENARIO_MIX=1 for domain randomization)  maxCycles: ${MAX_CYCLES}`);
  }
  console.log(`Gens: ${GENERATIONS}  population: ${POPULATION_SIZE}  matches/candidate: ${MATCHES_PER_PAIR}  elite: ${ELITE_COUNT}`);
  if (trendOverrides) {
    const n = Object.keys(trendOverrides).length;
    console.log(`Trend report: using ${n} param overrides (artifacts/trend-report.json)`);
  }
  console.log('');

  let baseline: AiParams = loadSeedBaseline();
  console.log('Initial baseline: ' + formatParamsShort(baseline));
  console.log('');
  let population: AiParams[] = [cloneParams(baseline)];
  while (population.length < POPULATION_SIZE) {
    population.push(mutateParams(population[population.length - 1], trendOverrides));
  }

  for (let gen = 0; gen < GENERATIONS; gen++) {
    console.log('');
    console.log(`═══════════════════════════════════════════  Gen ${gen + 1}/${GENERATIONS}  ═══════════════════════════════════════════`);
    console.log('Baseline: ' + formatParamsShort(baseline));

    const start = Date.now();
    const matchScoresPerCandidate: number[][] = [];
    const flowStatsPerCandidate: FlowStats[] = [];
    for (let idx = 0; idx < population.length; idx++) {
      process.stdout.write(`  Candidate ${idx + 1}/${population.length}...`);
      const { matchScores: ms, flowStats } = evaluateCandidate(population[idx], baseline, idx);
      matchScoresPerCandidate.push(ms);
      flowStatsPerCandidate.push(flowStats);
      console.log(` ${effectiveScore(ms).toFixed(1)} (μ=${mean(ms).toFixed(1)} σ=${std(ms).toFixed(1)})`);
    }
    const evalSeconds = (Date.now() - start) / 1000;
    console.log(`  Generation eval: ${evalSeconds.toFixed(1)}s`);

    const scored = population.map((p, i) => ({
      params: p,
      score: effectiveScore(matchScoresPerCandidate[i]),
      mean: mean(matchScoresPerCandidate[i]),
      std: std(matchScoresPerCandidate[i]),
      flowStats: flowStatsPerCandidate[i],
    }));
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    const prevBaseline = baseline;
    baseline = best.params;

    const bestFlow = best.flowStats;
    logMetricsToPython({
      epoch: gen + 1,
      loss: best.std,
      reward: best.score,
      avg_cycle: bestFlow.avg_cycle,
      draw_rate: bestFlow.draw_rate,
      max_cycle_rate: bestFlow.max_cycle_rate,
      avg_city_margin: bestFlow.avg_city_margin,
      eval_seconds: evalSeconds,
      mean: best.mean,
      std: best.std,
    });
    appendTrainingLiveLog(
      `[${new Date().toISOString()}] gen=${gen + 1}/${GENERATIONS} eval=${evalSeconds.toFixed(1)}s bestScore=${best.score.toFixed(1)} avgCycle=${bestFlow.avg_cycle.toFixed(1)} drawRate=${(bestFlow.draw_rate * 100).toFixed(1)}% maxCycleRate=${(bestFlow.max_cycle_rate * 100).toFixed(1)}%`,
    );

    console.log('');
    console.log(`  ► Best: score ${best.score.toFixed(1)} (μ=${best.mean.toFixed(1)} σ=${best.std.toFixed(1)})  ` + formatParamsShort(best.params));

    if (SHOW_BATTLES > 0) {
      console.log('');
      console.log('  Sample battles (new best vs previous baseline):');
      for (let i = 0; i < SHOW_BATTLES; i++) {
        const seed = (Date.now() + gen * 10000 + i * 1000) % 1_000_000;
        const r1 = runMatch(best.params, prevBaseline, seed);
        const r2 = runMatch(prevBaseline, best.params, seed + 1);
        console.log(`    ${i + 1}a (seed ${seed}): North=best → ${formatResult(r1)}`);
        console.log(`    ${i + 1}b (seed ${seed + 1}): South=best → ${formatResult(r2)}`);
      }
    }

    population = scored.slice(0, ELITE_COUNT).map(s => s.params);
    while (population.length < POPULATION_SIZE) {
      const parent = population[Math.floor(Math.random() * ELITE_COUNT)];
      population.push(mutateParams(parent, trendOverrides));
    }
  }

  const finalBest = cloneParams(baseline);
  console.log('');
  console.log('Best params:');
  console.log(JSON.stringify(finalBest, null, 2));

  const outPath = path.join(process.cwd(), 'public', 'ai-params.json');
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(finalBest, null, 2), 'utf-8');
    console.log('');
    console.log(`Wrote ${outPath} — use in game to load trained AI.`);
  } catch (e) {
    console.log('');
    console.log('(Could not write:', (e as Error).message, ')');
  }
}

try {
  main();
} catch (e) {
  console.error(e);
  process.exit(1);
}
