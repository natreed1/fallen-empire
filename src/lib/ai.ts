import {
  City, Unit, Player, Tile, TerritoryInfo, Hero,
  BuildingType, UnitType, BUILDING_COSTS, UNIT_COSTS, UNIT_BASE_STATS, UNIT_L2_STATS,
  BARACKS_UPGRADE_COST, FACTORY_UPGRADE_COST, FARM_UPGRADE_COST,
  hexDistance, hexNeighbors, tileKey, generateId,
  STARTING_CITY_TEMPLATE, HERO_NAMES, CITY_CENTER_STORAGE,
  BUILDING_IRON_COSTS, SCOUT_MISSION_COST, VILLAGE_INCORPORATE_COST,
} from '@/types/game';

// ─── AI Action Types ───────────────────────────────────────────────

export interface AiBuildAction {
  cityId: string;
  type: BuildingType;
  q: number;
  r: number;
}

export interface AiUpgradeAction {
  cityId: string;
  buildingQ: number;
  buildingR: number;
  type: 'barracks' | 'factory' | 'farm';
}


export interface AiRecruitAction {
  cityId: string;
  type: UnitType;
  armsLevel?: 1 | 2;
}

export interface AiMoveAction {
  unitId: string;
  toQ: number;
  toR: number;
}

export interface AiScoutAction {
  targetQ: number;
  targetR: number;
}

export interface AiIncorporateAction {
  q: number;
  r: number;
}

export interface AiActions {
  builds: AiBuildAction[];
  upgrades: AiUpgradeAction[];
  recruits: AiRecruitAction[];
  moveTargets: AiMoveAction[];
  scouts: AiScoutAction[];
  incorporateVillages: AiIncorporateAction[];
}

// ─── Evolvable AI Parameters (for self-improvement / training) ───────
// Mutate these and run bot-vs-bot; keep params that win more.

export interface AiParams {
  /** Chance to recruit siege (trebuchet/ram) instead of combat unit (0–1). */
  siegeChance: number;
  /** Gold above this => recruit up to maxRecruitsWhenRich per city per cycle. */
  recruitGoldThreshold: number;
  /** Max military recruits per city per cycle when gold is above threshold. */
  maxRecruitsWhenRich: number;
  /** Max military recruits per city per cycle when gold is below threshold. */
  maxRecruitsWhenPoor: number;
  /** Weight for enemy defenders in "weakest city" score (higher = prefer fewer defenders). */
  targetDefenderWeight: number;
  /** If another enemy city is within this ratio of primary target distance, unit may go there (0–1). */
  nearestTargetDistanceRatio: number;
  /** Builder recruit chance per cycle when academy and pop > 5 (0–1). */
  builderRecruitChance: number;
}

export const DEFAULT_AI_PARAMS: AiParams = {
  siegeChance: 0.22,
  recruitGoldThreshold: 400,
  maxRecruitsWhenRich: 3,
  maxRecruitsWhenPoor: 2,
  targetDefenderWeight: 3,
  nearestTargetDistanceRatio: 0.85,
  builderRecruitChance: 0.2,
};

// ─── Execute AI Turn ───────────────────────────────────────────────

export function planAiTurn(
  aiPlayerId: string,
  cities: City[],
  units: Unit[],
  players: Player[],
  tiles: Map<string, Tile>,
  territory: Map<string, TerritoryInfo>,
  params: AiParams = DEFAULT_AI_PARAMS,
): AiActions {
  const aiCities = cities.filter(c => c.ownerId === aiPlayerId);
  const aiPlayer = players.find(p => p.id === aiPlayerId);
  if (!aiPlayer || aiCities.length === 0) {
    return { builds: [], upgrades: [], recruits: [], moveTargets: [], scouts: [], incorporateVillages: [] };
  }

  const actions: AiActions = { builds: [], upgrades: [], recruits: [], moveTargets: [], scouts: [], incorporateVillages: [] };
  let goldBudget = aiPlayer.gold;
  const enemyCities = cities.filter(c => c.ownerId !== aiPlayerId);
  const aiUnits = units.filter(u => u.ownerId === aiPlayerId && u.hp > 0);

  for (const city of aiCities) {
    const farmCount = city.buildings.filter(b => b.type === 'farm').length;
    const hasFactory = city.buildings.some(b => b.type === 'factory');
    const hasBarracks = city.buildings.some(b => b.type === 'barracks');
    const hasAcademy = city.buildings.some(b => b.type === 'academy');
    const hasQuarry = city.buildings.some(b => b.type === 'quarry');
    const hasMine = city.buildings.some(b => b.type === 'mine');
    const factoryToUpgrade = city.buildings.find(b => b.type === 'factory' && (b.level ?? 1) < 2);
    const barracksToUpgrade = city.buildings.find(b => b.type === 'barracks' && (b.level ?? 1) < 2);
    const farmToUpgrade = city.buildings.find(b => b.type === 'farm' && (b.level ?? 1) < 2);

    if (goldBudget >= FACTORY_UPGRADE_COST && factoryToUpgrade && city.storage.iron >= 5) {
      actions.upgrades.push({ cityId: city.id, buildingQ: factoryToUpgrade.q, buildingR: factoryToUpgrade.r, type: 'factory' });
      goldBudget -= FACTORY_UPGRADE_COST;
    } else if (goldBudget >= BARACKS_UPGRADE_COST && barracksToUpgrade) {
      actions.upgrades.push({ cityId: city.id, buildingQ: barracksToUpgrade.q, buildingR: barracksToUpgrade.r, type: 'barracks' });
      goldBudget -= BARACKS_UPGRADE_COST;
    } else if (goldBudget >= FARM_UPGRADE_COST && farmToUpgrade) {
      actions.upgrades.push({ cityId: city.id, buildingQ: farmToUpgrade.q, buildingR: farmToUpgrade.r, type: 'farm' });
      goldBudget -= FARM_UPGRADE_COST;
    }

    let toBuild: BuildingType | null = null;
    const quarrySpot = findDepositTile(city, territory, tiles, cities, 'quarry');
    const mineSpot = findDepositTile(city, territory, tiles, cities, 'mine');
    const hasMarket = city.buildings.some(b => b.type === 'market');
    const hasGoldMine = city.buildings.some(b => b.type === 'gold_mine');
    const goldMineSpot = findGoldMineTile(city, territory, tiles, cities);
    const ironForGoldMine = (BUILDING_IRON_COSTS.gold_mine ?? 0);

    // Balanced build order: barracks, then economy (farms + market for growth/income), then factory/academy
    if (!hasBarracks && goldBudget >= BUILDING_COSTS.barracks) {
      toBuild = 'barracks';
    } else if (farmCount < 2 && goldBudget >= BUILDING_COSTS.farm) {
      toBuild = 'farm';
    } else if (!hasFactory && goldBudget >= BUILDING_COSTS.factory) {
      toBuild = 'factory';
    } else if (!hasMarket && goldBudget >= BUILDING_COSTS.market) {
      toBuild = 'market';
    } else if (!hasAcademy && goldBudget >= BUILDING_COSTS.academy) {
      toBuild = 'academy';
    } else if (!hasQuarry && quarrySpot && goldBudget >= BUILDING_COSTS.quarry && city.population >= 10) {
      toBuild = 'quarry';
    } else if (!hasMine && mineSpot && goldBudget >= BUILDING_COSTS.mine && city.population >= 10) {
      toBuild = 'mine';
    } else if (!hasGoldMine && goldMineSpot && goldBudget >= BUILDING_COSTS.gold_mine && city.storage.iron >= ironForGoldMine) {
      toBuild = 'gold_mine';
    } else if (farmCount < 4 && goldBudget >= BUILDING_COSTS.farm) {
      toBuild = 'farm';
    }

    if (toBuild) {
      let spot: [number, number] | null = null;
      if (toBuild === 'quarry' && quarrySpot) spot = quarrySpot;
      else if (toBuild === 'mine' && mineSpot) spot = mineSpot;
      else if (toBuild === 'gold_mine' && goldMineSpot) spot = goldMineSpot;
      else if (toBuild !== 'quarry' && toBuild !== 'mine' && toBuild !== 'gold_mine') spot = findEmptyTerritoryTile(city, territory, tiles, cities);

      if (spot) {
        actions.builds.push({ cityId: city.id, type: toBuild, q: spot[0], r: spot[1] });
        goldBudget -= BUILDING_COSTS[toBuild];
      }
    }

    // Recruit military: mix of infantry/cavalry/ranged, sometimes L2, sometimes siege (up to 3 per city per cycle)
    const barracks = city.buildings.find(b => b.type === 'barracks');
    const barracksLvl = barracks ? (barracks.level ?? 1) : 1;
    const hasGunsL2 = (city.storage.gunsL2 ?? 0) >= 1;
    if (hasBarracks && city.population > 3) {
      const unitChoices: UnitType[] = ['infantry', 'infantry', 'cavalry', 'ranged'];
      const siegeChoices: UnitType[] = ['trebuchet', 'battering_ram'];
      const maxRecruits = goldBudget > params.recruitGoldThreshold ? params.maxRecruitsWhenRich : params.maxRecruitsWhenPoor;
      for (let i = 0; i < maxRecruits; i++) {
        const useSiege = Math.random() < params.siegeChance;
        const pick = useSiege
          ? siegeChoices[Math.floor(Math.random() * siegeChoices.length)]
          : unitChoices[Math.floor(Math.random() * unitChoices.length)];
        const wantL2 = !useSiege && barracksLvl >= 2 && hasGunsL2 && pick !== 'builder';
        const cost = UNIT_COSTS[pick];
        if (goldBudget >= cost.gold) {
          actions.recruits.push({ cityId: city.id, type: pick, armsLevel: wantL2 ? 2 : undefined });
          goldBudget -= cost.gold;
        } else break;
      }
    }

    // Recruit civilian: builders for roads/outlying buildings
    if (hasAcademy && city.population > 5) {
      const cost = UNIT_COSTS.builder;
      if (goldBudget >= cost.gold && Math.random() < params.builderRecruitChance) {
        actions.recruits.push({ cityId: city.id, type: 'builder' });
        goldBudget -= cost.gold;
      }
    }
  }

  // Scout: send one mission per cycle to nearest enemy city if gold allows
  if (enemyCities.length > 0 && goldBudget >= SCOUT_MISSION_COST) {
    const capital = aiCities[0];
    if (capital) {
      let nearest = enemyCities[0];
      let nearDist = hexDistance(capital.q, capital.r, nearest.q, nearest.r);
      for (const ec of enemyCities) {
        const d = hexDistance(capital.q, capital.r, ec.q, ec.r);
        if (d < nearDist) { nearDist = d; nearest = ec; }
      }
      actions.scouts.push({ targetQ: nearest.q, targetR: nearest.r });
      goldBudget -= SCOUT_MISSION_COST;
    }
  }

  // Incorporate villages: where we have military and gold
  for (const [key, info] of Array.from(territory.entries())) {
    if (info.playerId !== aiPlayerId) continue;
    const tile = tiles.get(key);
    if (!tile || !tile.hasVillage) continue;
    if (cities.some(c => c.q === tile.q && c.r === tile.r)) continue;
    const militaryHere = aiUnits.filter(u => u.q === tile.q && u.r === tile.r && u.type !== 'builder');
    if (militaryHere.length > 0 && goldBudget >= VILLAGE_INCORPORATE_COST) {
      actions.incorporateVillages.push({ q: tile.q, r: tile.r });
      goldBudget -= VILLAGE_INCORPORATE_COST;
    }
  }

  // Move idle units toward best enemy target: prefer weakest city (fewest defenders + low pop)
  if (enemyCities.length > 0) {
    const idleUnits = aiUnits.filter(u => u.status === 'idle' && u.type !== 'builder');
    const enemyUnitCount = (eq: number, er: number): number =>
      units.filter(u => u.ownerId !== aiPlayerId && u.hp > 0 && hexDistance(u.q, u.r, eq, er) <= 2).length;
    const score = (ec: City): number => ec.population + enemyUnitCount(ec.q, ec.r) * params.targetDefenderWeight;
    const sortedEnemies = [...enemyCities].sort((a, b) => score(a) - score(b));
    const primaryTarget = sortedEnemies[0];
    const ratio = Math.max(0.1, Math.min(1, params.nearestTargetDistanceRatio));
    for (const unit of idleUnits) {
      let target = primaryTarget;
      let bestDist = hexDistance(unit.q, unit.r, target.q, target.r);
      for (const ec of sortedEnemies.slice(1, 4)) {
        const d = hexDistance(unit.q, unit.r, ec.q, ec.r);
        if (d < bestDist * ratio) { target = ec; bestDist = d; }
      }
      if (bestDist > 1) {
        actions.moveTargets.push({ unitId: unit.id, toQ: target.q, toR: target.r });
      }
    }
  }

  return actions;
}

// ─── AI Hero Spawning ──────────────────────────────────────────────

let heroNameIdx = 0;
export function createAiHero(q: number, r: number, ownerId: string): Hero {
  return {
    id: generateId('hero'),
    name: HERO_NAMES[heroNameIdx++ % HERO_NAMES.length],
    type: 'general',
    q, r,
    ownerId,
  };
}

// ─── Helpers ───────────────────────────────────────────────────────

function findEmptyTerritoryTile(
  city: City,
  territory: Map<string, TerritoryInfo>,
  tiles: Map<string, Tile>,
  allCities: City[],
): [number, number] | null {
  const cityKeys = new Set(allCities.map(c => tileKey(c.q, c.r)));

  for (const [key, info] of Array.from(territory.entries())) {
    if (info.cityId !== city.id) continue;
    const tile = tiles.get(key);
    if (!tile || tile.biome === 'water' || tile.biome === 'mountain') continue;
    if (cityKeys.has(key)) continue;

    const hasBuilding = allCities.some(c => c.buildings.some(b => tileKey(b.q, b.r) === key));
    if (!hasBuilding) {
      const [q, r] = key.split(',').map(Number);
      return [q, r];
    }
  }
  return null;
}

function findDepositTile(
  city: City,
  territory: Map<string, TerritoryInfo>,
  tiles: Map<string, Tile>,
  allCities: City[],
  deposit: 'quarry' | 'mine',
): [number, number] | null {
  const cityKeys = new Set(allCities.map(c => tileKey(c.q, c.r)));
  const hasDeposit = deposit === 'quarry' ? (t: Tile) => t.hasQuarryDeposit : (t: Tile) => t.hasMineDeposit;

  for (const [key, info] of Array.from(territory.entries())) {
    if (info.cityId !== city.id) continue;
    const tile = tiles.get(key);
    if (!tile || tile.biome === 'water' || tile.biome === 'mountain') continue;
    if (cityKeys.has(key)) continue;
    if (!hasDeposit(tile)) continue;

    const hasBuilding = allCities.some(c => c.buildings.some(b => tileKey(b.q, b.r) === key));
    if (!hasBuilding) {
      const [q, r] = key.split(',').map(Number);
      return [q, r];
    }
  }
  return null;
}

function findGoldMineTile(
  city: City,
  territory: Map<string, TerritoryInfo>,
  tiles: Map<string, Tile>,
  allCities: City[],
): [number, number] | null {
  const cityKeys = new Set(allCities.map(c => tileKey(c.q, c.r)));

  for (const [key, info] of Array.from(territory.entries())) {
    if (info.cityId !== city.id) continue;
    const tile = tiles.get(key);
    if (!tile || tile.biome === 'water' || tile.biome === 'mountain') continue;
    if (cityKeys.has(key)) continue;
    if (!tile.hasGoldMineDeposit) continue;

    const hasBuilding = allCities.some(c => c.buildings.some(b => tileKey(b.q, b.r) === key));
    if (!hasBuilding) {
      const [q, r] = key.split(',').map(Number);
      return [q, r];
    }
  }
  return null;
}

/** Place an AI city at a specific hex (for bot-vs-bot). Returns null if tile invalid. */
export function placeAiStartingCityAt(
  aiPlayerId: string,
  atQ: number,
  atR: number,
  tiles: Map<string, Tile>,
): City | null {
  const tile = tiles.get(tileKey(atQ, atR));
  if (!tile || tile.biome === 'water' || tile.biome === 'mountain') return null;

  const city: City = {
    id: generateId('city'),
    name: 'AI Capital',
    q: atQ,
    r: atR,
    ownerId: aiPlayerId,
    ...structuredClone(STARTING_CITY_TEMPLATE),
  };
  city.buildings = [{ type: 'city_center', q: atQ, r: atR, assignedWorkers: 0 }];
  city.storageCap = { ...CITY_CENTER_STORAGE };
  return city;
}

export function placeAiStartingCity(
  humanCityQ: number,
  humanCityR: number,
  tiles: Map<string, Tile>,
  config: { width: number; height: number },
  aiPlayerId: string,
): City | null {
  const targetQ = config.width - 1 - humanCityQ;
  const targetR = config.height - 1 - humanCityR;

  const checked = new Set<string>();
  const queue: [number, number][] = [[targetQ, targetR]];
  checked.add(tileKey(targetQ, targetR));

  while (queue.length > 0) {
    const [q, r] = queue.shift()!;
    const tile = tiles.get(tileKey(q, r));
    if (tile && tile.biome !== 'water' && tile.biome !== 'mountain') {
      const city: City = {
        id: generateId('city'),
        name: 'AI Capital',
        q, r,
        ownerId: aiPlayerId,
        ...structuredClone(STARTING_CITY_TEMPLATE),
      };
      city.buildings = [{ type: 'city_center', q, r, assignedWorkers: 0 }];
      city.storageCap = { ...CITY_CENTER_STORAGE };
      return city;
    }
    for (const [nq, nr] of hexNeighbors(q, r)) {
      const nk = tileKey(nq, nr);
      if (!checked.has(nk) && nq >= 0 && nq < config.width && nr >= 0 && nr < config.height) {
        checked.add(nk);
        queue.push([nq, nr]);
      }
    }
  }
  return null;
}
