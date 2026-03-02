/**
 * Worker for parallel candidate evaluation. Receives (candidate, baseline, options)
 * and returns total score. Loaded by train-ai.ts via worker_threads.
 */
import { parentPort, workerData } from 'worker_threads';
import {
  runSimulation,
  type AiParams,
  type SimResult,
  type RunSimulationOptions,
} from '../src/core/gameCore';

function scoreResult(result: SimResult, playedAs: 'ai1' | 'ai2'): number {
  let s = 0;
  if (result.winner === playedAs) s += 100;
  else if (result.winner !== null) s -= 30;
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

function evaluate(candidate: AiParams, baseline: AiParams, opts: WorkerInput): number {
  const simOpts: RunSimulationOptions = {
    maxCycles: opts.maxCycles,
    mapConfigOverride: opts.mapConfigOverride,
  };
  let total = 0;
  for (let i = 0; i < opts.matchesPerPair; i++) {
    const seed = (Date.now() + i * 1000 + Math.floor(Math.random() * 1000)) % 1_000_000;
    const asAi1 = runSimulation(candidate, baseline, seed, opts.maxCycles, simOpts);
    const asAi2 = runSimulation(baseline, candidate, seed + 1, opts.maxCycles, simOpts);
    total += scoreResult(asAi1, 'ai1') + scoreResult(asAi2, 'ai2');
  }
  return total;
}

parentPort!.on('message', (msg: { type: 'eval'; id: number; workerId: number; opts: WorkerInput }) => {
  if (msg.type !== 'eval') return;
  const score = evaluate(msg.opts.candidate, msg.opts.baseline, msg.opts);
  parentPort!.postMessage({ id: msg.id, score, workerId: msg.workerId });
});
