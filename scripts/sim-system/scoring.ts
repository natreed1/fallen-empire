/**
 * Robustness-first scoring and anti-degenerate penalties.
 * Composite score = mean - λ·std - tail penalty; penalize draws, no-combat, starvation lock.
 */

import type { GameResult } from './types';
import type { SimSystemConfig } from './config';

const WIN_POINTS = 100;
const LOSS_POINTS = -30;
const CITY_W = 15;
const POP_W = 0.2;
const KILL_W = 2;

/** Score one game for one side (ai1 or ai2) including anti-degenerate penalties. */
export function scoreGame(
  result: GameResult,
  side: 'ai1' | 'ai2',
  config: SimSystemConfig,
): number {
  let s = 0;
  if (result.winner === side) s += WIN_POINTS;
  else if (result.winner !== null) s += LOSS_POINTS;
  else s += config.drawPenalty;

  const myCities = side === 'ai1' ? result.ai1Cities : result.ai2Cities;
  const oppCities = side === 'ai1' ? result.ai2Cities : result.ai1Cities;
  const myPop = side === 'ai1' ? result.ai1Pop : result.ai2Pop;
  const oppPop = side === 'ai1' ? result.ai2Pop : result.ai1Pop;
  const myKills = side === 'ai1' ? (result.diagnostics.killsByAi1 ?? 0) : (result.diagnostics.killsByAi2 ?? 0);

  s += CITY_W * (myCities - oppCities);
  s += POP_W * (myPop - oppPop);
  s += KILL_W * myKills;

  if (result.diagnostics.totalKills === 0) s += config.noCombatPenalty;
  // Total-starvation abort: both sides irrecoverable → game aborted, both get massive penalty
  if (result.diagnostics.totalStarvationAbort) s += config.totalStarvationPenalty;

  return s;
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

/** Robustness score: mean - λ·std - tailPenalty·worstDecile. Prefer stable generalists. */
export function robustnessScore(gameScores: number[], config: SimSystemConfig): number {
  if (gameScores.length === 0) return 0;
  const m = mean(gameScores);
  const s = std(gameScores);
  const sorted = [...gameScores].sort((a, b) => a - b);
  const decileIdx = Math.floor(sorted.length * 0.1);
  const worstDecile = decileIdx < sorted.length ? sorted[decileIdx] : sorted[0] ?? 0;
  return m - config.robustnessLambda * s - config.robustnessTailPenalty * Math.min(0, worstDecile);
}
