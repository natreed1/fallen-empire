/**
 * Shared AI economy application: instant builds/upgrades + pending land recruits.
 * Used by useGameStore.runCycle and gameCore.stepSimulation for parity.
 */

import {
  type City,
  type Unit,
  type BuildingType,
  type Player,
  BUILDING_COSTS,
  BUILDING_IRON_COSTS,
  UNIT_COSTS,
  UNIT_L2_COSTS,
  UNIT_L3_COSTS,
  WORKERS_PER_LEVEL,
  BARACKS_UPGRADE_COST,
  FACTORY_UPGRADE_COST,
  FARM_UPGRADE_COST,
  getUnitStats,
  isNavalUnitType,
  type RangedVariant,
  isBuildingUnlockedByTech,
  isUnitUnlockedByTech,
  maxBuildingLevelByTech,
  STARTING_TECHS,
} from '@/types/game';
import { computeUniversityBuildingLevelFromPopulation } from '@/lib/universityPopulation';
import type { AiActions } from '@/lib/ai';
import type { PendingLandRecruit } from '@/lib/pendingLandRecruit';

/** Where queued land recruits are appended (array or custom sink). */
export type PendingLandRecruitSink = {
  push: (item: PendingLandRecruit) => void;
};

const LEVEL1_BUILDING_TYPES: BuildingType[] = [
  'quarry',
  'mine',
  'gold_mine',
  'barracks',
  'factory',
  'academy',
  'siege_workshop',
  'farm',
  'banana_farm',
  'market',
  'social_bar',
];

export function applyAiInstantBuilds(
  builds: AiActions['builds'],
  ctx: {
    aiPlayerId: string;
    cities: City[];
    getPlayer: () => Pick<Player, 'gold' | 'researchedTechs'> | undefined;
    onSpendGold: (delta: number) => void;
    onInstantBuild?: (buildingType: BuildingType) => void;
  },
): void {
  for (const build of builds) {
    const aiPlayer = ctx.getPlayer();
    if (!aiPlayer) continue;
    const techs = aiPlayer.researchedTechs ?? STARTING_TECHS;
    if (!isBuildingUnlockedByTech(build.type, techs)) continue;
    const city = ctx.cities.find(c => c.id === build.cityId);
    if (!city || city.ownerId !== ctx.aiPlayerId) continue;
    if (aiPlayer.gold < BUILDING_COSTS[build.type]) continue;
    const ironCost = BUILDING_IRON_COSTS[build.type] ?? 0;
    if (ironCost > 0 && (city.storage.iron ?? 0) < ironCost) continue;
    const b = { type: build.type, q: build.q, r: build.r } as City['buildings'][number];
    if (LEVEL1_BUILDING_TYPES.includes(build.type)) (b as { level?: number }).level = 1;
    if (build.type === 'university') {
      (b as { level?: number }).level = computeUniversityBuildingLevelFromPopulation(city.population);
    }
    if (build.type === 'quarry' || build.type === 'mine' || build.type === 'gold_mine') {
      const toAssign = Math.min(WORKERS_PER_LEVEL, Math.max(0, city.population - 1));
      (b as { assignedWorkers?: number }).assignedWorkers = toAssign;
      city.population -= toAssign;
    }
    city.buildings.push(b);
    ctx.onSpendGold(BUILDING_COSTS[build.type]);
    if (ironCost > 0) city.storage.iron = (city.storage.iron ?? 0) - ironCost;
    ctx.onInstantBuild?.(build.type);
  }
}

export function applyAiUpgrades(
  upgrades: AiActions['upgrades'] | undefined,
  ctx: {
    aiPlayerId: string;
    cities: City[];
    getPlayer: () => Pick<Player, 'gold' | 'researchedTechs'> | undefined;
    onSpendGold: (delta: number) => void;
  },
): void {
  for (const up of upgrades ?? []) {
    const aiPlayer = ctx.getPlayer();
    if (!aiPlayer) continue;
    const techs = aiPlayer.researchedTechs ?? STARTING_TECHS;
    const city = ctx.cities.find(c => c.id === up.cityId);
    if (!city || city.ownerId !== ctx.aiPlayerId) continue;
    const cost =
      up.type === 'barracks'
        ? BARACKS_UPGRADE_COST
        : up.type === 'farm' || up.type === 'banana_farm'
          ? FARM_UPGRADE_COST
          : FACTORY_UPGRADE_COST;
    if (aiPlayer.gold < cost) continue;
    const building = city.buildings.find(b => b.type === up.type && b.q === up.buildingQ && b.r === up.buildingR);
    if (!building || (building.level ?? 1) >= 2) continue;
    if (maxBuildingLevelByTech(up.type, techs) < 2) continue;
    building.level = 2;
    ctx.onSpendGold(cost);
  }
}

/**
 * Queue land recruits with completesAtCycle = newCycle + 1; pays costs now (same as live store).
 */
export function applyAiRecruitsAsPending(
  recruits: AiActions['recruits'],
  ctx: {
    aiPlayerId: string;
    newCycle: number;
    cities: City[];
    units: Unit[];
    getPlayer: () => Pick<Player, 'gold' | 'researchedTechs'> | undefined;
    onSpendGold: (delta: number) => void;
    pendingRecruitsOut: PendingLandRecruitSink;
    generateId: (prefix: string) => string;
  },
): void {
  const aiRecruitCities = ctx.cities.filter(c => c.ownerId === ctx.aiPlayerId);
  const aiTotalPopForRecruit = aiRecruitCities.reduce((s, c) => s + c.population, 0);
  let aiTroopCount = ctx.units.filter(u => u.ownerId === ctx.aiPlayerId && u.hp > 0).length;

  for (const rec of recruits) {
    const aiPlayer = ctx.getPlayer();
    if (!aiPlayer) continue;
    const techs = aiPlayer.researchedTechs ?? STARTING_TECHS;
    if (!isUnitUnlockedByTech(rec.type, techs)) continue;
    const city = ctx.cities.find(c => c.id === rec.cityId);
    if (!city || city.ownerId !== ctx.aiPlayerId || city.population <= 0 || aiTroopCount >= aiTotalPopForRecruit) {
      continue;
    }
    if (rec.type === 'trebuchet' || rec.type === 'battering_ram') {
      if (!city.buildings.some(b => b.type === 'siege_workshop')) continue;
    }
    const effectiveLevel = rec.type === 'defender' ? 3 : (rec.armsLevel ?? 1);
    const wantL2 = effectiveLevel === 2;
    const wantL3 = effectiveLevel === 3;
    const goldCost = wantL3
      ? UNIT_L3_COSTS[rec.type].gold
      : wantL2
        ? UNIT_L2_COSTS[rec.type].gold
        : UNIT_COSTS[rec.type].gold;
    const stoneCost = wantL2 ? (UNIT_L2_COSTS[rec.type].stone ?? 0) : 0;
    const ironCost = wantL3 ? (UNIT_L3_COSTS[rec.type].iron ?? 0) : 0;
    const refinedWoodCost = wantL3
      ? (UNIT_L3_COSTS[rec.type].refinedWood ?? 0)
      : wantL2
        ? (UNIT_L2_COSTS[rec.type].refinedWood ?? 0)
        : (UNIT_COSTS[rec.type].refinedWood ?? 0);
    if (aiPlayer.gold < goldCost) continue;
    if (stoneCost > 0 && (city.storage.stone ?? 0) < stoneCost) continue;
    if (ironCost > 0 && (city.storage.iron ?? 0) < ironCost) continue;
    if (refinedWoodCost > 0 && (city.storage.refinedWood ?? 0) < refinedWoodCost) continue;
    const stats = getUnitStats({ type: rec.type, armsLevel: effectiveLevel as 1 | 2 | 3 });
    const gunL2Upkeep = (stats as { gunL2Upkeep?: number }).gunL2Upkeep ?? 0;
    if (gunL2Upkeep > 0) {
      const totalGunsL2 = ctx.cities.filter(c => c.ownerId === ctx.aiPlayerId).reduce((sum, c) => sum + (c.storage.gunsL2 ?? 0), 0);
      if (totalGunsL2 < gunL2Upkeep) continue;
    }
    if (rec.type === 'builder') continue;
    const barracks = city.buildings.find(b => b.type === 'barracks');
    const bl = barracks?.level ?? 1;
    const needBarracks =
      rec.type === 'defender' ? 3 : wantL3 ? 3 : wantL2 ? 2 : 1;
    if (bl < needBarracks) continue;
    const sq = city.q;
    const sr = city.r;
    const effArms: 1 | 2 | 3 = rec.type === 'defender' ? 3 : wantL3 ? 3 : wantL2 ? 2 : 1;

    let rangedRv: RangedVariant | undefined;
    if (rec.type === 'ranged' && effArms === 3) {
      rangedRv = rec.rangedVariant ?? 'marksman';
      const cidx = ctx.cities.findIndex(c => c.id === city.id);
      if (cidx >= 0) {
        const cd = ctx.cities[cidx].archerDoctrineL3;
        if (cd !== 'marksman' && cd !== 'longbowman') {
          ctx.cities[cidx] = { ...ctx.cities[cidx], archerDoctrineL3: rangedRv };
        }
      }
    }

    if (gunL2Upkeep > 0) {
      for (const oc of ctx.cities.filter(c => c.ownerId === ctx.aiPlayerId)) {
        if ((oc.storage.gunsL2 ?? 0) >= gunL2Upkeep) {
          oc.storage.gunsL2 = (oc.storage.gunsL2 ?? 0) - gunL2Upkeep;
          break;
        }
      }
    }
    ctx.onSpendGold(goldCost);
    if (stoneCost > 0 || ironCost > 0 || refinedWoodCost > 0) {
      const idx = ctx.cities.indexOf(city);
      if (idx >= 0) {
        const c = ctx.cities[idx];
        ctx.cities[idx] = {
          ...c,
          storage: {
            ...c.storage,
            stone: Math.max(0, (c.storage.stone ?? 0) - stoneCost),
            iron: Math.max(0, (c.storage.iron ?? 0) - ironCost),
            refinedWood: Math.max(0, (c.storage.refinedWood ?? 0) - refinedWoodCost),
          },
        };
      }
    }
    ctx.pendingRecruitsOut.push({
      id: ctx.generateId('pr'),
      playerId: ctx.aiPlayerId,
      cityId: city.id,
      type: rec.type,
      effectiveArmsLevel: effArms,
      rangedVariant: rec.type === 'ranged' && effArms === 3 ? (rangedRv ?? rec.rangedVariant) : undefined,
      spawnQ: sq,
      spawnR: sr,
      completesAtCycle: ctx.newCycle + 1,
    });
    aiTroopCount += 1;
  }
}
