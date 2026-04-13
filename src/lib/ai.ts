import {
  City, Unit, Player, Tile, TerritoryInfo, WallSection,
  BuildingType, UnitType, BUILDING_COSTS, UNIT_COSTS, UNIT_L2_COSTS, UNIT_L3_COSTS, getUnitStats,
  BARACKS_UPGRADE_COST, FACTORY_UPGRADE_COST, FARM_UPGRADE_COST,
  hexDistance, hexNeighbors, tileKey, generateId, getHexRing, parseTileKey,
  STARTING_CITY_TEMPLATE, CITY_CENTER_STORAGE,
  BUILDING_IRON_COSTS, SCOUT_MISSION_COST, VILLAGE_INCORPORATE_COST, DEFENDER_IRON_COST,
  WALL_SECTION_STONE_COST, WALL_SECTION_HP, WALL_BUILDER_STONE_PER_CYCLE_PER_SLOT,
  MapConfig,
  Commander, ScrollItem, ScrollAttachment, BuilderTask,
  SpecialRegionKind,
  ScrollRelicSite,
  isNavalUnitType,
} from '@/types/game';
import { computeCityProductionRate } from '@/lib/gameLoop';
import {
  appendStartingBarracksToCity,
  appendStartingAcademyToCity,
  isCapitalStartHex,
  clearVillageForCapitalTile,
} from '@/lib/kingdomSpawn';
import { countDefensesTaskSlots } from '@/lib/wallBuilding';

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
  type: 'barracks' | 'factory' | 'farm' | 'banana_farm';
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

export interface AiCommanderAssignAction {
  commanderId: string;
  assignment: { kind: 'field'; anchorUnitId: string } | { kind: 'city_defense'; cityId: string };
}

export interface AiScrollAttachAction {
  scrollId: string;
  carrierUnitId: string;
}

export interface AiUniversityTaskAction {
  cityId: string;
  task: 'expand_quarries' | 'expand_iron_mines' | 'expand_forestry' | 'city_defenses';
}

export interface AiStanceAction {
  unitId: string;
  stance: import('@/types/game').ArmyStance;
}

export interface AiRetreatAction {
  unitId: string;
}

export interface AiActions {
  builds: AiBuildAction[];
  upgrades: AiUpgradeAction[];
  recruits: AiRecruitAction[];
  moveTargets: AiMoveAction[];
  scouts: AiScoutAction[];
  incorporateVillages: AiIncorporateAction[];
  buildWallRings: AiWallRingAction[];
  commanderAssignments: AiCommanderAssignAction[];
  scrollAttachments: AiScrollAttachAction[];
  universityTasks: AiUniversityTaskAction[];
  stanceChanges: AiStanceAction[];
  retreats: AiRetreatAction[];
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

  // ── Contested zone ──
  /** Share of idle military to send toward contested zone hexes (0–1). */
  contestedZoneCommitShare: number;
  /** Min surplus military before diverting any to contested zone (0–20). */
  contestedZoneMinSurplusMilitary: number;

  // ── Commanders ──
  /** Chance to assign an idle city-defense commander to a field army per cycle (0–1). */
  commanderFieldAssignRate: number;
  /** Min army stack size before attaching a commander (1–10). */
  commanderMinArmySize: number;

  // ── Scrolls ──
  /** Priority for positioning units on special terrain for scroll discovery (0–1). */
  scrollTerrainPriority: number;
  /** Max units to divert toward scroll terrain per cycle (1–5). */
  scrollTerrainMaxDivert: number;

  // ── University / builder tasks ──
  /** Preference weight for iron mines over quarries when setting university task (0–1). */
  universityIronMinePref: number;
  /** When to switch university to city_defenses (0–1; higher = switch earlier). */
  universityCityDefenseThreshold: number;
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
  contestedZoneCommitShare: 0.15,
  contestedZoneMinSurplusMilitary: 4,
  commanderFieldAssignRate: 0.4,
  commanderMinArmySize: 3,
  scrollTerrainPriority: 0.3,
  scrollTerrainMaxDivert: 2,
  universityIronMinePref: 0.5,
  universityCityDefenseThreshold: 0.3,
};

/**
 * Built-in "advanced" preset: stronger wall/supply/siege than default.
 * Used when public/ai-params.json is not present so you can play vs and spectate a capable AI without running train-ai.
 */
export const ADVANCED_AI_PARAMS: AiParams = {
  ...DEFAULT_AI_PARAMS,
  siegeChance: 0.28,
  targetDefenderWeight: 3.5,
  foodBufferThreshold: 16,
  sustainableMilitaryMultiplier: 0.95,
  wallBuildPerCityTarget: 3,
  wallBuildPriority: 0.55,
  wallClosurePriority: 0.65,
  wallRepairPriority: 0.6,
  wallRingTarget: 1,
  wallClosureUptimeWeight: 0.4,
  supplyExpansionPriority: 0.55,
  supplyAnchorDistanceWeight: 0.8,
  supplyStarvationRiskWeight: 0.7,
  supplyCityAcquisitionBias: 0.45,
  defenderAssignmentPriority: 0.7,
  incorporateVillageChance: 1,
  contestedZoneCommitShare: 0.25,
  contestedZoneMinSurplusMilitary: 3,
  commanderFieldAssignRate: 0.6,
  commanderMinArmySize: 2,
  scrollTerrainPriority: 0.45,
  scrollTerrainMaxDivert: 3,
  universityIronMinePref: 0.6,
  universityCityDefenseThreshold: 0.4,
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
  contestedZoneHexKeys: string[] = [],
  commanders: Commander[] = [],
  scrollInventory: Record<string, ScrollItem[]> = {},
  scrollAttachments: ScrollAttachment[] = [],
  scrollRelics: ScrollRelicSite[] = [],
  scrollRegionClaimed: Record<SpecialRegionKind, string[]> = {
    mexca: [],
    hills_lost: [],
    forest_secrets: [],
    isle_lost: [],
  },
): AiActions {
  const aiCities = cities.filter(c => c.ownerId === aiPlayerId);
  const aiPlayer = players.find(p => p.id === aiPlayerId);
  if (!aiPlayer || aiCities.length === 0) {
    return { builds: [], upgrades: [], recruits: [], moveTargets: [], scouts: [], incorporateVillages: [], buildWallRings: [], commanderAssignments: [], scrollAttachments: [], universityTasks: [], stanceChanges: [], retreats: [] };
  }

  const actions: AiActions = { builds: [], upgrades: [], recruits: [], moveTargets: [], scouts: [], incorporateVillages: [], buildWallRings: [], commanderAssignments: [], scrollAttachments: [], universityTasks: [], stanceChanges: [], retreats: [] };
  let goldBudget = aiPlayer.gold;
  const enemyCities = cities.filter(c => c.ownerId !== aiPlayerId);
  const aiUnits = units.filter(u => u.ownerId === aiPlayerId && u.hp > 0);

  const foodStats = estimateAiFoodSurplus(aiPlayerId, cities, units, tiles, territory);
  const militaryUnits = aiUnits.filter(u => u.type !== 'builder');
  const militaryCount = militaryUnits.length;

  const minDistToCities = (q: number, r: number, cityList: City[]): number => {
    let min = Infinity;
    for (const c of cityList) {
      const d = hexDistance(q, r, c.q, c.r);
      if (d < min) min = d;
    }
    return min;
  };

  for (const city of aiCities) {
    const farmCount = city.buildings.filter(b => b.type === 'farm').length;
    const hasFactory = city.buildings.some(b => b.type === 'factory');
    const hasBarracks = city.buildings.some(b => b.type === 'barracks');
    const hasSiegeWorkshop = city.buildings.some(b => b.type === 'siege_workshop');
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
      } else if (!farmFirst && farmCount < 2 && goldBudget >= BUILDING_COSTS.farm) {
        toBuild = 'farm';
      } else if (!hasFactory && goldBudget >= BUILDING_COSTS.factory) {
        toBuild = 'factory';
      } else if (!hasSiegeWorkshop && goldBudget >= BUILDING_COSTS.siege_workshop) {
        toBuild = 'siege_workshop';
      } else if (!hasMarket && goldBudget >= BUILDING_COSTS.market) {
        toBuild = 'market';
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
      let refinedWoodBudget = city.storage.refinedWood ?? 0;
      for (let i = 0; i < maxRecruits; i++) {
        const useSiege = allowSiege && hasSiegeWorkshop && Math.random() < params.siegeChance;
        const pick = useSiege
          ? siegeChoices[Math.floor(Math.random() * siegeChoices.length)]
          : unitChoices[Math.floor(Math.random() * unitChoices.length)];
        let goldCost: number;
        let stoneCost = 0;
        let ironCost = 0;
        let refinedWoodCost = 0;
        let armsLevel: 1 | 2 | 3 | undefined = undefined;
        if (pick === 'defender') {
          armsLevel = 3;
          goldCost = UNIT_L3_COSTS.defender.gold;
          ironCost = UNIT_L3_COSTS.defender.iron ?? 0;
        } else if (useSiege) {
          goldCost = UNIT_COSTS[pick].gold;
          if (pick === 'trebuchet') refinedWoodCost = UNIT_COSTS.trebuchet.refinedWood ?? 0;
        } else {
          const rwL3 = UNIT_L3_COSTS[pick].refinedWood ?? 0;
          const rwL2 = UNIT_L2_COSTS[pick].refinedWood ?? 0;
          const rwL1 = UNIT_COSTS[pick].refinedWood ?? 0;
          const canL3 = barracksLvl >= 2 && hasGunsL2 && goldBudget >= UNIT_L3_COSTS[pick].gold && ironBudget >= (UNIT_L3_COSTS[pick].iron ?? 0) && refinedWoodBudget >= rwL3;
          const canL2 = barracksLvl >= 2 && hasGunsL2 && goldBudget >= UNIT_L2_COSTS[pick].gold && stoneBudget >= (UNIT_L2_COSTS[pick].stone ?? 0) && refinedWoodBudget >= rwL2;
          const canL1 = goldBudget >= UNIT_COSTS[pick].gold && refinedWoodBudget >= rwL1;
          if (canL3 && (Math.random() < 0.35 || !canL2)) {
            armsLevel = 3;
            goldCost = UNIT_L3_COSTS[pick].gold;
            ironCost = UNIT_L3_COSTS[pick].iron ?? 0;
            refinedWoodCost = rwL3;
          } else if (canL2) {
            armsLevel = 2;
            goldCost = UNIT_L2_COSTS[pick].gold;
            stoneCost = UNIT_L2_COSTS[pick].stone ?? 0;
            refinedWoodCost = rwL2;
          } else if (canL1) {
            goldCost = UNIT_COSTS[pick].gold;
            refinedWoodCost = rwL1;
          } else {
            break;
          }
        }
        if (goldBudget >= goldCost && stoneBudget >= stoneCost && ironBudget >= ironCost && refinedWoodBudget >= refinedWoodCost) {
          actions.recruits.push({ cityId: city.id, type: pick, armsLevel });
          goldBudget -= goldCost;
          stoneBudget -= stoneCost;
          ironBudget -= ironCost;
          refinedWoodBudget -= refinedWoodCost;
        } else break;
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
  const avgDistToAnchor = aiCities.length > 0 && militaryUnits.length > 0
    ? militaryUnits.reduce((sum, u) => sum + minDistToCities(u.q, u.r, aiCities), 0) / militaryUnits.length
    : 0;
  const anchorDistW = Math.max(0, Math.min(2, params.supplyAnchorDistanceWeight ?? 0.5));
  const starvationW = Math.max(0, Math.min(2, params.supplyStarvationRiskWeight ?? 0.5));
  const cityBias = Math.max(0, Math.min(1, params.supplyCityAcquisitionBias ?? 0.3));
  const expansionPriority = Math.max(0, Math.min(1, params.supplyExpansionPriority ?? 0.4));

  const scoreVillageExpansion = (vq: number, vr: number): number => {
    const distToNearestCity = aiCities.length > 0 ? minDistToCities(vq, vr, aiCities) : 0;
    const currentAvg = avgDistToAnchor;
    let newAvg = currentAvg;
    if (militaryUnits.length > 0) {
      let sum = 0;
      for (const u of militaryUnits) {
        let minD = hexDistance(u.q, u.r, vq, vr);
        for (const c of aiCities) {
          const d = hexDistance(u.q, u.r, c.q, c.r);
          if (d < minD) minD = d;
        }
        sum += minD;
      }
      newAvg = sum / militaryUnits.length;
    }
    const supplyGain = Math.max(0, (currentAvg - newAvg) * 0.1 * anchorDistW);
    const starvationRisk = (distToNearestCity / 24) * starvationW;
    return 1 + supplyGain - starvationRisk + cityBias;
  };

  const cityCenterKeys = new Set(cities.map(c => tileKey(c.q, c.r)));
  const villageTilesForIncorp: { q: number; r: number; score: number }[] = [];
  const villagesNeedingUnits: { q: number; r: number; score: number }[] = [];
  for (const tile of tiles.values()) {
    if (!tile.hasVillage) continue;
    if (cityCenterKeys.has(tileKey(tile.q, tile.r))) continue;
    const militaryHere = aiUnits.filter(u => u.q === tile.q && u.r === tile.r && u.type !== 'builder');
    const score = scoreVillageExpansion(tile.q, tile.r);
    if (militaryHere.length > 0) villageTilesForIncorp.push({ q: tile.q, r: tile.r, score });
    else villagesNeedingUnits.push({ q: tile.q, r: tile.r, score });
  }
  villageTilesForIncorp.sort((a, b) => b.score - a.score);
  for (const { q, r } of villageTilesForIncorp) {
    if (goldBudget < VILLAGE_INCORPORATE_COST) break;
    if (Math.random() < (params.incorporateVillageChance ?? 1)) {
      actions.incorporateVillages.push({ q, r });
      goldBudget -= VILLAGE_INCORPORATE_COST;
    }
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
      aiCities.length === 0 ? 999 : minDistToCities(ec.q, ec.r, aiCities);
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
      const defSlots = countDefensesTaskSlots(city);
      const minStonePerCycle = Math.max(WALL_SECTION_STONE_COST, defSlots * WALL_BUILDER_STONE_PER_CYCLE_PER_SLOT);
      if (defSlots <= 0 || stoneAvailable < minStonePerCycle) continue;
      const ring1 = getRingTopology(city, 1, tiles, ownerWallByKey);
      const ring2 = getRingTopology(city, 2, tiles, ownerWallByKey);
      // Prefer closing ring 1 first; if closed, consider ring 2 (or repair ring 1 if breached)
      const wantClosure = closurePriority >= 0.3;
      const wantRepair = repairPriority >= 0.3;
      let buildRing: 1 | 2 | null = null;
      if (!ring1.isClosed && ring1.missingCount > 0 && wantClosure) {
        if (stoneAvailable >= minStonePerCycle) buildRing = 1;
      }
      if (!buildRing && ring1.isClosed && ring1.isBreached && wantRepair && ring1.missingCount > 0 && stoneAvailable >= minStonePerCycle) {
        buildRing = 1;
      }
      if (!buildRing && ring1.isClosed && ringTarget >= 2 && !ring2.isClosed && ring2.missingCount > 0 && wantClosure) {
        if (stoneAvailable >= minStonePerCycle) buildRing = 2;
      }
      if (buildRing && Math.random() < wallPriority + (buildRing === 1 && !ring1.isClosed ? closurePriority : 0) * 0.5) {
        actions.buildWallRings.push({ cityId: city.id, ring: buildRing });
      }
    }
  }

  // ── Contested zone: divert idle military toward contested hexes for gold/iron payouts ──
  const unitIdsAlreadyTargeted = new Set(actions.moveTargets.map(mt => mt.unitId));
  if (contestedZoneHexKeys.length > 0 && (params.contestedZoneCommitShare ?? 0) > 0) {
    const commitShare = Math.max(0, Math.min(1, params.contestedZoneCommitShare ?? 0.15));
    const minSurplus = Math.max(0, params.contestedZoneMinSurplusMilitary ?? 4);
    const idleForContest = aiUnits.filter(
      u => u.hp > 0 && u.type !== 'builder' && !isNavalUnitType(u.type) && !unitIdsAlreadyTargeted.has(u.id) && u.status !== 'fighting',
    );
    const numToCommit = Math.max(0, Math.min(
      Math.floor(idleForContest.length * commitShare),
      idleForContest.length - minSurplus,
    ));
    if (numToCommit > 0) {
      const zoneCenter = parseTileKey(contestedZoneHexKeys[Math.floor(contestedZoneHexKeys.length / 2)]);
      const sorted = [...idleForContest].sort(
        (a, b) => hexDistance(a.q, a.r, zoneCenter[0], zoneCenter[1]) - hexDistance(b.q, b.r, zoneCenter[0], zoneCenter[1]),
      );
      for (let i = 0; i < numToCommit && i < sorted.length; i++) {
        const u = sorted[i];
        const targetHex = contestedZoneHexKeys[i % contestedZoneHexKeys.length];
        const [tq, tr] = parseTileKey(targetHex);
        if (hexDistance(u.q, u.r, tq, tr) > 1) {
          actions.moveTargets.push({ unitId: u.id, toQ: tq, toR: tr });
          unitIdsAlreadyTargeted.add(u.id);
        }
      }
    }
  }

  // ── Combat evaluation: retreat when losing badly, set stances tactically, attempt flanking ──
  {
    const fightingUnits = aiUnits.filter(u => u.status === 'fighting' && u.hp > 0 && !isNavalUnitType(u.type));
    const fightingByHex = new Map<string, Unit[]>();
    for (const u of fightingUnits) {
      const k = tileKey(u.q, u.r);
      const arr = fightingByHex.get(k) ?? [];
      arr.push(u);
      fightingByHex.set(k, arr);
    }

    for (const [hexK, myStack] of fightingByHex) {
      const [hq, hr] = hexK.split(',').map(Number);
      const enemyHere = units.filter(u => u.ownerId !== aiPlayerId && u.hp > 0 && u.q === hq && u.r === hr && !u.aboardShipId);
      if (enemyHere.length === 0) continue;

      const myPower = myStack.reduce((s, u) => s + getUnitStats(u).attack * u.hp, 0);
      const enPower = enemyHere.reduce((s, u) => s + getUnitStats(u).attack * u.hp, 0);
      const ratio = enPower > 0 ? myPower / enPower : 10;

      if (ratio < 0.33) {
        for (const u of myStack) {
          if (!u.retreatAt) actions.retreats.push({ unitId: u.id });
        }
      } else if (ratio < 0.6) {
        const rangedUnits = myStack.filter(u => getUnitStats(u).range >= 2);
        for (const u of rangedUnits) {
          actions.stanceChanges.push({ unitId: u.id, stance: 'skirmish' });
        }
        const melee = myStack.filter(u => getUnitStats(u).range <= 1);
        for (const u of melee) {
          actions.stanceChanges.push({ unitId: u.id, stance: 'defensive' });
        }
      } else if (ratio > 1.5) {
        for (const u of myStack) {
          actions.stanceChanges.push({ unitId: u.id, stance: 'aggressive' });
        }
      }
    }

    // Flanking: if AI has idle military near a battle hex, route them to attack from a different side
    for (const [hexK, myStack] of fightingByHex) {
      const [hq, hr] = hexK.split(',').map(Number);
      const neighbors = hexNeighbors(hq, hr);
      const emptyNeighbors = neighbors.filter(([nq, nr]) => {
        const t = tiles.get(tileKey(nq, nr));
        if (!t || t.biome === 'water') return false;
        return !units.some(u => u.q === nq && u.r === nr && u.hp > 0 && !u.aboardShipId);
      });
      if (emptyNeighbors.length === 0) continue;

      const nearbyIdle = aiUnits.filter(u =>
        u.hp > 0 && u.type !== 'builder' && !isNavalUnitType(u.type) &&
        u.status !== 'fighting' && !unitIdsAlreadyTargeted.has(u.id) &&
        hexDistance(u.q, u.r, hq, hr) <= 4 && hexDistance(u.q, u.r, hq, hr) > 1
      );
      const [flankQ, flankR] = emptyNeighbors[Math.floor(Math.random() * emptyNeighbors.length)];
      for (const u of nearbyIdle.slice(0, 3)) {
        actions.moveTargets.push({ unitId: u.id, toQ: flankQ, toR: flankR });
        unitIdsAlreadyTargeted.add(u.id);
      }
    }
  }

  // ── Commander field assignment: attach idle city-defense commanders to army stacks ──
  const fieldAssignRate = Math.max(0, Math.min(1, params.commanderFieldAssignRate ?? 0.4));
  const minArmySize = Math.max(1, Math.round(params.commanderMinArmySize ?? 3));
  if (fieldAssignRate > 0 && commanders.length > 0) {
    const myCommanders = commanders.filter(c => c.ownerId === aiPlayerId);
    const idleCityDef = myCommanders.filter(
      c => c.assignment?.kind === 'city_defense' && (c.commanderKind ?? 'land') === 'land',
    );
    if (idleCityDef.length > 1) {
      const movingMilitary = aiUnits.filter(
        u => u.hp > 0 && u.type !== 'builder' && !isNavalUnitType(u.type) && u.status === 'moving' && u.targetQ != null,
      );
      const hexStacks = new Map<string, Unit[]>();
      for (const u of movingMilitary) {
        const k = tileKey(u.q, u.r);
        const arr = hexStacks.get(k) ?? [];
        arr.push(u);
        hexStacks.set(k, arr);
      }
      let assignedCount = 0;
      for (const [, stack] of hexStacks) {
        if (stack.length < minArmySize) continue;
        if (assignedCount >= idleCityDef.length - 1) break;
        if (Math.random() > fieldAssignRate) continue;
        const anchor = stack.reduce((best, u) => u.hp > best.hp ? u : best, stack[0]);
        const cmd = idleCityDef[assignedCount];
        if (cmd) {
          actions.commanderAssignments.push({
            commanderId: cmd.id,
            assignment: { kind: 'field', anchorUnitId: anchor.id },
          });
          assignedCount++;
        }
      }
    }
  }

  // ── Scroll attachment: equip discovered scrolls onto leading army units ──
  const myScrolls = scrollInventory[aiPlayerId] ?? [];
  if (myScrolls.length > 0) {
    const alreadyAttachedScrollIds = new Set(scrollAttachments.filter(a => a.ownerId === aiPlayerId).map(a => a.scrollId));
    const unequipped = myScrolls.filter(s => !alreadyAttachedScrollIds.has(s.id));
    if (unequipped.length > 0) {
      const carrierCandidates = aiUnits.filter(
        u => u.hp > 0 && u.type !== 'builder' && !isNavalUnitType(u.type) && u.status === 'moving',
      );
      const usedCarrierIds = new Set(scrollAttachments.filter(a => a.ownerId === aiPlayerId).map(a => a.carrierUnitId));
      const available = carrierCandidates.filter(u => !usedCarrierIds.has(u.id));
      for (let i = 0; i < unequipped.length && i < available.length; i++) {
        actions.scrollAttachments.push({
          scrollId: unequipped[i].id,
          carrierUnitId: available[i].id,
        });
      }
    }
  }

  // ── Scroll relics / special terrain: divert units toward unclaimed relic hexes first ──
  const scrollTerrainPriority = Math.max(0, Math.min(1, params.scrollTerrainPriority ?? 0.3));
  const scrollMaxDivert = Math.max(0, Math.round(params.scrollTerrainMaxDivert ?? 2));
  if (scrollTerrainPriority > 0 && scrollMaxDivert > 0) {
    const unclaimedRelics = scrollRelics.filter(
      s => !(scrollRegionClaimed[s.regionKind] ?? []).includes(aiPlayerId),
    );
    const specialLand: Tile[] = [];
    for (const t of tiles.values()) {
      if (t.specialTerrainKind && t.biome !== 'water' && t.biome !== 'mountain') {
        specialLand.push(t);
      }
    }
    const targets: { q: number; r: number }[] = [];
    const seen = new Set<string>();
    for (const s of unclaimedRelics) {
      const k = tileKey(s.q, s.r);
      if (seen.has(k)) continue;
      seen.add(k);
      targets.push({ q: s.q, r: s.r });
    }
    for (const t of specialLand) {
      const k = tileKey(t.q, t.r);
      if (seen.has(k)) continue;
      seen.add(k);
      targets.push({ q: t.q, r: t.r });
    }
    if (targets.length > 0) {
      let diverted = 0;
      for (const dest of targets) {
        if (diverted >= scrollMaxDivert) break;
        if (Math.random() > scrollTerrainPriority) continue;
        const tile = tiles.get(tileKey(dest.q, dest.r));
        const needShip = tile?.biome === 'water';
        const divertable = aiUnits.filter(
          u =>
            u.hp > 0 &&
            u.type !== 'builder' &&
            (needShip ? isNavalUnitType(u.type) : !isNavalUnitType(u.type)) &&
            !unitIdsAlreadyTargeted.has(u.id) &&
            u.status !== 'fighting',
        );
        const nearest = divertable
          .sort((a, b) => hexDistance(a.q, a.r, dest.q, dest.r) - hexDistance(b.q, b.r, dest.q, dest.r))[0];
        if (nearest && hexDistance(nearest.q, nearest.r, dest.q, dest.r) > 1) {
          actions.moveTargets.push({ unitId: nearest.id, toQ: dest.q, toR: dest.r });
          unitIdsAlreadyTargeted.add(nearest.id);
          diverted++;
        }
      }
    }
  }

  // ── University task selection per city (based on available deposits and game state) ──
  for (const city of aiCities) {
    const hasAcademy = city.buildings.some(b => b.type === 'academy');
    if (!hasAcademy) continue;
    const hasMine = city.buildings.some(b => b.type === 'mine');
    const hasQuarry = city.buildings.some(b => b.type === 'quarry');
    const ironPref = params.universityIronMinePref ?? 0.5;
    const defThreshold = params.universityCityDefenseThreshold ?? 0.3;

    let task: BuilderTask = 'expand_quarries';
    if (enemyCities.length > 0 && Math.random() < defThreshold) {
      task = 'city_defenses';
    } else if (hasMine && !hasQuarry) {
      task = 'expand_quarries';
    } else if (hasQuarry && !hasMine) {
      task = 'expand_iron_mines';
    } else if (Math.random() < ironPref) {
      task = 'expand_iron_mines';
    } else {
      task = 'expand_quarries';
    }

    if (city.universityBuilderTask !== task) {
      actions.universityTasks.push({ cityId: city.id, task });
    }
  }

  return actions;
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
  if (!tile || !isCapitalStartHex(tile)) return null;
  clearVillageForCapitalTile(tiles, atQ, atR);

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
  appendStartingBarracksToCity(city, tiles, atQ * 524287 + atR * 65521);
  appendStartingAcademyToCity(city, tiles, atQ * 524287 + atR * 65521 + 0xaced);
  return city;
}

/** Hex radius for “local land” check: center tile must have a majority land in this disk (not ocean rim). */
const AI_START_LAND_DISK_RADIUS = 5;

function landFractionInDisk(
  tiles: Map<string, Tile>,
  cq: number,
  cr: number,
  radius: number,
): number {
  let land = 0;
  let total = 0;
  for (const t of tiles.values()) {
    if (hexDistance(t.q, t.r, cq, cr) > radius) continue;
    total++;
    if (t.biome !== 'water') land++;
  }
  return total === 0 ? 0 : land / total;
}

type AiStartCand = { q: number; r: number; landFrac: number; d: number };

function compareAiStartFair(a: AiStartCand, b: AiStartCand, idealD: number): number {
  const scoreA = a.landFrac * 10 - Math.abs(a.d - idealD) * 0.5;
  const scoreB = b.landFrac * 10 - Math.abs(b.d - idealD) * 0.5;
  if (scoreA !== scoreB) return scoreB - scoreA;
  if (a.q !== b.q) return a.q - b.q;
  return a.r - b.r;
}

export function placeAiStartingCity(
  humanCityQ: number,
  humanCityR: number,
  tiles: Map<string, Tile>,
  config: Pick<MapConfig, 'width' | 'height' | 'seed'>,
  aiPlayerId: string,
): City | null {
  const w = config.width;
  const h = config.height;
  const seedMix = config.seed ^ humanCityQ * 1315423911 ^ humanCityR * 9737333;
  /** Minimum hex distance from the human capital so 1v1 starts aren’t adjacent. */
  const minSep = Math.max(8, Math.floor(Math.min(w, h) * 0.15));
  /** Prefer a moderate separation — not the farthest corner of the map. */
  const idealD = minSep + Math.floor(Math.min(w, h) * 0.12);
  const maxD = Math.floor(Math.min(w, h) * 0.55);
  const margin = Math.max(3, Math.floor(Math.min(w, h) * 0.08));

  const isInMapMargin = (q: number, r: number) =>
    q < margin || q >= w - margin || r < margin || r >= h - margin;

  const placeAt = (q: number, r: number, seedSalt: number) => {
    clearVillageForCapitalTile(tiles, q, r);
    const city: City = {
      id: generateId('city'),
      name: 'AI Capital',
      q,
      r,
      ownerId: aiPlayerId,
      ...structuredClone(STARTING_CITY_TEMPLATE),
    };
    city.buildings = [{ type: 'city_center', q, r, assignedWorkers: 0 }];
    city.storageCap = { ...CITY_CENTER_STORAGE };
    const seed = humanCityQ * 1315423911 + humanCityR * 9737333 + q * 524287 + r * 65521 + seedSalt;
    appendStartingBarracksToCity(city, tiles, seed);
    appendStartingAcademyToCity(city, tiles, seed ^ 0xaced);
    return city;
  };

  const all: AiStartCand[] = [];
  const allFallback: AiStartCand[] = [];
  for (const tile of tiles.values()) {
    if (!tile || !isCapitalStartHex(tile)) continue;
    if (tile.q === humanCityQ && tile.r === humanCityR) continue;
    const d = hexDistance(tile.q, tile.r, humanCityQ, humanCityR);
    const landFrac = landFractionInDisk(tiles, tile.q, tile.r, AI_START_LAND_DISK_RADIUS);
    const cand = { q: tile.q, r: tile.r, landFrac, d };
    allFallback.push(cand);
    if (!isInMapMargin(tile.q, tile.r) && d <= maxD) {
      all.push(cand);
    }
  }

  const pickFrom = (pool: AiStartCand[], pred: (c: AiStartCand) => boolean): AiStartCand | null => {
    const sub = pool.filter(pred);
    if (sub.length === 0) return null;
    sub.sort((a, b) => compareAiStartFair(a, b, idealD));
    const topN = Math.min(8, sub.length);
    const idx = Math.abs(seedMix) % topN;
    return sub[idx]!;
  };

  const chosen =
    pickFrom(all, (c) => c.landFrac > 0.5 && c.d >= minSep)
    ?? pickFrom(all, (c) => c.landFrac > 0.4 && c.d >= minSep)
    ?? pickFrom(all, (c) => c.d >= minSep)
    ?? pickFrom(allFallback, (c) => c.landFrac > 0.4 && c.d >= minSep)
    ?? pickFrom(allFallback, () => true);

  return chosen ? placeAt(chosen.q, chosen.r, 0) : null;
}

type AiStartCandMulti = { q: number; r: number; landFrac: number; minD: number };

function placeOneAiApartFromPoints(
  aiPlayerId: string,
  placed: { q: number; r: number }[],
  tiles: Map<string, Tile>,
  config: Pick<MapConfig, 'width' | 'height' | 'seed'>,
  salt: number,
): City | null {
  const w = config.width;
  const h = config.height;
  const mapMin = Math.min(w, h);
  /** Minimum hex distance to any existing capital — higher than before so FFA / many-AI starts are not cheek-by-jowl. */
  const minSep = Math.max(10, Math.floor(mapMin * 0.18) + Math.floor(Math.max(0, placed.length - 2) * 2));
  const margin = Math.max(3, Math.floor(mapMin * 0.08));
  const seedMix = config.seed ^ salt * 0x9e3779b9;

  const isInMapMargin = (q: number, r: number) =>
    q < margin || q >= w - margin || r < margin || r >= h - margin;

  const minDistToPlaced = (q: number, r: number) =>
    Math.min(...placed.map(p => hexDistance(q, r, p.q, p.r)));

  /** Prefer good local land and being far from the nearest existing capital (spread), not a narrow “ideal ring” distance. */
  const scoreCandidate = (c: AiStartCandMulti): number => c.landFrac * 10 + c.minD * 0.72;

  const collect = (minSepRequired: number, respectMargin: boolean): AiStartCandMulti[] => {
    const out: AiStartCandMulti[] = [];
    for (const tile of tiles.values()) {
      if (!isCapitalStartHex(tile)) continue;
      if (placed.some(p => p.q === tile.q && p.r === tile.r)) continue;
      if (respectMargin && isInMapMargin(tile.q, tile.r)) continue;
      const minD = minDistToPlaced(tile.q, tile.r);
      if (minD < minSepRequired) continue;
      const landFrac = landFractionInDisk(tiles, tile.q, tile.r, AI_START_LAND_DISK_RADIUS);
      out.push({ q: tile.q, r: tile.r, landFrac, minD });
    }
    return out;
  };

  let all = collect(minSep, true);
  if (all.length === 0) all = collect(minSep, false);
  if (all.length === 0) all = collect(Math.max(6, minSep - 4), false);
  if (all.length === 0) all = collect(4, false);

  if (all.length === 0) return null;

  all.sort((a, b) => scoreCandidate(b) - scoreCandidate(a));

  const topN = Math.min(12, all.length);
  const idx = Math.abs(seedMix) % topN;
  const chosen = all[idx]!;
  return placeAiStartingCityAt(aiPlayerId, chosen.q, chosen.r, tiles);
}

/** Human capital + N AI capitals spread apart (FFA). */
export function placeAiStartingCitiesSequential(
  humanQ: number,
  humanR: number,
  aiPlayerIds: string[],
  tiles: Map<string, Tile>,
  config: Pick<MapConfig, 'width' | 'height' | 'seed'>,
): City[] {
  const placed: { q: number; r: number }[] = [{ q: humanQ, r: humanR }];
  const cities: City[] = [];
  for (let i = 0; i < aiPlayerIds.length; i++) {
    const id = aiPlayerIds[i]!;
    const c = placeOneAiApartFromPoints(id, placed, tiles, config, i);
    if (c) {
      cities.push(c);
      placed.push({ q: c.q, r: c.r });
    }
  }
  return cities;
}

function pickFirstSpectateCapital(
  tiles: Map<string, Tile>,
  config: Pick<MapConfig, 'width' | 'height' | 'seed'>,
): { q: number; r: number } | null {
  const w = config.width;
  const h = config.height;
  const cq = Math.floor(w / 2);
  const cr = Math.floor(h / 2);
  let best: AiStartCandMulti | null = null;
  let bestScore = -Infinity;
  for (const tile of tiles.values()) {
    if (!isCapitalStartHex(tile)) continue;
    const landFrac = landFractionInDisk(tiles, tile.q, tile.r, AI_START_LAND_DISK_RADIUS);
    const distCenter = hexDistance(tile.q, tile.r, cq, cr);
    const cand: AiStartCandMulti = { q: tile.q, r: tile.r, landFrac, minD: distCenter };
    /** Prefer viable land, but also away from map center so the first capital anchors spread instead of sitting in the densest cluster. */
    const score = landFrac * 10 + distCenter * 0.28;
    if (!best || score > bestScore) {
      best = cand;
      bestScore = score;
    }
  }
  return best ? { q: best.q, r: best.r } : null;
}

/** Spectate: several AI capitals spread across the map (no human). */
export function placeManyAiCapitalsApart(
  count: number,
  aiPlayerIds: string[],
  tiles: Map<string, Tile>,
  config: Pick<MapConfig, 'width' | 'height' | 'seed'>,
): City[] {
  const n = Math.min(count, aiPlayerIds.length);
  if (n <= 0) return [];

  const cities: City[] = [];
  const placed: { q: number; r: number }[] = [];

  const first = pickFirstSpectateCapital(tiles, config);
  if (!first) return [];
  const c0 = placeAiStartingCityAt(aiPlayerIds[0]!, first.q, first.r, tiles);
  if (!c0) return [];
  cities.push(c0);
  placed.push({ q: c0.q, r: c0.r });

  for (let i = 1; i < n; i++) {
    const id = aiPlayerIds[i]!;
    const c = placeOneAiApartFromPoints(id, placed, tiles, config, i + 16);
    if (c) {
      cities.push(c);
      placed.push({ q: c.q, r: c.r });
    }
  }
  return cities;
}
