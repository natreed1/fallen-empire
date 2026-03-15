import {
  City, Unit, Player, Tile, TerritoryInfo, Hero, WallSection,
  BuildingType, UnitType, BUILDING_COSTS, UNIT_COSTS, UNIT_L2_COSTS, UNIT_L3_COSTS, getUnitStats,
  BARACKS_UPGRADE_COST, FACTORY_UPGRADE_COST, FARM_UPGRADE_COST,
  hexDistance, hexNeighbors, tileKey, generateId, getHexRing,
  STARTING_CITY_TEMPLATE, HERO_NAMES, CITY_CENTER_STORAGE,
  BUILDING_IRON_COSTS, SCOUT_MISSION_COST, VILLAGE_INCORPORATE_COST, DEFENDER_IRON_COST, HERO_BASE_HP,
  WALL_SECTION_STONE_COST, WALL_SECTION_HP,
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
  armsLevel?: 1 | 2 | 3;
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

export interface AiWallRingAction {
  cityId: string;
  ring: 1 | 2;
}

export interface AiActions {
  builds: AiBuildAction[];
  upgrades: AiUpgradeAction[];
  recruits: AiRecruitAction[];
  moveTargets: AiMoveAction[];
  scouts: AiScoutAction[];
  incorporateVillages: AiIncorporateAction[];
  buildWallRings: AiWallRingAction[];
}

// ─── Evolvable AI Parameters (for self-improvement / training) ───────
// Mutate these and run bot-vs-bot; keep params that win more.
// Canonical key list and mutation ranges: see aiParamsSchema.ts.

/** Target distribution for unit level mix (L1/L2/L3); must sum to 1. */
export interface MilitaryLevelMix {
  L1: number;
  L2: number;
  L3: number;
}

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
  /** When building mines/quarries/gold_mine or recruiting siege, multiply builder recruit chance by (1 + this). Builders are required for out-of-territory mines and for field trebuchets (0–1). */
  builderRecruitForMinesAndSiege: number;
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
  /** When food surplus is above this, prefer building mine over quarry (0–30). */
  minePriorityThreshold: number;
  /** Rate at which to adopt L2 units when available (0–1). */
  l2AdoptionRate: number;
  /** Target share of ranged units in composition (0–1). */
  targetRangedShare: number;
  /** Target share of siege units in composition (0–1). */
  targetSiegeShare: number;
  /** Strength of composition correction toward targets (0–1). */
  compositionCorrectionStrength: number;
  /** Share of assault wing in formation (0–1). */
  assaultWingShare: number;
  /** Share of screen wing in formation (0–1). */
  screenWingShare: number;
  /** Max distance to chase fleeing units (hexes). */
  maxChaseDistance: number;
  /** Target dispersion of units (0–1). */
  targetDispersion: number;
  /** Priority for defending villages (0–1). */
  villageDefensePriority: number;
  /** Priority for recapturing villages (0–1). */
  villageRecapturePriority: number;
  /** Priority for cluster interdiction (0–1). */
  clusterInterdictionPriority: number;
  /** Share of forces committed to cluster isolation (0–1). */
  clusterIsolationCommitShare: number;
  /** Duration to maintain cluster isolation (cycles). */
  clusterIsolationDuration: number;
  /** Share of melee on frontline (0–1). */
  frontlineMeleeShare: number;
  /** Preferred distance of backline ranged (hexes). */
  backlineRangedDistance: number;
  /** Preferred distance of siege from backline (hexes). */
  siegeBacklineDistance: number;
  /** Share of cavalry on flanks (0–1). */
  flankCavalryShare: number;
  /** Formation cohesion factor (0–1). */
  formationCohesion: number;
  /** Weight for acquiring L3 units (0–2). */
  l3AcquisitionWeight: number;
  /** Target iron per unit for L3 acquisition. */
  l3IronPerUnitTarget: number;
  /** Target stone per unit for L2 acquisition. */
  l2StonePerUnitTarget: number;
  /** Target mix of military levels (L1/L2/L3); normalized to sum to 1. */
  militaryLevelMixTarget: MilitaryLevelMix;
  /** Strength of correction toward military level mix target (0–1). */
  militaryLevelMixCorrectionStrength: number;
  /** Target hex coverage per city for defenders (0–1). */
  defenderCityHexCoverageTarget: number;
  /** Priority for assigning defenders to cities (0–1). */
  defenderAssignmentPriority: number;
  /** Target wall builds per city. */
  wallBuildPerCityTarget: number;
  /** Priority for building walls (0–1). */
  wallBuildPriority: number;
  /** Weight for wall–defender synergy (0–1). */
  wallToDefenderSynergyWeight: number;
  // ── Wall intelligence (closure, repair, ring target) ──
  /** Prioritize closing ring vs partial spread (0–1). */
  wallClosurePriority: number;
  /** Rebuild breached segments quickly (0–1). */
  wallRepairPriority: number;
  /** Preferred ring depth for key cities (1 or 2). */
  wallRingTarget: number;
  /** Value maintaining closed state (0–1). */
  wallClosureUptimeWeight: number;
  // ── Supply expansion ──
  /** Priority for supply expansion (0–1). */
  supplyExpansionPriority: number;
  /** Reward reducing front-to-city distance (0–2). */
  supplyAnchorDistanceWeight: number;
  /** Prioritize moves reducing starvation risk (0–2). */
  supplyStarvationRiskWeight: number;
  /** Value capturing/incorporating city/village as anchor (0–1). */
  supplyCityAcquisitionBias: number;
}

const DEFAULT_MILITARY_LEVEL_MIX: MilitaryLevelMix = { L1: 0.6, L2: 0.3, L3: 0.1 };

export const DEFAULT_AI_PARAMS: AiParams = {
  siegeChance: 0.22,
  recruitGoldThreshold: 400,
  maxRecruitsWhenRich: 3,
  maxRecruitsWhenPoor: 2,
  targetDefenderWeight: 3,
  nearestTargetDistanceRatio: 0.85,
  builderRecruitChance: 0.2,
  builderRecruitForMinesAndSiege: 0.5,
  foodBufferThreshold: 14,
  sustainableMilitaryMultiplier: 0.9,
  farmFirstBias: 0,
  farmPriorityThreshold: 15,
  factoryUpgradePriority: 0.6,
  scoutChance: 1,
  incorporateVillageChance: 1,
  targetPopWeight: 1,
  minePriorityThreshold: 12,
  l2AdoptionRate: 0.5,
  targetRangedShare: 0.25,
  targetSiegeShare: 0.15,
  compositionCorrectionStrength: 0.3,
  assaultWingShare: 0.6,
  screenWingShare: 0.2,
  maxChaseDistance: 8,
  targetDispersion: 0.5,
  villageDefensePriority: 0.5,
  villageRecapturePriority: 0.6,
  clusterInterdictionPriority: 0.4,
  clusterIsolationCommitShare: 0.3,
  clusterIsolationDuration: 5,
  frontlineMeleeShare: 0.6,
  backlineRangedDistance: 3,
  siegeBacklineDistance: 4,
  flankCavalryShare: 0.2,
  formationCohesion: 0.7,
  l3AcquisitionWeight: 1,
  l3IronPerUnitTarget: 15,
  l2StonePerUnitTarget: 8,
  militaryLevelMixTarget: { ...DEFAULT_MILITARY_LEVEL_MIX },
  militaryLevelMixCorrectionStrength: 0.4,
  defenderCityHexCoverageTarget: 0.5,
  defenderAssignmentPriority: 0.6,
  wallBuildPerCityTarget: 2,
  wallBuildPriority: 0.4,
  wallToDefenderSynergyWeight: 0.5,
  wallClosurePriority: 0.5,
  wallRepairPriority: 0.5,
  wallRingTarget: 1,
  wallClosureUptimeWeight: 0.3,
  supplyExpansionPriority: 0.4,
  supplyAnchorDistanceWeight: 0.5,
  supplyStarvationRiskWeight: 0.5,
  supplyCityAcquisitionBias: 0.3,
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
    const stats = getUnitStats(u);
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
  wallSections: WallSection[] = [],
): AiActions {
  const aiCities = cities.filter(c => c.ownerId === aiPlayerId);
  const aiPlayer = players.find(p => p.id === aiPlayerId);
  if (!aiPlayer || aiCities.length === 0) {
    return { builds: [], upgrades: [], recruits: [], moveTargets: [], scouts: [], incorporateVillages: [], buildWallRings: [] };
  }

  const actions: AiActions = { builds: [], upgrades: [], recruits: [], moveTargets: [], scouts: [], incorporateVillages: [], buildWallRings: [] };
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
    // Only prioritize farm when food is tight if we already have barracks, so we don't block building the first barracks
    if (foodTight && hasBarracks && farmCount < 4 && goldBudget >= BUILDING_COSTS.farm) {
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

    // Recruit military: hard execution-level food control (maxSustainableMilitary cap, foodBufferThreshold hard gate)
    const barracks = city.buildings.find(b => b.type === 'barracks');
    const barracksLvl = barracks ? (barracks.level ?? 1) : 1;
    const hasGunsL2 = (city.storage.gunsL2 ?? 0) >= 1;
    const foodThreshold = params.foodBufferThreshold ?? 10;
    // Hard cap: never exceed food-sustainable military; multiplier can only reduce cap (e.g. 0.8 = recruit up to 80%)
    const sustainableArmyCap = Math.max(0, Math.floor(foodStats.maxSustainableMilitary * Math.min(1, params.sustainableMilitaryMultiplier ?? 1)));
    if (hasBarracks && city.population > 3) {
      const goldBasedMax = goldBudget > params.recruitGoldThreshold ? params.maxRecruitsWhenRich : params.maxRecruitsWhenPoor;
      let maxRecruits = goldBasedMax;
      if (foodStats.surplus < 0) maxRecruits = 0;
      else if (foodStats.surplus < foodThreshold) maxRecruits = 0; // hard: no recruits when surplus below threshold
      else if (militaryCount >= sustainableArmyCap) maxRecruits = 0;
      maxRecruits = Math.min(maxRecruits, Math.max(0, sustainableArmyCap - militaryCount));

      const unitChoices: UnitType[] = barracksLvl >= 2
        ? ['infantry', 'infantry', 'cavalry', 'ranged', 'defender']
        : ['infantry', 'infantry', 'cavalry', 'ranged'];
      const siegeChoices: UnitType[] = ['trebuchet', 'battering_ram'];
      const allowSiege = foodStats.surplus >= foodThreshold; // hard: siege only when surplus >= threshold
      let stoneBudget = city.storage.stone ?? 0;
      let ironBudget = city.storage.iron ?? 0;
      for (let i = 0; i < maxRecruits; i++) {
        const useSiege = allowSiege && Math.random() < params.siegeChance;
        const pick = useSiege
          ? siegeChoices[Math.floor(Math.random() * siegeChoices.length)]
          : unitChoices[Math.floor(Math.random() * unitChoices.length)];
        let goldCost: number;
        let stoneCost = 0;
        let ironCost = 0;
        let armsLevel: 1 | 2 | 3 | undefined = undefined;
        if (pick === 'defender') {
          armsLevel = 3;
          goldCost = UNIT_L3_COSTS.defender.gold;
          ironCost = UNIT_L3_COSTS.defender.iron ?? 0;
        } else if (useSiege || pick === 'builder') {
          goldCost = UNIT_COSTS[pick].gold;
        } else {
          const canL3 = barracksLvl >= 2 && hasGunsL2 && goldBudget >= UNIT_L3_COSTS[pick].gold && ironBudget >= (UNIT_L3_COSTS[pick].iron ?? 0);
          const canL2 = barracksLvl >= 2 && hasGunsL2 && goldBudget >= UNIT_L2_COSTS[pick].gold && stoneBudget >= (UNIT_L2_COSTS[pick].stone ?? 0);
          const canL1 = goldBudget >= UNIT_COSTS[pick].gold;
          if (canL3 && (Math.random() < 0.35 || !canL2)) {
            armsLevel = 3;
            goldCost = UNIT_L3_COSTS[pick].gold;
            ironCost = UNIT_L3_COSTS[pick].iron ?? 0;
          } else if (canL2) {
            armsLevel = 2;
            goldCost = UNIT_L2_COSTS[pick].gold;
            stoneCost = UNIT_L2_COSTS[pick].stone ?? 0;
          } else if (canL1) {
            goldCost = UNIT_COSTS[pick].gold;
          } else {
            break;
          }
        }
        if (goldBudget >= goldCost && stoneBudget >= stoneCost && ironBudget >= ironCost) {
          actions.recruits.push({ cityId: city.id, type: pick, armsLevel });
          goldBudget -= goldCost;
          stoneBudget -= stoneCost;
          ironBudget -= ironCost;
        } else break;
      }
    }

    // Recruit civilian: builders (hard: only when surplus >= foodBufferThreshold)
    if (hasAcademy && city.population > 5 && foodStats.surplus >= foodThreshold) {
      const cost = UNIT_COSTS.builder;
      const goingForSiege = hasBarracks && (params.siegeChance ?? 0) >= 0.05;
      const needBuildersForMinesOrSiege =
        (toBuild === 'quarry' || toBuild === 'mine' || toBuild === 'gold_mine') || goingForSiege;
      const boost = needBuildersForMinesOrSiege ? (params.builderRecruitForMinesAndSiege ?? 0) : 0;
      const effectiveChance = Math.min(1, (params.builderRecruitChance ?? 0) * (1 + boost));
      if (goldBudget >= cost.gold && Math.random() < effectiveChance) {
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

  // Supply-aware expansion: avg distance from military to nearest friendly city (anchor)
  const avgDistToAnchor = aiCities.length > 0 && aiUnits.some(u => u.type !== 'builder')
    ? aiUnits
        .filter(u => u.type !== 'builder')
        .reduce((sum, u) => sum + Math.min(...aiCities.map(c => hexDistance(u.q, u.r, c.q, c.r))), 0) /
      Math.max(1, aiUnits.filter(u => u.type !== 'builder').length)
    : 0;
  const anchorDistW = Math.max(0, Math.min(2, params.supplyAnchorDistanceWeight ?? 0.5));
  const starvationW = Math.max(0, Math.min(2, params.supplyStarvationRiskWeight ?? 0.5));
  const cityBias = Math.max(0, Math.min(1, params.supplyCityAcquisitionBias ?? 0.3));
  const expansionPriority = Math.max(0, Math.min(1, params.supplyExpansionPriority ?? 0.4));

  const scoreVillageExpansion = (vq: number, vr: number): number => {
    const distToNearestCity = aiCities.length > 0 ? Math.min(...aiCities.map(c => hexDistance(vq, vr, c.q, c.r))) : 0;
    const currentAvg = avgDistToAnchor;
    const newCities = [...aiCities, { q: vq, r: vr } as City];
    const newAvg = aiUnits.filter(u => u.type !== 'builder').length > 0
      ? aiUnits
          .filter(u => u.type !== 'builder')
          .reduce((sum, u) => sum + Math.min(...newCities.map(c => hexDistance(u.q, u.r, c.q, c.r))), 0) /
        Math.max(1, aiUnits.filter(u => u.type !== 'builder').length)
      : currentAvg;
    const supplyGain = Math.max(0, (currentAvg - newAvg) * 0.1 * anchorDistW);
    const starvationRisk = (distToNearestCity / 24) * starvationW;
    return 1 + supplyGain - starvationRisk + cityBias;
  };

  // Incorporate villages: order by expansion score when supply expansion is used
  const villageTilesForIncorp: { q: number; r: number; score: number }[] = [];
  for (const tile of tiles.values()) {
    if (!tile.hasVillage) continue;
    if (cities.some(c => c.q === tile.q && c.r === tile.r)) continue;
    const militaryHere = aiUnits.filter(u => u.q === tile.q && u.r === tile.r && u.type !== 'builder');
    if (militaryHere.length > 0) villageTilesForIncorp.push({ q: tile.q, r: tile.r, score: scoreVillageExpansion(tile.q, tile.r) });
  }
  const sortedForIncorp = villageTilesForIncorp.sort((a, b) => b.score - a.score);
  for (const { q, r } of sortedForIncorp) {
    if (goldBudget < VILLAGE_INCORPORATE_COST) break;
    if (Math.random() < (params.incorporateVillageChance ?? 1)) {
      actions.incorporateVillages.push({ q, r });
      goldBudget -= VILLAGE_INCORPORATE_COST;
    }
  }

  // Move units toward villages we don't have military on (village expansion), ordered by expansion score
  const villagesNeedingUnits: { q: number; r: number; score: number }[] = [];
  for (const tile of tiles.values()) {
    if (!tile.hasVillage) continue;
    if (cities.some(c => c.q === tile.q && c.r === tile.r)) continue;
    const militaryHere = aiUnits.filter(u => u.q === tile.q && u.r === tile.r && u.type !== 'builder');
    if (militaryHere.length === 0) villagesNeedingUnits.push({ q: tile.q, r: tile.r, score: scoreVillageExpansion(tile.q, tile.r) });
  }
  villagesNeedingUnits.sort((a, b) => b.score - a.score);
  const movableForVillage = aiUnits.filter(u => u.hp > 0 && u.type !== 'builder' && u.status !== 'fighting');
  const assignedToVillage = new Set<string>();
  if (villagesNeedingUnits.length > 0 && goldBudget >= VILLAGE_INCORPORATE_COST && expansionPriority > 0) {
    const cap = expansionPriority >= 0.5 ? 3 : 2;
    for (const v of villagesNeedingUnits.slice(0, cap)) {
      const available = movableForVillage.filter(u => !assignedToVillage.has(u.id));
      if (available.length === 0) break;
      let nearest = available[0];
      let nearestDist = hexDistance(nearest.q, nearest.r, v.q, v.r);
      for (const u of available.slice(1)) {
        const d = hexDistance(u.q, u.r, v.q, v.r);
        if (d < nearestDist) { nearest = u; nearestDist = d; }
      }
      if (nearestDist > 1) {
        actions.moveTargets.push({ unitId: nearest.id, toQ: v.q, toR: v.r });
        assignedToVillage.add(nearest.id);
      }
    }
  }

  // Move units toward best enemy target (units not already sent to villages). Tie-breaker: prefer targets that become anchors (supplyCityAcquisitionBias).
  if (enemyCities.length > 0) {
    const movableUnits = aiUnits.filter(u => u.hp > 0 && u.type !== 'builder' && u.status !== 'fighting' && !assignedToVillage.has(u.id));
    const enemyUnitCount = (eq: number, er: number): number =>
      units.filter(u => u.ownerId !== aiPlayerId && u.hp > 0 && hexDistance(u.q, u.r, eq, er) <= 2).length;
    const popW = params.targetPopWeight ?? 1;
    const defW = params.targetDefenderWeight;
    const baseScore = (ec: City): number => popW * ec.population + enemyUnitCount(ec.q, ec.r) * defW;
    const distToOurs = (ec: City): number =>
      aiCities.length === 0 ? 999 : Math.min(...aiCities.map(c => hexDistance(ec.q, ec.r, c.q, c.r)));
    const score = (ec: City): number => baseScore(ec);
    // Primary: weakest first; tie-breaker: prefer closer (becomes anchor, supplyCityAcquisitionBias)
    const sortedEnemies = [...enemyCities].sort(
      (a, b) => (score(a) - score(b)) || (cityBias > 0 ? distToOurs(a) - distToOurs(b) : 0)
    );
    const primaryTarget = sortedEnemies[0];
    const ratio = Math.max(0.1, Math.min(1, params.nearestTargetDistanceRatio));
    const unitIdsTargeted = new Set(actions.moveTargets.map(mt => mt.unitId));
    for (const unit of movableUnits) {
      if (unitIdsTargeted.has(unit.id)) continue;
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

  // Wall closure: for each owned city, compute ring topology and optionally build ring (closure first, then repair/expand)
  const wallPriority = params.wallBuildPriority ?? 0;
  const closurePriority = params.wallClosurePriority ?? 0.5;
  const repairPriority = params.wallRepairPriority ?? 0.5;
  const ringTarget = Math.max(1, Math.min(2, Math.round(params.wallRingTarget ?? 1))) as 1 | 2;
  if (wallSections.length >= 0 && (wallPriority > 0 || closurePriority > 0 || repairPriority > 0)) {
    const ownerWallByKey = new Map<string, WallSection>();
    for (const w of wallSections) {
      if (w.ownerId === aiPlayerId) ownerWallByKey.set(tileKey(w.q, w.r), w);
    }
    for (const city of aiCities) {
      const stoneAvailable = city.storage.stone ?? 0;
      if (stoneAvailable < WALL_SECTION_STONE_COST) continue;
      const ring1 = getRingTopology(city, 1, tiles, ownerWallByKey);
      const ring2 = getRingTopology(city, 2, tiles, ownerWallByKey);
      // Prefer closing ring 1 first; if closed, consider ring 2 (or repair ring 1 if breached)
      const wantClosure = closurePriority >= 0.3;
      const wantRepair = repairPriority >= 0.3;
      let buildRing: 1 | 2 | null = null;
      if (!ring1.isClosed && ring1.missingCount > 0 && wantClosure) {
        const cost = ring1.missingCount * WALL_SECTION_STONE_COST;
        if (stoneAvailable >= cost) buildRing = 1;
      }
      if (!buildRing && ring1.isClosed && ring1.isBreached && wantRepair && ring1.missingCount > 0 && stoneAvailable >= ring1.missingCount * WALL_SECTION_STONE_COST) {
        buildRing = 1;
      }
      if (!buildRing && ring1.isClosed && ringTarget >= 2 && !ring2.isClosed && ring2.missingCount > 0 && wantClosure) {
        const cost = ring2.missingCount * WALL_SECTION_STONE_COST;
        if (stoneAvailable >= cost) buildRing = 2;
      }
      if (buildRing && Math.random() < wallPriority + (buildRing === 1 && !ring1.isClosed ? closurePriority : 0) * 0.5) {
        actions.buildWallRings.push({ cityId: city.id, ring: buildRing });
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
    hp: HERO_BASE_HP,
    maxHp: HERO_BASE_HP,
  };
}

// ─── Helpers ───────────────────────────────────────────────────────

/** Ring topology for one city at one ring depth: target perimeter, built/intact count, missing segments, closed, breached. */
function getRingTopology(
  city: City,
  ring: 1 | 2,
  tiles: Map<string, Tile>,
  ownerWallByKey: Map<string, WallSection>,
): { targetCount: number; builtCount: number; missingCount: number; isClosed: boolean; isBreached: boolean } {
  const ringHexes = getHexRing(city.q, city.r, ring);
  const validHexes: { q: number; r: number }[] = [];
  for (const { q, r } of ringHexes) {
    const tile = tiles.get(tileKey(q, r));
    if (!tile || tile.biome === 'water') continue;
    validHexes.push({ q, r });
  }
  const targetCount = validHexes.length;
  let builtCount = 0;
  let hasAnySection = false;
  let hasBroken = false;
  for (const { q, r } of validHexes) {
    const w = ownerWallByKey.get(tileKey(q, r));
    if (w) {
      hasAnySection = true;
      if ((w.hp ?? 0) > 0) builtCount++;
      else hasBroken = true;
    }
  }
  const missingCount = targetCount - builtCount;
  const isClosed = targetCount > 0 && builtCount === targetCount;
  const isBreached = hasAnySection && hasBroken;
  return { targetCount, builtCount, missingCount, isClosed, isBreached };
}

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
