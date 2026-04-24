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
  getUnitPopCost,
  isNavalUnitType,
  type RangedVariant,
  isBuildingUnlockedByTech,
  isUnitUnlockedByTech,
  maxBuildingLevelByTech,
  STARTING_TECHS,
  hexNeighbors,
  tileKey,
  SHIP_RECRUIT_COSTS,
} from '@/types/game';
import { computeUniversityBuildingLevelFromPopulation } from '@/lib/universityPopulation';
import type { AiActions } from '@/lib/ai';
import type { PendingLandRecruit } from '@/lib/pendingLandRecruit';
import { buildBattalionTrainingFields, computeEmpirePopUsedForPlayer } from '@/lib/battalionTraining';
import { countPlayerSiegePieces, siegeCompositionAllowsRecruit } from '@/lib/siegeRecruitment';
import type { PendingShipRecruit, SimPendingRecruit } from '@/lib/pendingShipRecruit';
import type { Tile } from '@/types/game';
import type { AiShipRecruitAction } from '@/lib/ai';

/** Where queued land recruits are appended (array or custom sink). */
export type PendingLandRecruitSink = {
  push: (item: PendingLandRecruit) => void;
};

/** Headless sim: land + ship pending share one queue. */
export type SimPendingRecruitSink = { push: (item: SimPendingRecruit) => void };

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
  'sawmill',
  'logging_hut',
  'port',
  'shipyard',
  'fishery',
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
    pendingRecruitsOut: PendingLandRecruitSink | SimPendingRecruitSink;
    generateId: (prefix: string) => string;
  },
): void {
  const aiRecruitCities = ctx.cities.filter(c => c.ownerId === ctx.aiPlayerId);
  const aiTotalPopForRecruit = aiRecruitCities.reduce((s, c) => s + c.population, 0);
  const pendingSink = ctx.pendingRecruitsOut as unknown;
  const pendingForSiegeCount: unknown[] = Array.isArray(pendingSink) ? [...pendingSink] : [];

  for (const rec of recruits) {
    const aiPlayer = ctx.getPlayer();
    if (!aiPlayer) continue;
    const techs = aiPlayer.researchedTechs ?? STARTING_TECHS;
    if (!isUnitUnlockedByTech(rec.type, techs)) continue;
    const city = ctx.cities.find(c => c.id === rec.cityId);
    const popCost = getUnitPopCost(rec.type);
    const popUsed = computeEmpirePopUsedForPlayer(ctx.units, Array.isArray(pendingSink) ? pendingSink : [], ctx.aiPlayerId);
    if (!city || city.ownerId !== ctx.aiPlayerId || city.population <= 0 || popUsed + popCost > aiTotalPopForRecruit) {
      continue;
    }
    const isSiege = rec.type === 'trebuchet' || rec.type === 'battering_ram';
    if (isSiege) {
      if (!city.buildings.some(b => b.type === 'siege_workshop')) continue;
      const sc = countPlayerSiegePieces(ctx.units, pendingForSiegeCount, ctx.aiPlayerId);
      if (!siegeCompositionAllowsRecruit(rec.type as 'trebuchet' | 'battering_ram', sc)) continue;
    }
    const effectiveLevel = rec.type === 'defender' ? 3 : (rec.armsLevel ?? 1);
    const wantL2 = effectiveLevel === 2;
    const wantL3 = effectiveLevel === 3;
    const goldCost = wantL3
      ? UNIT_L3_COSTS[rec.type].gold
      : wantL2
        ? UNIT_L2_COSTS[rec.type].gold
        : UNIT_COSTS[rec.type].gold;
    const stoneCost = wantL3
      ? (UNIT_L3_COSTS[rec.type].stone ?? 0)
      : wantL2
        ? (UNIT_L2_COSTS[rec.type].stone ?? 0)
        : (UNIT_COSTS[rec.type].stone ?? 0);
    const woodCost = wantL3
      ? (UNIT_L3_COSTS[rec.type].wood ?? 0)
      : wantL2
        ? (UNIT_L2_COSTS[rec.type].wood ?? 0)
        : (UNIT_COSTS[rec.type].wood ?? 0);
    const ironCost = wantL3 ? (UNIT_L3_COSTS[rec.type].iron ?? 0) : 0;
    const refinedWoodCost = wantL3
      ? (UNIT_L3_COSTS[rec.type].refinedWood ?? 0)
      : wantL2
        ? (UNIT_L2_COSTS[rec.type].refinedWood ?? 0)
        : (UNIT_COSTS[rec.type].refinedWood ?? 0);
    if (aiPlayer.gold < goldCost) continue;
    if (stoneCost > 0 && (city.storage.stone ?? 0) < stoneCost) continue;
    if (woodCost > 0 && (city.storage.wood ?? 0) < woodCost) continue;
    if (ironCost > 0 && (city.storage.iron ?? 0) < ironCost) continue;
    if (refinedWoodCost > 0 && (city.storage.refinedWood ?? 0) < refinedWoodCost) continue;
    if (rec.type === 'builder') continue;
    if (!isSiege) {
      const barracks = city.buildings.find(b => b.type === 'barracks');
      const bl = barracks?.level ?? 1;
      const needBarracks =
        rec.type === 'defender' ? 3 : wantL3 ? 3 : wantL2 ? 2 : 1;
      if (bl < needBarracks) continue;
    }
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

    ctx.onSpendGold(goldCost);
    if (stoneCost > 0 || woodCost > 0 || ironCost > 0 || refinedWoodCost > 0) {
      const idx = ctx.cities.indexOf(city);
      if (idx >= 0) {
        const c = ctx.cities[idx];
        ctx.cities[idx] = {
          ...c,
          storage: {
            ...c.storage,
            stone: Math.max(0, (c.storage.stone ?? 0) - stoneCost),
            wood: Math.max(0, (c.storage.wood ?? 0) - woodCost),
            iron: Math.max(0, (c.storage.iron ?? 0) - ironCost),
            refinedWood: Math.max(0, (c.storage.refinedWood ?? 0) - refinedWoodCost),
          },
        };
      }
    }
    const battalion = buildBattalionTrainingFields(rec.type, effArms, popCost);
    const pr: PendingLandRecruit = {
      id: ctx.generateId('pr'),
      playerId: ctx.aiPlayerId,
      cityId: city.id,
      type: rec.type,
      effectiveArmsLevel: effArms,
      rangedVariant: rec.type === 'ranged' && effArms === 3 ? (rangedRv ?? rec.rangedVariant) : undefined,
      spawnQ: sq,
      spawnR: sr,
      ...battalion,
      goldPaid: goldCost,
      stonePaid: stoneCost,
      woodPaid: woodCost,
      ironPaid: ironCost,
      refinedWoodPaid: refinedWoodCost,
    };
    ctx.pendingRecruitsOut.push(pr);
    if (isSiege) pendingForSiegeCount.push(pr);
  }
}

type ShipRecruitSink = { push: (item: PendingShipRecruit) => void };

/** Queue ship recruits (next cycle spawn); pays costs now — same rules as human recruitShip. */
export function applyAiShipRecruitsAsPending(
  shipRecruits: AiShipRecruitAction[],
  ctx: {
    aiPlayerId: string;
    newCycle: number;
    cities: City[];
    units: Unit[];
    tiles: Map<string, Tile>;
    getPlayer: () => Pick<Player, 'gold' | 'researchedTechs' | 'kingdomId'> | undefined;
    onSpendGold: (delta: number) => void;
    pendingShipsOut: ShipRecruitSink;
    generateId: (prefix: string) => string;
  },
): void {
  const aiRecruitCities = ctx.cities.filter(c => c.ownerId === ctx.aiPlayerId);
  const aiTotalPop = aiRecruitCities.reduce((s, c) => s + c.population, 0);
  const pendingMixed = Array.isArray(ctx.pendingShipsOut as unknown)
    ? (ctx.pendingShipsOut as unknown[])
    : [];

  for (const rec of shipRecruits) {
    const aiPlayer = ctx.getPlayer();
    if (!aiPlayer) continue;
    const techs = aiPlayer.researchedTechs ?? STARTING_TECHS;
    if (!isUnitUnlockedByTech(rec.shipType, techs)) continue;
    if (rec.shipType === 'fisher_transport' && aiPlayer.kingdomId !== 'fishers') continue;

    const city = ctx.cities.find(c => c.id === rec.cityId);
    if (!city || city.ownerId !== ctx.aiPlayerId) continue;
    const yard = city.buildings.some(b => b.type === 'shipyard' && b.q === rec.shipyardQ && b.r === rec.shipyardR);
    if (!yard) continue;

    const costs = SHIP_RECRUIT_COSTS[rec.shipType];
    if (aiPlayer.gold < costs.gold) continue;
    if ((costs.wood ?? 0) > 0 && (city.storage.wood ?? 0) < (costs.wood ?? 0)) continue;
    if ((costs.refinedWood ?? 0) > 0 && (city.storage.refinedWood ?? 0) < (costs.refinedWood ?? 0)) continue;

    const neighbors = hexNeighbors(rec.shipyardQ, rec.shipyardR);
    let spawn: [number, number] | null = null;
    for (const [nq, nr] of neighbors) {
      const tile = ctx.tiles.get(tileKey(nq, nr));
      if (tile?.biome !== 'water') continue;
      const blocked = ctx.units.some(u => !u.aboardShipId && u.q === nq && u.r === nr && u.hp > 0);
      if (!blocked) {
        spawn = [nq, nr];
        break;
      }
    }
    if (!spawn) continue;

    const popUsed = computeEmpirePopUsedForPlayer(ctx.units, pendingMixed, ctx.aiPlayerId);
    if (popUsed + getUnitPopCost(rec.shipType) > aiTotalPop) continue;

    const woodCost = costs.wood ?? 0;
    const rwCost = costs.refinedWood ?? 0;
    ctx.onSpendGold(costs.gold);
    const cidx = ctx.cities.findIndex(c => c.id === city.id);
    if (cidx >= 0) {
      const c = ctx.cities[cidx];
      ctx.cities[cidx] = {
        ...c,
        storage: {
          ...c.storage,
          wood: Math.max(0, (c.storage.wood ?? 0) - woodCost),
          refinedWood: Math.max(0, (c.storage.refinedWood ?? 0) - rwCost),
        },
      };
    }
    ctx.pendingShipsOut.push({
      id: ctx.generateId('pr'),
      playerId: ctx.aiPlayerId,
      cityId: city.id,
      shipType: rec.shipType,
      spawnQ: spawn[0],
      spawnR: spawn[1],
      completesAtCycle: ctx.newCycle + 1,
    });
  }
}
