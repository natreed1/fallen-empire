/**
 * Load/save evolvable AI parameters (for self-improvement).
 * In browser: persists to localStorage so training UI or scripts can update them.
 * Training: mutate params, run games, keep params that win more.
 */

import { AiParams, DEFAULT_AI_PARAMS } from './ai';

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

/** Save AI params (e.g. after evolution). Clamps to valid ranges. */
export function setAiParams(params: Partial<AiParams>): AiParams {
  const merged: AiParams = {
    ...DEFAULT_AI_PARAMS,
    ...params,
  };
  merged.siegeChance = Math.max(0, Math.min(1, merged.siegeChance));
  merged.recruitGoldThreshold = Math.max(0, merged.recruitGoldThreshold);
  merged.maxRecruitsWhenRich = Math.max(1, Math.min(5, Math.round(merged.maxRecruitsWhenRich)));
  merged.maxRecruitsWhenPoor = Math.max(1, Math.min(5, Math.round(merged.maxRecruitsWhenPoor)));
  merged.targetDefenderWeight = Math.max(0.5, Math.min(10, merged.targetDefenderWeight));
  merged.nearestTargetDistanceRatio = Math.max(0.1, Math.min(1, merged.nearestTargetDistanceRatio));
  merged.builderRecruitChance = Math.max(0, Math.min(1, merged.builderRecruitChance));
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
