import {
  type City,
  type CityBuilding,
  type ConstructionSite,
  type TerritoryInfo,
  BUILDER_POWER,
  CITY_BUILDING_POWER,
  DEFAULT_BUILDER_TASK,
  type BuilderTask,
  tileKey,
  hexDistance,
} from '@/types/game';

/** Resolved task list for each University workforce slot (length = slot count). */
export function getUniversitySlotTasks(city: City, academy: CityBuilding | undefined | null): BuilderTask[] {
  const slots = getUniversityBuilderSlots(academy);
  if (slots <= 0) return [];
  const legacy = city.universityBuilderTask ?? DEFAULT_BUILDER_TASK;
  const stored = city.universityBuilderSlotTasks;
  if (stored && stored.length === slots) return [...stored];
  const out: BuilderTask[] = [];
  for (let i = 0; i < slots; i++) {
    out.push(stored?.[i] ?? legacy);
  }
  return out;
}

/** Fill every workforce slot with the same task (AI / bulk UI). */
export function fillUniversitySlotTasks(
  city: City,
  academy: CityBuilding | undefined | null,
  task: BuilderTask,
): BuilderTask[] {
  const n = getUniversityBuilderSlots(academy);
  return Array.from({ length: n }, () => task);
}

export function getCityUniversityTask(city: City): BuilderTask {
  const academy = city.buildings.find(b => b.type === 'academy');
  const tasks = getUniversitySlotTasks(city, academy);
  if (tasks.length === 0) return city.universityBuilderTask ?? DEFAULT_BUILDER_TASK;
  const first = tasks.find(t => t !== 'idle');
  return first ?? 'idle';
}

/** True if at least one workforce slot is assigned this task. */
export function cityUniversityHasSlotTask(city: City, task: BuilderTask): boolean {
  const academy = city.buildings.find(b => b.type === 'academy');
  return getUniversitySlotTasks(city, academy).some(t => t === task);
}

/** Builder workforce size from University (academy) level — 1 slot per level, max 5. */
export function getUniversityBuilderSlots(academy: CityBuilding | undefined | null): number {
  if (!academy || academy.type !== 'academy') return 0;
  const lvl = academy.level ?? 1;
  return Math.min(5, Math.max(1, lvl));
}

export function universityTaskMatchesSiteType(task: BuilderTask, siteType: ConstructionSite['type']): boolean {
  switch (task) {
    case 'idle':
      return false;
    case 'expand_quarries':
      return siteType === 'quarry';
    case 'expand_iron_mines':
      return siteType === 'mine' || siteType === 'gold_mine';
    case 'expand_forestry':
      return siteType === 'logging_hut' || siteType === 'sawmill';
    case 'city_defenses':
      return siteType === 'wall_section';
    default:
      return false;
  }
}

export function findNearestCityWithAcademy(
  q: number,
  r: number,
  cities: City[],
  ownerId: string,
): City | undefined {
  let best: City | undefined;
  let bestD = Infinity;
  for (const c of cities) {
    if (c.ownerId !== ownerId) continue;
    if (!c.buildings.some(b => b.type === 'academy')) continue;
    const d = hexDistance(c.q, c.r, q, r);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

const UNIVERSITY_BP_TASKS: BuilderTask[] = ['expand_quarries', 'expand_iron_mines', 'expand_forestry', 'city_defenses'];

function constructionOrderIndex(site: ConstructionSite, allConstructions: ConstructionSite[]): number {
  const i = allConstructions.findIndex(s => s.id === site.id);
  return i >= 0 ? i : Infinity;
}

/**
 * Live-game construction BP (territory city power + university workforce when task matches).
 * Trebuchet / scout towers use nearest city's academy (field engineering).
 *
 * When several sites share the same University task (e.g. three quarries), **workforce BP stacks on one
 * site at a time**: the earliest in `allConstructions` gets all matching slots; others get territory power only.
 */
export function computeConstructionAvailableBp(
  site: ConstructionSite,
  territory: Map<string, TerritoryInfo>,
  cities: City[],
  allConstructions: ConstructionSite[],
): number {
  const key = tileKey(site.q, site.r);
  let avail = 0;

  // Territory tile BP: city buildings, and city defense towers (paid with gold; built with base territory power only — not University workforce).
  if (site.type !== 'trebuchet' && site.type !== 'scout_tower' && site.type !== 'wall_section') {
    const terr = territory.get(key);
    if (terr && terr.playerId === site.ownerId) avail += CITY_BUILDING_POWER;
  }

  if (site.type === 'trebuchet' || site.type === 'scout_tower') {
    const fieldPeers = allConstructions.filter(
      s => s.ownerId === site.ownerId && (s.type === 'trebuchet' || s.type === 'scout_tower'),
    );
    fieldPeers.sort((a, b) => constructionOrderIndex(a, allConstructions) - constructionOrderIndex(b, allConstructions));
    const firstField = fieldPeers[0];
    if (firstField && firstField.id === site.id) {
      const nc = findNearestCityWithAcademy(site.q, site.r, cities, site.ownerId);
      const ac = nc?.buildings.find(b => b.type === 'academy');
      avail += getUniversityBuilderSlots(ac) * BUILDER_POWER;
    }
    return avail;
  }

  if (site.type === 'city_defense') {
    return avail;
  }

  const city = site.cityId ? cities.find(c => c.id === site.cityId) : undefined;
  if (!city) return avail;

  const academy = city.buildings.find(b => b.type === 'academy');
  const slots = getUniversityBuilderSlots(academy);
  if (slots <= 0) return avail;

  const slotTasks = getUniversitySlotTasks(city, academy);
  const indexById = new Map(allConstructions.map((s, i) => [s.id, i]));

  for (const task of UNIVERSITY_BP_TASKS) {
    if (!universityTaskMatchesSiteType(task, site.type)) continue;
    const slotCountForTask = slotTasks.filter(t => t === task).length;
    if (slotCountForTask === 0) continue;

    const sameTaskSites = allConstructions.filter(
      s =>
        s.cityId === site.cityId &&
        s.ownerId === site.ownerId &&
        universityTaskMatchesSiteType(task, s.type),
    );
    sameTaskSites.sort((a, b) => (indexById.get(a.id) ?? Infinity) - (indexById.get(b.id) ?? Infinity));
    const winner = sameTaskSites[0];
    if (winner?.id === site.id) {
      avail += slotCountForTask * BUILDER_POWER;
    }
    break;
  }
  return avail;
}

/** Roads: only university workforce in that territory tile (no city “building power”). */
export function computeRoadAvailableBp(
  site: { q: number; r: number; ownerId: string },
  territory: Map<string, TerritoryInfo>,
  cities: City[],
): number {
  const terr = territory.get(tileKey(site.q, site.r));
  if (!terr || terr.playerId !== site.ownerId) return 0;
  const city = cities.find(c => c.id === terr.cityId);
  const academy = city?.buildings.find(b => b.type === 'academy');
  return getUniversityBuilderSlots(academy) * BUILDER_POWER;
}
