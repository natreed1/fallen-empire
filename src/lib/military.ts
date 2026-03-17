import {
  Unit, Hero, Tile, City, GameNotification, TerritoryInfo, WallSection,
  getUnitStats, ROAD_SPEED_BONUS,
  hexDistance, hexNeighbors, tileKey, generateId,
  RETREAT_DELAY_MS, ASSAULT_ATTACK_DEBUFF, HERO_BASE_HP, HERO_ATTACK,
  type Biome,
} from '@/types/game';
import { getUnitAttack, getUnitDefense, awardXp } from './combat';
import { computeTradeClusters, getUnitSupplyInfo, getUnitSupplyInfoFromMap, TradeCluster, type SupplyCostMap } from '@/lib/logistics';
import { SUPPLY_QUALITY_THRESHOLD } from '@/types/game';

const TOWER_DEFENSE_BONUS = 0.10;

function hasTowerAt(_q: number, _r: number, _cities: City[]): boolean {
  return false; // scout towers removed
}

function applyTowerDefense(damage: number, targetQ: number, targetR: number, cities: City[]): number {
  if (hasTowerAt(targetQ, targetR, cities)) {
    return Math.max(1, Math.floor(damage * (1 - TOWER_DEFENSE_BONUS)));
  }
  return damage;
}

/** Reduce damage by defender's defense: finalDamage = max(1, attack - defense). Applied after raw attack, before tower/assault/resist. */
function applyDefense(rawDamage: number, defender: Unit, defenderHero?: Hero): number {
  const def = getUnitDefense(defender, defenderHero);
  return Math.max(1, rawDamage - def);
}

/** Apply defender (and other unit) damage resistance. When defender is on friendly city hex, uses damageResistOnCityHex. */
function applyDamageResist(damage: number, target: Unit, cities: City[]): number {
  const stats = getUnitStats(target);
  const resist = (stats as { damageResist?: number; damageResistOnCityHex?: number }).damageResist ?? 0;
  const onCityHex = target.type === 'defender' && cities.some(c => c.ownerId === target.ownerId && c.q === target.q && c.r === target.r);
  const resistVal = onCityHex
    ? ((stats as { damageResistOnCityHex?: number }).damageResistOnCityHex ?? resist)
    : resist;
  if (resistVal <= 0) return damage;
  return Math.max(1, Math.floor(damage * (1 - resistVal)));
}

/** Terrain combat modifiers: multiplier applied to damage (defender's tile = less damage when < 1). Order: damage *= modifier then applyDamageResist. */
export function getTerrainCombatModifier(biome: Biome, _role: 'attacker' | 'defender'): number {
  switch (biome) {
    case 'forest': return _role === 'defender' ? 0.85 : 1.0;   // defender 15% less damage
    case 'mountain': return _role === 'defender' ? 0.80 : 1.0;  // defender 20% less damage
    case 'desert': return _role === 'defender' ? 1.15 : 1.0;    // defender 15% more damage
    case 'plains':
    case 'water':
    default: return 1.0;
  }
}

// ═══════════════════════════════════════════════════════════════════
//  Movement Tick — advance moving armies one step toward their target
// ═══════════════════════════════════════════════════════════════════

function isCityCenter(q: number, r: number, cities: City[]): boolean {
  return cities.some(c => c.q === q && c.r === r);
}

export function movementTick(
  units: Unit[],
  heroes: Hero[],
  tiles: Map<string, Tile>,
  wallSections: WallSection[] = [],
  cities: City[] = [],
  nowMs: number = Date.now(),
): void {
  const now = nowMs;

  // Retreat execution: when retreatAt has passed, set target to hex away from enemies (design §5, 30)
  for (const u of units) {
    if (u.hp <= 0 || u.retreatAt == null || u.retreatAt > now) continue;
    const best = pickRetreatHex(u.q, u.r, units, tiles, u.ownerId);
    if (best) {
      u.targetQ = best[0];
      u.targetR = best[1];
      u.status = 'moving';
      u.retreatAt = undefined;
    }
  }

  const armies = groupArmies(units.filter(u => u.status === 'moving' && u.targetQ !== undefined && u.hp > 0));

  for (const army of armies) {
    const leader = army[0];
    const prevQ = leader.q;
    const prevR = leader.r;
    const targetQ = leader.targetQ!;
    const targetR = leader.targetR!;

    if (leader.q === targetQ && leader.r === targetR) {
      for (const u of army) { u.status = 'idle'; u.targetQ = undefined; u.targetR = undefined; }
      continue;
    }

    const slowestSpeed = Math.min(...army.map(u => getUnitStats(u).speed));
    const earliestReady = Math.min(...army.map(u => u.nextMoveAt));
    if (now < earliestReady) continue;

    const next = stepTowardZOC(leader.q, leader.r, targetQ, targetR, tiles, units, leader.ownerId, wallSections, cities);

    if (next[0] === leader.q && next[1] === leader.r) {
      for (const u of army) { u.status = 'idle'; u.targetQ = undefined; u.targetR = undefined; }
      continue;
    }

    // Allow movement toward target even when out of supply (attack/expand); upkeepTick still applies HP loss for unsupplied units.
    // Previously we idled units here when beyond SUPPLY_VICINITY_RADIUS and the next step was further from any friendly city,
    // which stopped armies from ever reaching the enemy on 38x38 (enemy ~30+ hexes away, radius 24).

    const enemiesAtNext = units.some(u => u.q === next[0] && u.r === next[1] && u.ownerId !== leader.ownerId && u.hp > 0);
    if (enemiesAtNext) {
      for (const u of army) { u.status = 'fighting'; u.targetQ = undefined; u.targetR = undefined; }
      continue;
    }

    const destTile = tiles.get(tileKey(next[0], next[1]));
    const onRoad = destTile?.hasRoad ?? false;
    const effectiveSpeed = slowestSpeed * (onRoad ? ROAD_SPEED_BONUS : 1.0);
    const moveDelay = Math.floor(1000 / effectiveSpeed);

    for (const u of army) {
      u.q = next[0];
      u.r = next[1];
      u.nextMoveAt = now + moveDelay;
      if (u.q === targetQ && u.r === targetR) {
        u.status = 'idle'; u.targetQ = undefined; u.targetR = undefined;
      }
    }

    for (const h of heroes) {
      if (h.ownerId === leader.ownerId && h.q === prevQ && h.r === prevR) {
        h.q = next[0];
        h.r = next[1];
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
//  Combat Tick — automatic 1-second engagement resolution
// ═══════════════════════════════════════════════════════════════════

export interface CombatTickResult {
  killedUnitIds: string[];
  killedHeroIds: string[];
  notifications: GameNotification[];
  /** Hex keys (q,r) where combat occurred this tick (for ancient city: no reward if combat on that hex) */
  combatHexKeys: string[];
}

export function combatTick(
  units: Unit[],
  heroes: Hero[],
  cycle: number,
  cities: City[] = [],
  tiles: Map<string, Tile> = new Map(),
  nowMs: number = Date.now(),
): CombatTickResult {
  const killed: string[] = [];
  const killedHeroIds: string[] = [];
  const notifications: GameNotification[] = [];
  const combatHexKeys: string[] = [];
  const processed = new Set<string>();
  const now = nowMs;

  // Build hex -> units map
  const byHex: Record<string, Unit[]> = {};
  for (const u of units) {
    if (u.hp <= 0) continue;
    const key = tileKey(u.q, u.r);
    if (!byHex[key]) byHex[key] = [];
    byHex[key].push(u);
  }

  const hexKeys = Object.keys(byHex);

  // Phase A: Same-hex combat (units from different owners sharing a hex); heroes can attack and take damage
  for (const hexKey of hexKeys) {
    const hexUnits = byHex[hexKey];
    const ownerSet: Record<string, boolean> = {};
    for (const u of hexUnits) ownerSet[u.ownerId] = true;
    const owners = Object.keys(ownerSet);
    if (owners.length < 2) continue;

    const side1 = hexUnits.filter((u: Unit) => u.ownerId === owners[0] && u.hp > 0);
    const side2 = hexUnits.filter((u: Unit) => u.ownerId === owners[1] && u.hp > 0);
    const hero1 = heroes.find(h => h.q === side1[0]?.q && h.r === side1[0]?.r && h.ownerId === owners[0]);
    const hero2 = heroes.find(h => h.q === side2[0]?.q && h.r === side2[0]?.r && h.ownerId === owners[1]);

    combatHexKeys.push(hexKey);
    resolveMeleeRound(side1, side2, hero1, hero2, killed, killedHeroIds, notifications, cycle, cities, tiles);
    for (const u of side1.concat(side2)) processed.add(u.id);
  }

  // Phase B: Ranged & aggressive melee combat across hexes (design §2: auto-attack back; §32: retreat overrides)
  for (const hexKey of hexKeys) {
    const hexUnits = byHex[hexKey];
    const [q, r] = hexKey.split(',').map(Number);
    const aggressors = hexUnits.filter((u: Unit) =>
      u.stance === 'aggressive' && !processed.has(u.id) && u.hp > 0 && !u.retreatAt
    );
    if (aggressors.length === 0) continue;

    const ownerId = aggressors[0].ownerId;
    const maxRange = Math.max(...aggressors.map((u: Unit) => getUnitStats(u).range));
    const attackerHero = heroes.find(h => h.q === q && h.r === r && h.ownerId === ownerId);

    for (const otherKey of hexKeys) {
      if (otherKey === hexKey) continue;
      const otherUnits = byHex[otherKey];
      const [oq, or_] = otherKey.split(',').map(Number);
      const dist = hexDistance(q, r, oq, or_);
      if (dist > maxRange) continue;

      const enemies = otherUnits.filter((u: Unit) => u.ownerId !== ownerId && u.hp > 0);
      const enemyHero = heroes.find(h => h.q === oq && h.r === or_ && h.ownerId !== ownerId && heroHp(h) > 0);
      const defenderHero = heroes.find(h => h.q === oq && h.r === or_ && h.ownerId === (enemies[0]?.ownerId ?? enemyHero?.ownerId));
      if (enemies.length === 0 && !enemyHero) continue;

      if (!combatHexKeys.includes(hexKey)) combatHexKeys.push(hexKey);
      if (!combatHexKeys.includes(otherKey)) combatHexKeys.push(otherKey);

      for (const atk of aggressors) {
        if (processed.has(atk.id) || atk.hp <= 0) continue;
        const unitRange = getUnitStats(atk).range;
        if (dist > unitRange) continue;

        const target = enemies.find((e: Unit) => e.hp > 0);
        if (target) {
          let rawDamage = getUnitAttack(atk, attackerHero);
          let damage = applyDefense(rawDamage, target, defenderHero);
          damage = applyTowerDefense(damage, target.q, target.r, cities);
          if (atk.assaulting && isCityCenter(target.q, target.r, cities)) {
            damage = Math.max(1, Math.floor(damage * ASSAULT_ATTACK_DEBUFF));
          }
          const defTile = tiles.get(tileKey(target.q, target.r));
          damage = Math.max(1, Math.floor(damage * getTerrainCombatModifier(defTile?.biome ?? 'plains', 'defender')));
          damage = applyDamageResist(damage, target, cities);
          target.hp -= damage;
          atk.status = 'fighting';
          if (target.hp <= 0) {
            killed.push(target.id);
            const leveled = awardXp(atk, 10);
            if (leveled) {
              notifications.push({
                id: generateId('n'), turn: cycle,
                message: `${capitalize(atk.type)} leveled up to ${atk.level}!`,
                type: 'success',
              });
            }
          }
        } else if (enemyHero) {
          let damage = applyTowerDefense(getUnitAttack(atk, attackerHero), oq, or_, cities);
          const defTile = tiles.get(otherKey);
          damage = Math.max(1, Math.floor(damage * getTerrainCombatModifier(defTile?.biome ?? 'plains', 'defender')));
          const hp = (enemyHero.hp ?? HERO_BASE_HP) - damage;
          enemyHero.hp = Math.max(0, hp);
          if (enemyHero.hp <= 0) killedHeroIds.push(enemyHero.id);
        }
        processed.add(atk.id);
      }

      for (const def of enemies) {
        if (def.hp <= 0 || processed.has(def.id) || def.stance === 'passive') continue;
        if (def.retreatAt) continue;
        const defRange = getUnitStats(def).range;
        if (dist > defRange) continue;

        const counterTarget = aggressors.find((a: Unit) => a.hp > 0);
        if (!counterTarget) break;

        let rawDamage = getUnitAttack(def, defenderHero);
        let damage = applyDefense(rawDamage, counterTarget, attackerHero);
        damage = applyTowerDefense(damage, counterTarget.q, counterTarget.r, cities);
        if (def.assaulting && isCityCenter(counterTarget.q, counterTarget.r, cities)) {
          damage = Math.max(1, Math.floor(damage * ASSAULT_ATTACK_DEBUFF));
        }
        const defTile = tiles.get(hexKey);
        damage = Math.max(1, Math.floor(damage * getTerrainCombatModifier(defTile?.biome ?? 'plains', 'defender')));
        damage = applyDamageResist(damage, counterTarget, cities);
        counterTarget.hp -= damage;

        if (counterTarget.hp <= 0) {
          killed.push(counterTarget.id);
          const leveled = awardXp(def, 10);
          if (leveled) {
            notifications.push({
              id: generateId('n'), turn: cycle,
              message: `Enemy ${capitalize(def.type)} leveled up to ${def.level}!`,
              type: 'warning',
            });
          }
        }
        processed.add(def.id);
      }
    }
  }

  return { killedUnitIds: killed, killedHeroIds, notifications, combatHexKeys };
}

function heroHp(hero: Hero | undefined): number {
  return hero?.hp ?? HERO_BASE_HP;
}

function resolveMeleeRound(
  side1: Unit[], side2: Unit[],
  hero1: Hero | undefined, hero2: Hero | undefined,
  killed: string[], killedHeroIds: string[], notifications: GameNotification[], cycle: number,
  cities: City[] = [],
  tiles: Map<string, Tile> = new Map(),
) {
  for (const atk of side1) {
    if (atk.hp <= 0 || atk.retreatAt) continue;
    const unitTarget = side2.find(d => d.hp > 0);
    const heroTargetAlive = hero2 && heroHp(hero2) > 0;
    if (!unitTarget && !heroTargetAlive) break;
    let rawDmg = getUnitAttack(atk, hero1);
    if (unitTarget) {
      let dmg = applyDefense(rawDmg, unitTarget, hero2);
      dmg = applyTowerDefense(dmg, unitTarget.q, unitTarget.r, cities);
      if (atk.assaulting && isCityCenter(unitTarget.q, unitTarget.r, cities)) {
        dmg = Math.max(1, Math.floor(dmg * ASSAULT_ATTACK_DEBUFF));
      }
      const defBiome = tiles.get(tileKey(unitTarget.q, unitTarget.r))?.biome ?? 'plains';
      dmg = Math.max(1, Math.floor(dmg * getTerrainCombatModifier(defBiome, 'defender')));
      dmg = applyDamageResist(dmg, unitTarget, cities);
      unitTarget.hp -= dmg;
      atk.status = 'fighting';
      if (unitTarget.hp <= 0) { killed.push(unitTarget.id); awardXp(atk, 10); }
    } else if (hero2) {
      let dmg = applyTowerDefense(rawDmg, hero2.q, hero2.r, cities);
      const defBiome = tiles.get(tileKey(hero2.q, hero2.r))?.biome ?? 'plains';
      dmg = Math.max(1, Math.floor(dmg * getTerrainCombatModifier(defBiome, 'defender')));
      const hp = (hero2.hp ?? HERO_BASE_HP) - dmg;
      hero2.hp = Math.max(0, hp);
      atk.status = 'fighting';
      if (hero2.hp <= 0) { killedHeroIds.push(hero2.id); }
    }
  }
  for (const atk of side2) {
    if (atk.hp <= 0 || atk.retreatAt) continue;
    const unitTarget = side1.find(d => d.hp > 0);
    const heroTargetAlive = hero1 && heroHp(hero1) > 0;
    if (!unitTarget && !heroTargetAlive) break;
    let rawDmg = getUnitAttack(atk, hero2);
    if (unitTarget) {
      let dmg = applyDefense(rawDmg, unitTarget, hero1);
      dmg = applyTowerDefense(dmg, unitTarget.q, unitTarget.r, cities);
      if (atk.assaulting && isCityCenter(unitTarget.q, unitTarget.r, cities)) {
        dmg = Math.max(1, Math.floor(dmg * ASSAULT_ATTACK_DEBUFF));
      }
      const defBiome = tiles.get(tileKey(unitTarget.q, unitTarget.r))?.biome ?? 'plains';
      dmg = Math.max(1, Math.floor(dmg * getTerrainCombatModifier(defBiome, 'defender')));
      dmg = applyDamageResist(dmg, unitTarget, cities);
      unitTarget.hp -= dmg;
      atk.status = 'fighting';
      if (unitTarget.hp <= 0) { killed.push(unitTarget.id); awardXp(atk, 10); }
    } else if (hero1) {
      let dmg = applyTowerDefense(rawDmg, hero1.q, hero1.r, cities);
      const defBiome = tiles.get(tileKey(hero1.q, hero1.r))?.biome ?? 'plains';
      dmg = Math.max(1, Math.floor(dmg * getTerrainCombatModifier(defBiome, 'defender')));
      const hp = (hero1.hp ?? HERO_BASE_HP) - dmg;
      hero1.hp = Math.max(0, hp);
      atk.status = 'fighting';
      if (hero1.hp <= 0) { killedHeroIds.push(hero1.id); }
    }
  }
  if (hero1 && heroHp(hero1) > 0) {
    const target = side2.find(d => d.hp > 0);
    if (target) {
      let dmg = applyTowerDefense(HERO_ATTACK, target.q, target.r, cities);
      const defBiome = tiles.get(tileKey(target.q, target.r))?.biome ?? 'plains';
      dmg = Math.max(1, Math.floor(dmg * getTerrainCombatModifier(defBiome, 'defender')));
      const afterResist = applyDamageResist(dmg, target, cities);
      target.hp -= afterResist;
      if (target.hp <= 0) { killed.push(target.id); }
    }
  }
  if (hero2 && heroHp(hero2) > 0) {
    const target = side1.find(d => d.hp > 0);
    if (target) {
      let dmg = applyTowerDefense(HERO_ATTACK, target.q, target.r, cities);
      const defBiome = tiles.get(tileKey(target.q, target.r))?.biome ?? 'plains';
      dmg = Math.max(1, Math.floor(dmg * getTerrainCombatModifier(defBiome, 'defender')));
      const afterResist = applyDamageResist(dmg, target, cities);
      target.hp -= afterResist;
      if (target.hp <= 0) { killed.push(target.id); }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
//  Upkeep Tick — 30s consumption: 1 food + 1 gun per unit
// ═══════════════════════════════════════════════════════════════════

export interface UpkeepResult {
  notifications: GameNotification[];
}

/** Cache entry for unit supply: avoid recomputing when position unchanged. */
export type SupplyCacheEntry = { clusterKey: string | null; supplyQuality: number; q: number; r: number };

export function upkeepTick(
  units: Unit[],
  cities: City[],
  heroes: Hero[],
  cycle: number,
  tiles: Map<string, Tile>,
  territory: Map<string, TerritoryInfo>,
  precomputedClusters?: Map<string, TradeCluster[]>,
  supplyCache?: Map<string, SupplyCacheEntry>,
  supplyCostMaps?: Map<string, SupplyCostMap>,
): UpkeepResult {
  const notifications: GameNotification[] = [];
  const clusters = precomputedClusters ?? computeTradeClusters(cities, tiles, units, territory);

  const byOwner: Record<string, Unit[]> = {};
  for (const u of units) {
    if (u.hp <= 0) continue;
    if (!byOwner[u.ownerId]) byOwner[u.ownerId] = [];
    byOwner[u.ownerId].push(u);
  }

  for (const ownerId of Object.keys(byOwner)) {
    const playerUnits = byOwner[ownerId];
    const playerClusters = clusters.get(ownerId) ?? [];
    const supplyMap = supplyCostMaps?.get(ownerId);
    const isHuman = ownerId.includes('human');

    // Index cluster by key for O(1) lookup (avoids repeated playerClusters.find)
    const clusterByKey = new Map<string, TradeCluster>();
    for (const c of playerClusters) clusterByKey.set(c.cityIds.join(','), c);
    // Index logistician heroes by hex for O(1) lookup per unit (avoids heroes.find per unit)
    const heroLogisticianByHex = new Map<string, Hero>();
    for (const h of heroes) {
      if (h.ownerId === ownerId && h.type === 'logistician') heroLogisticianByHex.set(tileKey(h.q, h.r), h);
    }

    // Group units by supplying cluster (null = cut off or supplyQuality below threshold); use cache when position unchanged
    const unitsByCluster = new Map<string | null, Unit[]>();
    for (const u of playerUnits) {
      let key: string | null;
      let supplyQuality: number;
      const cached = supplyCache?.get(u.id);
      if (cached && cached.q === u.q && cached.r === u.r) {
        key = cached.clusterKey;
        supplyQuality = cached.supplyQuality;
      } else {
        const info = supplyMap
          ? getUnitSupplyInfoFromMap(u, supplyMap)
          : getUnitSupplyInfo(u, playerClusters, tiles, units, ownerId);
        key = info.supplyQuality >= SUPPLY_QUALITY_THRESHOLD ? info.clusterKey : null;
        supplyQuality = info.supplyQuality;
        if (supplyCache) supplyCache.set(u.id, { clusterKey: info.clusterKey, supplyQuality, q: u.q, r: u.r });
      }
      if (!unitsByCluster.has(key)) unitsByCluster.set(key, []);
      unitsByCluster.get(key)!.push(u);
    }

    // Process each cluster
    for (const [clusterKey, clusterUnits] of unitsByCluster) {
      const unsupplied = clusterKey === null;
      if (unsupplied) {
        for (const u of clusterUnits) {
          const hpLoss = Math.floor(u.maxHp * 0.05);
          u.hp = Math.max(1, u.hp - hpLoss);
          u.status = 'starving';
        }
        if (isHuman && clusterUnits.length > 0) {
          notifications.push({
            id: generateId('n'), turn: cycle,
            message: 'Units cut off from supply! Losing HP. Move closer to cities.',
            type: 'danger',
          });
        }
        continue;
      }

      const cluster = clusterByKey.get(clusterKey);
      if (!cluster) continue;
      const clusterCities = cluster.cities;

      let totalFoodDemand = 0;
      let totalGunDemand = 0;
      let totalGunL2Demand = 0;
      for (const u of clusterUnits) {
        const stats = getUnitStats(u);
        let foodUp = stats.foodUpkeep;
        const heroAtUnit = heroLogisticianByHex.get(tileKey(u.q, u.r));
        if (heroAtUnit) foodUp = Math.ceil(foodUp * 0.5);
        totalFoodDemand += foodUp;
        totalGunDemand += stats.gunUpkeep ?? 0;
        totalGunL2Demand += (stats as { gunL2Upkeep?: number }).gunL2Upkeep ?? 0;
      }

      const totalFood = clusterCities.reduce((s, c) => s + c.storage.food, 0);
      const totalGuns = clusterCities.reduce((s, c) => s + c.storage.guns, 0);
      const totalGunsL2 = clusterCities.reduce((s, c) => s + c.storage.gunsL2, 0);

      const foodOk = totalFood >= totalFoodDemand;
      if (foodOk) {
        deductFromCities(clusterCities, 'food', totalFoodDemand);
        for (const u of clusterUnits) {
          if (u.status === 'starving') u.status = 'idle';
        }
      } else if (totalFood > 0) {
        deductFromCities(clusterCities, 'food', totalFood);
        if (isHuman) {
          notifications.push({
            id: generateId('n'), turn: cycle,
            message: 'Army rations low! Build more farms to avoid starvation.',
            type: 'warning',
          });
        }
        for (const u of clusterUnits) {
          if (u.status === 'starving') u.status = 'idle';
        }
      } else {
        if (isHuman) {
          notifications.push({
            id: generateId('n'), turn: cycle,
            message: 'Army is starving! Units losing HP. Build more farms!',
            type: 'danger',
          });
        }
        for (const u of clusterUnits) {
          const hpLoss = Math.floor(u.maxHp * 0.05);
          u.hp = Math.max(1, u.hp - hpLoss);
          u.status = 'starving';
        }
      }

      const gunsOk = totalGuns >= totalGunDemand;
      if (gunsOk) deductFromCities(clusterCities, 'guns', totalGunDemand);
      else {
        deductFromCities(clusterCities, 'guns', totalGuns);
        if (isHuman) {
          notifications.push({
            id: generateId('n'), turn: cycle,
            message: 'Low on arms! Units fight at reduced strength. Build more factories!',
            type: 'warning',
          });
        }
      }

      const gunsL2Ok = totalGunsL2 >= totalGunL2Demand;
      if (gunsL2Ok) deductFromCities(clusterCities, 'gunsL2', totalGunL2Demand);
      else {
        deductFromCities(clusterCities, 'gunsL2', totalGunsL2);
        if (isHuman && totalGunL2Demand > 0) {
          notifications.push({
            id: generateId('n'), turn: cycle,
            message: 'Low on L2 arms! Upgraded units fight at reduced strength.',
            type: 'warning',
          });
        }
      }
    }
  }

  return { notifications };
}

function deductFromCities(cities: City[], resource: 'food' | 'guns' | 'gunsL2', amount: number) {
  let remaining = amount;
  for (const city of cities) {
    if (remaining <= 0) break;
    const deduct = Math.min(city.storage[resource], remaining);
    city.storage[resource] -= deduct;
    remaining -= deduct;
  }
}

// ═══════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════

function groupArmies(units: Unit[]): Unit[][] {
  const groups: Record<string, Unit[]> = {};
  for (const u of units) {
    const key = `${u.q},${u.r},${u.ownerId}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(u);
  }
  return Object.values(groups);
}

function pickRetreatHex(
  fromQ: number, fromR: number,
  allUnits: Unit[],
  tiles: Map<string, Tile>,
  ownerId: string,
): [number, number] | null {
  const enemies = allUnits.filter(u => u.ownerId !== ownerId && u.hp > 0);
  const neighbors = hexNeighbors(fromQ, fromR);
  let best: [number, number] | null = null;
  let bestMinDist = -1;
  for (const [nq, nr] of neighbors) {
    const tile = tiles.get(tileKey(nq, nr));
    if (!tile || tile.biome === 'water') continue;
    const hasEnemy = allUnits.some(u => u.q === nq && u.r === nr && u.ownerId !== ownerId && u.hp > 0);
    if (hasEnemy) continue;
    const minEnemyDist = enemies.length === 0 ? 99 : Math.min(...enemies.map(u => hexDistance(nq, nr, u.q, u.r)));
    if (minEnemyDist > bestMinDist) {
      bestMinDist = minEnemyDist;
      best = [nq, nr];
    }
  }
  return best;
}

function stepTowardZOC(
  fromQ: number, fromR: number,
  toQ: number, toR: number,
  tiles: Map<string, Tile>,
  allUnits: Unit[],
  ownerId: string,
  wallSections: WallSection[] = [],
  _cities: City[] = [],
): [number, number] {
  // Enemy wall blocks movement unless broken (hp <= 0). Friendly walls do not block.
  const wallByKey = new Map<string, WallSection>();
  for (const w of wallSections) {
    wallByKey.set(tileKey(w.q, w.r), w);
  }

  const neighbors = hexNeighbors(fromQ, fromR);
  let best: [number, number] = [fromQ, fromR];
  let bestDist = Infinity;

  for (const [nq, nr] of neighbors) {
    const tile = tiles.get(tileKey(nq, nr));
    if (!tile || tile.biome === 'water') continue;
    const hasEnemy = allUnits.some(u => u.q === nq && u.r === nr && u.ownerId !== ownerId && u.hp > 0);
    if (hasEnemy) continue;
    // Force engagement when paths cross: enemy at (nq,nr) moving toward us (design §26)
    const enemyMovingTowardUs = allUnits.some(
      u => u.q === nq && u.r === nr && u.ownerId !== ownerId && u.hp > 0 &&
        u.targetQ === fromQ && u.targetR === fromR
    );
    if (enemyMovingTowardUs) continue;
    const wallSection = wallByKey.get(tileKey(nq, nr));
    if (wallSection && wallSection.ownerId !== ownerId) {
      const hp = wallSection.hp ?? 1;
      if (hp > 0) continue; // intact enemy wall blocks
    }
    const d = hexDistance(nq, nr, toQ, toR);
    if (d < bestDist) {
      bestDist = d;
      best = [nq, nr];
    }
  }
  return best;
}

/** Siege tick: trebuchet (range 3) and battering ram (range 1) damage enemy wall sections (design §17–19, 29). */
export function siegeTick(
  wallSections: WallSection[],
  units: Unit[],
): void {
  const siegeTypes = ['trebuchet', 'battering_ram'] as const;
  for (const w of wallSections) {
    const hp = w.hp ?? 0;
    if (hp <= 0) continue;
    for (const u of units) {
      if (u.hp <= 0 || u.ownerId === w.ownerId) continue;
      if (!siegeTypes.includes(u.type as typeof siegeTypes[number])) continue;
      const stats = getUnitStats(u);
      const range = stats.range;
      const siegeAttack = (stats as { siegeAttack?: number }).siegeAttack ?? 0;
      if (siegeAttack <= 0) continue;
      const dist = hexDistance(u.q, u.r, w.q, w.r);
      if (dist > range) continue;
      const damage = siegeAttack;
      w.hp = Math.max(0, (w.hp ?? 0) - damage);
    }
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
