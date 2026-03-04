/**
 * Load/save evolvable AI parameters (for self-improvement).
 * In browser: persists to localStorage so training UI or scripts can update them.
 * Training: mutate params, run games, keep params that win more.
 * Clamps use aiParamsSchema ranges for consistency.
 */

import { AiParams, DEFAULT_AI_PARAMS } from './ai';
import { MUTATION_RANGES, SCALAR_PARAM_KEYS, normalizeMilitaryLevelMix } from './aiParamsSchema';

const STORAGE_KEY = 'fallen_empire_ai_params';

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

/** Load current AI params (from localStorage if available, else defaults). */
export function getAiParams(): AiParams {
  if (!isBrowser()) return { ...DEFAULT_AI_PARAMS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_AI_PARAMS };
    const parsed = JSON.parse(raw) as Partial<AiParams>;
    return { ...DEFAULT_AI_PARAMS, ...parsed };
  } catch {
    return { ...DEFAULT_AI_PARAMS };
  }
}

/** Save AI params (e.g. after evolution). Clamps to valid ranges from schema. */
export function setAiParams(params: Partial<AiParams>): AiParams {
  const merged: AiParams = {
    ...DEFAULT_AI_PARAMS,
    ...params,
  };
  for (const key of SCALAR_PARAM_KEYS) {
    const range = MUTATION_RANGES[key];
    let v = (merged as unknown as Record<string, number>)[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    v = Math.max(range.min, Math.min(range.max, v));
    if (range.round) v = Math.round(v);
    (merged as unknown as Record<string, number>)[key] = v;
  }
  if (merged.militaryLevelMixTarget) {
    merged.militaryLevelMixTarget = normalizeMilitaryLevelMix(merged.militaryLevelMixTarget);
  }
  if (isBrowser()) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    } catch (_) {}
  }
  return merged;
}

/** Reset to default params and return them. */
export function resetAiParams(): AiParams {
  if (isBrowser()) {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (_) {}
  }
  return { ...DEFAULT_AI_PARAMS };
}
