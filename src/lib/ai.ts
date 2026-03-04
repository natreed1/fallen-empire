import {
  City, Unit, Player, Tile, TerritoryInfo, Hero,
  BuildingType, UnitType, BUILDING_COSTS, UNIT_COSTS, UNIT_BASE_STATS, UNIT_L2_STATS,
  BARACKS_UPGRADE_COST, FACTORY_UPGRADE_COST, FARM_UPGRADE_COST,
  hexDistance, hexNeighbors, tileKey, generateId,
  STARTING_CITY_TEMPLATE, HERO_NAMES, CITY_CENTER_STORAGE,
  BUILDING_IRON_COSTS, SCOUT_MISSION_COST, VILLAGE_INCORPORATE_COST,
} from '@/types/game';
import { computeCityProductionRate } from '@/lib/gameLoop';

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
  // ─── Extended (food, build, upgrade, scout, village, targeting) ──
  /** Min food surplus to allow more than 1 recruit per cycle (higher = more conservative). */
  foodBufferThreshold: number;
  /** Scale for max sustainable military (0.6–1.2: <1 = underfill cap, >1 = allow overfill). */
  sustainableMilitaryMultiplier: number;
  /** Build order: 0 = barracks first, 1 = 2 farms before barracks. */
  farmFirstBias: number;
  /** When food surplus is below this, prefer building a farm (priority over normal build order). 0 = off. */
  farmPriorityThreshold: number;
  /** When factory and barracks can both upgrade, chance to pick factory first (0–1). */
  factoryUpgradePriority: number;
  /** Chance to send scout each cycle when gold allows (0–1). */
  scoutChance: number;
  /** Chance to incorporate village when military + gold (0–1). */
  incorporateVillageChance: number;
  /** Weight for enemy city pop in target score (higher = prefer high-pop cities). */
  targetPopWeight: number;
}

export const DEFAULT_AI_PARAMS: AiParams = {
  siegeChance: 0.2604324738460518,
  recruitGoldThreshold: 574,
  maxRecruitsWhenRich: 5,
  maxRecruitsWhenPoor: 3,
  targetDefenderWeight: 2.002454414985417,
  nearestTargetDistanceRatio: 0.8974484759321075,
  builderRecruitChance: 0.30076342938205447,
  foodBufferThreshold: 5,
  sustainableMilitaryMultiplier: 0.8981775924328552,
  farmFirstBias: 0,
  farmPriorityThreshold: 8,
  factoryUpgradePriority: 0.5512785610145845,
  scoutChance: 1,
  incorporateVillageChance: 0.9513629524907542,
  targetPopWeight: 0.8099010091528773,
};

// ─── Food-aware recruit gating (avoid starvation lock in headless sim) ──
const CIV_FOOD_PER_POP = 0.25;
const AVG_MILITARY_FOOD_PER_UNIT = 1.5;

export function estimateAiFoodSurplus(
  aiPlayerId: string,
  cities: City[],
  units: Unit[],
  tiles: Map<string, Tile>,
  territory: Map<string, TerritoryInfo>,
  harvestMultiplier: number = 1.0,
): { foodIncome: number; civDemand: number; militaryDemand: number; surplus: number; maxSustainableMilitary: number } {
  const aiCities = cities.filter(c => c.ownerId === aiPlayerId);
  let foodIncome = 0;
  let civDemand = 0;
  for (const c of aiCities) {
    foodIncome += computeCityProductionRate(c, tiles, territory, harvestMultiplier).food;
    civDemand += Math.ceil(c.population * CIV_FOOD_PER_POP);
  }
  const aiUnits = units.filter(u => u.ownerId === aiPlayerId && u.hp > 0);
  let militaryDemand = 0;
  for (const u of aiUnits) {
    const stats = u.armsLevel === 2 ? UNIT_L2_STATS[u.type] : UNIT_BASE_STATS[u.type];
    militaryDemand += stats.foodUpkeep ?? 0;
  }
  const surplus = foodIncome - civDemand - militaryDemand;
  const foodForMilitary = Math.max(0, foodIncome - civDemand);
  const maxSustainableMilitary = Math.floor(foodForMilitary / AVG_MILITARY_FOOD_PER_UNIT);
  return { foodIncome, civDemand, militaryDemand, surplus, maxSustainableMilitary };
}

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

  const foodStats = estimateAiFoodSurplus(aiPlayerId, cities, units, tiles, territory);
  const militaryCount = aiUnits.filter(u => u.type !== 'builder').length;

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

    const upgradeOrder = (params.factoryUpgradePriority ?? 0.6) >= 0.5 ? ['factory', 'barracks', 'farm'] : ['barracks', 'factory', 'farm'];
    for (const kind of upgradeOrder) {
      if (kind === 'factory' && goldBudget >= FACTORY_UPGRADE_COST && factoryToUpgrade && (city.storage.iron ?? 0) >= 5) {
        actions.upgrades.push({ cityId: city.id, buildingQ: factoryToUpgrade.q, buildingR: factoryToUpgrade.r, type: 'factory' });
        goldBudget -= FACTORY_UPGRADE_COST;
        break;
      }
      if (kind === 'barracks' && goldBudget >= BARACKS_UPGRADE_COST && barracksToUpgrade) {
        actions.upgrades.push({ cityId: city.id, buildingQ: barracksToUpgrade.q, buildingR: barracksToUpgrade.r, type: 'barracks' });
        goldBudget -= BARACKS_UPGRADE_COST;
        break;
      }
      if (kind === 'farm' && goldBudget >= FARM_UPGRADE_COST && farmToUpgrade) {
        actions.upgrades.push({ cityId: city.id, buildingQ: farmToUpgrade.q, buildingR: farmToUpgrade.r, type: 'farm' });
        goldBudget -= FARM_UPGRADE_COST;
        break;
      }
    }

    let toBuild: BuildingType | null = null;
    const quarrySpot = findDepositTile(city, territory, tiles, cities, 'quarry');
    const mineSpot = findDepositTile(city, territory, tiles, cities, 'mine');
    const hasMarket = city.buildings.some(b => b.type === 'market');
    const hasGoldMine = city.buildings.some(b => b.type === 'gold_mine');
    const goldMineSpot = findGoldMineTile(city, territory, tiles, cities);
    const ironForGoldMine = (BUILDING_IRON_COSTS.gold_mine ?? 0);

    const farmPriority = params.farmPriorityThreshold ?? 0;
    const foodTight = farmPriority > 0 && foodStats.surplus < farmPriority;
    if (foodTight && farmCount < 4 && goldBudget >= BUILDING_COSTS.farm) {
      toBuild = 'farm';
    }

    if (!toBuild) {
      const farmFirst = (params.farmFirstBias ?? 0) >= 0.5;
      if (farmFirst && farmCount < 2 && goldBudget >= BUILDING_COSTS.farm) {
        toBuild = 'farm';
      } else if (!hasBarracks && goldBudget >= BUILDING_COSTS.barracks) {
      toBuild = 'barracks';
    } else if (!farmFirst && farmCount < 2 && goldBudget >= BUILDING_COSTS.farm) {
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

    // Recruit military: food-aware gating + sustainable army cap to avoid starvation lock in headless sims
    const barracks = city.buildings.find(b => b.type === 'barracks');
    const barracksLvl = barracks ? (barracks.level ?? 1) : 1;
    const hasGunsL2 = (city.storage.gunsL2 ?? 0) >= 1;
    const foodThreshold = params.foodBufferThreshold ?? 10;
    const sustainableArmyCap = Math.max(0, Math.floor(foodStats.maxSustainableMilitary * (params.sustainableMilitaryMultiplier ?? 1)));
    if (hasBarracks && city.population > 3) {
      const goldBasedMax = goldBudget > params.recruitGoldThreshold ? params.maxRecruitsWhenRich : params.maxRecruitsWhenPoor;
      let maxRecruits = goldBasedMax;
      if (foodStats.surplus < 0) maxRecruits = 0;
      else if (militaryCount >= sustainableArmyCap) maxRecruits = 0;
      else if (foodStats.surplus < foodThreshold) maxRecruits = Math.min(maxRecruits, 1);
      maxRecruits = Math.min(maxRecruits, Math.max(0, sustainableArmyCap - militaryCount));

      const unitChoices: UnitType[] = ['infantry', 'infantry', 'cavalry', 'ranged'];
      const siegeChoices: UnitType[] = ['trebuchet', 'battering_ram'];
      const allowSiege = foodStats.surplus >= foodThreshold; // high-upkeep units only when food buffer is safe
      for (let i = 0; i < maxRecruits; i++) {
        const useSiege = allowSiege && Math.random() < params.siegeChance;
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

  // Scout: chance per cycle when gold allows (scoutChance)
  if (enemyCities.length > 0 && goldBudget >= SCOUT_MISSION_COST && Math.random() < (params.scoutChance ?? 1)) {
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
    if (militaryHere.length > 0 && goldBudget >= VILLAGE_INCORPORATE_COST && Math.random() < (params.incorporateVillageChance ?? 1)) {
      actions.incorporateVillages.push({ q: tile.q, r: tile.r });
      goldBudget -= VILLAGE_INCORPORATE_COST;
    }
  }

  // Move idle units toward best enemy target: prefer weakest city (fewest defenders + low pop)
  if (enemyCities.length > 0) {
    const movableUnits = aiUnits.filter(u => u.hp > 0 && u.type !== 'builder' && u.status !== 'fighting');
    const enemyUnitCount = (eq: number, er: number): number =>
      units.filter(u => u.ownerId !== aiPlayerId && u.hp > 0 && hexDistance(u.q, u.r, eq, er) <= 2).length;
    const popW = params.targetPopWeight ?? 1;
    const defW = params.targetDefenderWeight;
    const score = (ec: City): number => popW * ec.population + enemyUnitCount(ec.q, ec.r) * defW;
    const sortedEnemies = [...enemyCities].sort((a, b) => score(a) - score(b));
    const primaryTarget = sortedEnemies[0];
    const ratio = Math.max(0.1, Math.min(1, params.nearestTargetDistanceRatio));
    for (const unit of movableUnits) {
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
