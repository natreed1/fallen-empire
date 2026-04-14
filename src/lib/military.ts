import {
  Unit, Hero, Tile, City, GameNotification, TerritoryInfo, WallSection, Player,
  TERRITORY_RADIUS, GARRISON_PATROL_RADIUS_MIN, GARRISON_PATROL_RADIUS_MAX,
  defaultCityBuildingMaxHp,
  PATROL_DEFAULT_RADIUS,
  DefenseInstallation,
  getUnitStats, ROAD_SPEED_BONUS,
  hexDistance, hexNeighbors, tileKey, parseTileKey, generateId,
  RETREAT_DELAY_MS, ASSAULT_ATTACK_DEBUFF, HERO_BASE_HP, HERO_ATTACK,
  isNavalUnitType, getShipMaxCargo,
  DEFENSE_TOWER_MORTAR_RANGE,
  DEFENSE_TOWER_ARCHER_RANGE,
  DEFENSE_TOWER_BALLISTA_RANGE,
  COMBAT_UNIT_DAMAGE_SCALE,
  COMBAT_KILL_XP,
  COMBAT_HIT_FULL_CHANCE,
  COMBAT_HIT_GLANCE_CHANCE,
  COMBAT_GLANCE_DAMAGE_MULT,
  UNIT_MOVEMENT_DELAY_MULT,
  MONGOL_LAND_SPEED_MULT,
  SCROLL_COMBAT_BONUS,
  SCROLL_DEFENSE_BONUS,
  SCROLL_MOVEMENT_BONUS,
  COASTAL_BOMBARD_RANGE,
  COASTAL_BOMBARD_DIRECT_HIT_CHANCE,
  COASTAL_BOMBARD_WALL_DAMAGE,
  COASTAL_BOMBARD_UNIT_BASE,
  COASTAL_BOMBARD_SPLASH_FULL_CHANCE,
  COASTAL_BOMBARD_SPLASH_GLANCE_CHANCE,
  COASTAL_BOMBARD_SPLASH_GLANCE_MULT,
  type ScrollAttachment,
  type Commander,
  MORALE_ROUT_THRESHOLD,
  isCityBuildingOperational,
} from '@/types/game';
import { armyHasMovementScroll, hexHasScrollKind } from '@/lib/scrolls';
import {
  commanderAttackMultiplierForUnit,
  commanderDefenseDamageFactorForUnit,
  commanderAppliesToUnit,
} from '@/lib/commanders';
import {
  getUnitAttack, awardXp,
  getTerrainAttackModifier, getTerrainDefenseModifier, getRiverCrossingPenalty,
  getCounterMultiplier, getFlankingBonus,
  getStanceAttackMult, getStanceDefenseMult,
  type MoraleState, initMorale, getStackMorale, setStackMorale,
  adjustMoraleOnKill, adjustMoraleOnHeroDeath, tickMorale,
  getMoraleAttackPenalty, shouldRout,
  getShieldWallDefenseBonus, getShieldWallAttackPenalty, getVolleyFireBonus, getChargeBonus,
} from './combat';
import { isUnitInSupplyVicinityOfPlayerCities } from '@/lib/empireEconomy';
import { tryReGarrisonIdleUnit, isLandMilitaryUnit, marchHexDistanceAtOrder, applyDeployFlagsForMoveMutable } from '@/lib/garrison';
import { getCityTerritory } from '@/lib/territory';

const TOWER_DEFENSE_BONUS = 0.10;

function clearMarchFields(u: Unit): void {
  delete u.marchInitialHexDistance;
  delete u.moveLegMs;
}

function hasTowerAt(_q: number, _r: number, _cities: City[]): boolean {
  return false; // scout towers removed
}

function applyTowerDefense(damage: number, targetQ: number, targetR: number, cities: City[]): number {
  if (hasTowerAt(targetQ, targetR, cities)) {
    return Math.max(1, Math.floor(damage * (1 - TOWER_DEFENSE_BONUS)));
  }
  return damage;
}

function landTargetableByDefenseTower(u: Unit): boolean {
  return u.hp > 0 && !u.aboardShipId && !isNavalUnitType(u.type);
}

function hasEnemyLandInSameHex(u: Unit, units: Unit[]): boolean {
  return units.some(
    o =>
      o.id !== u.id &&
      o.hp > 0 &&
      o.ownerId !== u.ownerId &&
      o.q === u.q &&
      o.r === u.r &&
      !o.aboardShipId &&
      !isNavalUnitType(o.type),
  );
}

function maybeApplyRetaliation(
  victim: Unit,
  source: { attackerUnitId?: string; defenseId?: string },
  units: Unit[],
  defenseInstallations?: DefenseInstallation[],
): void {
  if (victim.hp <= 0) return;
  if (!isLandMilitaryUnit(victim) && victim.type !== 'builder') return;
  if (isNavalUnitType(victim.type)) return;
  if (victim.retreatAt) return;
  if (hasEnemyLandInSameHex(victim, units)) return;

  if (victim.retaliateDefenseId && source.attackerUnitId) {
    const inst = defenseInstallations?.find(i => i.id === victim.retaliateDefenseId);
    if (inst && hexDistance(victim.q, victim.r, inst.q, inst.r) <= 1) return;
  }

  if (source.attackerUnitId && source.attackerUnitId !== victim.id) {
    victim.retaliateUnitId = source.attackerUnitId;
    delete victim.retaliateDefenseId;
    delete victim.attackBuildingTarget;
  } else if (source.defenseId) {
    victim.retaliateDefenseId = source.defenseId;
    delete victim.retaliateUnitId;
    delete victim.attackBuildingTarget;
  }
}

function applyPursuitOrders(
  units: Unit[],
  _heroes: Hero[],
  _tiles: Map<string, Tile>,
  _wallSections: WallSection[],
  cities: City[],
  now: number,
  defenseInstallations?: DefenseInstallation[],
): void {
  for (const u of units) {
    if (u.hp <= 0 || u.aboardShipId || u.retreatAt) continue;
    if (!isLandMilitaryUnit(u) || u.type === 'builder' || isNavalUnitType(u.type)) continue;
    if (u.marchEchelonHold || u.attackWaveHold) continue;
    if (u.stance === 'hold_the_line') continue;

    const meleeLock = hasEnemyLandInSameHex(u, units);

    if (u.retaliateUnitId) {
      if (meleeLock) continue;
      const target = units.find(x => x.id === u.retaliateUnitId && x.hp > 0);
      if (!target) {
        delete u.retaliateUnitId;
        continue;
      }
      u.targetQ = target.q;
      u.targetR = target.r;
      if (u.status === 'idle' || u.status === 'fighting') {
        u.status = 'moving';
        u.nextMoveAt = Math.min(u.nextMoveAt, now);
      }
      continue;
    }

    if (u.retaliateDefenseId) {
      if (meleeLock) continue;
      const tower = defenseInstallations?.find(d => d.id === u.retaliateDefenseId);
      if (!tower) {
        delete u.retaliateDefenseId;
        continue;
      }
      u.targetQ = tower.q;
      u.targetR = tower.r;
      if (u.status === 'idle' || u.status === 'fighting') {
        u.status = 'moving';
        u.nextMoveAt = Math.min(u.nextMoveAt, now);
      }
      continue;
    }

    if (u.attackBuildingTarget) {
      if (meleeLock) continue;
      const city = cities.find(c => c.id === u.attackBuildingTarget!.cityId);
      if (!city || city.ownerId === u.ownerId) {
        delete u.attackBuildingTarget;
        continue;
      }
      const b = city.buildings.find(
        x => x.q === u.attackBuildingTarget!.q && x.r === u.attackBuildingTarget!.r,
      );
      if (!b || !isCityBuildingOperational(b)) {
        delete u.attackBuildingTarget;
        continue;
      }
      const bq = b.q;
      const br = b.r;
      const dist = hexDistance(u.q, u.r, bq, br);
      const stats = getUnitStats(u);
      const inRange = stats.range <= 1 ? dist <= 1 : dist <= stats.range && dist > 0;
      if (inRange) continue;
      u.targetQ = bq;
      u.targetR = br;
      if (u.status === 'idle' || u.status === 'fighting') {
        u.status = 'moving';
        u.nextMoveAt = Math.min(u.nextMoveAt, now);
      }
    }
  }
}

function defenseTowerTerritoryActive(t: DefenseInstallation, territory: Map<string, TerritoryInfo>): boolean {
  const info = territory.get(tileKey(t.q, t.r));
  return !!(info && info.playerId === t.ownerId && info.cityId === t.cityId);
}

function mortarSplashDamagePerUnit(level: number): number {
  return Math.max(1, Math.floor(1.75 * (0.75 + 0.15 * level)));
}

function archerTowerShotDamage(level: number): number {
  return Math.max(1, Math.floor(6 * (0.8 + 0.12 * level)));
}

function ballistaShotDamage(level: number): number {
  // Tuned so L1 ballista can kill several L1 infantry at range before they close (still scaled by COMBAT_UNIT_DAMAGE_SCALE).
  return Math.max(1, Math.floor(11 * (0.82 + 0.11 * level)));
}

/** Scale damage for land/naval unit-vs-unit combat (not static defenses). */
function scaleLandCombatDamageToUnit(damage: number): number {
  if (damage <= 0) return 0;
  return Math.max(0, Math.floor(damage * COMBAT_UNIT_DAMAGE_SCALE));
}

/** Deterministic 0..1 roll for hit / glance / miss (stable given cycle, time, ids, salt). */
export function combatRoll01(
  cycle: number,
  nowMs: number,
  attackerId: string,
  defenderId: string,
  salt: number,
): number {
  const tickPart = Math.floor(nowMs / 1000) | 0;
  let h = ((cycle | 0) * 1000003) >>> 0;
  h = Math.imul(h ^ tickPart, 2654435761) >>> 0;
  h = Math.imul(h ^ (salt | 0), 1597334677) >>> 0;
  for (let i = 0; i < attackerId.length; i++) h = Math.imul(h ^ attackerId.charCodeAt(i), 2246822519) >>> 0;
  for (let i = 0; i < defenderId.length; i++) h = Math.imul(h ^ defenderId.charCodeAt(i), 3266489917) >>> 0;
  return (h % 10000) / 10000;
}

function hitOutcomeFromRoll(r: number): 'full' | 'glance' | 'miss' {
  if (r < COMBAT_HIT_FULL_CHANCE) return 'full';
  if (r < COMBAT_HIT_FULL_CHANCE + COMBAT_HIT_GLANCE_CHANCE) return 'glance';
  return 'miss';
}

function applyHitOutcomeDamage(damage: number, outcome: 'full' | 'glance' | 'miss'): number {
  if (outcome === 'miss' || damage <= 0) return 0;
  if (outcome === 'glance') return Math.max(0, Math.floor(damage * COMBAT_GLANCE_DAMAGE_MULT));
  return damage;
}

function hitOutcomeFromBombardSplashRoll(r: number): 'full' | 'glance' | 'miss' {
  if (r < COASTAL_BOMBARD_SPLASH_FULL_CHANCE) return 'full';
  if (r < COASTAL_BOMBARD_SPLASH_FULL_CHANCE + COASTAL_BOMBARD_SPLASH_GLANCE_CHANCE) return 'glance';
  return 'miss';
}

function applyBombardSplashDamage(damage: number, outcome: 'full' | 'glance' | 'miss'): number {
  if (outcome === 'miss' || damage <= 0) return 0;
  if (outcome === 'glance') return Math.max(0, Math.floor(damage * COASTAL_BOMBARD_SPLASH_GLANCE_MULT));
  return damage;
}

/** When a ship sinks, cargo units aboard are also lost (same rule as combat tick). */
export function expandKilledWithCargoIds(units: Unit[], killed: string[]): string[] {
  const killedExpand = new Set(killed);
  let grew = true;
  while (grew) {
    grew = false;
    for (const id of [...killedExpand]) {
      const dead = units.find(u => u.id === id);
      if (!dead?.cargoUnitIds?.length) continue;
      for (const cid of dead.cargoUnitIds) {
        const c = units.find(u => u.id === cid);
        if (c?.aboardShipId === id && !killedExpand.has(cid)) {
          killedExpand.add(cid);
          grew = true;
        }
      }
    }
  }
  return [...killedExpand];
}

function isBombardShipType(type: Unit['type']): boolean {
  return type === 'warship' || type === 'capital_ship';
}

function landTargetableByBombardment(u: Unit): boolean {
  return u.hp > 0 && !u.aboardShipId && !isNavalUnitType(u.type);
}

function applyDefenseDamageToUnit(
  raw: number,
  target: Unit,
  cities: City[],
  killed: string[],
  units: Unit[],
  scrollAttachments?: ScrollAttachment[],
  commanders?: Commander[],
  tiles?: Map<string, Tile>,
  defenseInstallations?: DefenseInstallation[],
  fromDefenseId?: string,
): void {
  let damage = applyTowerDefense(raw, target.q, target.r, cities);
  damage = applyDamageResist(damage, target, cities, units, scrollAttachments, tiles);
  if (commanders?.length) {
    const f = commanderDefenseDamageFactorForUnit(target, commanders, cities, units);
    damage = Math.max(1, Math.floor(damage * f));
  }
  damage = scaleLandCombatDamageToUnit(damage);
  if (damage <= 0) damage = 1;
  target.hp -= damage;
  if (target.hp <= 0) killed.push(target.id);
  if (fromDefenseId) {
    maybeApplyRetaliation(target, { defenseId: fromDefenseId }, units, defenseInstallations);
  }
}

/** Volley from static city defenses (1s combat tick); mortar splashes center + neighbors. */
function defenseTowerVolley(
  installations: DefenseInstallation[],
  territory: Map<string, TerritoryInfo>,
  tiles: Map<string, Tile>,
  units: Unit[],
  heroes: Hero[],
  cities: City[],
  killed: string[],
  killedHeroIds: string[],
  combatHexKeys: string[],
  defenseVolleyFx: DefenseVolleyFx[],
  scrollAttachments?: ScrollAttachment[],
  commanders?: Commander[],
): void {
  for (const tower of installations) {
    if (!defenseTowerTerritoryActive(tower, territory)) continue;
    if (tiles.get(tileKey(tower.q, tower.r))?.biome === 'water') continue;

    const enemies = units.filter(u => landTargetableByDefenseTower(u) && u.ownerId !== tower.ownerId);
    if (enemies.length === 0) continue;

    if (tower.type === 'mortar') {
      type Cand = { q: number; r: number; count: number; dist: number };
      const byHex = new Map<string, Cand>();
      for (const u of enemies) {
        const d = hexDistance(tower.q, tower.r, u.q, u.r);
        if (d > DEFENSE_TOWER_MORTAR_RANGE) continue;
        const k = tileKey(u.q, u.r);
        const cur = byHex.get(k);
        if (!cur) byHex.set(k, { q: u.q, r: u.r, count: 1, dist: d });
        else {
          cur.count++;
          cur.dist = Math.min(cur.dist, d);
        }
      }
      if (byHex.size === 0) continue;
      let best: Cand | null = null;
      for (const c of byHex.values()) {
        if (!best || c.count > best.count || (c.count === best.count && c.dist < best.dist)) best = c;
      }
      if (!best) continue;
      const splash: [number, number][] = [[best.q, best.r], ...hexNeighbors(best.q, best.r)];
      const dmg = mortarSplashDamagePerUnit(tower.level);
      const splashKeys = new Set(splash.map(([sq, sr]) => tileKey(sq, sr)));
      for (const u of enemies) {
        if (!splashKeys.has(tileKey(u.q, u.r))) continue;
        applyDefenseDamageToUnit(dmg, u, cities, killed, units, scrollAttachments, commanders, tiles, installations, tower.id);
      }
      for (const h of heroes) {
        if (h.ownerId === tower.ownerId || heroHp(h) <= 0) continue;
        if (!splashKeys.has(tileKey(h.q, h.r))) continue;
        const hd = applyTowerDefense(dmg, h.q, h.r, cities);
        h.hp = Math.max(0, (h.hp ?? HERO_BASE_HP) - hd);
        if ((h.hp ?? 0) <= 0) killedHeroIds.push(h.id);
      }
      combatHexKeys.push(tileKey(tower.q, tower.r));
      for (const [sq, sr] of splash) {
        const hk = tileKey(sq, sr);
        if (!combatHexKeys.includes(hk)) combatHexKeys.push(hk);
      }
      defenseVolleyFx.push({
        kind: 'mortar',
        fromQ: tower.q,
        fromR: tower.r,
        splashKeys: [...splashKeys],
      });
    } else if (tower.type === 'archer_tower') {
      let best: Unit | null = null;
      let bestD = Infinity;
      for (const u of enemies) {
        const d = hexDistance(tower.q, tower.r, u.q, u.r);
        if (d > DEFENSE_TOWER_ARCHER_RANGE) continue;
        if (d < bestD) {
          bestD = d;
          best = u;
        }
      }
      if (!best) continue;
      const dmg = archerTowerShotDamage(tower.level);
      applyDefenseDamageToUnit(dmg, best, cities, killed, units, scrollAttachments, commanders, tiles, installations, tower.id);
      combatHexKeys.push(tileKey(tower.q, tower.r));
      const tk = tileKey(best.q, best.r);
      if (!combatHexKeys.includes(tk)) combatHexKeys.push(tk);
      defenseVolleyFx.push({
        kind: 'archer_tower',
        fromQ: tower.q,
        fromR: tower.r,
        targetQ: best.q,
        targetR: best.r,
      });
    } else {
      // ballista: two quick shots, range 3
      for (let s = 0; s < 2; s++) {
        let pick: Unit | null = null;
        let bestD = Infinity;
        for (const u of enemies) {
          if (u.hp <= 0) continue;
          const d = hexDistance(tower.q, tower.r, u.q, u.r);
          if (d > DEFENSE_TOWER_BALLISTA_RANGE) continue;
          if (d < bestD) {
            bestD = d;
            pick = u;
          }
        }
        if (!pick) break;
        const dmg = ballistaShotDamage(tower.level);
        applyDefenseDamageToUnit(dmg, pick, cities, killed, units, scrollAttachments, commanders, tiles, installations, tower.id);
        combatHexKeys.push(tileKey(tower.q, tower.r));
        const tk = tileKey(pick.q, pick.r);
        if (!combatHexKeys.includes(tk)) combatHexKeys.push(tk);
        defenseVolleyFx.push({
          kind: 'ballista',
          fromQ: tower.q,
          fromR: tower.r,
          targetQ: pick.q,
          targetR: pick.r,
        });
      }
    }
  }
}

function isBowUnitType(type: Unit['type']): boolean {
  return type === 'ranged' || type === 'horse_archer';
}

/** Garrisoned bow units can return ranged fire even when stance is passive/skirmish (they cannot kite inside a city). */
function garrisonCanReturnBowFire(u: Unit): boolean {
  return !!u.garrisonCityId && isBowUnitType(u.type) && getUnitStats(u).range >= 2;
}

/** Apply defender (and other unit) damage resistance including terrain, stance, and abilities. */
function applyDamageResist(
  damage: number,
  target: Unit,
  cities: City[],
  units: Unit[],
  scrollAttachments?: ScrollAttachment[],
  tiles?: Map<string, Tile>,
): number {
  const stats = getUnitStats(target);
  const resist = (stats as { damageResist?: number; damageResistOnCityHex?: number }).damageResist ?? 0;
  const onCityHex = target.type === 'defender' && cities.some(c => c.ownerId === target.ownerId && c.q === target.q && c.r === target.r);
  const resistVal = onCityHex
    ? ((stats as { damageResistOnCityHex?: number }).damageResistOnCityHex ?? resist)
    : resist;
  let d = damage;
  if (resistVal > 0) d = Math.max(1, Math.floor(d * (1 - resistVal)));
  if (
    scrollAttachments?.length &&
    hexHasScrollKind(target.q, target.r, target.ownerId, 'defense', units, scrollAttachments)
  ) {
    d = Math.max(1, Math.floor(d * (1 - SCROLL_DEFENSE_BONUS)));
  }
  const terrainDef = tiles ? getTerrainDefenseModifier(tiles.get(tileKey(target.q, target.r))) : 1.0;
  if (terrainDef > 1) d = Math.max(1, Math.floor(d / terrainDef));
  const stanceDef = getStanceDefenseMult(target.stance);
  if (stanceDef > 1) d = Math.max(1, Math.floor(d / stanceDef));
  const shieldWall = getShieldWallDefenseBonus(target);
  if (shieldWall > 0) d = Math.max(1, Math.floor(d * (1 - shieldWall)));
  return d;
}

// ═══════════════════════════════════════════════════════════════════
//  Movement Tick — advance moving armies one step toward their target
// ═══════════════════════════════════════════════════════════════════

function isCityCenter(q: number, r: number, cities: City[]): boolean {
  return cities.some(c => c.q === q && c.r === r);
}

/** Land units that contest city capture (excludes builder, naval, units aboard a ship). */
export function landMilitaryContestsCityCapture(u: Unit, q: number, r: number): boolean {
  return (
    u.q === q &&
    u.r === r &&
    u.hp > 0 &&
    !u.aboardShipId &&
    u.type !== 'builder' &&
    !isNavalUnitType(u.type)
  );
}

export function enemyIntactWallOnCityHex(wallSections: WallSection[], city: City): boolean {
  return wallSections.some(
    w =>
      w.q === city.q &&
      w.r === city.r &&
      w.ownerId === city.ownerId &&
      (w.hp ?? 0) > 0,
  );
}

export interface ClosingFireResult {
  killedUnitIds: string[];
  notifications: GameNotification[];
  rangedShotFx: RangedShotFx[];
}

/** Ranged units auto-fire at an army that just moved into their range (overwatch). */
function closingFireOnArmy(
  movedArmy: Unit[],
  allUnits: Unit[],
  heroes: Hero[],
  cities: City[],
  cycle: number,
  nowMs: number,
  result: ClosingFireResult,
  scrollAttachments?: ScrollAttachment[],
  commanders: Commander[] = [],
  defenseInstallations?: DefenseInstallation[],
): void {
  const leader = movedArmy[0];
  if (!leader || leader.hp <= 0) return;
  if (isNavalUnitType(leader.type)) return;

  const armyQ = leader.q;
  const armyR = leader.r;

  for (const shooter of allUnits) {
    if (shooter.hp <= 0) continue;
    if (shooter.ownerId === leader.ownerId) continue;
    if (shooter.aboardShipId) continue;
    if (isNavalUnitType(shooter.type)) continue;
    if (!isBowUnitType(shooter.type)) continue;
    if (shooter.retreatAt) continue;

    const range = getUnitStats(shooter).range;
    const dist = hexDistance(shooter.q, shooter.r, armyQ, armyR);
    if (dist > range || dist === 0) continue;

    const shooterInMelee = allUnits.some(
      u => u.q === shooter.q && u.r === shooter.r &&
        u.ownerId !== shooter.ownerId && u.hp > 0 &&
        !u.aboardShipId && !isNavalUnitType(u.type),
    );
    if (shooterInMelee) continue;

    const target = movedArmy.find(u => u.hp > 0 && !u.aboardShipId);
    if (!target) break;

    const shooterHero = heroes.find(
      h => h.q === shooter.q && h.r === shooter.r && h.ownerId === shooter.ownerId,
    );
    const atkMult = combatScrollMult(allUnits, shooter, scrollAttachments);
    const cmdAtk = commanderAttackMultiplierForUnit(shooter, commanders, cities, allUnits);
    let rawDamage = getUnitAttack(shooter, shooterHero, { attackMult: atkMult, commanderAttackMult: cmdAtk });
    let damage = applyTowerDefense(rawDamage, target.q, target.r, cities);
    damage = applyDamageResist(damage, target, cities, allUnits, scrollAttachments);
    damage = Math.max(1, Math.floor(damage * commanderDefenseDamageFactorForUnit(target, commanders, cities, allUnits)));
    damage = scaleLandCombatDamageToUnit(damage);
    const ro = combatRoll01(cycle, nowMs, shooter.id, target.id, 300);
    damage = applyHitOutcomeDamage(damage, hitOutcomeFromRoll(ro));

    target.hp -= damage;
    maybeApplyRetaliation(target, { attackerUnitId: shooter.id }, allUnits, defenseInstallations);

    result.rangedShotFx.push({
      attackerId: shooter.id,
      fromQ: shooter.q,
      fromR: shooter.r,
      toQ: armyQ,
      toR: armyR,
    });

    if (target.hp <= 0) {
      result.killedUnitIds.push(target.id);
      const leveled = awardXp(shooter, COMBAT_KILL_XP);
      if (leveled) {
        result.notifications.push({
          id: generateId('n'),
          turn: cycle,
          message: `${capitalize(shooter.type)} leveled up to ${shooter.level}!`,
          type: 'success',
        });
      }
    }
  }
}

export function movementTick(
  units: Unit[],
  heroes: Hero[],
  tiles: Map<string, Tile>,
  wallSections: WallSection[] = [],
  cities: City[] = [],
  nowMs: number = Date.now(),
  players: Player[] = [],
  scrollAttachments?: ScrollAttachment[],
  cycle: number = 0,
  commanders: Commander[] = [],
  territory?: Map<string, TerritoryInfo>,
  defenseInstallations?: DefenseInstallation[],
): ClosingFireResult {
  const now = nowMs;
  const closingFireRes: ClosingFireResult = { killedUnitIds: [], notifications: [], rangedShotFx: [] };

  applyPursuitOrders(units, heroes, tiles, wallSections, cities, now, defenseInstallations);

  // Retreat execution: when retreatAt has passed, set target to hex away from enemies (design §5, 30)
  for (const u of units) {
    if (u.hp <= 0 || u.retreatAt == null || u.retreatAt > now || u.aboardShipId) continue;
    const best = pickRetreatHex(u.q, u.r, units, tiles, u.ownerId, isNavalUnitType(u.type));
    if (best) {
      u.targetQ = best[0];
      u.targetR = best[1];
      u.status = 'moving';
      u.retreatAt = undefined;
      u.marchInitialHexDistance = Math.max(1, hexDistance(u.q, u.r, best[0], best[1]));
    }
  }

  const moving = units.filter(u => u.status === 'moving' && u.targetQ !== undefined && u.hp > 0 && !u.aboardShipId);
  const landArmies = groupArmies(moving.filter(u => !isNavalUnitType(u.type)));
  const navalArmies = groupArmies(moving.filter(u => isNavalUnitType(u.type)));

  const advanceArmy = (army: Unit[], naval: boolean) => {
    const leader = army[0];
    const prevQ = leader.q;
    const prevR = leader.r;
    const targetQ = leader.targetQ!;
    const targetR = leader.targetR!;

    if (leader.q === targetQ && leader.r === targetR) {
      for (const u of army) {
        u.status = 'idle'; u.targetQ = undefined; u.targetR = undefined;
        clearMarchFields(u);
        tryReGarrisonIdleUnit(u, cities);
      }
      return;
    }

    const slowestSpeed = Math.min(...army.map(u => getUnitStats(u).speed));
    const earliestReady = Math.min(...army.map(u => u.nextMoveAt));
    if (now < earliestReady) return;

    const next = naval
      ? stepTowardZOCNaval(leader.q, leader.r, targetQ, targetR, tiles, units, leader.ownerId)
      : stepTowardZOC(leader.q, leader.r, targetQ, targetR, tiles, units, leader.ownerId, wallSections, cities);

    if (next[0] === leader.q && next[1] === leader.r) {
      for (const u of army) {
        u.status = 'idle'; u.targetQ = undefined; u.targetR = undefined;
        clearMarchFields(u);
        tryReGarrisonIdleUnit(u, cities);
      }
      return;
    }

    const enemiesAtNext = units.some(
      u => !u.aboardShipId && u.q === next[0] && u.r === next[1] && u.ownerId !== leader.ownerId && u.hp > 0,
    );
    if (enemiesAtNext) {
      for (const u of army) {
        u.status = 'fighting'; u.targetQ = undefined; u.targetR = undefined;
        clearMarchFields(u);
        if (u.garrisonCityId) delete u.garrisonCityId;
        if (u.defendCityId) delete u.defendCityId;
        if (u.incorporateVillageAt) delete u.incorporateVillageAt;
      }
      return;
    }

    const destTile = tiles.get(tileKey(next[0], next[1]));
    const onRoad = !naval && (destTile?.hasRoad ?? false);
    const mongolMult =
      !naval && players.some(p => p.id === leader.ownerId && p.kingdomId === 'mongols')
        ? MONGOL_LAND_SPEED_MULT
        : 1.0;
    const scrollMove =
      !naval && scrollAttachments?.length
        ? armyHasMovementScroll(army, leader.ownerId, units, scrollAttachments)
        : false;
    const scrollMoveMult = scrollMove ? 1 + SCROLL_MOVEMENT_BONUS : 1;
    const effectiveSpeed = slowestSpeed * (onRoad ? ROAD_SPEED_BONUS : 1.0) * mongolMult * scrollMoveMult;
    const moveDelay = Math.max(280, Math.floor((1000 / effectiveSpeed) * UNIT_MOVEMENT_DELAY_MULT));

    for (const u of army) {
      u.q = next[0];
      u.r = next[1];
      u.nextMoveAt = now + moveDelay;
      u.moveLegMs = moveDelay;
      if (u.cargoUnitIds?.length) {
        for (const cid of u.cargoUnitIds) {
          const cargo = units.find(x => x.id === cid);
          if (cargo && cargo.aboardShipId === u.id) {
            cargo.q = next[0];
            cargo.r = next[1];
          }
        }
      }
      if (u.q === targetQ && u.r === targetR) {
        u.status = 'idle'; u.targetQ = undefined; u.targetR = undefined;
        clearMarchFields(u);
        tryReGarrisonIdleUnit(u, cities);
      }
    }

    for (const h of heroes) {
      if (h.ownerId === leader.ownerId && h.q === prevQ && h.r === prevR) {
        h.q = next[0];
        h.r = next[1];
      }
    }

    if (!naval) {
      closingFireOnArmy(army, units, heroes, cities, cycle, now, closingFireRes, scrollAttachments, commanders, defenseInstallations);
    }
  };

  for (const army of landArmies) advanceArmy(army, false);
  for (const army of navalArmies) advanceArmy(army, true);

  cityDefenseAndPatrolTick(
    units,
    heroes,
    tiles,
    wallSections,
    cities,
    now,
    players,
    scrollAttachments,
    cycle,
    commanders,
    territory,
  );

  return closingFireRes;
}

/** Auto city defense (roam territory) and patrol wander / intercept — idle land stacks only. */
function cityDefenseAndPatrolTick(
  units: Unit[],
  heroes: Hero[],
  tiles: Map<string, Tile>,
  wallSections: WallSection[],
  cities: City[],
  nowMs: number,
  players: Player[],
  scrollAttachments: ScrollAttachment[] | undefined,
  cycle: number,
  commanders: Commander[],
  territory: Map<string, TerritoryInfo> | undefined,
): void {
  if (!territory) return;

  const byHex = new Map<string, Unit[]>();
  for (const u of units) {
    if (u.hp <= 0 || u.aboardShipId || u.status !== 'idle') continue;
    const k = tileKey(u.q, u.r);
    if (!byHex.has(k)) byHex.set(k, []);
    byHex.get(k)!.push(u);
  }

  for (const [_hk, stack] of byHex) {
    const land = stack.filter(u => isLandMilitaryUnit(u));
    if (land.length === 0) continue;
    // Echelon/siege wave waiters stay idle; patrol/defense still runs for other units on this hex.
    const landFree = land.filter(u => !u.marchEchelonHold && !u.attackWaveHold);
    if (landFree.length === 0) continue;

    const patrolAnchor = landFree.find(u => u.patrolCenterQ !== undefined && u.patrolCenterR !== undefined);
    const defAuto = landFree.find(u => u.defendCityId && u.cityDefenseMode === 'auto_engage');

    let targetQ: number | undefined;
    let targetR: number | undefined;
    let ownerId = landFree[0]!.ownerId;

    if (patrolAnchor) {
      const pq = patrolAnchor.patrolCenterQ!;
      const pr = patrolAnchor.patrolCenterR!;
      const rad = patrolAnchor.patrolRadius ?? PATROL_DEFAULT_RADIUS;
      const painted = patrolAnchor.patrolHexKeys && patrolAnchor.patrolHexKeys.length > 0
        ? new Set(patrolAnchor.patrolHexKeys)
        : null;
      const inPatrolZone = (q: number, r: number) => {
        if (painted) return painted.has(tileKey(q, r));
        return hexDistance(pq, pr, q, r) <= rad;
      };
      let best: Unit | null = null;
      let bestD = Infinity;
      for (const ou of units) {
        if (ou.hp <= 0 || ou.ownerId === ownerId || ou.aboardShipId) continue;
        if (!isLandMilitaryUnit(ou)) continue;
        if (!inPatrolZone(ou.q, ou.r)) continue;
        const d = hexDistance(patrolAnchor.q, patrolAnchor.r, ou.q, ou.r);
        if (d > 0 && d < bestD) {
          bestD = d;
          best = ou;
        }
      }
      if (best) {
        targetQ = best.q;
        targetR = best.r;
      } else {
        const neigh = hexNeighbors(patrolAnchor.q, patrolAnchor.r);
        const candidates: [number, number][] = [];
        let salt = cycle * 10007 + patrolAnchor.id.charCodeAt(0);
        for (const [nq, nr] of neigh) {
          if (!inPatrolZone(nq, nr)) continue;
          if (tiles.get(tileKey(nq, nr))?.biome === 'water') continue;
          candidates.push([nq, nr]);
        }
        if (candidates.length > 0) {
          salt = (salt * 31 + (patrolAnchor.q & 255)) >>> 0;
          const pick = candidates[salt % candidates.length];
          targetQ = pick[0];
          targetR = pick[1];
        }
      }
    } else if (defAuto) {
      const city = cities.find(c => c.id === defAuto.defendCityId);
      if (!city) continue;
      const terrKeys = new Set(getCityTerritory(city.id, territory));
      let best: Unit | null = null;
      let bestD = Infinity;
      for (const ou of units) {
        if (ou.hp <= 0 || ou.ownerId === ownerId || ou.aboardShipId) continue;
        if (!isLandMilitaryUnit(ou)) continue;
        if (!terrKeys.has(tileKey(ou.q, ou.r))) continue;
        const d = hexDistance(defAuto.q, defAuto.r, ou.q, ou.r);
        if (d > 0 && d < bestD) {
          bestD = d;
          best = ou;
        }
      }
      if (best) {
        targetQ = best.q;
        targetR = best.r;
      }
    } else {
      continue;
    }

    if (targetQ === undefined || targetR === undefined) continue;

    const lead = landFree[0]!;
    const next = stepTowardZOC(
      lead.q,
      lead.r,
      targetQ,
      targetR,
      tiles,
      units,
      ownerId,
      wallSections,
      cities,
    );
    if (next[0] === lead.q && next[1] === lead.r) continue;

    for (const u of landFree) {
      applyDeployFlagsForMoveMutable(u, next[0], next[1], cities);
      u.targetQ = next[0];
      u.targetR = next[1];
      u.status = 'moving';
      u.nextMoveAt = 0;
      u.marchInitialHexDistance = marchHexDistanceAtOrder(u, next[0], next[1]);
    }

    const prevQ = lead.q;
    const prevR = lead.r;
    for (const h of heroes) {
      if (h.ownerId === ownerId && h.q === prevQ && h.r === prevR) {
        h.q = next[0];
        h.r = next[1];
      }
    }
    void nowMs;
    void scrollAttachments;
    void commanders;
  }
}

// ═══════════════════════════════════════════════════════════════════
//  Combat Tick — automatic 1-second engagement resolution
// ═══════════════════════════════════════════════════════════════════

/** Client-only combat VFX: defense towers, bow volleys, coastal bombardment (see HexGrid). */
export type DefenseVolleyFx =
  | { kind: 'mortar'; fromQ: number; fromR: number; splashKeys: string[] }
  | { kind: 'archer_tower'; fromQ: number; fromR: number; targetQ: number; targetR: number }
  | { kind: 'ballista'; fromQ: number; fromR: number; targetQ: number; targetR: number }
  | { kind: 'coastal_bombard'; fromQ: number; fromR: number; splashKeys: string[] };

export type RangedShotFx = {
  attackerId: string;
  fromQ: number;
  fromR: number;
  toQ: number;
  toR: number;
};

export interface CombatKillEvent {
  killerType: string;
  killerOwner: string;
  victimType: string;
  victimOwner: string;
  hexKey: string;
  timestamp: number;
}

export interface CombatTickResult {
  killedUnitIds: string[];
  killedHeroIds: string[];
  notifications: GameNotification[];
  /** Hex keys (q,r) where combat occurred this tick (for ancient city: no reward if combat on that hex) */
  combatHexKeys: string[];
  defenseVolleyFx: DefenseVolleyFx[];
  rangedShotFx: RangedShotFx[];
  /** Per-stack morale state after this tick */
  moraleState: MoraleState;
  /** Kill events this tick for UI kill feed */
  killFeed: CombatKillEvent[];
}

function tileIsWater(tiles: Map<string, Tile>, q: number, r: number): boolean {
  return tiles.get(tileKey(q, r))?.biome === 'water';
}

/** Naval may only fight naval on water; land only fights land. Shore damage uses {@link coastalBombardmentTick}. */
export function canUnitsFight(attacker: Unit, target: Unit, tiles: Map<string, Tile>): boolean {
  const aNav = isNavalUnitType(attacker.type);
  const tNav = isNavalUnitType(target.type);
  const aW = tileIsWater(tiles, attacker.q, attacker.r);
  const tW = tileIsWater(tiles, target.q, target.r);
  if (aNav && tNav) return aW && tW;
  if (!aNav && !tNav) return !aW || !tW;
  return false;
}

function combatScrollMult(
  units: Unit[],
  u: Unit,
  scrollAttachments: ScrollAttachment[] | undefined,
): number {
  if (!scrollAttachments?.length) return 1;
  return hexHasScrollKind(u.q, u.r, u.ownerId, 'combat', units, scrollAttachments)
    ? 1 + SCROLL_COMBAT_BONUS
    : 1;
}

export function combatTick(
  units: Unit[],
  heroes: Hero[],
  cycle: number,
  cities: City[] = [],
  tiles: Map<string, Tile> = new Map(),
  nowMs: number = Date.now(),
  defenseInstallations?: DefenseInstallation[],
  territory?: Map<string, TerritoryInfo>,
  scrollAttachments?: ScrollAttachment[],
  commanders: Commander[] = [],
  prevMoraleState?: MoraleState,
): CombatTickResult {
  const killed: string[] = [];
  const killedHeroIds: string[] = [];
  const notifications: GameNotification[] = [];
  const combatHexKeys: string[] = [];
  const rangedShotFx: RangedShotFx[] = [];
  const killFeed: CombatKillEvent[] = [];
  const processed = new Set<string>();
  const now = nowMs;
  const moraleState: MoraleState = prevMoraleState ?? initMorale();

  const byHex: Record<string, Unit[]> = {};
  for (const u of units) {
    if (u.hp <= 0 || u.aboardShipId) continue;
    const key = tileKey(u.q, u.r);
    if (!byHex[key]) byHex[key] = [];
    byHex[key].push(u);
  }

  const hexKeys = Object.keys(byHex);

  // Phase A: Same-hex combat
  for (const hexKey of hexKeys) {
    const hexUnits = byHex[hexKey];
    const ownerSet: Record<string, boolean> = {};
    for (const u of hexUnits) ownerSet[u.ownerId] = true;
    const owners = Object.keys(ownerSet);
    if (owners.length < 2) continue;

    for (const u of hexUnits) {
      if (u.garrisonCityId) delete u.garrisonCityId;
      if (u.defendCityId) delete u.defendCityId;
      if (u.incorporateVillageAt) delete u.incorporateVillageAt;
    }

    let side1 = hexUnits.filter((u: Unit) => u.ownerId === owners[0] && u.hp > 0);
    let side2 = hexUnits.filter((u: Unit) => u.ownerId === owners[1] && u.hp > 0);
    const s1Nav = side1.some(u => isNavalUnitType(u.type));
    const s2Nav = side2.some(u => isNavalUnitType(u.type));
    if (s1Nav !== s2Nav || (s1Nav && !tileIsWater(tiles, side1[0].q, side1[0].r))) continue;
    if (s1Nav) {
      side1 = side1.filter(u => isNavalUnitType(u.type));
      side2 = side2.filter(u => isNavalUnitType(u.type));
    } else {
      side1 = side1.filter(u => !isNavalUnitType(u.type));
      side2 = side2.filter(u => !isNavalUnitType(u.type));
    }
    if (side1.length === 0 || side2.length === 0) continue;

    const hero1 = heroes.find(h => h.q === side1[0]?.q && h.r === side1[0]?.r && h.ownerId === owners[0]);
    const hero2 = heroes.find(h => h.q === side2[0]?.q && h.r === side2[0]?.r && h.ownerId === owners[1]);

    const hasCmd1 = commanders.some(c => commanderAppliesToUnit(c, side1[0], cities, units));
    const hasCmd2 = commanders.some(c => commanderAppliesToUnit(c, side2[0], cities, units));
    const isHome1 = territory ? !!(territory.get(hexKey)?.playerId === owners[0]) : false;
    const isHome2 = territory ? !!(territory.get(hexKey)?.playerId === owners[1]) : false;
    tickMorale(moraleState, hexKey, owners[0], side1.length, side2.length, hasCmd1, isHome1);
    tickMorale(moraleState, hexKey, owners[1], side2.length, side1.length, hasCmd2, isHome2);

    combatHexKeys.push(hexKey);
    resolveMeleeRound(
      side1, side2, hero1, hero2, killed, killedHeroIds, notifications, cycle, cities, now, units, scrollAttachments,
      commanders, tiles, moraleState, killFeed, byHex, defenseInstallations,
    );
    for (const u of side1.concat(side2)) processed.add(u.id);
  }

  // Phase B: Ranged & aggressive/hold_the_line across hexes (skirmish units also fire but retreat if approached)
  for (const hexKey of hexKeys) {
    const hexUnits = byHex[hexKey];
    const [q, r] = hexKey.split(',').map(Number);
    const aggressors = hexUnits.filter((u: Unit) =>
      (u.stance === 'aggressive' || u.stance === 'skirmish') && !processed.has(u.id) && u.hp > 0 && !u.retreatAt
    );
    if (aggressors.length === 0) continue;

    const ownerId = aggressors[0].ownerId;
    const maxRange = Math.max(...aggressors.map((u: Unit) => getUnitStats(u).range));
    const attackerHero = heroes.find(h => h.q === q && h.r === r && h.ownerId === ownerId);
    const atkTile = tiles.get(hexKey);

    for (const otherKey of hexKeys) {
      if (otherKey === hexKey) continue;
      const otherUnits = byHex[otherKey];
      const [oq, or_] = otherKey.split(',').map(Number);
      const dist = hexDistance(q, r, oq, or_);
      if (dist > maxRange) continue;

      const enemies = otherUnits.filter((u: Unit) => u.ownerId !== ownerId && u.hp > 0);
      const enemyHero = heroes.find(h => h.q === oq && h.r === or_ && h.ownerId !== ownerId && heroHp(h) > 0);
      if (enemies.length === 0 && !enemyHero) continue;

      if (!combatHexKeys.includes(hexKey)) combatHexKeys.push(hexKey);
      if (!combatHexKeys.includes(otherKey)) combatHexKeys.push(otherKey);
      const targetTile = tiles.get(otherKey);

      for (const atk of aggressors) {
        if (processed.has(atk.id) || atk.hp <= 0) continue;
        const unitRange = getUnitStats(atk).range;
        if (dist > unitRange) continue;

        const target = enemies.find((e: Unit) => e.hp > 0 && canUnitsFight(atk, e, tiles));
        if (target) {
          const atkMult = combatScrollMult(units, atk, scrollAttachments);
          const cmdAtk = commanderAttackMultiplierForUnit(atk, commanders, cities, units);
          const terrainAtk = getTerrainAttackModifier(atkTile, targetTile, atk.type);
          const riverPenalty = getRiverCrossingPenalty(atkTile, tiles, q, r);
          const counterM = getCounterMultiplier(atk.type, target.type);
          const stanceAtk = getStanceAttackMult(atk.stance);
          const moraleMult = getMoraleAttackPenalty(getStackMorale(moraleState, hexKey, atk.ownerId));
          const flankBonus = getFlankingBonus(target.q, target.r, atk.ownerId, byHex);
          const chargeMult = getChargeBonus(atk);
          const volleyMult = getVolleyFireBonus(atk, now);
          const shieldPenalty = getShieldWallAttackPenalty(atk);
          const abilityMult = chargeMult * shieldPenalty * volleyMult;

          let rawDamage = getUnitAttack(atk, attackerHero, {
            attackMult: atkMult, commanderAttackMult: cmdAtk,
            terrainAttackMult: terrainAtk * riverPenalty, counterMult: counterM,
            stanceMult: stanceAtk, flankingBonus: flankBonus,
            moraleMult, abilityMult,
          });
          let damage = applyTowerDefense(rawDamage, target.q, target.r, cities);
          if (atk.assaulting && isCityCenter(target.q, target.r, cities)) {
            damage = Math.max(1, Math.floor(damage * ASSAULT_ATTACK_DEBUFF));
          }
          damage = applyDamageResist(damage, target, cities, units, scrollAttachments, tiles);
          damage = Math.max(1, Math.floor(damage * commanderDefenseDamageFactorForUnit(target, commanders, cities, units)));
          damage = scaleLandCombatDamageToUnit(damage);
          const ro = combatRoll01(cycle, now, atk.id, target.id, 210);
          damage = applyHitOutcomeDamage(damage, hitOutcomeFromRoll(ro));
          target.hp -= damage;
          maybeApplyRetaliation(target, { attackerUnitId: atk.id }, units, defenseInstallations);
          atk.status = 'fighting';
          if (atk.chargeReady) atk.chargeReady = false;
          if (isBowUnitType(atk.type)) {
            rangedShotFx.push({ attackerId: atk.id, fromQ: q, fromR: r, toQ: target.q, toR: target.r });
          }
          if (target.hp <= 0) {
            killed.push(target.id);
            const leveled = awardXp(atk, COMBAT_KILL_XP);
            if (leveled) {
              notifications.push({ id: generateId('n'), turn: cycle, message: `${capitalize(atk.type)} leveled up to ${atk.level}!`, type: 'success' });
            }
            adjustMoraleOnKill(moraleState, otherKey, atk.ownerId, target.ownerId);
            killFeed.push({ killerType: atk.type, killerOwner: atk.ownerId, victimType: target.type, victimOwner: target.ownerId, hexKey: otherKey, timestamp: now });
          }
        } else if (enemyHero && !isNavalUnitType(atk.type)) {
          const atkMult = combatScrollMult(units, atk, scrollAttachments);
          const cmdAtk = commanderAttackMultiplierForUnit(atk, commanders, cities, units);
          let damage = scaleLandCombatDamageToUnit(
            applyTowerDefense(getUnitAttack(atk, attackerHero, { attackMult: atkMult, commanderAttackMult: cmdAtk }), oq, or_, cities),
          );
          const ro = combatRoll01(cycle, now, atk.id, enemyHero.id, 211);
          damage = applyHitOutcomeDamage(damage, hitOutcomeFromRoll(ro));
          const hp = (enemyHero.hp ?? HERO_BASE_HP) - damage;
          enemyHero.hp = Math.max(0, hp);
          if (enemyHero.hp <= 0) {
            killedHeroIds.push(enemyHero.id);
            adjustMoraleOnHeroDeath(moraleState, otherKey, enemyHero.ownerId);
          }
        }
        processed.add(atk.id);
      }

      const defenderHero = heroes.find(h => h.q === oq && h.r === or_ && h.ownerId === (enemies[0]?.ownerId ?? enemyHero?.ownerId));
      for (const def of enemies) {
        if (def.hp <= 0 || processed.has(def.id)) continue;
        if ((def.stance === 'passive' || def.stance === 'skirmish') && !garrisonCanReturnBowFire(def)) continue;
        if (def.retreatAt) continue;
        const defRange = getUnitStats(def).range;
        if (dist > defRange) continue;

        const counterTarget = aggressors.find((a: Unit) => a.hp > 0 && canUnitsFight(def, a, tiles));
        if (!counterTarget) continue;

        const defMult = combatScrollMult(units, def, scrollAttachments);
        const cmdAtkDef = commanderAttackMultiplierForUnit(def, commanders, cities, units);
        const stanceDef = getStanceAttackMult(def.stance);
        const moraleMult = getMoraleAttackPenalty(getStackMorale(moraleState, otherKey, def.ownerId));
        const counterM = getCounterMultiplier(def.type, counterTarget.type);

        const flankDef = getFlankingBonus(counterTarget.q, counterTarget.r, def.ownerId, byHex);
        let rawDamage = getUnitAttack(def, defenderHero, {
          attackMult: defMult, commanderAttackMult: cmdAtkDef,
          stanceMult: stanceDef, counterMult: counterM, moraleMult,
        });
        let damage = applyTowerDefense(rawDamage, counterTarget.q, counterTarget.r, cities);
        if (def.assaulting && isCityCenter(counterTarget.q, counterTarget.r, cities)) {
          damage = Math.max(1, Math.floor(damage * ASSAULT_ATTACK_DEBUFF));
        }
        damage = applyDamageResist(damage, counterTarget, cities, units, scrollAttachments, tiles);
        damage = Math.max(1, Math.floor(damage * commanderDefenseDamageFactorForUnit(counterTarget, commanders, cities, units)));
        damage = scaleLandCombatDamageToUnit(damage);
        const ro2 = combatRoll01(cycle, now, def.id, counterTarget.id, 212);
        damage = applyHitOutcomeDamage(damage, hitOutcomeFromRoll(ro2));
        counterTarget.hp -= damage;
        maybeApplyRetaliation(counterTarget, { attackerUnitId: def.id }, units, defenseInstallations);
        if (isBowUnitType(def.type)) {
          rangedShotFx.push({ attackerId: def.id, fromQ: oq, fromR: or_, toQ: counterTarget.q, toR: counterTarget.r });
        }

        if (counterTarget.hp <= 0) {
          killed.push(counterTarget.id);
          const leveled = awardXp(def, COMBAT_KILL_XP);
          if (leveled) {
            notifications.push({ id: generateId('n'), turn: cycle, message: `Enemy ${capitalize(def.type)} leveled up to ${def.level}!`, type: 'warning' });
          }
          adjustMoraleOnKill(moraleState, hexKey, def.ownerId, counterTarget.ownerId);
          killFeed.push({ killerType: def.type, killerOwner: def.ownerId, victimType: counterTarget.type, victimOwner: counterTarget.ownerId, hexKey, timestamp: now });
        }
        processed.add(def.id);
      }
    }
  }

  // Phase B2: Garrison patrol — bow units in a city with patrol enabled shoot enemies in that city's territory
  // within patrol radius of the city center (one shot per garrison archer per tick; skips units already processed in Phase B).
  if (territory && territory.size > 0 && cities.length > 0) {
    for (const city of cities) {
      if (!city.garrisonPatrol) continue;
      const patrolR = Math.min(
        GARRISON_PATROL_RADIUS_MAX,
        Math.max(GARRISON_PATROL_RADIUS_MIN, city.garrisonPatrolRadius ?? TERRITORY_RADIUS),
      );
      const cityHexKey = tileKey(city.q, city.r);
      const shooters = units
        .filter(
          u =>
            u.garrisonCityId === city.id &&
            u.hp > 0 &&
            !u.aboardShipId &&
            u.q === city.q &&
            u.r === city.r &&
            isBowUnitType(u.type) &&
            !processed.has(u.id) &&
            !u.retreatAt,
        )
        .sort((a, b) => a.id.localeCompare(b.id));
      for (const atk of shooters) {
        const unitRange = getUnitStats(atk).range;
        const atkHero = heroes.find(h => h.q === city.q && h.r === city.r && h.ownerId === atk.ownerId);
        const atkTile = tiles.get(cityHexKey);

        let target: Unit | undefined;
        let bestUd = Infinity;
        for (const u of units) {
          if (u.hp <= 0 || u.aboardShipId || u.ownerId === city.ownerId) continue;
          if (!landTargetableByDefenseTower(u)) continue;
          const tinf = territory.get(tileKey(u.q, u.r));
          if (!tinf || tinf.cityId !== city.id) continue;
          const fromCenter = hexDistance(city.q, city.r, u.q, u.r);
          if (fromCenter > patrolR) continue;
          const dAtk = hexDistance(atk.q, atk.r, u.q, u.r);
          if (dAtk > unitRange || dAtk === 0) continue;
          if (!canUnitsFight(atk, u, tiles)) continue;
          if (fromCenter < bestUd || (fromCenter === bestUd && u.id < (target?.id ?? 'zz'))) {
            bestUd = fromCenter;
            target = u;
          }
        }

        let targetHero: Hero | undefined;
        if (!target) {
          let bestHd = Infinity;
          for (const h of heroes) {
            if (heroHp(h) <= 0 || h.ownerId === city.ownerId) continue;
            if (isNavalUnitType(atk.type)) break;
            const tinf = territory.get(tileKey(h.q, h.r));
            if (!tinf || tinf.cityId !== city.id) continue;
            const fromCenter = hexDistance(city.q, city.r, h.q, h.r);
            if (fromCenter > patrolR) continue;
            const dAtk = hexDistance(atk.q, atk.r, h.q, h.r);
            if (dAtk > unitRange || dAtk === 0) continue;
            if (fromCenter < bestHd || (fromCenter === bestHd && h.id < (targetHero?.id ?? 'zz'))) {
              bestHd = fromCenter;
              targetHero = h;
            }
          }
        }

        if (!target && !targetHero) continue;

        const q = city.q;
        const r = city.r;
        if (target) {
          const otherKey = tileKey(target.q, target.r);
          if (!combatHexKeys.includes(cityHexKey)) combatHexKeys.push(cityHexKey);
          if (!combatHexKeys.includes(otherKey)) combatHexKeys.push(otherKey);
          const targetTile = tiles.get(otherKey);

          const atkMult = combatScrollMult(units, atk, scrollAttachments);
          const cmdAtk = commanderAttackMultiplierForUnit(atk, commanders, cities, units);
          const terrainAtk = getTerrainAttackModifier(atkTile, targetTile, atk.type);
          const riverPenalty = getRiverCrossingPenalty(atkTile, tiles, q, r);
          const counterM = getCounterMultiplier(atk.type, target.type);
          const stanceAtk = getStanceAttackMult(atk.stance);
          const moraleMult = getMoraleAttackPenalty(getStackMorale(moraleState, cityHexKey, atk.ownerId));
          const flankBonus = getFlankingBonus(target.q, target.r, atk.ownerId, byHex);
          const chargeMult = getChargeBonus(atk);
          const volleyMult = getVolleyFireBonus(atk, now);
          const shieldPenalty = getShieldWallAttackPenalty(atk);
          const abilityMult = chargeMult * shieldPenalty * volleyMult;

          let rawDamage = getUnitAttack(atk, atkHero, {
            attackMult: atkMult, commanderAttackMult: cmdAtk,
            terrainAttackMult: terrainAtk * riverPenalty, counterMult: counterM,
            stanceMult: stanceAtk, flankingBonus: flankBonus,
            moraleMult, abilityMult,
          });
          let damage = applyTowerDefense(rawDamage, target.q, target.r, cities);
          if (atk.assaulting && isCityCenter(target.q, target.r, cities)) {
            damage = Math.max(1, Math.floor(damage * ASSAULT_ATTACK_DEBUFF));
          }
          damage = applyDamageResist(damage, target, cities, units, scrollAttachments, tiles);
          damage = Math.max(1, Math.floor(damage * commanderDefenseDamageFactorForUnit(target, commanders, cities, units)));
          damage = scaleLandCombatDamageToUnit(damage);
          const ro = combatRoll01(cycle, now, atk.id, target.id, 214);
          damage = applyHitOutcomeDamage(damage, hitOutcomeFromRoll(ro));
          target.hp -= damage;
          maybeApplyRetaliation(target, { attackerUnitId: atk.id }, units, defenseInstallations);
          atk.status = 'fighting';
          if (atk.chargeReady) atk.chargeReady = false;
          rangedShotFx.push({ attackerId: atk.id, fromQ: q, fromR: r, toQ: target.q, toR: target.r });
          if (target.hp <= 0) {
            killed.push(target.id);
            const leveled = awardXp(atk, COMBAT_KILL_XP);
            if (leveled) {
              notifications.push({ id: generateId('n'), turn: cycle, message: `${capitalize(atk.type)} leveled up to ${atk.level}!`, type: 'success' });
            }
            adjustMoraleOnKill(moraleState, otherKey, atk.ownerId, target.ownerId);
            killFeed.push({ killerType: atk.type, killerOwner: atk.ownerId, victimType: target.type, victimOwner: target.ownerId, hexKey: otherKey, timestamp: now });
          }
        } else if (targetHero && !isNavalUnitType(atk.type)) {
          const oq = targetHero.q;
          const or_ = targetHero.r;
          const otherKey = tileKey(oq, or_);
          if (!combatHexKeys.includes(cityHexKey)) combatHexKeys.push(cityHexKey);
          if (!combatHexKeys.includes(otherKey)) combatHexKeys.push(otherKey);
          const atkMult = combatScrollMult(units, atk, scrollAttachments);
          const cmdAtk = commanderAttackMultiplierForUnit(atk, commanders, cities, units);
          let damage = scaleLandCombatDamageToUnit(
            applyTowerDefense(getUnitAttack(atk, atkHero, { attackMult: atkMult, commanderAttackMult: cmdAtk }), oq, or_, cities),
          );
          const ro = combatRoll01(cycle, now, atk.id, targetHero.id, 215);
          damage = applyHitOutcomeDamage(damage, hitOutcomeFromRoll(ro));
          const hp = (targetHero.hp ?? HERO_BASE_HP) - damage;
          targetHero.hp = Math.max(0, hp);
          if (targetHero.hp <= 0) {
            killedHeroIds.push(targetHero.id);
            adjustMoraleOnHeroDeath(moraleState, otherKey, targetHero.ownerId);
          }
          rangedShotFx.push({ attackerId: atk.id, fromQ: q, fromR: r, toQ: oq, toR: or_ });
        }

        processed.add(atk.id);
      }
    }
  }

  // Morale rout: auto-retreat for stacks below rout threshold
  for (const hexKey of hexKeys) {
    const hexUnits = byHex[hexKey];
    const ownerSet = new Set(hexUnits.map(u => u.ownerId));
    if (ownerSet.size < 2) continue;
    for (const ownerId of ownerSet) {
      const morale = getStackMorale(moraleState, hexKey, ownerId);
      if (shouldRout(morale)) {
        const routUnits = hexUnits.filter(u => u.ownerId === ownerId && u.hp > 0 && !u.retreatAt);
        for (const u of routUnits) {
          if (!u.retreatAt) {
            u.retreatAt = now + 500;
          }
        }
        if (routUnits.length > 0 && ownerId.includes('human')) {
          notifications.push({ id: generateId('n'), turn: cycle, message: 'Your troops are routing! Morale has collapsed.', type: 'danger' });
        }
      }
    }
  }

  // Skirmish stance: ranged units auto-kite when enemy enters their hex
  for (const hexKey of hexKeys) {
    const hexUnits = byHex[hexKey];
    const ownerSet: Record<string, boolean> = {};
    for (const u of hexUnits) ownerSet[u.ownerId] = true;
    if (Object.keys(ownerSet).length < 2) continue;
    for (const u of hexUnits) {
      if (u.stance !== 'skirmish' || u.hp <= 0 || u.retreatAt) continue;
      const hasEnemyMelee = hexUnits.some(e => e.ownerId !== u.ownerId && e.hp > 0 && getUnitStats(e).range <= 1);
      if (hasEnemyMelee && getUnitStats(u).range >= 2) {
        u.retreatAt = now + 200;
      }
    }
  }

  // Hold the line: immovable, no pursuit (clear any movement targets)
  for (const u of units) {
    if (u.stance === 'hold_the_line' && u.hp > 0 && u.status === 'fighting') {
      u.targetQ = undefined;
      u.targetR = undefined;
    }
  }

  const defenseVolleyFx: DefenseVolleyFx[] = [];
  if (defenseInstallations?.length && territory && territory.size > 0) {
    defenseTowerVolley(
      defenseInstallations, territory, tiles, units, heroes, cities,
      killed, killedHeroIds, combatHexKeys, defenseVolleyFx, scrollAttachments, commanders,
    );
  }

  return {
    killedUnitIds: expandKilledWithCargoIds(units, killed),
    killedHeroIds,
    notifications,
    combatHexKeys,
    defenseVolleyFx,
    rangedShotFx,
    moraleState,
    killFeed,
  };
}

/**
 * Warships / capital ships on water bombard enemy land at range {@link COASTAL_BOMBARD_RANGE}.
 * Separate from ship-vs-ship combat: scatter on aim, 7-hex splash, low per-target accuracy; damages walls.
 */
export function coastalBombardmentTick(
  units: Unit[],
  heroes: Hero[],
  wallSections: WallSection[],
  cycle: number,
  cities: City[],
  tiles: Map<string, Tile>,
  nowMs: number,
  scrollAttachments?: ScrollAttachment[],
  commanders: Commander[] = [],
): CombatTickResult {
  const killed: string[] = [];
  const killedHeroIds: string[] = [];
  const notifications: GameNotification[] = [];
  const combatHexKeys: string[] = [];
  const defenseVolleyFx: DefenseVolleyFx[] = [];
  const rangedShotFx: RangedShotFx[] = [];
  const now = nowMs;

  const bombardShips = units
    .filter(
      u =>
        u.hp > 0 &&
        !u.aboardShipId &&
        isBombardShipType(u.type) &&
        tileIsWater(tiles, u.q, u.r) &&
        u.stance === 'aggressive',
    )
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const ship of bombardShips) {
    let targetQ: number | null = null;
    let targetR: number | null = null;

    let bestWall: WallSection | null = null;
    let bestWallD = Infinity;
    for (const w of wallSections) {
      if (w.ownerId === ship.ownerId) continue;
      if ((w.hp ?? 0) <= 0) continue;
      if (tileIsWater(tiles, w.q, w.r)) continue;
      const d = hexDistance(ship.q, ship.r, w.q, w.r);
      if (d > COASTAL_BOMBARD_RANGE) continue;
      const better =
        d < bestWallD ||
        (d === bestWallD &&
          (!bestWall || w.q < bestWall.q || (w.q === bestWall.q && w.r < bestWall.r)));
      if (better) {
        bestWallD = d;
        bestWall = w;
      }
    }
    if (bestWall) {
      targetQ = bestWall.q;
      targetR = bestWall.r;
    } else {
      type HexCand = { q: number; r: number; count: number; dist: number };
      const byHex = new Map<string, HexCand>();
      for (const u of units) {
        if (!landTargetableByBombardment(u)) continue;
        if (u.ownerId === ship.ownerId) continue;
        if (tileIsWater(tiles, u.q, u.r)) continue;
        const d = hexDistance(ship.q, ship.r, u.q, u.r);
        if (d > COASTAL_BOMBARD_RANGE) continue;
        const k = tileKey(u.q, u.r);
        const cur = byHex.get(k);
        if (!cur) byHex.set(k, { q: u.q, r: u.r, count: 1, dist: d });
        else {
          cur.count++;
          cur.dist = Math.min(cur.dist, d);
        }
      }
      const candidates = [...byHex.values()].sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        if (a.dist !== b.dist) return a.dist - b.dist;
        if (a.q !== b.q) return a.q - b.q;
        return a.r - b.r;
      });
      const bestHex = candidates[0];
      if (bestHex) {
        targetQ = bestHex.q;
        targetR = bestHex.r;
      }
    }

    if (targetQ === null || targetR === null) continue;

    let centerQ = targetQ;
    let centerR = targetR;
    const aimRoll = combatRoll01(cycle, now, ship.id, `${targetQ},${targetR}`, 303);
    if (aimRoll >= COASTAL_BOMBARD_DIRECT_HIT_CHANCE) {
      const neighbors = hexNeighbors(targetQ, targetR);
      const landNeighbors = neighbors.filter(([nq, nr]) => !tileIsWater(tiles, nq, nr));
      if (landNeighbors.length > 0) {
        const pick =
          Math.floor(combatRoll01(cycle, now, ship.id, 'scatter', 304) * landNeighbors.length) %
          landNeighbors.length;
        centerQ = landNeighbors[pick][0];
        centerR = landNeighbors[pick][1];
      }
    }

    const splashKeysSet = new Set<string>();
    const splashPairs: [number, number][] = [[centerQ, centerR], ...hexNeighbors(centerQ, centerR)];
    for (const [sq, sr] of splashPairs) splashKeysSet.add(tileKey(sq, sr));
    const splashKeys: string[] = [];
    splashKeys.push(tileKey(centerQ, centerR));
    for (const [sq, sr] of hexNeighbors(centerQ, centerR)) {
      const k = tileKey(sq, sr);
      if (!splashKeys.includes(k)) splashKeys.push(k);
    }

    for (const k of splashKeys) {
      if (!combatHexKeys.includes(k)) combatHexKeys.push(k);
    }

    const wallDmg =
      ship.type === 'capital_ship' ? COASTAL_BOMBARD_WALL_DAMAGE + 2 : COASTAL_BOMBARD_WALL_DAMAGE;
    const unitBaseDmg =
      ship.type === 'capital_ship'
        ? Math.round(COASTAL_BOMBARD_UNIT_BASE * 1.5)
        : COASTAL_BOMBARD_UNIT_BASE;

    for (const w of wallSections) {
      if (w.ownerId === ship.ownerId) continue;
      if ((w.hp ?? 0) <= 0) continue;
      if (!splashKeysSet.has(tileKey(w.q, w.r))) continue;
      w.hp = Math.max(0, (w.hp ?? 0) - wallDmg);
    }

    let salt = 400;
    for (const u of units) {
      if (!landTargetableByBombardment(u)) continue;
      if (u.ownerId === ship.ownerId) continue;
      if (!splashKeysSet.has(tileKey(u.q, u.r))) continue;
      salt++;
      let damage = applyTowerDefense(unitBaseDmg, u.q, u.r, cities);
      damage = applyDamageResist(damage, u, cities, units, scrollAttachments);
      if (commanders.length) {
        const f = commanderDefenseDamageFactorForUnit(u, commanders, cities, units);
        damage = Math.max(1, Math.floor(damage * f));
      }
      damage = scaleLandCombatDamageToUnit(damage);
      const ro = combatRoll01(cycle, now, ship.id, u.id, salt);
      damage = applyBombardSplashDamage(damage, hitOutcomeFromBombardSplashRoll(ro));
      if (damage <= 0) continue;
      u.hp -= damage;
      ship.status = 'fighting';
      if (u.hp <= 0) {
        killed.push(u.id);
        const leveled = awardXp(ship, COMBAT_KILL_XP);
        if (leveled) {
          notifications.push({
            id: generateId('n'),
            turn: cycle,
            message: `${capitalize(ship.type)} leveled up to ${ship.level}!`,
            type: 'success',
          });
        }
      }
    }

    for (const h of heroes) {
      if (h.ownerId === ship.ownerId || heroHp(h) <= 0) continue;
      if (!splashKeysSet.has(tileKey(h.q, h.r))) continue;
      if (tileIsWater(tiles, h.q, h.r)) continue;
      let dmg = scaleLandCombatDamageToUnit(applyTowerDefense(unitBaseDmg, h.q, h.r, cities));
      const ro = combatRoll01(cycle, now, ship.id, h.id, 450);
      dmg = applyBombardSplashDamage(dmg, hitOutcomeFromBombardSplashRoll(ro));
      if (dmg <= 0) continue;
      h.hp = Math.max(0, (h.hp ?? HERO_BASE_HP) - dmg);
      ship.status = 'fighting';
      if ((h.hp ?? 0) <= 0) killedHeroIds.push(h.id);
    }

    defenseVolleyFx.push({
      kind: 'coastal_bombard',
      fromQ: ship.q,
      fromR: ship.r,
      splashKeys,
    });
  }

  return {
    killedUnitIds: expandKilledWithCargoIds(units, killed),
    killedHeroIds,
    notifications,
    combatHexKeys,
    defenseVolleyFx,
    rangedShotFx,
    moraleState: initMorale(),
    killFeed: [],
  };
}

function heroHp(hero: Hero | undefined): number {
  return hero?.hp ?? HERO_BASE_HP;
}

/** Formation screening: melee front-line (range ≤ 1, attack > 0) absorbs hits before ranged back-line is exposed. */
function pickScreenedTarget(enemies: Unit[]): Unit | undefined {
  return (
    enemies.find(d => d.hp > 0 && getUnitStats(d).range <= 1 && getUnitStats(d).attack > 0) ??
    enemies.find(d => d.hp > 0)
  );
}

function resolveMeleeRound(
  side1: Unit[], side2: Unit[],
  hero1: Hero | undefined, hero2: Hero | undefined,
  killed: string[], killedHeroIds: string[], notifications: GameNotification[], cycle: number,
  cities: City[] = [],
  nowMs: number = Date.now(),
  allUnits: Unit[] = [],
  scrollAttachments?: ScrollAttachment[],
  commanders: Commander[] = [],
  tiles: Map<string, Tile> = new Map(),
  moraleState?: MoraleState,
  killFeed?: CombatKillEvent[],
  byHex?: Record<string, Unit[]>,
  defenseInstallations?: DefenseInstallation[],
) {
  const hexKey = side1[0] ? tileKey(side1[0].q, side1[0].r) : '';
  const atkTile = tiles.get(hexKey);

  const meleeAttack = (
    atk: Unit, side: Unit[], enemySide: Unit[],
    atkHero: Hero | undefined, defHero: Hero | undefined,
    salt: number,
  ) => {
    if (atk.hp <= 0 || atk.retreatAt) return;
    const unitTarget = pickScreenedTarget(enemySide);
    const heroTargetAlive = defHero && heroHp(defHero) > 0;
    if (!unitTarget && !heroTargetAlive) return;
    const atkMult = combatScrollMult(allUnits, atk, scrollAttachments);
    const cmdAtk = commanderAttackMultiplierForUnit(atk, commanders, cities, allUnits);
    const terrainAtk = unitTarget ? getTerrainAttackModifier(atkTile, atkTile, atk.type) : 1;
    const counterM = unitTarget ? getCounterMultiplier(atk.type, unitTarget.type) : 1;
    const stanceAtk = getStanceAttackMult(atk.stance);
    const moraleMult = moraleState ? getMoraleAttackPenalty(getStackMorale(moraleState, hexKey, atk.ownerId)) : 1;
    const chargeMult = getChargeBonus(atk);
    const shieldPenalty = getShieldWallAttackPenalty(atk);
    const volleyMult = getVolleyFireBonus(atk, nowMs);
    const abilityMult = chargeMult * shieldPenalty * volleyMult;
    const flankBonus = byHex && unitTarget ? getFlankingBonus(unitTarget.q, unitTarget.r, atk.ownerId, byHex) : 0;

    let rawDmg = getUnitAttack(atk, atkHero, {
      attackMult: atkMult, commanderAttackMult: cmdAtk,
      terrainAttackMult: terrainAtk, counterMult: counterM,
      stanceMult: stanceAtk, flankingBonus: flankBonus,
      moraleMult, abilityMult,
    });
    if (unitTarget) {
      let dmg = applyTowerDefense(rawDmg, unitTarget.q, unitTarget.r, cities);
      if (atk.assaulting && isCityCenter(unitTarget.q, unitTarget.r, cities)) {
        dmg = Math.max(1, Math.floor(dmg * ASSAULT_ATTACK_DEBUFF));
      }
      dmg = applyDamageResist(dmg, unitTarget, cities, allUnits, scrollAttachments, tiles);
      dmg = Math.max(1, Math.floor(dmg * commanderDefenseDamageFactorForUnit(unitTarget, commanders, cities, allUnits)));
      dmg = scaleLandCombatDamageToUnit(dmg);
      const ro = combatRoll01(cycle, nowMs, atk.id, unitTarget.id, salt);
      dmg = applyHitOutcomeDamage(dmg, hitOutcomeFromRoll(ro));
      unitTarget.hp -= dmg;
      atk.status = 'fighting';
      if (atk.chargeReady) atk.chargeReady = false;
      maybeApplyRetaliation(unitTarget, { attackerUnitId: atk.id }, allUnits, defenseInstallations);
      if (unitTarget.hp <= 0) {
        killed.push(unitTarget.id);
        awardXp(atk, COMBAT_KILL_XP);
        if (moraleState) adjustMoraleOnKill(moraleState, hexKey, atk.ownerId, unitTarget.ownerId);
        if (killFeed) killFeed.push({ killerType: atk.type, killerOwner: atk.ownerId, victimType: unitTarget.type, victimOwner: unitTarget.ownerId, hexKey, timestamp: nowMs });
      }
    } else if (defHero) {
      let dmg = scaleLandCombatDamageToUnit(applyTowerDefense(rawDmg, defHero.q, defHero.r, cities));
      const ro = combatRoll01(cycle, nowMs, atk.id, defHero.id, salt + 1);
      dmg = applyHitOutcomeDamage(dmg, hitOutcomeFromRoll(ro));
      const hp = (defHero.hp ?? HERO_BASE_HP) - dmg;
      defHero.hp = Math.max(0, hp);
      atk.status = 'fighting';
      if (defHero.hp <= 0) {
        killedHeroIds.push(defHero.id);
        if (moraleState) adjustMoraleOnHeroDeath(moraleState, hexKey, defHero.ownerId);
      }
    }
  };

  for (const atk of side1) meleeAttack(atk, side1, side2, hero1, hero2, 11);
  for (const atk of side2) meleeAttack(atk, side2, side1, hero2, hero1, 21);

  if (hero1 && heroHp(hero1) > 0) {
    const target = pickScreenedTarget(side2);
    if (target) {
      let dmg = applyTowerDefense(HERO_ATTACK, target.q, target.r, cities);
      const afterResist = applyDamageResist(dmg, target, cities, allUnits, scrollAttachments, tiles);
      let scaled = scaleLandCombatDamageToUnit(
        Math.max(1, Math.floor(afterResist * commanderDefenseDamageFactorForUnit(target, commanders, cities, allUnits))),
      );
      const ro = combatRoll01(cycle, nowMs, hero1.id, target.id, 41);
      scaled = applyHitOutcomeDamage(scaled, hitOutcomeFromRoll(ro));
      target.hp -= scaled;
      if (target.hp <= 0) {
        killed.push(target.id);
        if (moraleState && hero1.ownerId) adjustMoraleOnKill(moraleState, hexKey, hero1.ownerId, target.ownerId);
      }
    }
  }
  if (hero2 && heroHp(hero2) > 0) {
    const target = pickScreenedTarget(side1);
    if (target) {
      let dmg = applyTowerDefense(HERO_ATTACK, target.q, target.r, cities);
      const afterResist = applyDamageResist(dmg, target, cities, allUnits, scrollAttachments, tiles);
      let scaled = scaleLandCombatDamageToUnit(
        Math.max(1, Math.floor(afterResist * commanderDefenseDamageFactorForUnit(target, commanders, cities, allUnits))),
      );
      const ro = combatRoll01(cycle, nowMs, hero2.id, target.id, 42);
      scaled = applyHitOutcomeDamage(scaled, hitOutcomeFromRoll(ro));
      target.hp -= scaled;
      if (target.hp <= 0) {
        killed.push(target.id);
        if (moraleState && hero2.ownerId) adjustMoraleOnKill(moraleState, hexKey, hero2.ownerId, target.ownerId);
      }
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
export type SupplyCacheEntry = { inSupply: boolean; q: number; r: number };

export function upkeepTick(
  units: Unit[],
  cities: City[],
  heroes: Hero[],
  cycle: number,
  tiles: Map<string, Tile>,
  territory: Map<string, TerritoryInfo>,
  supplyCache?: Map<string, SupplyCacheEntry>,
): UpkeepResult {
  const notifications: GameNotification[] = [];

  const byOwner: Record<string, Unit[]> = {};
  for (const u of units) {
    if (u.hp <= 0) continue;
    if (!byOwner[u.ownerId]) byOwner[u.ownerId] = [];
    byOwner[u.ownerId].push(u);
  }

  for (const ownerId of Object.keys(byOwner)) {
    const playerUnits = byOwner[ownerId];
    const playerCities = cities.filter(c => c.ownerId === ownerId);
    const isHuman = ownerId.includes('human');

    const suppliedUnits: Unit[] = [];
    const unsuppliedUnits: Unit[] = [];
    for (const u of playerUnits) {
      let inSupply: boolean;
      const cached = supplyCache?.get(u.id);
      if (cached && cached.q === u.q && cached.r === u.r) {
        inSupply = cached.inSupply;
      } else {
        inSupply = playerCities.length > 0 && isUnitInSupplyVicinityOfPlayerCities(u, playerCities);
        if (supplyCache) supplyCache.set(u.id, { inSupply, q: u.q, r: u.r });
      }
      if (inSupply) suppliedUnits.push(u);
      else unsuppliedUnits.push(u);
    }

    for (const u of unsuppliedUnits) {
      const hpLoss = Math.floor(u.maxHp * 0.05);
      u.hp = Math.max(1, u.hp - hpLoss);
      u.status = 'starving';
    }
    if (unsuppliedUnits.length > 0 && isHuman) {
      notifications.push({
        id: generateId('n'), turn: cycle,
        message: 'Units cut off from supply! Losing HP. Move closer to cities.',
        type: 'danger',
      });
    }

    if (suppliedUnits.length === 0 || playerCities.length === 0) continue;

    let totalFoodDemand = 0;
    let totalGunDemand = 0;
    let totalGunL2Demand = 0;
    for (const u of suppliedUnits) {
      const stats = getUnitStats(u);
      let foodUp = stats.foodUpkeep;
      const heroAtUnit = heroes.find(
        h => h.q === u.q && h.r === u.r && h.ownerId === u.ownerId && h.type === 'logistician',
      );
      if (heroAtUnit) foodUp = Math.ceil(foodUp * 0.5);
      totalFoodDemand += foodUp;
      totalGunDemand += stats.gunUpkeep ?? 0;
      totalGunL2Demand += (stats as { gunL2Upkeep?: number }).gunL2Upkeep ?? 0;
    }

    const totalFood = playerCities.reduce((s, c) => s + c.storage.food, 0);
    const totalGuns = playerCities.reduce((s, c) => s + c.storage.guns, 0);
    const totalGunsL2 = playerCities.reduce((s, c) => s + c.storage.gunsL2, 0);

    const foodOk = totalFood >= totalFoodDemand;
    if (foodOk) {
      deductFromCities(playerCities, 'food', totalFoodDemand);
      for (const u of suppliedUnits) {
        if (u.status === 'starving') u.status = 'idle';
      }
    } else if (totalFood > 0) {
      deductFromCities(playerCities, 'food', totalFood);
      if (isHuman) {
        notifications.push({
          id: generateId('n'), turn: cycle,
          message: 'Army rations low! Build more farms to avoid starvation.',
          type: 'warning',
        });
      }
      for (const u of suppliedUnits) {
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
      for (const u of suppliedUnits) {
        const hpLoss = Math.floor(u.maxHp * 0.05);
        u.hp = Math.max(1, u.hp - hpLoss);
        u.status = 'starving';
      }
    }

    const gunsOk = totalGuns >= totalGunDemand;
    if (gunsOk) deductFromCities(playerCities, 'guns', totalGunDemand);
    else {
      deductFromCities(playerCities, 'guns', totalGuns);
      if (isHuman) {
        notifications.push({
          id: generateId('n'), turn: cycle,
          message: 'Low on arms! Units fight at reduced strength. Build more factories!',
          type: 'warning',
        });
      }
    }

    const gunsL2Ok = totalGunsL2 >= totalGunL2Demand;
    if (gunsL2Ok) deductFromCities(playerCities, 'gunsL2', totalGunL2Demand);
    else {
      deductFromCities(playerCities, 'gunsL2', totalGunsL2);
      if (isHuman && totalGunL2Demand > 0) {
        notifications.push({
          id: generateId('n'), turn: cycle,
          message: 'Low on L2 arms! Upgraded units fight at reduced strength.',
          type: 'warning',
        });
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

/** Land/naval stacks moving together must share a destination, or each unit advances toward its own target (spatial formation). */
function groupArmies(units: Unit[]): Unit[][] {
  const groups: Record<string, Unit[]> = {};
  for (const u of units) {
    const tq = u.targetQ;
    const tr = u.targetR;
    const key = `${u.q},${u.r},${u.ownerId},${tq ?? ''},${tr ?? ''}`;
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
  naval: boolean,
): [number, number] | null {
  const enemies = allUnits.filter(u => u.ownerId !== ownerId && u.hp > 0);
  const neighbors = hexNeighbors(fromQ, fromR);
  let best: [number, number] | null = null;
  let bestMinDist = -1;
  for (const [nq, nr] of neighbors) {
    const tile = tiles.get(tileKey(nq, nr));
    if (!tile) continue;
    if (naval) {
      if (tile.biome !== 'water') continue;
    } else {
      if (tile.biome === 'water') continue;
    }
    const hasEnemy = allUnits.some(
      u => !u.aboardShipId && u.q === nq && u.r === nr && u.ownerId !== ownerId && u.hp > 0,
    );
    if (hasEnemy) continue;
    const minEnemyDist = enemies.length === 0 ? 99 : Math.min(...enemies.map(u => hexDistance(nq, nr, u.q, u.r)));
    if (minEnemyDist > bestMinDist) {
      bestMinDist = minEnemyDist;
      best = [nq, nr];
    }
  }
  return best;
}

function stepTowardZOCNaval(
  fromQ: number, fromR: number,
  toQ: number, toR: number,
  tiles: Map<string, Tile>,
  allUnits: Unit[],
  ownerId: string,
): [number, number] {
  const neighbors = hexNeighbors(fromQ, fromR);
  let best: [number, number] = [fromQ, fromR];
  let bestDist = Infinity;

  for (const [nq, nr] of neighbors) {
    const tile = tiles.get(tileKey(nq, nr));
    if (!tile || tile.biome !== 'water') continue;
    const hasEnemy = allUnits.some(
      u => !u.aboardShipId && u.q === nq && u.r === nr && u.ownerId !== ownerId && u.hp > 0,
    );
    if (hasEnemy) continue;
    const enemyMovingTowardUs = allUnits.some(
      u => !u.aboardShipId && u.q === nq && u.r === nr && u.ownerId !== ownerId && u.hp > 0 &&
        u.targetQ === fromQ && u.targetR === fromR
    );
    if (enemyMovingTowardUs) continue;
    const d = hexDistance(nq, nr, toQ, toR);
    if (d < bestDist) {
      bestDist = d;
      best = [nq, nr];
    }
  }
  return best;
}

/** Land armies may enter a water hex only as the final step onto a friendly scout ship with cargo room. */
function isScoutShipEmbarkWaterHex(
  nq: number, nr: number, toQ: number, toR: number, allUnits: Unit[], ownerId: string,
): boolean {
  if (nq !== toQ || nr !== toR) return false;
  const shipsHere = allUnits.filter(
    u => !u.aboardShipId && u.q === nq && u.r === nr && u.ownerId === ownerId && u.hp > 0 && u.type === 'scout_ship',
  );
  if (shipsHere.length !== 1) return false;
  const ship = shipsHere[0];
  const cap = getShipMaxCargo('scout_ship');
  const n = ship.cargoUnitIds?.length ?? 0;
  return cap > n;
}

/** Enemy walls keyed by hex (intact enemy wall blocks land move onto that hex). */
function wallSectionByHex(wallSections: WallSection[]): Map<string, WallSection> {
  const wallByKey = new Map<string, WallSection>();
  for (const w of wallSections) {
    wallByKey.set(tileKey(w.q, w.r), w);
  }
  return wallByKey;
}

/**
 * Whether land may step from (fromQ,fromR) onto (nq,nr) toward final goal (toQ,toR).
 * Mirrors previous greedy-step rules (water/embark, ZOC, enemy walls).
 */
function isLandNeighborStepAllowed(
  fromQ: number,
  fromR: number,
  nq: number,
  nr: number,
  toQ: number,
  toR: number,
  tiles: Map<string, Tile>,
  allUnits: Unit[],
  ownerId: string,
  wallByKey: Map<string, WallSection>,
): boolean {
  const tile = tiles.get(tileKey(nq, nr));
  if (!tile) return false;
  const embarkWater = tile.biome === 'water' && isScoutShipEmbarkWaterHex(nq, nr, toQ, toR, allUnits, ownerId);
  if (tile.biome === 'water' && !embarkWater) return false;
  const hasEnemy = allUnits.some(
    u => !u.aboardShipId && u.q === nq && u.r === nr && u.ownerId !== ownerId && u.hp > 0,
  );
  if (hasEnemy) return false;
  const enemyMovingTowardUs = allUnits.some(
    u =>
      !u.aboardShipId &&
      u.q === nq &&
      u.r === nr &&
      u.ownerId !== ownerId &&
      u.hp > 0 &&
      u.targetQ === fromQ &&
      u.targetR === fromR,
  );
  if (enemyMovingTowardUs) return false;
  const wallSection = wallByKey.get(tileKey(nq, nr));
  if (wallSection && wallSection.ownerId !== ownerId) {
    const hp = wallSection.hp ?? 1;
    if (hp > 0) return false;
  }
  return true;
}

/**
 * First step of a shortest passable land path (BFS). Handles coasts, wall gaps, and
 * narrow channels where greedy "always decrease hex distance" gets stuck or wanders.
 */
function findNextStepLandBfs(
  fromQ: number,
  fromR: number,
  toQ: number,
  toR: number,
  tiles: Map<string, Tile>,
  allUnits: Unit[],
  ownerId: string,
  wallByKey: Map<string, WallSection>,
): [number, number] | null {
  const startKey = tileKey(fromQ, fromR);
  const goalKey = tileKey(toQ, toR);
  if (startKey === goalKey) return null;

  const straight = hexDistance(fromQ, fromR, toQ, toR);
  // Detours (e.g. long coast) can visit far more hexes than straight-line distance.
  const maxVisited = Math.min(10000, Math.max(350, (straight + 28) * (straight + 28)));

  const visited = new Set<string>([startKey]);
  const parent = new Map<string, string>();
  const q: string[] = [startKey];
  let qi = 0;

  while (qi < q.length && visited.size <= maxVisited) {
    const curKey = q[qi++]!;
    if (curKey === goalKey) {
      let node = goalKey;
      for (;;) {
        const p = parent.get(node);
        if (!p) return null;
        if (p === startKey) return parseTileKey(node);
        node = p;
      }
    }
    const [cq, cr] = parseTileKey(curKey);
    for (const [nq, nr] of hexNeighbors(cq, cr)) {
      const nk = tileKey(nq, nr);
      if (visited.has(nk)) continue;
      if (!isLandNeighborStepAllowed(cq, cr, nq, nr, toQ, toR, tiles, allUnits, ownerId, wallByKey)) {
        continue;
      }
      visited.add(nk);
      parent.set(nk, curKey);
      q.push(nk);
    }
  }
  return null;
}

function stepTowardZOCGreedy(
  fromQ: number,
  fromR: number,
  toQ: number,
  toR: number,
  tiles: Map<string, Tile>,
  allUnits: Unit[],
  ownerId: string,
  wallByKey: Map<string, WallSection>,
): [number, number] {
  const neighbors = hexNeighbors(fromQ, fromR);
  let best: [number, number] = [fromQ, fromR];
  let bestDist = Infinity;

  for (const [nq, nr] of neighbors) {
    if (!isLandNeighborStepAllowed(fromQ, fromR, nq, nr, toQ, toR, tiles, allUnits, ownerId, wallByKey)) {
      continue;
    }
    const d = hexDistance(nq, nr, toQ, toR);
    if (d < bestDist) {
      bestDist = d;
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
  const wallByKey = wallSectionByHex(wallSections);
  const dist = hexDistance(fromQ, fromR, toQ, toR);
  if (dist === 0) return [fromQ, fromR];

  const greedy = stepTowardZOCGreedy(fromQ, fromR, toQ, toR, tiles, allUnits, ownerId, wallByKey);
  const moved = greedy[0] !== fromQ || greedy[1] !== fromR;
  const dGreedy = moved ? hexDistance(greedy[0], greedy[1], toQ, toR) : dist;
  // Open ground: one step closer is enough (avoids BFS cost on long marches).
  if (moved && dGreedy < dist) return greedy;

  // Coastline / walls / cul-de-sacs: greedy stalls or only tangents — take first step of a shortest path.
  const bfsMaxGoalDist = 112;
  if (dist <= bfsMaxGoalDist) {
    const bfsStep = findNextStepLandBfs(fromQ, fromR, toQ, toR, tiles, allUnits, ownerId, wallByKey);
    if (bfsStep) return bfsStep;
  }

  return greedy;
}

/** When land units share a water hex with a friendly scout ship, board if there is cargo room. */
export function autoEmbarkLandUnitsOntoScoutShipsAtHex(units: Unit[], tiles: Map<string, Tile>): void {
  for (const u of units) {
    if (u.hp <= 0 || u.aboardShipId || isNavalUnitType(u.type)) continue;
    const t = tiles.get(tileKey(u.q, u.r));
    if (t?.biome !== 'water') continue;
    const ships = units.filter(
      x =>
        x.type === 'scout_ship' &&
        x.ownerId === u.ownerId &&
        x.q === u.q &&
        x.r === u.r &&
        x.hp > 0 &&
        !x.aboardShipId,
    );
    if (ships.length !== 1) continue;
    const ship = ships[0];
    const cap = getShipMaxCargo('scout_ship');
    const cargo = [...(ship.cargoUnitIds ?? [])];
    if (cargo.length >= cap) continue;
    if (cargo.includes(u.id)) continue;
    cargo.push(u.id);
    ship.cargoUnitIds = cargo;
    u.aboardShipId = ship.id;
    u.targetQ = undefined;
    u.targetR = undefined;
    u.status = 'idle';
    clearMarchFields(u);
    if (u.garrisonCityId) delete u.garrisonCityId;
    if (u.defendCityId) delete u.defendCityId;
  }
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

/** Siege units damage enemy city buildings (same range rules as walls). Ruins at 0 HP. */
export function siegeBuildingsTick(cities: City[], units: Unit[]): void {
  const siegeTypes = ['trebuchet', 'battering_ram'] as const;
  for (const city of cities) {
    for (const b of city.buildings) {
      const maxHp = b.maxHp ?? defaultCityBuildingMaxHp(b.type, b.level ?? 1);
      if (b.buildingState === 'ruins') continue;
      let hp = b.hp ?? maxHp;
      if (hp <= 0) continue;

      let totalDmg = 0;
      for (const u of units) {
        if (u.hp <= 0 || u.ownerId === city.ownerId) continue;
        if (!siegeTypes.includes(u.type as (typeof siegeTypes)[number])) continue;
        const stats = getUnitStats(u);
        const range = stats.range;
        const siegeAttack = (stats as { siegeAttack?: number }).siegeAttack ?? 0;
        if (siegeAttack <= 0) continue;
        const dist = hexDistance(u.q, u.r, b.q, b.r);
        if (dist > range) continue;
        totalDmg += siegeAttack;
      }
      if (totalDmg <= 0) continue;
      hp = Math.max(0, hp - totalDmg);
      b.hp = hp;
      if (hp <= 0) {
        b.buildingState = 'ruins';
        b.hp = 0;
      }
    }
  }
}

const SIEGE_UNIT_TYPES_FOR_BUILDING: ReadonlySet<Unit['type']> = new Set(['trebuchet', 'battering_ram']);

/** Non-siege land units damage enemy city buildings when occupying the hex or when ordered (attackBuildingTarget). */
export function landUnitBuildingDamageTick(cities: City[], units: Unit[]): void {
  for (const city of cities) {
    for (const b of city.buildings) {
      if (!isCityBuildingOperational(b)) continue;
      const maxHp = b.maxHp ?? defaultCityBuildingMaxHp(b.type, b.level ?? 1);
      let hp = b.hp ?? maxHp;
      if (hp <= 0) continue;

      let total = 0;
      for (const u of units) {
        if (u.hp <= 0 || u.ownerId === city.ownerId || u.aboardShipId) continue;
        if (isNavalUnitType(u.type)) continue;
        if (u.type === 'builder') {
          const dist = hexDistance(u.q, u.r, b.q, b.r);
          const ordered =
            u.attackBuildingTarget &&
            u.attackBuildingTarget.cityId === city.id &&
            u.attackBuildingTarget.q === b.q &&
            u.attackBuildingTarget.r === b.r;
          const raid = dist === 0;
          if (!ordered && !raid) continue;
          total += 1;
          continue;
        }
        if (!isLandMilitaryUnit(u)) continue;
        if (SIEGE_UNIT_TYPES_FOR_BUILDING.has(u.type)) continue;

        const dist = hexDistance(u.q, u.r, b.q, b.r);
        const stats = getUnitStats(u);
        const ordered =
          u.attackBuildingTarget &&
          u.attackBuildingTarget.cityId === city.id &&
          u.attackBuildingTarget.q === b.q &&
          u.attackBuildingTarget.r === b.r;
        const raid = dist === 0;

        if (!ordered && !raid) continue;

        if (raid) {
          total += Math.max(1, Math.floor(stats.attack * 0.1));
        } else if (stats.range <= 1) {
          if (dist > 1) continue;
          total += Math.max(1, Math.floor(stats.attack * 0.16));
        } else {
          if (dist > stats.range || dist === 0) continue;
          total += Math.max(1, Math.floor(stats.attack * 0.13));
        }
      }
      if (total <= 0) continue;
      hp = Math.max(0, hp - total);
      b.hp = hp;
      if (hp <= 0) {
        b.buildingState = 'ruins';
        b.hp = 0;
      }
    }
  }

  for (const u of units) {
    if (!u.attackBuildingTarget) continue;
    const c = cities.find(x => x.id === u.attackBuildingTarget!.cityId);
    const bb = c?.buildings.find(
      x => x.q === u.attackBuildingTarget!.q && x.r === u.attackBuildingTarget!.r,
    );
    if (!bb || !isCityBuildingOperational(bb)) delete u.attackBuildingTarget;
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
