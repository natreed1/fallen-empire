import type { Unit, UnitType } from '@/types/game';
import { isLandMilitaryUnit } from '@/lib/garrison';

/** Preset attack formations for siege / city assault. */
export type SiegeTacticId = 'classic_four' | 'boxed' | 'winged';

export const SIEGE_TACTIC_META: Record<
  SiegeTacticId,
  { label: string; short: string }
> = {
  classic_four: {
    label: 'Classic four-layer',
    short:
      'March: column toward the objective with flanking files. Infantry tends to hold the ordered hex; cavalry fills forward hexes.',
  },
  boxed: {
    label: 'Boxed',
    short: 'March: tight cluster around the objective hex — a filled “box” on surrounding tiles.',
  },
  winged: {
    label: 'Winged',
    short: 'March: strong wings on the sides of the axis, vanguard forward of the anchor hex.',
  },
};

/** Conceptual type groups per layer (front → back). */
const TACTIC_LAYERS: Record<SiegeTacticId, UnitType[][]> = {
  classic_four: [
    ['cavalry', 'horse_archer'],
    ['crusader_knight', 'infantry', 'defender'],
    ['ranged'],
    ['trebuchet', 'battering_ram'],
  ],
  boxed: [
    ['cavalry', 'horse_archer', 'crusader_knight', 'infantry', 'defender'],
    ['ranged', 'trebuchet', 'battering_ram'],
  ],
  winged: [
    ['cavalry', 'horse_archer'],
    ['crusader_knight', 'infantry', 'defender'],
    ['ranged', 'trebuchet', 'battering_ram'],
  ],
};

function sortMilitaryIds(units: Unit[]): Unit[] {
  return units
    .filter(u => isLandMilitaryUnit(u) && u.hp > 0 && !u.aboardShipId)
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Collect unit ids for each conceptual layer (may be empty layers). */
export function unitsByConceptualLayers(stackUnits: Unit[], preset: SiegeTacticId): string[][] {
  const defs = TACTIC_LAYERS[preset];
  const sorted = sortMilitaryIds(stackUnits);
  const layers: string[][] = [];
  for (const types of defs) {
    const set = new Set(types);
    layers.push(sorted.filter(u => set.has(u.type)).map(u => u.id));
  }
  return layers.filter(layer => layer.length > 0);
}

/** Depth slider 1–5 → target number of march waves (2–4). */
export function targetWaveCountFromDepth(depth: number): number {
  const d = Math.max(1, Math.min(5, Math.round(depth)));
  return [2, 2, 3, 4, 4][d - 1]!;
}

/** Width slider 1–5 → max units in the leading wave before splitting into sequential sub-waves. */
export function firstWaveMaxFromWidth(width: number): number {
  const w = Math.max(1, Math.min(5, Math.round(width)));
  return 8 + w * 3;
}

/** Merge conceptual layers from the back until we have at most `targetWaves` non-empty groups. */
export function mergeLayersFromBack(layers: string[][], targetWaves: number): string[][] {
  if (layers.length === 0) return [];
  let groups = layers.map(l => [...l]).filter(l => l.length > 0);
  if (groups.length <= targetWaves) return groups;
  while (groups.length > targetWaves) {
    const a = groups.pop()!;
    const b = groups.pop()!;
    groups.push([...b, ...a]);
  }
  return groups.filter(g => g.length > 0);
}

/** Split any wave that exceeds `maxPerWave` into sequential chunks (each chunk is its own wave). */
export function splitOversizedWaves(waves: string[][], maxPerWave: number): string[][] {
  const out: string[][] = [];
  for (const w of waves) {
    if (w.length <= maxPerWave) {
      out.push(w);
      continue;
    }
    for (let i = 0; i < w.length; i += maxPerWave) {
      out.push(w.slice(i, i + maxPerWave));
    }
  }
  return out.filter(x => x.length > 0);
}

/** Attach units not in any wave (e.g. builders) to the first marching wave. */
export function mergeUnassignedUnitIdsIntoFirstWave(waves: string[][], allUnitIds: string[]): string[][] {
  const set = new Set(waves.flat());
  const extra = allUnitIds.filter(id => !set.has(id));
  if (extra.length === 0) return waves;
  const out = waves.map(w => [...w]);
  if (out.length === 0) return [extra];
  out[0] = [...out[0]!, ...extra];
  return out;
}

/** Build ordered wave groups: first wave marches immediately; each next waits for the prior at the rally hex. */
export function buildWaveGroupsFromTactic(
  stackUnits: Unit[],
  preset: SiegeTacticId,
  width: number,
  depth: number,
): string[][] {
  const conceptual = unitsByConceptualLayers(stackUnits, preset);
  if (conceptual.length === 0) return [];

  const targetWaves = targetWaveCountFromDepth(depth);
  const merged = mergeLayersFromBack(conceptual, targetWaves);
  const maxFirst = firstWaveMaxFromWidth(width);
  return splitOversizedWaves(merged, maxFirst);
}
