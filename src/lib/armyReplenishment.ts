import {
  type UnitStack,
  type City,
  type Player,
  type Unit,
  type UnitType,
  type RangedVariant,
  UNIT_COSTS,
  UNIT_L2_COSTS,
  UNIT_L3_COSTS,
  getUnitStats,
  isNavalUnitType,
  generateId,
} from '@/types/game';

export type ReplenishPendingLand = {
  id: string;
  playerId: string;
  cityId: string;
  type: UnitType;
  effectiveArmsLevel: 1 | 2 | 3;
  rangedVariant?: RangedVariant;
  spawnQ: number;
  spawnR: number;
  completesAtCycle: number;
  stackId?: string;
  moveToRallyAfterSpawn?: { q: number; r: number };
};

function effectiveArmsForUnit(u: Unit): 1 | 2 | 3 {
  if (u.type === 'defender' || u.type === 'crusader_knight') return 3;
  return u.armsLevel ?? 1;
}

function countStackUnits(
  units: Unit[],
  stackId: string,
  type: UnitType,
  armsLevel: 1 | 2 | 3,
  rangedVariant?: RangedVariant,
): number {
  return units.filter(u => {
    if (u.stackId !== stackId || u.hp <= 0 || isNavalUnitType(u.type)) return false;
    if (u.type !== type || effectiveArmsForUnit(u) !== armsLevel) return false;
    if (type === 'ranged' && armsLevel === 3) {
      return (u.rangedVariant ?? 'marksman') === (rangedVariant ?? 'marksman');
    }
    return true;
  }).length;
}

/** Update rally hex to centroid of live units in the stack. */
export function updateUnitStackRallyFromUnits(unitStacks: UnitStack[], units: Unit[]): UnitStack[] {
  return unitStacks.map(a => {
    const mem = units.filter(u => u.stackId === a.id && u.hp > 0 && !isNavalUnitType(u.type));
    if (mem.length === 0) return a;
    const rq = Math.round(mem.reduce((s, u) => s + u.q, 0) / mem.length);
    const rr = Math.round(mem.reduce((s, u) => s + u.r, 0) / mem.length);
    return { ...a, rallyQ: rq, rallyR: rr };
  });
}

/** @deprecated Use {@link updateUnitStackRallyFromUnits} */
export const updateArmyRallyFromUnits = updateUnitStackRallyFromUnits;

export function mergeCompositionEntry(
  composition: UnitStack['composition'],
  unitType: UnitType,
  armsLevel: 1 | 2 | 3,
  delta: number,
  rangedVariant?: RangedVariant,
): UnitStack['composition'] {
  const idx = composition.findIndex(e => {
    if (e.unitType !== unitType || e.armsLevel !== armsLevel) return false;
    if (unitType === 'ranged' && armsLevel === 3) {
      return (e.rangedVariant ?? 'marksman') === (rangedVariant ?? 'marksman');
    }
    return true;
  });
  if (idx < 0) {
    if (delta <= 0) return composition;
    const entry: import('@/types/game').StackCompositionEntry =
      unitType === 'ranged' && armsLevel === 3
        ? { unitType, armsLevel, count: delta, rangedVariant: rangedVariant ?? 'marksman' }
        : { unitType, armsLevel, count: delta };
    return [...composition, entry];
  }
  const next = composition.slice();
  const c = next[idx].count + delta;
  if (c <= 0) next.splice(idx, 1);
  else next[idx] = { ...next[idx], count: c };
  return next;
}

export interface ReplenishInput {
  unitStacks: UnitStack[];
  units: Unit[];
  cities: City[];
  players: Player[];
  cycle: number;
  pendingRecruits: { type?: UnitType; stackId?: string; effectiveArmsLevel?: number; playerId?: string }[];
}

export interface ReplenishResult {
  unitStacks: UnitStack[];
  cities: City[];
  players: Player[];
  newPending: ReplenishPendingLand[];
}

/**
 * Queue at most one replacement per stack per cycle (deferred batch); pay full recruit price when queued.
 */
export function computeArmyReplenishment(input: ReplenishInput): ReplenishResult {
  const newPending: ReplenishPendingLand[] = [];
  let cities = input.cities.map(c => ({ ...c, storage: { ...c.storage }, buildings: c.buildings.map(b => ({ ...b })) }));
  let players = input.players.map(p => ({ ...p }));
  const unitStacks = input.unitStacks.map(a => ({ ...a, composition: a.composition.map(e => ({ ...e })) }));

  const pendingKey = (pid: string, sid: string, t: UnitType, ar: number, rv?: RangedVariant) =>
    `${pid}|${sid}|${t}|${ar}|${rv ?? ''}`;
  const pendingSet = new Set<string>();
  for (const pr of input.pendingRecruits) {
    if (pr.type && pr.stackId != null && pr.effectiveArmsLevel != null && pr.playerId) {
      const prv = (pr as { rangedVariant?: RangedVariant }).rangedVariant;
      pendingSet.add(pendingKey(pr.playerId, pr.stackId, pr.type, pr.effectiveArmsLevel, prv));
    }
  }

  for (const army of unitStacks) {
    if (!army.autoReplenish) continue;
    const homeIdx = cities.findIndex(c => c.id === army.homeCityId && c.ownerId === army.ownerId);
    if (homeIdx < 0) continue;
    const home = cities[homeIdx];
    const pIdx = players.findIndex(p => p.id === army.ownerId);
    if (pIdx < 0) continue;
    let player = players[pIdx];

    const playerCities = cities.filter(c => c.ownerId === army.ownerId);
    const totalPop = playerCities.reduce((s, c) => s + c.population, 0);
    const livingTroops = input.units.filter(u => u.ownerId === army.ownerId && u.hp > 0).length;
    const pendingLand = input.pendingRecruits.filter(
      pr => 'effectiveArmsLevel' in pr && pr.playerId === army.ownerId,
    ).length;

    const barracks = home.buildings.find(b => b.type === 'barracks');
    const barracksLvl = barracks ? (barracks.level ?? 1) : 1;

    for (const entry of army.composition) {
      if (entry.count <= 0) continue;
      const entryRv = entry.unitType === 'ranged' && entry.armsLevel === 3 ? entry.rangedVariant : undefined;
      const have = countStackUnits(
        input.units,
        army.id,
        entry.unitType,
        entry.armsLevel,
        entryRv,
      );
      if (have >= entry.count) continue;
      if (livingTroops + pendingLand >= totalPop) break;

      const t = entry.unitType;
      if (t === 'builder' || isNavalUnitType(t)) continue;
      if (t === 'horse_archer' && player.kingdomId !== 'mongols') continue;
      if (t === 'crusader_knight' && player.kingdomId !== 'crusaders') continue;
      const isSiege = t === 'trebuchet' || t === 'battering_ram';
      if (isSiege) {
        if (!home.buildings.some(b => b.type === 'siege_workshop')) continue;
      } else {
        if (!barracks) continue;
      }

      const wantL3 = entry.armsLevel === 3 || t === 'defender' || t === 'crusader_knight';
      const wantL2 = entry.armsLevel === 2 || wantL3;
      if (!isSiege) {
        if (t === 'defender' && barracksLvl < 2) continue;
        if ((wantL2 || wantL3) && t !== 'defender' && barracksLvl < 2) continue;
        if (t === 'crusader_knight' && barracksLvl < 3) continue;
      }

      const effArms: 1 | 2 | 3 =
        t === 'trebuchet' || t === 'battering_ram'
          ? 1
          : t === 'defender' || t === 'crusader_knight'
            ? 3
            : wantL3
              ? 3
              : wantL2
                ? 2
                : 1;

      let effRangedVariant: RangedVariant | undefined;
      if (t === 'ranged' && effArms === 3) {
        const doc = home.archerDoctrineL3;
        if (doc !== 'marksman' && doc !== 'longbowman') continue;
        effRangedVariant = entry.rangedVariant ?? doc;
      }

      const pk = pendingKey(army.ownerId, army.id, t, effArms, effRangedVariant);
      if (pendingSet.has(pk)) continue;

      const goldCost = wantL3 ? UNIT_L3_COSTS[t].gold : wantL2 ? UNIT_L2_COSTS[t].gold : UNIT_COSTS[t].gold;
      const stoneCost = wantL2 ? (UNIT_L2_COSTS[t].stone ?? 0) : 0;
      const ironCost = wantL3 ? (UNIT_L3_COSTS[t].iron ?? 0) : 0;
      const refinedWoodCost = wantL3
        ? (UNIT_L3_COSTS[t].refinedWood ?? 0)
        : wantL2
          ? (UNIT_L2_COSTS[t].refinedWood ?? 0)
          : (UNIT_COSTS[t].refinedWood ?? 0);

      if (player.gold < goldCost) continue;
      if (stoneCost > 0 && (home.storage.stone ?? 0) < stoneCost) continue;
      if (ironCost > 0 && (home.storage.iron ?? 0) < ironCost) continue;
      if (refinedWoodCost > 0 && (home.storage.refinedWood ?? 0) < refinedWoodCost) continue;

      const stats = getUnitStats({
        type: t,
        armsLevel: effArms,
        rangedVariant: effRangedVariant,
      });
      const gunL2Upkeep = (stats as { gunL2Upkeep?: number }).gunL2Upkeep ?? 0;
      if (gunL2Upkeep > 0) {
        const totalGunsL2 = playerCities.reduce((sum, c) => sum + (c.storage.gunsL2 ?? 0), 0);
        if (totalGunsL2 < gunL2Upkeep) continue;
      }

      player = { ...player, gold: player.gold - goldCost };
      players = players.slice();
      players[pIdx] = player;

      let nextHome = { ...home };
      if (stoneCost > 0 || ironCost > 0 || refinedWoodCost > 0) {
        nextHome = {
          ...nextHome,
          storage: {
            ...nextHome.storage,
            stone: Math.max(0, (nextHome.storage.stone ?? 0) - stoneCost),
            iron: Math.max(0, (nextHome.storage.iron ?? 0) - ironCost),
            refinedWood: Math.max(0, (nextHome.storage.refinedWood ?? 0) - refinedWoodCost),
          },
        };
      }
      cities = cities.slice();
      if (gunL2Upkeep > 0) {
        for (let i = 0; i < cities.length; i++) {
          if (cities[i].ownerId !== army.ownerId) continue;
          if ((cities[i].storage.gunsL2 ?? 0) >= gunL2Upkeep) {
            cities[i] = {
              ...cities[i],
              storage: {
                ...cities[i].storage,
                gunsL2: (cities[i].storage.gunsL2 ?? 0) - gunL2Upkeep,
              },
            };
            break;
          }
        }
      }
      cities[homeIdx] = nextHome;

      newPending.push({
        id: generateId('pr'),
        playerId: army.ownerId,
        cityId: home.id,
        type: t,
        effectiveArmsLevel: effArms,
        ...(effRangedVariant ? { rangedVariant: effRangedVariant } : {}),
        spawnQ: home.q,
        spawnR: home.r,
        completesAtCycle: input.cycle + 1,
        stackId: army.id,
        moveToRallyAfterSpawn: { q: army.rallyQ, r: army.rallyR },
      });
      pendingSet.add(pk);
      break;
    }
  }

  return { unitStacks, cities, players, newPending };
}
