/**
 * Worker for parallel candidate evaluation. Receives (candidate, baseline, options)
 * and returns total score. Loaded by train-ai.ts via worker_threads.
 */
import { parentPort } from 'worker_threads';
import {
  runSimulation,
  type AiParams,
  type SimResult,
  type RunSimulationOptions,
} from '../src/core/gameCore';

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

interface WorkerInput {
  candidate: AiParams;
  baseline: AiParams;
  matchesPerPair: number;
  maxCycles: number;
  mapConfigOverride?: { width: number; height: number };
}

function evaluate(candidate: AiParams, baseline: AiParams, opts: WorkerInput): number[] {
  const simOpts: RunSimulationOptions = {
    maxCycles: opts.maxCycles,
    mapConfigOverride: opts.mapConfigOverride,
  };
  const matchScores: number[] = [];
  for (let i = 0; i < opts.matchesPerPair; i++) {
    const seed = (Date.now() + i * 1000 + Math.floor(Math.random() * 1000)) % 1_000_000;
    const asAi1 = runSimulation(candidate, baseline, seed, opts.maxCycles, simOpts);
    const asAi2 = runSimulation(baseline, candidate, seed + 1, opts.maxCycles, simOpts);
    matchScores.push(
      scoreResult(asAi1, 'ai1', opts.maxCycles) + scoreResult(asAi2, 'ai2', opts.maxCycles),
    );
  }
  return matchScores;
}

parentPort!.on('message', (msg: { type: 'eval'; id: number; workerId: number; opts: WorkerInput }) => {
  if (msg.type !== 'eval') return;
  const scores = evaluate(msg.opts.candidate, msg.opts.baseline, msg.opts);
  parentPort!.postMessage({ id: msg.id, scores, workerId: msg.workerId });
});
