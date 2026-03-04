/**
 * Lineage diversity controls: cap per-lineage representation per tier/season.
 * Prevents single-family collapse of meta diversity.
 */

import type { SimAgent } from './types';
import type { Tier } from './types';

/** Count agents per lineage in a tier. */
export function countByLineage(agents: SimAgent[], tier: Tier): Map<string, number> {
  const inTier = agents.filter(a => a.tier === tier && !a.isAnchor);
  const counts = new Map<string, number>();
  for (const a of inTier) {
    counts.set(a.lineageId, (counts.get(a.lineageId) ?? 0) + 1);
  }
  return counts;
}

/** Check if adding one more agent of lineageId would exceed cap for tier. */
export function wouldExceedLineageCap(
  agents: SimAgent[],
  tier: Tier,
  lineageId: string,
  capFraction: number,
): boolean {
  const inTier = agents.filter(a => a.tier === tier && !a.isAnchor);
  const size = inTier.length;
  if (size === 0) return false;
  const current = inTier.filter(a => a.lineageId === lineageId).length;
  const cap = Math.floor(size * capFraction);
  return current >= cap;
}

/** Get lineage IDs that are at or over cap for tier (for diversity-aware selection). */
export function lineagesAtCap(
  agents: SimAgent[],
  tier: Tier,
  capFraction: number,
): Set<string> {
  const counts = countByLineage(agents, tier);
  const inTier = agents.filter(a => a.tier === tier && !a.isAnchor).length;
  const cap = Math.max(1, Math.floor(inTier * capFraction));
  const atCap = new Set<string>();
  for (const [lineageId, c] of counts) {
    if (c >= cap) atCap.add(lineageId);
  }
  return atCap;
}

/** Max fraction of a tier that is a single lineage (0–1). Used for telemetry. */
export function maxLineageConcentration(agents: SimAgent[], tier: Tier): number {
  const inTier = agents.filter(a => a.tier === tier && !a.isAnchor);
  if (inTier.length === 0) return 0;
  const counts = countByLineage(agents, tier);
  let maxFrac = 0;
  for (const c of counts.values()) {
    maxFrac = Math.max(maxFrac, c / inTier.length);
  }
  return maxFrac;
}
