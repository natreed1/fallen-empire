import type { City, CityBuilding } from '@/types/game';
import { UNIVERSITY_LEVEL_MAX, UNIVERSITY_LEVEL_POP_PER_STEP } from '@/types/game';

/** University building level from city population: +1 level each {@link UNIVERSITY_LEVEL_POP_PER_STEP} population (max {@link UNIVERSITY_LEVEL_MAX}). */
export function computeUniversityBuildingLevelFromPopulation(population: number): number {
  const p = Math.max(0, population);
  return Math.min(UNIVERSITY_LEVEL_MAX, Math.max(1, 1 + Math.floor(p / UNIVERSITY_LEVEL_POP_PER_STEP)));
}

export interface SyncUniversityLevelUpEvent {
  city: City;
  building: CityBuilding;
  oldLevel: number;
  newLevel: number;
}

/**
 * Forces each `university` building's level to match {@link computeUniversityBuildingLevelFromPopulation}.
 * Optionally reports level-ups (not downgrades).
 */
export function syncUniversityBuildingLevelsForCities(
  cities: City[],
  opts?: { onLevelUp?: (ev: SyncUniversityLevelUpEvent) => void },
): City[] {
  return cities.map(city => {
    const target = computeUniversityBuildingLevelFromPopulation(city.population);
    let changed = false;
    const buildings = city.buildings.map(b => {
      if (b.type !== 'university') return b;
      const oldLevel = b.level ?? 1;
      if (oldLevel === target) return b;
      changed = true;
      if (target > oldLevel) {
        opts?.onLevelUp?.({ city, building: b, oldLevel, newLevel: target });
      }
      return { ...b, level: target };
    });
    return changed ? { ...city, buildings } : city;
  });
}

/** Next population count where this city's university gains a level (null if already max). */
export function nextUniversityLevelPopulationThreshold(currentLevel: number): number | null {
  if (currentLevel >= UNIVERSITY_LEVEL_MAX) return null;
  return currentLevel * UNIVERSITY_LEVEL_POP_PER_STEP;
}
