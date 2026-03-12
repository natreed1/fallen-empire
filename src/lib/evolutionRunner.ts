/**
 * Lightweight evolution runner for UI streaming.
 * Runs the evolutionary loop with onGeneration callbacks; no workers.
 * Used by /api/evolve and /evolve page.
 */

import {
  runSimulation,
  DEFAULT_AI_PARAMS,
  type AiParams,
  type SimResult,
  type RunSimulationOptions,
} from '@/core/gameCore';
import {
  mutateParams,
  type TrendMutationOverrides,
} from '@/lib/aiParamsSchema';

export type EvolutionConfig = {
  generations: number;
  populationSize: number;
  matchesPerPair: number;
  maxCycles: number;
  mapConfig?: { width: number; height: number };
  trendOverrides?: TrendMutationOverrides;
};

export type CandidateData = {
  params: AiParams;
  score: number;
  mean: number;
  std: number;
};

export type GenerationData = {
  gen: number;
  baseline: AiParams;
  baselineScore: number;
  population: CandidateData[];
  elapsedMs: number;
};

function ensureFullParams(p: Partial<AiParams>): AiParams {
  return { ...DEFAULT_AI_PARAMS, ...p };
}

function scoreResult(
  result: SimResult,
  playedAs: 'ai1' | 'ai2',
  maxCycles: number,
): number {
  let s = 0;
  if (result.winner === playedAs) {
    s += 100;
    s += (maxCycles - result.cycle) * 0.05;
  } else if (result.winner !== null) {
    s -= 30;
    s += result.cycle * 0.03;
  } else {
    s -= 10;
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

function mean(arr: number[]): number {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function std(arr: number[]): number {
  if (arr.length <= 1) return 0;
  const m = mean(arr);
  const v = arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length;
  return Math.sqrt(v);
}

function effectiveScore(matchScores: number[]): number {
  return mean(matchScores) - 0.5 * std(matchScores);
}

function evaluateCandidate(candidate: AiParams, baseline: AiParams, config: EvolutionConfig): number[] {
  const simOpts: RunSimulationOptions = {
    maxCycles: config.maxCycles,
    mapConfigOverride: config.mapConfig,
  };
  const scores: number[] = [];
  for (let i = 0; i < config.matchesPerPair; i++) {
    const seed = (Date.now() + i * 997) % 1_000_000;
    const asAi1 = runSimulation(candidate, baseline, seed, config.maxCycles, simOpts);
    const asAi2 = runSimulation(baseline, candidate, seed + 1, config.maxCycles, simOpts);
    scores.push(
      scoreResult(asAi1, 'ai1', config.maxCycles) + scoreResult(asAi2, 'ai2', config.maxCycles),
    );
  }
  return scores;
}

/** Run evolution loop with onGeneration callback. Returns final baseline. */
export async function runEvolutionStream(
  config: EvolutionConfig,
  onGeneration: (data: GenerationData) => void,
): Promise<AiParams> {
  const ELITE_COUNT = 4;
  const startMs = Date.now();

  const MUTATION_STRENGTH = 0.15;
  let baseline: AiParams = ensureFullParams({ ...DEFAULT_AI_PARAMS });
  let population: AiParams[] = [ensureFullParams(baseline)];
  while (population.length < config.populationSize) {
    population.push(
      mutateParams(population[population.length - 1], MUTATION_STRENGTH, config.trendOverrides),
    );
  }

  for (let gen = 0; gen < config.generations; gen++) {
    const matchScoresPerCandidate: number[][] = [];
    for (let i = 0; i < population.length; i++) {
      const scores = evaluateCandidate(population[i], baseline, config);
      matchScoresPerCandidate.push(scores);
    }

    const scored = population.map((p, i) => ({
      params: p,
      score: effectiveScore(matchScoresPerCandidate[i]),
      mean: mean(matchScoresPerCandidate[i]),
      std: std(matchScoresPerCandidate[i]),
    }));
    scored.sort((a, b) => b.score - a.score);
    baseline = scored[0].params;

    onGeneration({
      gen: gen + 1,
      baseline,
      baselineScore: scored[0].score,
      population: scored,
      elapsedMs: Date.now() - startMs,
    });

    population = scored.slice(0, ELITE_COUNT).map(s => s.params);
    while (population.length < config.populationSize) {
      const parent = population[Math.floor(Math.random() * ELITE_COUNT)];
      population.push(mutateParams(parent, MUTATION_STRENGTH, config.trendOverrides));
    }
  }

  return baseline;
}
