/**
 * Worker for parallel match evaluation. Handles two job types:
 * - 'match': Run one match pair (2 sims), return single score — used for fine-grained parallelism.
 * - 'eval': Run full candidate evaluation (legacy) — one worker per candidate.
 */
import { parentPort } from 'worker_threads';
import {
  runSimulation,
  DEFAULT_AI_PARAMS,
  type AiParams,
  type SimResult,
  type RunSimulationOptions,
} from '../src/core/gameCore';

function ensureFullParams(p: Partial<AiParams>): AiParams {
  return { ...DEFAULT_AI_PARAMS, ...p };
}

const DRAW_PENALTY = 10;
const WON_QUICKLY_BONUS_PER_CYCLE = 0.05;
const LOST_SLOWLY_BONUS_PER_CYCLE = 0.03;

function scoreResult(
  result: SimResult,
  playedAs: 'ai1' | 'ai2',
  maxCycles: number,
): number {
  let s = 0;
  if (result.winner === playedAs) {
    s += 100;
    s += (maxCycles - result.cycle) * WON_QUICKLY_BONUS_PER_CYCLE;
  } else if (result.winner !== null) {
    s -= 30;
    s += result.cycle * LOST_SLOWLY_BONUS_PER_CYCLE;
  } else {
    s -= DRAW_PENALTY;
  }
  s += result.cycle * 0.1;
  const myCities = playedAs === 'ai1' ? result.ai1Cities : result.ai2Cities;
  const myPop = playedAs === 'ai1' ? result.ai1Pop : result.ai2Pop;
  const oppCities = playedAs === 'ai1' ? result.ai2Cities : result.ai1Cities;
  const oppPop = playedAs === 'ai1' ? result.ai2Pop : result.ai1Pop;
  s += (myCities - oppCities) * 15;
  s += (myPop - oppPop) * 0.2;
  return s;
}

interface MatchJob {
  type: 'match';
  workerId: number;
  jobId: number;
  candidateId: number;
  matchIndex: number;
  candidate: AiParams;
  baseline: AiParams;
  seed: number;
  maxCycles: number;
  mapConfigOverride?: { width: number; height: number };
}

interface EvalJob {
  type: 'eval';
  id: number;
  workerId: number;
  opts: {
    candidate: AiParams;
    baseline: AiParams;
    matchesPerPair: number;
    maxCycles: number;
    mapConfigOverride?: { width: number; height: number };
  };
}

function runOneMatch(job: MatchJob): number {
  const c = ensureFullParams(job.candidate);
  const b = ensureFullParams(job.baseline);
  const simOpts: RunSimulationOptions = {
    maxCycles: job.maxCycles,
    mapConfigOverride: job.mapConfigOverride,
  };
  const asAi1 = runSimulation(c, b, job.seed, job.maxCycles, simOpts);
  const asAi2 = runSimulation(b, c, job.seed + 1, job.maxCycles, simOpts);
  return scoreResult(asAi1, 'ai1', job.maxCycles) + scoreResult(asAi2, 'ai2', job.maxCycles);
}

function evaluate(job: EvalJob): number[] {
  const c = ensureFullParams(job.opts.candidate);
  const b = ensureFullParams(job.opts.baseline);
  const simOpts: RunSimulationOptions = {
    maxCycles: job.opts.maxCycles,
    mapConfigOverride: job.opts.mapConfigOverride,
  };
  const matchScores: number[] = [];
  for (let i = 0; i < job.opts.matchesPerPair; i++) {
    const seed = (Date.now() + i * 1000 + Math.floor(Math.random() * 1000)) % 1_000_000;
    const asAi1 = runSimulation(c, b, seed, job.opts.maxCycles, simOpts);
    const asAi2 = runSimulation(b, c, seed + 1, job.opts.maxCycles, simOpts);
    matchScores.push(
      scoreResult(asAi1, 'ai1', job.opts.maxCycles) + scoreResult(asAi2, 'ai2', job.opts.maxCycles),
    );
  }
  return matchScores;
}

parentPort!.on('message', (msg: MatchJob | EvalJob) => {
  if (msg.type === 'match') {
    const score = runOneMatch(msg);
    parentPort!.postMessage({
      type: 'match',
      workerId: msg.workerId,
      jobId: msg.jobId,
      candidateId: msg.candidateId,
      matchIndex: msg.matchIndex,
      score,
    });
    return;
  }
  if (msg.type === 'eval') {
    const scores = evaluate(msg);
    parentPort!.postMessage({ id: msg.id, scores, workerId: msg.workerId });
  }
});
