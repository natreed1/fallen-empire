/**
 * Permanent fixed anchors: benchmark opponents in every season.
 * Anchors are ineligible for champion and never mutated.
 */

import type { AiParams } from '../../src/lib/ai';
import { FIXED_ARCHETYPES } from '../lib/archetypes';
import type { SimAgent } from './types';

export type AnchorId = string;

/** Anchors as SimAgents (tier irrelevant; they don't participate in promotion). */
export function getAnchors(): SimAgent[] {
  return FIXED_ARCHETYPES.map((a, i) => ({
    id: a.id,
    params: a.params,
    tier: 'A' as const, // placeholder; anchors are not in a tier pool
    lineageId: `anchor_${a.id}`,
    isAnchor: true,
    gameScores: [],
    wins: 0,
    losses: 0,
    draws: 0,
    totalKills: 0,
    noCombatGames: 0,
    totalStarvationGames: 0,
    decisiveGames: 0,
  }));
}

export function getAnchorParamsById(id: string): AiParams | undefined {
  const found = FIXED_ARCHETYPES.find(a => a.id === id);
  return found?.params;
}

export function isAnchorId(id: string): boolean {
  return FIXED_ARCHETYPES.some(a => a.id === id);
}
