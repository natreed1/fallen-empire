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
 * TRAIN_USE_SCENARIO_MIX, TRAIN_SCENARIO_MIX, TRAIN_NAVAL_POSTINIT,
 * TRAIN_NAVAL_EDUCATION, TRAIN_OUT_JSON, TRAIN_VS_DEFAULT_MATCHES, TRAIN_SELFPLAY_WEIGHT, TRAIN_VS_DEFAULT_WEIGHT
 * Each completed full run updates `artifacts/last-train-baseline.json` for the next seed (see `loadSeedBaseline`).
 * (see docs/AI_TRAINING.md).
 */

import * as path from 'path';
import * as fs from 'fs';
import { spawnSync } from 'child_process';
import {
  runSimulation,
  DEFAULT_AI_PARAMS,
  type AiParams,
  type SimResult,
} from '../src/core/gameCore';
import {
  mutateParams as mutateParamsFromSchema,
  assertAiParamsConsistency,
  getMutationSpaceSummary,
  EVOLVABLE_PARAM_KEYS,
  NAVAL_EDUCATION_PARAM_KEYS,
  type MutateParamsOptions,
  type TrendMutationOverrides,
} from '../src/lib/aiParamsSchema';
import { parseScenarioMix } from './lib/scenarios';
import { getTrainSimOptsForSeed } from './lib/trainSimOptions';

// ─── Config (env overrides for main knobs only) ────────────────────────
const POPULATION_SIZE = parseInt(process.env.TRAIN_POPULATION_SIZE || '12', 10) || 12;
const GENERATIONS = parseInt(process.env.TRAIN_GENERATIONS || '20', 10) || 20;
const MATCHES_PER_PAIR = parseInt(process.env.TRAIN_MATCHES_PER_PAIR || '12', 10) || 12;
const MAX_CYCLES = parseInt(process.env.TRAIN_MAX_CYCLES || '520', 10) || 520;
/** Extra eval games per candidate: candidate vs fixed {@link DEFAULT_AI_PARAMS} (mirrors validate-robustness). */
const VS_DEFAULT_MATCHES = Math.max(0, parseInt(process.env.TRAIN_VS_DEFAULT_MATCHES || '4', 10) || 0);
const SELFPLAY_WEIGHT = Math.max(0, Math.min(1, parseFloat(process.env.TRAIN_SELFPLAY_WEIGHT || '0.7') || 0.7));
const VS_DEFAULT_WEIGHT = Math.max(0, Math.min(1, parseFloat(process.env.TRAIN_VS_DEFAULT_WEIGHT || '0.3') || 0.3));
const MAP_SIZE = parseInt(process.env.TRAIN_MAP_SIZE || '38', 10) || 38;
let ELITE_COUNT = Math.max(2, parseInt(process.env.TRAIN_ELITE_COUNT || '4', 10) || 4);
ELITE_COUNT = Math.min(ELITE_COUNT, Math.max(2, POPULATION_SIZE - 1));
const MUTATION_STRENGTH = Math.min(0.5, Math.max(0.05, parseFloat(process.env.TRAIN_MUTATION_STRENGTH || '0.15') || 0.15));
const VARIANCE_PENALTY = parseFloat(process.env.TRAIN_VARIANCE_PENALTY || '0.5') || 0.5;
const _showBRaw = process.env.TRAIN_SHOW_BATTLES ?? process.env.SHOW_BATTLES;
const SHOW_BATTLES =
  _showBRaw === undefined || _showBRaw === ''
    ? 4
    : Math.max(0, parseInt(_showBRaw, 10) || 0);

const DRAW_PENALTY = parseFloat(process.env.TRAIN_DRAW_PENALTY || '10') || 10;
const WON_QUICKLY_BONUS_PER_CYCLE = parseFloat(process.env.TRAIN_WON_QUICKLY_BONUS || '0.1') || 0.1;
const LOST_SLOWLY_BONUS_PER_CYCLE = parseFloat(process.env.TRAIN_LOST_SLOWLY_BONUS || '0.03') || 0.03;

/** Domain-randomized maps + optional naval gauntlet seed (set TRAIN_USE_SCENARIO_MIX=0 for legacy flat map only). */
const TRAIN_USE_SCENARIO_MIX =
  process.env.TRAIN_USE_SCENARIO_MIX !== '0' && process.env.TRAIN_USE_SCENARIO_MIX !== 'false';
const TRAIN_NAVAL_POSTINIT =
  process.env.TRAIN_NAVAL_POSTINIT !== '0' && process.env.TRAIN_NAVAL_POSTINIT !== 'false';
const TRAIN_SCENARIO_MIX_ENV = process.env.TRAIN_SCENARIO_MIX?.trim();
/** Naval-only curriculum: every match is `naval-islands` + gauntlet; mutates only `NAVAL_EDUCATION_PARAM_KEYS`. */
const TRAIN_NAVAL_EDUCATION =
  process.env.TRAIN_NAVAL_EDUCATION === '1' || process.env.TRAIN_NAVAL_EDUCATION === 'true';
const SCENARIO_MIX = TRAIN_USE_SCENARIO_MIX
  ? parseScenarioMix(TRAIN_SCENARIO_MIX_ENV && TRAIN_SCENARIO_MIX_ENV.length > 0 ? TRAIN_SCENARIO_MIX_ENV : undefined)
  : [];
const MUTATE_OPTS: MutateParamsOptions | undefined = TRAIN_NAVAL_EDUCATION
  ? { onlyKeys: NAVAL_EDUCATION_PARAM_KEYS }
  : undefined;

const _wSp0 = SELFPLAY_WEIGHT;
const _wDe0 = VS_DEFAULT_WEIGHT;
const _wSum0 = _wSp0 + _wDe0;
/** Normalized blend: vs-default arm disabled when `TRAIN_VS_DEFAULT_MATCHES=0`. */
const EVAL_SELFPLAY_W = VS_DEFAULT_MATCHES > 0 && _wSum0 > 0 ? _wSp0 / _wSum0 : 1;
const EVAL_VS_DEFAULT_W = VS_DEFAULT_MATCHES > 0 && _wSum0 > 0 ? _wDe0 / _wSum0 : 0;

/** Per-match sim options (shared with `regression-harness` when REGRESSION_MATCH_TRAIN_SIM=1). */
function getTrainSimOpts(matchSeed: number) {
  return getTrainSimOptsForSeed(matchSeed, {
    maxCycles: MAX_CYCLES,
    mapSize: MAP_SIZE,
    useScenarioMix: TRAIN_USE_SCENARIO_MIX,
    navalPostInit: TRAIN_NAVAL_POSTINIT,
    navalEducation: TRAIN_NAVAL_EDUCATION,
    scenarioMix: SCENARIO_MIX,
  });
}

/** Ensure params have all keys (merge with defaults). */
function ensureFullParams(p: Partial<AiParams>): AiParams {
  return { ...DEFAULT_AI_PARAMS, ...p };
}

/** Written on each successful *full* train-ai finish so the next run seeds from the latest best (not naval-education). */
const LAST_TRAIN_BASELINE_PATH = path.join(process.cwd(), 'artifacts', 'last-train-baseline.json');

function tryLoadParamsFile(absPath: string, label: string): AiParams | null {
  try {
    const raw = JSON.parse(fs.readFileSync(absPath, 'utf-8')) as Partial<AiParams>;
    console.log(`Seed baseline: loaded ${absPath} (${label})`);
    return ensureFullParams(raw);
  } catch (e) {
    console.warn(`Seed baseline: failed to read ${absPath} (${label}):`, (e as Error).message);
    return null;
  }
}

/**
 * Seed order: `TRAIN_SEED_JSON` (if set) → `artifacts/last-train-baseline.json` (last run) →
 * `public/ai-params.json` → `DEFAULT_AI_PARAMS`. Use `TRAIN_FROM_CHAMPION=0` to start from code defaults
 * and ignore champion files. Naval education runs do not update `last-train-baseline.json`.
 */
function loadSeedBaseline(): AiParams {
  const seedEnv = process.env.TRAIN_SEED_JSON?.trim();
  if (seedEnv) {
    const jsonPath = path.isAbsolute(seedEnv) ? seedEnv : path.join(process.cwd(), seedEnv);
    if (fs.existsSync(jsonPath)) {
      const p = tryLoadParamsFile(jsonPath, 'TRAIN_SEED_JSON');
      if (p) return p;
    } else {
      console.warn(`Seed baseline: TRAIN_SEED_JSON not found: ${jsonPath} — using default chain`);
    }
  }
  if (process.env.TRAIN_FROM_CHAMPION === '0') {
    console.log('Seed baseline: DEFAULT_AI_PARAMS (TRAIN_FROM_CHAMPION=0)');
    return ensureFullParams({});
  }
  if (fs.existsSync(LAST_TRAIN_BASELINE_PATH)) {
    const p = tryLoadParamsFile(LAST_TRAIN_BASELINE_PATH, 'last train-ai run');
    if (p) return p;
  }
  const publicPath = path.join(process.cwd(), 'public', 'ai-params.json');
  if (fs.existsSync(publicPath)) {
    const p = tryLoadParamsFile(publicPath, 'public/ai-params.json');
    if (p) return p;
  }
  console.log('Seed baseline: DEFAULT_AI_PARAMS (no last-train-baseline.json, no public/ai-params.json)');
  return ensureFullParams({});
}


function formatParamsShort(p: AiParams): string {
  const k = EVOLVABLE_PARAM_KEYS.length;
  return `[${k} params] ` + JSON.stringify(p).slice(0, 100) + '…';
}

function formatResult(r: SimResult): string {
  const winner = r.winner === 'ai1' ? 'North' : r.winner === 'ai2' ? 'South' : 'draw';
  const ships =
    TRAIN_NAVAL_EDUCATION || process.env.TRAIN_LOG_SHIPS === '1'
      ? ` ships ${r.ai1Ships}-${r.ai2Ships}`
      : '';
  const travel =
    TRAIN_NAVAL_EDUCATION || process.env.TRAIN_LOG_TRAVEL === '1'
      ? ` overseasCities ${r.ai1OverseasCities}-${r.ai2OverseasCities} overseasArmy ${r.ai1OverseasLandMilitary}-${r.ai2OverseasLandMilitary} cargo ${r.ai1CargoAboard}-${r.ai2CargoAboard}`
      : '';
  return `cycle ${r.cycle}, ${r.ai1Cities}-${r.ai2Cities} cities, ${r.ai1Pop}-${r.ai2Pop} pop${ships}${travel} → ${winner}`;
}

function cloneParams(p: Partial<AiParams>): AiParams {
  return ensureFullParams(p);
}

function mutateParams(p: Partial<AiParams>, trendOverrides?: TrendMutationOverrides): AiParams {
  const mutated = mutateParamsFromSchema(ensureFullParams(p), MUTATION_STRENGTH, trendOverrides, MUTATE_OPTS);
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
    // Timeouts are common on island/naval maps; soften penalty so pop/city/ship margins can differentiate.
    sc -= TRAIN_NAVAL_EDUCATION ? DRAW_PENALTY * 0.35 : DRAW_PENALTY;
  }
  sc += result.cycle * 0.1;
  const myCities = playedAs === 'ai1' ? result.ai1Cities : result.ai2Cities;
  const myPop = playedAs === 'ai1' ? result.ai1Pop : result.ai2Pop;
  const oppCities = playedAs === 'ai1' ? result.ai2Cities : result.ai1Cities;
  const oppPop = playedAs === 'ai1' ? result.ai2Pop : result.ai1Pop;
  sc += (myCities - oppCities) * 15;
  sc += (myPop - oppPop) * 0.2;
  if (TRAIN_NAVAL_EDUCATION && result.winner === null) {
    const myShips = playedAs === 'ai1' ? result.ai1Ships : result.ai2Ships;
    const oppShips = playedAs === 'ai1' ? result.ai2Ships : result.ai1Ships;
    sc += (myShips - oppShips) * 5;
    sc += (myPop - oppPop) * 0.25;
    sc += (myCities - oppCities) * 12;
  }
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

/** One candidate vs current gen baseline, plus optional games vs fixed {@link DEFAULT_AI_PARAMS} (holdout-style). */
function evaluateCandidate(
  candidate: AiParams,
  baseline: AiParams,
  candidateIndex: number,
): {
  blendedScore: number;
  selfplayEff: number;
  vsDefaultEff: number;
  selfplayScores: number[];
  flowStats: FlowStats;
} {
  const selfplayScores: number[] = [];
  const simResults: SimResult[] = [];
  const t0 = Date.now();
  for (let i = 0; i < MATCHES_PER_PAIR; i++) {
    const seed = (t0 + candidateIndex * 1000 + i * 997) % 1_000_000;
    const asAi1 = runMatch(candidate, baseline, seed);
    const asAi2 = runMatch(baseline, candidate, seed + 1);
    simResults.push(asAi1, asAi2);
    selfplayScores.push(
      scoreResult(asAi1, 'ai1') + scoreResult(asAi2, 'ai2'),
    );
  }
  const vsDefaultScores: number[] = [];
  for (let i = 0; i < VS_DEFAULT_MATCHES; i++) {
    const seed = (t0 + candidateIndex * 1000 + i * 991 + 17) % 1_000_000;
    const asAi1 = runMatch(candidate, DEFAULT_AI_PARAMS, seed);
    const asAi2 = runMatch(DEFAULT_AI_PARAMS, candidate, seed + 1);
    simResults.push(asAi1, asAi2);
    vsDefaultScores.push(scoreResult(asAi1, 'ai1') + scoreResult(asAi2, 'ai2'));
  }
  const selfplayEff = effectiveScore(selfplayScores);
  const vsDefaultEff = vsDefaultScores.length > 0 ? effectiveScore(vsDefaultScores) : 0;
  const blendedScore = EVAL_SELFPLAY_W * selfplayEff + EVAL_VS_DEFAULT_W * vsDefaultEff;
  return {
    blendedScore,
    selfplayEff,
    vsDefaultEff,
    selfplayScores,
    flowStats: accumulateFlowStats(simResults),
  };
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

/** Record full training env for reproducibility (item 7): console + `training-live.log` + `artifacts/last-train-run-env.json`. */
function logTrainingRunEnv(): void {
  const trainKeys = Object.keys(process.env)
    .filter(k => k.startsWith('TRAIN_') || k === 'PYTHON' || k === 'SHOW_BATTLES')
    .sort();
  const envSnapshot: Record<string, string | undefined> = { NODE_ENV: process.env.NODE_ENV };
  for (const k of trainKeys) envSnapshot[k] = process.env[k];
  const startedAt = new Date().toISOString();
  const block = [
    '--- train-ai env snapshot ---',
    `startedAt: ${startedAt}`,
    'cwd: ' + process.cwd(),
    ...trainKeys.map(k => `${k}=${process.env[k] ?? ''}`),
    `computed: MAX_CYCLES=${MAX_CYCLES} MAP_SIZE=${MAP_SIZE} VS_DEFAULT_MATCHES=${VS_DEFAULT_MATCHES} EVAL_SELFPLAY_W=${EVAL_SELFPLAY_W} EVAL_VS_DEFAULT_W=${EVAL_VS_DEFAULT_W} hadLastTrainBaseline=${fs.existsSync(LAST_TRAIN_BASELINE_PATH)}`,
    '-----------------------------',
  ].join('\n');
  console.log(block);
  appendTrainingLiveLog(block);
  try {
    const out = path.join(process.cwd(), 'artifacts', 'last-train-run-env.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(
      out,
      JSON.stringify(
        { startedAt, cwd: process.cwd(), env: Object.fromEntries(trainKeys.map(k => [k, process.env[k] ?? ''])), computed: { MAX_CYCLES, MAP_SIZE, VS_DEFAULT_MATCHES, EVAL_SELFPLAY_W, EVAL_VS_DEFAULT_W, WON_QUICKLY_BONUS_PER_CYCLE, hadLastTrainBaseline: fs.existsSync(LAST_TRAIN_BASELINE_PATH) } },
        null,
        2,
      ),
      'utf-8',
    );
  } catch (e) {
    console.warn('[last-train-run-env.json]', (e as Error).message);
  }
}

function main() {
  logTrainingRunEnv();
  assertAiParamsConsistency();
  const summary = getMutationSpaceSummary();
  const trendOverrides = loadTrendReportOverrides();
  console.log('Training AI parameters (evolutionary + multi-game evaluation)...');
  if (TRAIN_NAVAL_EDUCATION) {
    console.log('Mode: NAVAL EDUCATION — naval-islands + naval-gauntlet every match; mutating only:', NAVAL_EDUCATION_PARAM_KEYS.join(', '));
    console.log('Then run full `npm run train-ai` with TRAIN_SEED_JSON pointing at this run’s output to merge into land training.');
  }
  console.log(`Param count: ${summary.totalParamCount}  In mutation space: ${summary.paramsInMutationSpace.length}  Excluded: ${summary.excludedFromMutation.length} (${summary.excludedReason})`);
  console.log(`Evolvable params: ${EVOLVABLE_PARAM_KEYS.join(', ')}`);
  if (TRAIN_USE_SCENARIO_MIX && !TRAIN_NAVAL_EDUCATION) {
    const mixStr =
      TRAIN_SCENARIO_MIX_ENV && TRAIN_SCENARIO_MIX_ENV.length > 0
        ? TRAIN_SCENARIO_MIX_ENV
        : '(default mix from scripts/lib/scenarios.ts — includes naval-islands)';
    console.log(
      `Maps: scenario mix ON  ${mixStr}  naval postInit: ${TRAIN_NAVAL_POSTINIT ? 'on (when naval-islands)' : 'off'}  base size: ${MAP_SIZE} (overridden by scenario)  maxCycles: ${MAX_CYCLES}`,
    );
  } else if (!TRAIN_NAVAL_EDUCATION) {
    console.log(`Map: ${MAP_SIZE}x${MAP_SIZE} (flat; set TRAIN_USE_SCENARIO_MIX=1 for domain randomization)  maxCycles: ${MAX_CYCLES}`);
  }
  if (TRAIN_NAVAL_EDUCATION) {
    console.log(`Map: naval-islands scenario (see scenarios.ts)  base TRAIN_MAP_SIZE: ${MAP_SIZE}  maxCycles: ${MAX_CYCLES}`);
  }
  console.log(`Gens: ${GENERATIONS}  population: ${POPULATION_SIZE}  matches/candidate: ${MATCHES_PER_PAIR}  elite: ${ELITE_COUNT}`);
  if (VS_DEFAULT_MATCHES > 0) {
    console.log(
      `  vs-default: ${VS_DEFAULT_MATCHES} pair(s)  blend self ${(EVAL_SELFPLAY_W * 100).toFixed(0)}% / vs DEFAULT_AI_PARAMS ${(EVAL_VS_DEFAULT_W * 100).toFixed(0)}%  (WON_QUICKLY_BONUS/cycle=${WON_QUICKLY_BONUS_PER_CYCLE})`,
    );
  } else {
    console.log('  vs-default: off (set TRAIN_VS_DEFAULT_MATCHES>0 to blend with fixed default)');
  }
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

  /** Highest blend score seen in any generation (output uses this, not only last-gen winner). */
  let bestEver: { params: AiParams; score: number; gen: number } | null = null;
  let lastGenBestScore = -Infinity;

  for (let gen = 0; gen < GENERATIONS; gen++) {
    console.log('');
    console.log(`═══════════════════════════════════════════  Gen ${gen + 1}/${GENERATIONS}  ═══════════════════════════════════════════`);
    console.log('Baseline: ' + formatParamsShort(baseline));

    const start = Date.now();
    const evResults: ReturnType<typeof evaluateCandidate>[] = [];
    for (let idx = 0; idx < population.length; idx++) {
      process.stdout.write(`  Candidate ${idx + 1}/${population.length}...`);
      const ev = evaluateCandidate(population[idx], baseline, idx);
      evResults.push(ev);
      const msp = ev.selfplayScores;
      console.log(
        ` ${ev.blendedScore.toFixed(1)} blend (sp ${ev.selfplayEff.toFixed(1)} + vd ${ev.vsDefaultEff.toFixed(1)}) (μ_sp=${mean(msp).toFixed(1)} σ_sp=${std(msp).toFixed(1)})`,
      );
    }
    const evalSeconds = (Date.now() - start) / 1000;
    console.log(`  Generation eval: ${evalSeconds.toFixed(1)}s`);

    const scored = population.map((p, i) => {
      const ev = evResults[i]!;
      return {
        params: p,
        score: ev.blendedScore,
        mean: mean(ev.selfplayScores),
        std: std(ev.selfplayScores),
        flowStats: ev.flowStats,
      };
    });
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    lastGenBestScore = best.score;
    if (!bestEver || best.score > bestEver.score) {
      bestEver = { params: cloneParams(best.params), score: best.score, gen: gen + 1 };
    }
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

  const finalBest = cloneParams(bestEver?.params ?? baseline);
  console.log('');
  if (bestEver && bestEver.score > lastGenBestScore + 1e-6) {
    console.log(
      `Best-over-all: generation ${bestEver.gen}, blend score ${bestEver.score.toFixed(1)} (last generation best: ${lastGenBestScore.toFixed(1)}). Exporting best-over-all params.`,
    );
  } else if (bestEver) {
    console.log(
      `Best-over-all: generation ${bestEver.gen}, blend score ${bestEver.score.toFixed(1)} (same as last-generation winner).`,
    );
  }
  console.log('Best params (exported):');
  console.log(JSON.stringify(finalBest, null, 2));

  const outPath =
    process.env.TRAIN_OUT_JSON && process.env.TRAIN_OUT_JSON.trim().length > 0
      ? path.isAbsolute(process.env.TRAIN_OUT_JSON)
        ? process.env.TRAIN_OUT_JSON
        : path.join(process.cwd(), process.env.TRAIN_OUT_JSON)
      : path.join(process.cwd(), 'public', 'ai-params.json');
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(finalBest, null, 2), 'utf-8');
    console.log('');
    console.log(
      TRAIN_NAVAL_EDUCATION
        ? `Wrote ${outPath} — naval-tuned params (full JSON). For land mix training: TRAIN_SEED_JSON=${outPath} npm run train-ai`
        : `Wrote ${outPath} — use in game to load trained AI.`,
    );
  } catch (e) {
    console.log('');
    console.log('(Could not write:', (e as Error).message, ')');
  }

  if (!TRAIN_NAVAL_EDUCATION) {
    try {
      fs.mkdirSync(path.dirname(LAST_TRAIN_BASELINE_PATH), { recursive: true });
      fs.writeFileSync(LAST_TRAIN_BASELINE_PATH, JSON.stringify(finalBest, null, 2), 'utf-8');
      console.log(
        `Wrote ${path.relative(process.cwd(), LAST_TRAIN_BASELINE_PATH)} — next train-ai will seed from this (unless TRAIN_SEED_JSON or TRAIN_FROM_CHAMPION=0).`,
      );
    } catch (e) {
      console.warn('(Could not write last-train-baseline.json:', (e as Error).message, ')');
    }
  } else {
    console.log('(Not updating artifacts/last-train-baseline.json — naval education; merge with land via TRAIN_SEED_JSON as needed.)');
  }
}

try {
  main();
} catch (e) {
  console.error(e);
  process.exit(1);
}
