/**
 * AI parameters for planAiTurn: league / train-ai champion lives in public/ai-params.json
 * and is baked into the client bundle so spectate / bot-vs-bot / human_vs_ai always use the
 * same weights without waiting on fetch or stale localStorage.
 * Optional session override via setAiParams (tests / tooling).
 * Clamps use aiParamsSchema ranges for consistency.
 */

import { AiParams, DEFAULT_AI_PARAMS } from './ai';
import { MUTATION_RANGES, SCALAR_PARAM_KEYS, normalizeMilitaryLevelMix } from './aiParamsSchema';
import shippedChampionPartial from '../../public/ai-params.json';

function clampAiParams(merged: AiParams): AiParams {
  const out: AiParams = { ...merged };
  for (const key of SCALAR_PARAM_KEYS) {
    const range = MUTATION_RANGES[key];
    let v = (out as unknown as Record<string, number>)[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    v = Math.max(range.min, Math.min(range.max, v));
    if (range.round) v = Math.round(v);
    (out as unknown as Record<string, number>)[key] = v;
  }
  if (out.militaryLevelMixTarget) {
    out.militaryLevelMixTarget = normalizeMilitaryLevelMix(out.militaryLevelMixTarget);
  }
  return out;
}

/** Champion from repo (tournament-league / train-ai output); merged on top of defaults then clamped. */
const SHIPPED_CHAMPION: AiParams = clampAiParams({
  ...DEFAULT_AI_PARAMS,
  ...(shippedChampionPartial as Partial<AiParams>),
});

let sessionOverride: AiParams | null = null;

/** Current AI params: shipped champion, or last setAiParams() if tests overrode. */
export function getAiParams(): AiParams {
  const base = sessionOverride ?? SHIPPED_CHAMPION;
  return { ...base };
}

/** Merge onto defaults, clamp, and use as session override (e.g. unit tests). */
export function setAiParams(params: Partial<AiParams>): AiParams {
  const merged = clampAiParams({
    ...DEFAULT_AI_PARAMS,
    ...params,
  });
  sessionOverride = merged;
  return merged;
}

/** Clear session override; play uses shipped champion again. */
export function resetAiParams(): AiParams {
  sessionOverride = null;
  return getAiParams();
}
