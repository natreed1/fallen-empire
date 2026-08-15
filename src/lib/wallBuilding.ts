import {
  getHexRing,
  tileKey,
  WALL_BUILDER_STONE_PER_CYCLE_PER_SLOT,
  type City,
  type ConstructionSite,
  type Tile,
} from '@/types/game';
import { getUniversitySlotTasks } from '@/lib/builders';

/** Next wall hex to build: full ring 1 in iteration order, then ring 2. Skips water. */
export function getNextWallBuildHex(
  city: City,
  tiles: Map<string, Tile>,
  builtWallKeys: Set<string>,
  queuedWallKeys: Set<string>,
): { q: number; r: number; ring: 1 | 2 } | null {
  for (const ring of [1, 2] as const) {
    const ringHexes = getHexRing(city.q, city.r, ring);
    for (const { q, r } of ringHexes) {
      const t = tiles.get(tileKey(q, r));
      if (!t || t.biome === 'water') continue;
      const k = tileKey(q, r);
      if (builtWallKeys.has(k) || queuedWallKeys.has(k)) continue;
      return { q, r, ring };
    }
  }
  return null;
}

/** Workforce slots assigned to city_defenses (wall + tower construction). */
export function countDefensesTaskSlots(city: City): number {
  const academy = city.buildings.find(b => b.type === 'academy');
  const slotTasks = getUniversitySlotTasks(city, academy);
  return slotTasks.filter(t => t === 'city_defenses').length;
}

/** Stone charged for one economy cycle of wall BP (0 if no Walls slots). */
export function wallConstructionStoneCost(city: City): number {
  const slots = countDefensesTaskSlots(city);
  if (slots <= 0) return 0;
  return slots * WALL_BUILDER_STONE_PER_CYCLE_PER_SLOT;
}

/** True when the city can pay this cycle's wall workforce (same gate as live BP). */
export function cityCanPayWallConstruction(city: City): boolean {
  const cost = wallConstructionStoneCost(city);
  return cost > 0 && (city.storage.stone ?? 0) >= cost;
}

/**
 * Cities that actually received wall BP this cycle: they already had a wall site
 * and enough stone *before* quarry income. Charge only these — post-economy
 * stone must not unlock a deduction when construction stalled.
 */
export function wallStoneChargesForCycle(
  cities: City[],
  constructions: Pick<ConstructionSite, 'cityId' | 'type'>[],
): Map<string, number> {
  const charges = new Map<string, number>();
  for (const city of cities) {
    const hasWallSite = constructions.some(
      con => con.cityId === city.id && con.type === 'wall_section',
    );
    if (!hasWallSite) continue;
    if (!cityCanPayWallConstruction(city)) continue;
    charges.set(city.id, wallConstructionStoneCost(city));
  }
  return charges;
}

/** Deduct pre-approved wall stone after economy; never charge a stalled city. */
export function applyWallStoneCharges<T extends City>(
  cities: T[],
  charges: Map<string, number>,
): T[] {
  if (charges.size === 0) return cities;
  return cities.map(c => {
    const cost = charges.get(c.id);
    if (!cost) return c;
    const stone = c.storage.stone ?? 0;
    if (stone < cost) return c;
    return {
      ...c,
      storage: { ...c.storage, stone: stone - cost },
    };
  });
}
