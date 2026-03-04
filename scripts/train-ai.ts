/**
 * Train AI parameters by running fast bot-vs-bot simulations and evolving
 * the param set that wins most. Run from project root: npm run train-ai
 *
 * Method: evolutionary (population + elite selection + mutation). Research shows
 * this is the best fit for noisy game outcomes and many cheap evaluations — see docs/OPTIMIZATION.md.
 * Env overrides: TRAIN_POPULATION_SIZE, TRAIN_GENERATIONS, TRAIN_MATCHES_PER_PAIR,
 * TRAIN_MAX_CYCLES, TRAIN_MAP_SIZE, NUM_WORKERS.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Worker } from 'worker_threads';
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
} from '../src/lib/aiParamsSchema';

// ─── Config (env overrides for main knobs only) ────────────────────────
const POPULATION_SIZE = parseInt(process.env.TRAIN_POPULATION_SIZE || '12', 10) || 12;
const GENERATIONS = parseInt(process.env.TRAIN_GENERATIONS || '20', 10) || 20;
const MATCHES_PER_PAIR = parseInt(process.env.TRAIN_MATCHES_PER_PAIR || '8', 10) || 8;
const MAX_CYCLES = parseInt(process.env.TRAIN_MAX_CYCLES || '250', 10) || 250;
const MAP_SIZE = parseInt(process.env.TRAIN_MAP_SIZE || '38', 10) || 38;
const NUM_WORKERS_ENV = process.env.NUM_WORKERS;
const NUM_WORKERS =
  NUM_WORKERS_ENV !== undefined
    ? Math.max(0, parseInt(NUM_WORKERS_ENV, 10) || 0)
    : Math.min(8, Math.max(1, (os.cpus?.()?.length ?? 1) - 1));
const ELITE_COUNT = 4;
const MUTATION_STRENGTH = 0.15;
const VARIANCE_PENALTY = 0.5; // rank by mean - VARIANCE_PENALTY * std
const SHOW_BATTLES = 4;

const DRAW_PENALTY = 10;
const WON_QUICKLY_BONUS_PER_CYCLE = 0.05; // bonus for finishing under maxCycles when winning
const LOST_SLOWLY_BONUS_PER_CYCLE = 0.03; // small bonus for lasting longer when losing

const TRAIN_MAP = { width: MAP_SIZE, height: MAP_SIZE };
const SIM_OPTS: RunSimulationOptions = { maxCycles: MAX_CYCLES, mapConfigOverride: TRAIN_MAP };

/** Ensure params have all keys (merge with defaults). Use before sending to worker or evaluating. */
function ensureFullParams(p: Partial<AiParams>): AiParams {
  return { ...DEFAULT_AI_PARAMS, ...p };
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

function mutateParams(p: Partial<AiParams>): AiParams {
  return mutateParamsFromSchema(ensureFullParams(p), MUTATION_STRENGTH);
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
  return runSimulation(paramsA, paramsB, seed, MAX_CYCLES, SIM_OPTS);
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

function evaluateCandidateMain(candidate: AiParams, baseline: AiParams): number[] {
  const matchScores: number[] = [];
  for (let i = 0; i < MATCHES_PER_PAIR; i++) {
    const seed = (Date.now() + i * 1000) % 1_000_000;
    const asAi1 = runMatch(candidate, baseline, seed);
    const asAi2 = runMatch(baseline, candidate, seed + 1);
    matchScores.push(
      scoreResult(asAi1, 'ai1') + scoreResult(asAi2, 'ai2'),
    );
  }
  return matchScores;
}

async function evaluatePopulationParallel(
  population: AiParams[],
  baseline: AiParams,
  workerPath: string,
): Promise<number[][]> {
  const scores = new Array<number[] | undefined>(population.length);
  let nextIdx = 0;
  let resolved = 0;
  const nw = Math.max(1, NUM_WORKERS);
  return new Promise((resolve, reject) => {
    const onResult = (id: number, matchScores: number[], workerId: number) => {
      scores[id] = matchScores;
      workerFree[workerId] = true;
      resolved++;
      if (resolved === population.length) {
        workers.forEach(w => w.terminate());
        resolve(scores as number[][]);
      } else scheduleNext();
    };
    const workers: Worker[] = [];
    const workerFree: boolean[] = [];
    function scheduleNext() {
      if (nextIdx >= population.length) return;
      const id = nextIdx++;
      const opts = {
        candidate: population[id],
        baseline,
        matchesPerPair: MATCHES_PER_PAIR,
        maxCycles: MAX_CYCLES,
        mapConfigOverride: TRAIN_MAP,
      };
      for (let w = 0; w < nw; w++) {
        if (workerFree[w]) {
          workerFree[w] = false;
          workers[w].postMessage({ type: 'eval', id, workerId: w, opts });
          return;
        }
      }
      nextIdx--;
    }
    for (let w = 0; w < nw; w++) {
      const worker = new Worker(workerPath, {
        workerData: null,
        execArgv: ['-r', 'ts-node/register', '-r', 'tsconfig-paths/register'],
      });
      workerFree[w] = true;
      worker.on('message', (msg: { id: number; scores: number[]; workerId: number }) =>
        onResult(msg.id, msg.scores, msg.workerId));
      worker.on('error', reject);
      worker.on('exit', (code) => { if (code !== 0) reject(new Error(`Worker exit ${code}`)); });
      workers.push(worker);
    }
    for (let i = 0; i < Math.min(nw, population.length); i++) scheduleNext();
  });
}

async function main() {
  assertAiParamsConsistency();
  const summary = getMutationSpaceSummary();
  console.log('Training AI parameters (evolutionary + multi-game evaluation)...');
  console.log(`Param count: ${summary.totalParamCount}  In mutation space: ${summary.paramsInMutationSpace.length}  Excluded: ${summary.excludedFromMutation.length} (${summary.excludedReason})`);
  console.log(`Evolvable params: ${EVOLVABLE_PARAM_KEYS.join(', ')}`);
  console.log(`Map: ${TRAIN_MAP.width}x${TRAIN_MAP.height}  maxCycles: ${MAX_CYCLES}  workers: ${NUM_WORKERS}`);
  console.log(`Gens: ${GENERATIONS}  population: ${POPULATION_SIZE}  matches/candidate: ${MATCHES_PER_PAIR}  elite: ${ELITE_COUNT}`);
  console.log('');

  let baseline: AiParams = cloneParams(DEFAULT_AI_PARAMS);
  console.log('Initial baseline: ' + formatParamsShort(baseline));
  console.log('');
  let population: AiParams[] = [cloneParams(baseline)];
  while (population.length < POPULATION_SIZE) {
    population.push(mutateParams(population[population.length - 1]));
  }

  const workerDir = path.join(process.cwd(), 'scripts');
  const workerPathJs = path.join(workerDir, 'train-ai-worker.js');
  const workerPathTs = path.join(workerDir, 'train-ai-worker.ts');
  const workerPath = fs.existsSync(workerPathJs) ? workerPathJs : workerPathTs;

  for (let gen = 0; gen < GENERATIONS; gen++) {
    console.log('');
    console.log(`═══════════════════════════════════════════  Gen ${gen + 1}/${GENERATIONS}  ═══════════════════════════════════════════`);
    console.log('Baseline: ' + formatParamsShort(baseline));

    let matchScoresPerCandidate: number[][];
    if (NUM_WORKERS > 1) {
      process.stdout.write(`  Evaluating ${population.length} candidates (${NUM_WORKERS} workers)...`);
      const start = Date.now();
      try {
        matchScoresPerCandidate = await evaluatePopulationParallel(population, baseline, workerPath);
        console.log(` ${((Date.now() - start) / 1000).toFixed(1)}s`);
      } catch (workerErr) {
        console.log('');
        console.warn('  Workers failed, falling back to main thread:', (workerErr as Error).message);
        matchScoresPerCandidate = [];
        for (let idx = 0; idx < population.length; idx++) {
          process.stdout.write(`  Candidate ${idx + 1}/${population.length}...`);
          const ms = evaluateCandidateMain(population[idx], baseline);
          matchScoresPerCandidate.push(ms);
          console.log(` ${effectiveScore(ms).toFixed(1)} (μ=${mean(ms).toFixed(1)} σ=${std(ms).toFixed(1)})`);
        }
      }
    } else {
      matchScoresPerCandidate = [];
      for (let idx = 0; idx < population.length; idx++) {
        process.stdout.write(`  Candidate ${idx + 1}/${population.length}...`);
        const ms = evaluateCandidateMain(population[idx], baseline);
        matchScoresPerCandidate.push(ms);
        console.log(` ${effectiveScore(ms).toFixed(1)} (μ=${mean(ms).toFixed(1)} σ=${std(ms).toFixed(1)})`);
      }
    }

    const scored = population.map((p, i) => ({
      params: p,
      score: effectiveScore(matchScoresPerCandidate[i]),
      mean: mean(matchScoresPerCandidate[i]),
      std: std(matchScoresPerCandidate[i]),
    }));
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    const prevBaseline = baseline;
    baseline = best.params;

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
      population.push(mutateParams(parent));
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

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
