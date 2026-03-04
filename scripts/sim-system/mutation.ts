/**
 * Hybrid mutation portfolio: stable (65%), medium (25%), wildcard (10%).
 * Ratios configurable via config; guardrails applied in config load.
 * Delegates full param mutation to aiParamsSchema (all evolvable params).
 */

import { DEFAULT_AI_PARAMS, type AiParams } from '../../src/lib/ai';
import { mutateParams as mutateParamsFromSchema } from '../../src/lib/aiParamsSchema';
import type { SimSystemConfig } from './config';

export type MutationBucket = 'stable' | 'medium' | 'wildcard';

/** Full param mutation with strength (all evolvable params, schema ranges). */
export function mutateParams(parent: AiParams, strength: number): AiParams {
  return mutateParamsFromSchema({ ...DEFAULT_AI_PARAMS, ...parent }, strength);
}

/** Choose bucket by config ratios (stable / medium / wildcard). */
export function chooseMutationBucket(config: SimSystemConfig): MutationBucket {
  const r = Math.random();
  if (r < config.mutationStableRatio) return 'stable';
  if (r < config.mutationStableRatio + config.mutationMediumRatio) return 'medium';
  return 'wildcard';
}

/** Mutate parent using the chosen bucket's strength. */
export function mutateWithBucket(
  parent: AiParams,
  bucket: MutationBucket,
  config: SimSystemConfig,
): AiParams {
  const strength =
    bucket === 'stable' ? config.mutationStableStrength
    : bucket === 'medium' ? config.mutationMediumStrength
    : config.mutationWildcardStrength;
  return mutateParams({ ...DEFAULT_AI_PARAMS, ...parent }, strength);
}
