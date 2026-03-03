import {
  City, Unit, Player, Tile, GameNotification, TerritoryInfo, CityBuilding, Hero,
  Biome, TERRAIN_FOOD_YIELD, BUILDING_PRODUCTION, BUILDING_JOBS, CITY_CENTER_STORAGE,
  MARKET_GOLD_PER_CYCLE, POP_BIRTH_RATE, POP_NATURAL_DEATHS,   POP_CARRYING_CAPACITY_PER_FOOD, POP_EXPECTED_K_ALPHA, STARVATION_DEATHS,
  FACTORY_L2_IRON_PER_CYCLE, FACTORY_L2_ARMS_PER_CYCLE, UNEMPLOYMENT_MORALE_PENALTY, UNEMPLOYMENT_MORALE_PENALTY_CAP,
  FARM_L2_FOOD_PER_CYCLE, getBuildingJobs, PRODUCTIVITY_NORMALIZE,
  WORKERS_PER_LEVEL, MIN_STAFFING_RATIO, UNIT_BASE_STATS, UNIT_L2_STATS,
  generateId, tileKey, parseTileKey, hexDistance,
  FRONTIER_CYCLES, FRONTIER_MIGRATION_BONUS, MIGRATION_BASE_RATE,
} from '@/types/game';
import { computeTradeClusters, TradeCluster, getSupplyingClusterKey } from '@/lib/logistics';

/** Per-cycle production rates for a city (for UI display). */
export function computeCityProductionRate(
  city: City,
  tiles: Map<string, Tile>,
  territory: Map<string, TerritoryInfo>,
  harvestMultiplier: number = 1.0,
): { food: number; goods: number; guns: number; stone: number; iron: number } {
  const moraleMod = city.morale / 100;
  let terrainFood = 0;
  for (const [key, info] of territory) {
    if (info.cityId !== city.id) continue;
    const [q, r] = parseTileKey(key);
    const tile = tiles.get(tileKey(q, r));
    if (tile) terrainFood += TERRAIN_FOOD_YIELD[tile.biome as Biome];
  }
  let buildingFood = 0, buildingGoods = 0, buildingGuns = 0, buildingStone = 0, buildingIron = 0;
  for (const b of city.buildings) {
    if (b.type === 'city_center' || b.type === 'barracks' || b.type === 'academy') continue; // no production
    const prod = BUILDING_PRODUCTION[b.type];
    const lvl = (b as CityBuilding).level ?? 1;
    const jobs = getBuildingJobs(b);
    const assigned = (b as CityBuilding).assignedWorkers ?? 0;
    const staffRatio = jobs > 0 ? Math.min(1, assigned / jobs) : 0;
    const active = (b.type === 'quarry' || b.type === 'mine')
      ? (staffRatio > MIN_STAFFING_RATIO ? staffRatio : 0)
      : staffRatio;
    const farmFood = b.type === 'farm' && lvl >= 2
      ? FARM_L2_FOOD_PER_CYCLE * active
      : (prod.food ?? 0) * lvl * active;
    buildingFood += farmFood;
    buildingGoods += (prod.goods ?? 0) * lvl * active;
    buildingGuns += (prod.guns ?? 0) * lvl * active;
    buildingStone += (prod.stone ?? 0) * lvl * (b.type === 'quarry' ? active : active);
    buildingIron += (prod.iron ?? 0) * lvl * (b.type === 'mine' ? active : active);
  }
  return {
    food: Math.floor((terrainFood + buildingFood) * moraleMod * harvestMultiplier),
    goods: Math.floor(buildingGoods * moraleMod),
    guns: Math.round(buildingGuns * moraleMod),
    stone: Math.floor(buildingStone * moraleMod),
    iron: Math.floor(buildingIron * moraleMod),
  };
}

/** Per-cycle income statement for a cluster (for supply map UI). */
export interface ClusterIncomeStatement {
  food: { income: number; expense: number; net: number };
  goods: { income: number; expense: number; net: number };
  iron: { income: number; expense: number; net: number };
  arms: { income: number; expense: number; net: number };
  armsL2: { income: number; expense: number; net: number };
  stone: { income: number; expense: number; net: number };
  foodSurplus: boolean;
}

export function computeClusterIncomeStatement(
  cluster: TradeCluster,
  cities: City[],
  units: Unit[],
  tiles: Map<string, Tile>,
  territory: Map<string, TerritoryInfo>,
  heroes: Hero[],
  playerId: string,
  harvestMultiplier: number = 1.0,
): ClusterIncomeStatement {
  const clusterCities = cluster.cities;
  const clusterKey = cluster.cityIds.join(',');

  const foodIncome = clusterCities.reduce((s, c) => {
    return s + computeCityProductionRate(c, tiles, territory, harvestMultiplier).food;
  }, 0);
  const ironIncome = clusterCities.reduce((s, c) => {
    return s + computeCityProductionRate(c, tiles, territory, harvestMultiplier).iron;
  }, 0);
  const armsIncome = clusterCities.reduce((s, c) => {
    return s + computeCityProductionRate(c, tiles, territory, harvestMultiplier).guns;
  }, 0);
  const stoneIncome = clusterCities.reduce((s, c) => {
    return s + computeCityProductionRate(c, tiles, territory, harvestMultiplier).stone;
  }, 0);

  const foodExpenseCiv = Math.ceil(clusterCities.reduce((s, c) => s + c.population, 0) * 0.25);

  const clusterUnits = units.filter(u => {
    if (u.hp <= 0) return false;
    if (u.ownerId !== playerId) return false;
    const key = getSupplyingClusterKey(u, [cluster], tiles, units, playerId);
    return key === clusterKey;
  });

  let foodExpenseMil = 0;
  let armsExpense = 0;
  let armsL2Expense = 0;
  for (const u of clusterUnits) {
    const stats = u.armsLevel === 2 ? UNIT_L2_STATS[u.type] : UNIT_BASE_STATS[u.type];
    let foodUp = stats.foodUpkeep;
    const heroAtUnit = heroes.find(h => h.q === u.q && h.r === u.r && h.ownerId === u.ownerId && h.type === 'logistician');
    if (heroAtUnit) foodUp = Math.ceil(foodUp * 0.5);
    foodExpenseMil += foodUp;
    armsExpense += stats.gunUpkeep ?? 0;
    armsL2Expense += (stats as { gunL2Upkeep?: number }).gunL2Upkeep ?? 0;
  }

  const foodExpense = foodExpenseCiv + foodExpenseMil;

  const l2FactoryCount = clusterCities.filter(c =>
    c.buildings.some(b => b.type === 'factory' && ((b as CityBuilding).level ?? 1) >= 2)
  ).length;
  const ironExpense = l2FactoryCount * FACTORY_L2_IRON_PER_CYCLE;

  const ironUsed = Math.min(ironIncome, ironExpense);
  const armsL2Income = Math.floor(ironUsed * (FACTORY_L2_ARMS_PER_CYCLE / FACTORY_L2_IRON_PER_CYCLE));

  return {
    food: { income: foodIncome, expense: foodExpense, net: foodIncome - foodExpense },
    goods: { income: 0, expense: 0, net: 0 },
    iron: { income: ironIncome, expense: ironExpense, net: ironIncome - ironExpense },
    arms: { income: armsIncome, expense: armsExpense, net: armsIncome - armsExpense },
    armsL2: { income: armsL2Income, expense: armsL2Expense, net: armsL2Income - armsL2Expense },
    stone: { income: stoneIncome, expense: 0, net: stoneIncome },
    foodSurplus: foodIncome >= foodExpense,
  };
}

// ─── Turn Result ───────────────────────────────────────────────────

export interface TurnResult {
  cities: City[];
  units: Unit[];
  players: Player[];
  notifications: GameNotification[];
  /** Precomputed trade clusters (cities, tiles, units, territory); callers may reuse for upkeep. */
  clusters?: Map<string, TradeCluster[]>;
}

// ─── Process Economy Cycle ──────────────────────────────────────────
// Military upkeep is now handled separately by upkeepTick in military.ts.
// This function only handles civilian economy: production, civilian
// consumption, tax, and morale.

export function processEconomyTurn(
  cities: City[],
  units: Unit[],
  players: Player[],
  tiles: Map<string, Tile>,
  territory: Map<string, TerritoryInfo>,
  turn: number,
  harvestMultiplier: number = 1.0,
): TurnResult {
  const newCities = cities.map(c => deepCloneCity(c));
  const newUnits = units.map(u => ({ ...u }));
  const newPlayers = players.map(p => ({ ...p }));
  const notifications: GameNotification[] = [];

  const notify = (msg: string, type: GameNotification['type']) => {
    notifications.push({ id: generateId('notif'), turn, message: msg, type });
  };

  const clusters = computeTradeClusters(newCities, tiles, units, territory);

  autoAssignWorkersPhase(newCities);
  const foodProduced = productionPhase(newCities, tiles, territory, notify, harvestMultiplier);
  clusterResourcePhase(newCities, clusters, newPlayers, notify);
  consumptionPhase(newCities, newPlayers, clusters, notify);
  populationGrowthPhase(newCities, foodProduced, clusters, notify);
  migrationPhase(newCities, newPlayers, turn, notify, foodProduced);
  economicsPhase(newCities, newPlayers, notify);
  moraleDrift(newCities, newPlayers);

  return { cities: newCities, units: newUnits, players: newPlayers, notifications, clusters };
}

// ─── Phase 0: Auto-assign workers ───────────────────────────────────
// Fill open job slots with unassigned population (by building order).

function autoAssignWorkersPhase(cities: City[]) {
  for (const city of cities) {
    let available = city.population - city.buildings.reduce((s, b) => s + ((b as CityBuilding).assignedWorkers ?? 0), 0);
    if (available <= 0) continue;
    for (const b of city.buildings) {
      const jobs = getBuildingJobs(b);
      if (jobs <= 0) continue;
      const assigned = (b as CityBuilding).assignedWorkers ?? 0;
      const open = Math.max(0, jobs - assigned);
      const toAdd = Math.min(open, available);
      if (toAdd > 0) {
        (b as CityBuilding).assignedWorkers = assigned + toAdd;
        available -= toAdd;
        if (available <= 0) break;
      }
    }
  }
}

// ─── Phase 1: Production ───────────────────────────────────────────

/**
 * Returns a map of cityId → food produced this cycle (before consumption).
 */
function productionPhase(
  cities: City[],
  tiles: Map<string, Tile>,
  territory: Map<string, TerritoryInfo>,
  notify: (msg: string, type: GameNotification['type']) => void,
  harvestMultiplier: number = 1.0,
): Record<string, number> {
  const foodProduced: Record<string, number> = {};

  for (const city of cities) {
    const moraleMod = city.morale / 100;

    let terrainFood = 0;
    for (const [key, info] of territory) {
      if (info.cityId !== city.id) continue;
      const [q, r] = parseTileKey(key);
      const tile = tiles.get(tileKey(q, r));
      if (tile) {
        terrainFood += TERRAIN_FOOD_YIELD[tile.biome as Biome];
      }
    }

    let buildingFood = 0;
    let buildingGuns = 0;
    let buildingStone = 0;
    let buildingIron = 0;
    for (const b of city.buildings) {
      if (b.type === 'city_center' || b.type === 'barracks' || b.type === 'academy') continue; // no production
      const prod = BUILDING_PRODUCTION[b.type];
      const lvl = (b as CityBuilding).level ?? 1;
      const jobs = getBuildingJobs(b);
      const assigned = (b as CityBuilding).assignedWorkers ?? 0;
      const staffRatio = jobs > 0 ? Math.min(1, assigned / jobs) : 0;
      const active = (b.type === 'quarry' || b.type === 'mine')
        ? (staffRatio > MIN_STAFFING_RATIO ? staffRatio : 0)
        : staffRatio;
      const farmFood = b.type === 'farm' && lvl >= 2
        ? FARM_L2_FOOD_PER_CYCLE * active
        : (prod.food ?? 0) * lvl * active;
      buildingFood += farmFood;
      buildingGuns += (prod.guns ?? 0) * lvl * active;
      buildingStone += (prod.stone ?? 0) * lvl * (b.type === 'quarry' ? active : active);
      buildingIron += (prod.iron ?? 0) * lvl * (b.type === 'mine' ? active : active);
    }

    // L2 factory iron consumption is handled at cluster level in clusterResourcePhase
    // (iron/stone flow along roads within clusters)
    // Storage cap comes from city center (1 per city)
    city.storageCap = { ...CITY_CENTER_STORAGE };

    // Apply weather harvest multiplier to food production (farms + terrain)
    const totalFood = Math.floor((terrainFood + buildingFood) * moraleMod * harvestMultiplier);
    const totalGuns = Math.round(buildingGuns * moraleMod); // round so 1 factory at 80% morale still produces 1
    const totalStone = Math.floor(buildingStone * moraleMod);
    const totalIronRaw = Math.floor(buildingIron * moraleMod);

    foodProduced[city.id] = totalFood;

    city.storage.food = Math.min(city.storageCap.food, city.storage.food + totalFood);
    city.storage.guns = Math.min(city.storageCap.guns, city.storage.guns + totalGuns);
    city.storage.gunsL2 = Math.min(city.storageCap.gunsL2, city.storage.gunsL2); // L2 added in clusterResourcePhase
    city.storage.iron = Math.min(city.storageCap.iron, city.storage.iron + totalIronRaw);
    city.storage.stone = Math.min(city.storageCap.stone, city.storage.stone + totalStone);

    const extras: string[] = [];
    if (totalStone > 0) extras.push(`+${totalStone} stone`);
    if (totalIronRaw > 0) extras.push(`+${totalIronRaw} iron`);
    if (totalFood > 0 || totalGuns > 0 || extras.length > 0) {
      const parts: string[] = [];
      if (totalFood > 0) parts.push(`+${totalFood} food`);
      if (totalGuns > 0) parts.push(`+${totalGuns} guns`);
      parts.push(...extras);
      notify(`${city.name}: ${parts.join(', ')}`, 'info');
    }
  }

  return foodProduced;
}

// ─── Phase 1b: Cluster Resource Allocation (iron/stone flow along roads) ───
// Within each trade cluster, iron and stone are pooled and allocated where needed.
// L2 factories consume iron from the cluster pool and produce gunsL2.
function clusterResourcePhase(
  _cities: City[],
  clusters: Map<string, TradeCluster[]>,
  players: Player[],
  notify: (msg: string, type: GameNotification['type']) => void,
) {
  const humanId = players.find(p => p.isHuman)?.id;
  for (const [playerId, playerClusters] of clusters) {
    for (const cluster of playerClusters) {
      const clusterCities = cluster.cities;
      if (clusterCities.length === 0) continue;

      const totalIron = clusterCities.reduce((s, c) => s + (c.storage.iron ?? 0), 0);

      // L2 factories: consume iron from cluster pool, produce gunsL2
      const l2Cities = clusterCities.filter(c =>
        c.buildings.some(b => b.type === 'factory' && ((b as CityBuilding).level ?? 1) >= 2)
      );
      const l2Count = l2Cities.length;
      const ironNeeded = l2Count * FACTORY_L2_IRON_PER_CYCLE;
      const ironUsed = Math.min(totalIron, ironNeeded);
      const gunsL2Produced = Math.floor(ironUsed * (FACTORY_L2_ARMS_PER_CYCLE / FACTORY_L2_IRON_PER_CYCLE));
      const gunsPerCity = l2Count > 0 ? Math.floor(gunsL2Produced / l2Count) : 0;

      for (const city of l2Cities) {
        city.storage.gunsL2 = Math.min(
          city.storageCap.gunsL2,
          city.storage.gunsL2 + gunsPerCity
        );
      }
      if (gunsL2Produced > 0 && playerId === humanId) {
        notify(`Cluster: +${gunsL2Produced} L2 arms (from ${ironUsed} iron)`, 'info');
      }

      // Deduct iron from cluster (take from cities that have it)
      let toDeduct = ironUsed;
      for (const city of clusterCities) {
        if (toDeduct <= 0) break;
        const avail = city.storage.iron ?? 0;
        const take = Math.min(avail, toDeduct);
        if (take > 0) {
          city.storage.iron = Math.max(0, avail - take);
          toDeduct -= take;
        }
      }
    }
  }
}

// ─── Phase 2: Civilian Consumption ──────────────────────────────────

function consumptionPhase(
  cities: City[],
  players: Player[],
  clusters: Map<string, TradeCluster[]>,
  notify: (msg: string, type: GameNotification['type']) => void,
) {
  for (const player of players) {
    const playerClusters = clusters.get(player.id) ?? [];
    for (const cluster of playerClusters) {
      const clusterCities = cluster.cities;
      if (clusterCities.length === 0) continue;

      const totalFood = clusterCities.reduce((sum, c) => sum + c.storage.food, 0);
      const totalDemand = Math.ceil(clusterCities.reduce((sum, c) => sum + c.population, 0) * 0.25);

      if (totalFood >= totalDemand) {
        deductFromPlayerCities(clusterCities, 'food', totalDemand);
        for (const city of clusterCities) {
          city.morale = Math.min(100, city.morale + 3);
        }
      } else {
        for (const city of clusterCities) city.storage.food = 0;
        const unfed = totalDemand - totalFood;
        for (const city of clusterCities) {
          const cityShare = totalDemand > 0 ? city.population / totalDemand : 0;
          const cityUnfed = Math.ceil(unfed * cityShare);
          const deaths = Math.ceil(cityUnfed / 2);
          city.population = Math.max(1, city.population - deaths);
          city.morale = Math.max(0, city.morale - 15);
          if (player.isHuman && deaths > 0) {
            notify(`Starvation in ${city.name}! -${deaths} pop`, 'danger');
          }
        }
      }

    }
  }
}

function deductFromPlayerCities(cities: City[], resource: 'food' | 'goods' | 'guns', amount: number) {
  let remaining = amount;
  for (const city of cities) {
    if (remaining <= 0) break;
    const deduct = Math.min(city.storage[resource], remaining);
    city.storage[resource] -= deduct;
    remaining -= deduct;
  }
}

// ─── Population Growth (Logistic Model + Expected K) ──────────────
//
// Carrying capacity K is "expected" (smoothed over ~2–4 cycles). Births are gated:
// when storage.food <= 0 (starving) we set births = 0 so population never grows
// while starving; otherwise births = floor(r * P * (1 - P/K)).
//
//   births = 0 if storage.food <= 0, else floor(r * P * (1 - P/K))
//   deaths = natural deaths + starvation deaths (when storage.food <= 0)
//   netGrowth = births - deaths
//
// Expected K: EMA of actual K (production-based). Initialized from cluster total
// production when unset (per-city share of cluster carrying capacity).

function populationGrowthPhase(
  cities: City[],
  foodProduced: Record<string, number>,
  clusters: Map<string, TradeCluster[]>,
  notify: (msg: string, type: GameNotification['type']) => void,
) {
  for (const city of cities) {
    const produced = foodProduced[city.id] ?? 0;
    const P = city.population;
    const K_actual = Math.max(10, produced * POP_CARRYING_CAPACITY_PER_FOOD);

    // Initialize or update expected carrying capacity (smoothed; ~2–4 cycle lag)
    let K_expected = city.expectedCarryingCapacity;
    if (K_expected == null) {
      // Base initial expected K on cluster: total cluster production → cluster K → per-city share
      const playerClusters = clusters.get(city.ownerId) ?? [];
      const cluster = playerClusters.find(cl => cl.cityIds.includes(city.id));
      if (cluster && cluster.cities.length > 0) {
        const clusterFood = cluster.cityIds.reduce((s, cid) => s + (foodProduced[cid] ?? 0), 0);
        const K_cluster = Math.max(10, clusterFood * POP_CARRYING_CAPACITY_PER_FOOD);
        K_expected = Math.max(10, Math.floor(K_cluster / cluster.cities.length));
      } else {
        K_expected = K_actual;
      }
    } else {
      K_expected = Math.max(10, Math.floor((1 - POP_EXPECTED_K_ALPHA) * K_expected + POP_EXPECTED_K_ALPHA * K_actual));
    }
    city.expectedCarryingCapacity = K_expected;
    const K = K_expected;

    // Natural deaths + starvation when no food in storage
    const naturalDeaths = POP_NATURAL_DEATHS;
    const starvationDeaths = city.storage.food <= 0 ? STARVATION_DEATHS : 0;
    const deaths = naturalDeaths + starvationDeaths;

    // Births use expected K; when starving (no grain in storage) births = 0 so pop never grows into starvation.
    // Taper births when food buffer is low (not only when storage hits zero) to prevent early boom-bust collapse.
    let births = 0;
    if (P > 0 && K > 0 && city.storage.food > 0) {
      let rawBirths = Math.max(0, Math.floor(POP_BIRTH_RATE * P * (1 - P / K)));
      const civDemandCity = Math.ceil(P * 0.25);
      if (civDemandCity > 0) {
        const bufferThreshold = 2 * civDemandCity;
        if (city.storage.food < bufferThreshold) {
          const scale = city.storage.food / bufferThreshold;
          rawBirths = Math.floor(rawBirths * scale);
        }
      }
      births = rawBirths;
    }

    const netGrowth = births - deaths;
    city.lastNaturalGrowth = netGrowth;

    if (netGrowth > 0) {
      city.population += netGrowth;
      const deathNote = starvationDeaths > 0 ? ` (${naturalDeaths} natural, ${starvationDeaths} starvation)` : ` (${deaths} died)`;
      notify(`${city.name}: +${netGrowth} pop (${births} born${deathNote})`, 'success');
    } else if (netGrowth < 0) {
      city.population = Math.max(1, city.population + netGrowth);
      const deathNote = starvationDeaths > 0 ? ` (${naturalDeaths} natural, ${starvationDeaths} starvation)` : ` (${deaths} died)`;
      if (netGrowth < -1) {
        notify(`${city.name}: ${netGrowth} pop (${births} born${deathNote})`, 'warning');
      }
      if (starvationDeaths > 0) {
        notify(`${city.name}: starvation — no grain in storage`, 'warning');
      }
    }
  }
}

// ─── Migration Phase ───────────────────────────────────────────────
// Same-player only. Pops migrate from high-unemployment/low-morale cities
// to cities with open jobs and higher morale. Productivity (food produced) increases pull.

function migrationPhase(
  cities: City[],
  players: Player[],
  turn: number,
  notify: (msg: string, type: GameNotification['type']) => void,
  foodProduced: Record<string, number> = {},
) {
  const humanId = players.find(p => p.isHuman)?.id;

  for (const player of players) {
    const playerCities = cities.filter(c => c.ownerId === player.id);
    if (playerCities.length < 2) continue;

    // Reset migration tracking
    for (const c of playerCities) {
      c.lastMigration = 0;
      if (c.frontierCity != null && c.frontierCity > 0) {
        c.frontierCity = c.frontierCity - 1;
      }
    }

    // Compute jobs/employment per city
    const cityData = new Map<string, { totalJobs: number; employed: number }>();
    for (const city of playerCities) {
      let totalJobs = 0;
      let employed = 0;
      for (const b of city.buildings) {
        const jobs = getBuildingJobs(b);
        totalJobs += jobs;
        employed += (b as CityBuilding).assignedWorkers ?? 0;
      }
      cityData.set(city.id, { totalJobs, employed });
    }

    // Sources: high unemployment, low morale
    const sources = playerCities.filter(c => {
      const d = cityData.get(c.id)!;
      const unemployed = Math.max(0, c.population - d.employed);
      return unemployed > 0 && c.population > 1;
    });

    // Destinations: open jobs, higher morale
    const dests = playerCities.filter(c => {
      const d = cityData.get(c.id)!;
      const openJobs = Math.max(0, d.totalJobs - d.employed);
      return openJobs > 0;
    });

    if (sources.length === 0 || dests.length === 0) continue;

    // For each (source, dest) pair, compute migration flow
    let totalMigrants = 0;
    for (const source of sources) {
      const sd = cityData.get(source.id)!;
      const sourceUnemployed = Math.max(0, source.population - sd.employed);
      if (sourceUnemployed <= 0 || source.population <= 1) continue;

      const push = Math.max(0,
        (sourceUnemployed / Math.max(1, source.population)) *
        (1 - source.morale / 100) *
        (1 + 0.1 * Math.max(0, (player.taxRate - 0.3) * 10))
      );
      const pushPops = Math.min(sourceUnemployed, source.population - 1, Math.ceil(push * MIGRATION_BASE_RATE));

      for (const dest of dests) {
        if (source.id === dest.id) continue;
        const dd = cityData.get(dest.id)!;
        // Recompute employed from current buildings (we mutate them during migration)
        const currentEmployed = dest.buildings.reduce((s, b) => s + ((b as CityBuilding).assignedWorkers ?? 0), 0);
        const openJobs = Math.max(0, dd.totalJobs - currentEmployed);
        if (openJobs <= 0) continue;

        const frontierBonus = (dest.frontierCity ?? 0) > 0 ? FRONTIER_MIGRATION_BONUS : 0;
        const productivityFactor = Math.min(1, (foodProduced[dest.id] ?? 0) / PRODUCTIVITY_NORMALIZE);
        const pull = (dest.morale / 100) * (1 + productivityFactor) * (1 + frontierBonus);
        const dist = hexDistance(source.q, source.r, dest.q, dest.r);
        const distWeight = 1 / (1 + dist);
        const pullPops = Math.min(openJobs, Math.ceil(pull * distWeight * MIGRATION_BASE_RATE * 2));

        const migrants = Math.min(pushPops, pullPops, source.population - 1, openJobs);
        if (migrants > 0) {
          source.population -= migrants;
          dest.population += migrants;
          source.lastMigration = (source.lastMigration ?? 0) - migrants;
          dest.lastMigration = (dest.lastMigration ?? 0) + migrants;
          // Assign migrants to buildings (spread across buildings with open jobs)
          let toAssign = migrants;
          for (const b of dest.buildings) {
            if (toAssign <= 0) break;
            const jobs = getBuildingJobs(b);
            const current = (b as CityBuilding).assignedWorkers ?? 0;
            const room = Math.max(0, jobs - current);
            const add = Math.min(toAssign, room);
            if (add > 0) {
              (b as CityBuilding).assignedWorkers = current + add;
              toAssign -= add;
            }
          }
          totalMigrants += migrants;
          if (player.id === humanId) {
            notify(`${dest.name}: +${migrants} migrants from ${source.name}`, 'success');
          }
        }
      }
    }
  }
}

// ─── Phase 3: Economics ────────────────────────────────────────────
//
// Tax now scales directly with population:
//   baseTax = floor(population * taxRate)
//   wealthBonus = floor(population * wealthFactor * taxRate * 0.5) — goods enhance tax
//   marketGold = markets * MARKET_GOLD_PER_CYCLE * moraleMod
//   totalGold = baseTax + wealthBonus + marketGold

function economicsPhase(
  cities: City[],
  players: Player[],
  notify: (msg: string, type: GameNotification['type']) => void,
) {
  for (const player of players) {
    const playerCities = cities.filter(c => c.ownerId === player.id);
    let totalTax = 0;
    let totalMarketGold = 0;

    let totalGoldMineGold = 0;
    for (const city of playerCities) {
      // Base tax: scales directly with population
      const baseTax = Math.floor(city.population * player.taxRate);

      totalTax += baseTax;

      // Market and gold_mine building gold income (scaled by staffing)
      const moraleMod = city.morale / 100;
      for (const b of city.buildings) {
        if (b.type === 'market') {
          const jobs = BUILDING_JOBS.market;
          const assigned = (b as CityBuilding).assignedWorkers ?? 0;
          const staffRatio = jobs > 0 ? Math.min(1, assigned / jobs) : 0;
          totalMarketGold += Math.floor(MARKET_GOLD_PER_CYCLE * moraleMod * staffRatio);
        } else if (b.type === 'gold_mine') {
          const prod = BUILDING_PRODUCTION.gold_mine;
          const goldPerCycle = prod.gold ?? 0;
          const lvl = (b as CityBuilding).level ?? 1;
          const jobs = BUILDING_JOBS.gold_mine ?? 2;
          const assigned = (b as CityBuilding).assignedWorkers ?? 0;
          const staffRatio = jobs > 0 ? Math.min(1, assigned / jobs) : 0;
          const active = staffRatio > MIN_STAFFING_RATIO ? staffRatio : 0;
          totalGoldMineGold += Math.floor(goldPerCycle * lvl * moraleMod * active);
        }
      }
    }

    const totalGold = totalTax + totalMarketGold + totalGoldMineGold;
    player.gold += totalGold;
    if (totalGold > 0 && player.isHuman) {
      const parts: string[] = [];
      if (totalTax > 0) parts.push(`${totalTax} tax`);
      if (totalMarketGold > 0) parts.push(`${totalMarketGold} markets`);
      if (totalGoldMineGold > 0) parts.push(`${totalGoldMineGold} gold mines`);
      notify(`Gold collected: +${totalGold} (${parts.join(', ')})`, 'info');
    }
  }
}

// ─── Morale Drift ──────────────────────────────────────────────────

function moraleDrift(cities: City[], players: Player[]) {
  for (const city of cities) {
    const player = players.find(p => p.id === city.ownerId);
    if (!player) continue;

    if (player.taxRate > 0.3) {
      city.morale -= Math.floor((player.taxRate - 0.3) * 15);
    }

    // Unemployment penalty: unassigned population hurts morale (open jobs don't affect it); capped so it doesn't dominate
    const employed = city.buildings.reduce((s, b) => s + ((b as CityBuilding).assignedWorkers ?? 0), 0);
    const unemployed = Math.max(0, city.population - employed);
    const unemploymentRate = city.population > 0 ? unemployed / city.population : 0;
    const penalty = Math.min(UNEMPLOYMENT_MORALE_PENALTY_CAP, Math.floor(unemploymentRate * UNEMPLOYMENT_MORALE_PENALTY));
    city.morale -= penalty;

    city.morale = Math.max(0, Math.min(100, city.morale));
  }
}

// ─── Helpers ───────────────────────────────────────────────────────

function deepCloneCity(c: City): City {
  return {
    ...c,
    storage: { ...c.storage },
    storageCap: { ...c.storageCap },
    buildings: c.buildings.map(b => ({ ...b })),
  };
}
