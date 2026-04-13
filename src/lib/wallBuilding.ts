import { getHexRing, tileKey, type City, type Tile } from '@/types/game';
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
