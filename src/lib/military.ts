import {
  Unit, Hero, Tile, City, GameNotification, TerritoryInfo, WallSection,
  UNIT_BASE_STATS, UNIT_L2_STATS, ROAD_SPEED_BONUS,
  hexDistance, hexNeighbors, tileKey, generateId,
  RETREAT_DELAY_MS, ASSAULT_ATTACK_DEBUFF,
} from '@/types/game';
import { getUnitAttack, awardXp } from './combat';
import { computeTradeClusters, getSupplyingClusterKey } from '@/lib/logistics';

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

    const slowestSpeed = Math.min(...army.map(u => (u.armsLevel === 2 ? UNIT_L2_STATS[u.type] : UNIT_BASE_STATS[u.type]).speed));
    const earliestReady = Math.min(...army.map(u => u.nextMoveAt));
    if (now < earliestReady) continue;

    const next = stepTowardZOC(leader.q, leader.r, targetQ, targetR, tiles, units, leader.ownerId, wallSections, cities);

    if (next[0] === leader.q && next[1] === leader.r) {
      for (const u of army) { u.status = 'idle'; u.targetQ = undefined; u.targetR = undefined; }
      continue;
    }

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
  notifications: GameNotification[];
  /** Hex keys (q,r) where combat occurred this tick (for ancient city: no reward if combat on that hex) */
  combatHexKeys: string[];
}

export function combatTick(
  units: Unit[],
  heroes: Hero[],
  cycle: number,
  cities: City[] = [],
  nowMs: number = Date.now(),
): CombatTickResult {
  const killed: string[] = [];
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

  // Phase A: Same-hex combat (units from different owners sharing a hex)
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
    resolveMeleeRound(side1, side2, hero1, hero2, killed, notifications, cycle, cities);
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
    const maxRange = Math.max(...aggressors.map((u: Unit) => UNIT_BASE_STATS[u.type].range));
    const attackerHero = heroes.find(h => h.q === q && h.r === r && h.ownerId === ownerId);

    for (const otherKey of hexKeys) {
      if (otherKey === hexKey) continue;
      const otherUnits = byHex[otherKey];
      const [oq, or_] = otherKey.split(',').map(Number);
      const dist = hexDistance(q, r, oq, or_);
      if (dist > maxRange) continue;

      const enemies = otherUnits.filter((u: Unit) => u.ownerId !== ownerId && u.hp > 0);
      if (enemies.length === 0) continue;

      if (!combatHexKeys.includes(hexKey)) combatHexKeys.push(hexKey);
      if (!combatHexKeys.includes(otherKey)) combatHexKeys.push(otherKey);

      for (const atk of aggressors) {
        if (processed.has(atk.id) || atk.hp <= 0) continue;
        const unitRange = UNIT_BASE_STATS[atk.type].range;
        if (dist > unitRange) continue;

        const target = enemies.find((e: Unit) => e.hp > 0);
        if (!target) break;

        let rawDamage = getUnitAttack(atk, attackerHero);
        let damage = applyTowerDefense(rawDamage, target.q, target.r, cities);
        if (atk.assaulting && isCityCenter(target.q, target.r, cities)) {
          damage = Math.max(1, Math.floor(damage * ASSAULT_ATTACK_DEBUFF));
        }
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
        processed.add(atk.id);
      }

      const defenderHero = heroes.find(h => h.q === oq && h.r === or_ && h.ownerId === enemies[0]?.ownerId);
      for (const def of enemies) {
        if (def.hp <= 0 || processed.has(def.id) || def.stance === 'passive') continue;
        if (def.retreatAt) continue;
        const defRange = UNIT_BASE_STATS[def.type].range;
        if (dist > defRange) continue;

        const counterTarget = aggressors.find((a: Unit) => a.hp > 0);
        if (!counterTarget) break;

        let rawDamage = getUnitAttack(def, defenderHero);
        let damage = applyTowerDefense(rawDamage, counterTarget.q, counterTarget.r, cities);
        if (def.assaulting && isCityCenter(counterTarget.q, counterTarget.r, cities)) {
          damage = Math.max(1, Math.floor(damage * ASSAULT_ATTACK_DEBUFF));
        }
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

  return { killedUnitIds: killed, notifications, combatHexKeys };
}

function resolveMeleeRound(
  side1: Unit[], side2: Unit[],
  hero1: Hero | undefined, hero2: Hero | undefined,
  killed: string[], notifications: GameNotification[], cycle: number,
  cities: City[] = [],
) {
  const now = Date.now();
  for (const atk of side1) {
    if (atk.hp <= 0 || atk.retreatAt) continue;
    const target = side2.find(d => d.hp > 0);
    if (!target) break;
    let rawDmg = getUnitAttack(atk, hero1);
    let dmg = applyTowerDefense(rawDmg, target.q, target.r, cities);
    if (atk.assaulting && isCityCenter(target.q, target.r, cities)) {
      dmg = Math.max(1, Math.floor(dmg * ASSAULT_ATTACK_DEBUFF));
    }
    target.hp -= dmg;
    atk.status = 'fighting';
    if (target.hp <= 0) { killed.push(target.id); awardXp(atk, 10); }
  }
  for (const atk of side2) {
    if (atk.hp <= 0 || atk.retreatAt) continue;
    const target = side1.find(d => d.hp > 0);
    if (!target) break;
    let rawDmg = getUnitAttack(atk, hero2);
    let dmg = applyTowerDefense(rawDmg, target.q, target.r, cities);
    if (atk.assaulting && isCityCenter(target.q, target.r, cities)) {
      dmg = Math.max(1, Math.floor(dmg * ASSAULT_ATTACK_DEBUFF));
    }
    target.hp -= dmg;
    atk.status = 'fighting';
    if (target.hp <= 0) { killed.push(target.id); awardXp(atk, 10); }
  }
}

// ═══════════════════════════════════════════════════════════════════
//  Upkeep Tick — 30s consumption: 1 food + 1 gun per unit
// ═══════════════════════════════════════════════════════════════════

export interface UpkeepResult {
  notifications: GameNotification[];
}

export function upkeepTick(
  units: Unit[],
  cities: City[],
  heroes: Hero[],
  cycle: number,
  tiles: Map<string, Tile>,
  territory: Map<string, TerritoryInfo>,
): UpkeepResult {
  const notifications: GameNotification[] = [];
  const clusters = computeTradeClusters(cities, tiles, units, territory);

  const byOwner: Record<string, Unit[]> = {};
  for (const u of units) {
    if (u.hp <= 0) continue;
    if (!byOwner[u.ownerId]) byOwner[u.ownerId] = [];
    byOwner[u.ownerId].push(u);
  }

  for (const ownerId of Object.keys(byOwner)) {
    const playerUnits = byOwner[ownerId];
    const playerClusters = clusters.get(ownerId) ?? [];
    const isHuman = ownerId.includes('human');

    // Group units by supplying cluster (null = cut off, no supply)
    const unitsByCluster = new Map<string | null, Unit[]>();
    for (const u of playerUnits) {
      const key = getSupplyingClusterKey(u, playerClusters, tiles, units, ownerId);
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

      const cluster = playerClusters.find(c => c.cityIds.join(',') === clusterKey);
      if (!cluster) continue;
      const clusterCities = cluster.cities;

      let totalFoodDemand = 0;
      let totalGunDemand = 0;
      let totalGunL2Demand = 0;
      for (const u of clusterUnits) {
        const stats = u.armsLevel === 2 ? UNIT_L2_STATS[u.type] : UNIT_BASE_STATS[u.type];
        let foodUp = stats.foodUpkeep;
        const heroAtUnit = heroes.find(
          h => h.q === u.q && h.r === u.r && h.ownerId === u.ownerId && h.type === 'logistician'
        );
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
      const stats = u.armsLevel === 2 ? UNIT_L2_STATS[u.type] : UNIT_BASE_STATS[u.type];
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
