/**
 * Major engagement: large field battles where each side commits ≥ MAJOR_ENGAGEMENT_ARMY_FRACTION
 * of the enemy’s global land army (by maxHp sum).
 */

import {
  Unit,
  UnitType,
  getUnitStats,
  MAJOR_ENGAGEMENT_ARMY_FRACTION,
  MajorEngagementDoctrine,
  isNavalUnitType,
  tileKey,
} from '@/types/game';
import { isLandMilitaryUnit } from '@/lib/garrison';

export const MAJOR_ENGAGEMENT_DOCTRINE_LABELS: Record<MajorEngagementDoctrine, string> = {
  balanced: 'Balanced',
  shield_wall: 'Shield wall',
  volley_focus: 'Volley focus',
  flank_emphasis: 'Flank emphasis',
  hold_the_line: 'Hold the line',
  cavalry_push: 'Cavalry push',
};

export const MAJOR_ENGAGEMENT_DOCTRINE_HELP: Record<MajorEngagementDoctrine, string> = {
  balanced: 'No special modifier.',
  shield_wall: 'Slightly lower attack; better damage reduction.',
  volley_focus: 'Stronger ranged attacks; slightly weaker melee.',
  flank_emphasis: 'Bonus when flanking.',
  hold_the_line: 'Lower attack; stronger defense.',
  cavalry_push: 'Stronger cavalry and horse archers; slightly weaker infantry.',
};

function unitMaxHp(u: Unit): number {
  return u.maxHp ?? getUnitStats(u).maxHp;
}

/** Sum maxHp for a player’s global land military (excludes builders, naval, embarked, dead). */
export function globalLandArmyPower(ownerId: string, units: Unit[]): number {
  let sum = 0;
  for (const u of units) {
    if (u.hp <= 0 || u.aboardShipId) continue;
    if (!isLandMilitaryUnit(u)) continue;
    if (u.ownerId !== ownerId) continue;
    sum += unitMaxHp(u);
  }
  return sum;
}

/** Engaged land combat power at a hex (same filters as global). */
export function engagedLandPower(sideUnits: Unit[]): number {
  let sum = 0;
  for (const u of sideUnits) {
    if (u.hp <= 0 || u.aboardShipId) continue;
    if (!isLandMilitaryUnit(u)) continue;
    sum += unitMaxHp(u);
  }
  return sum;
}

/**
 * True if this side’s engaged power ≥ fraction of enemy’s global land army.
 */
export function majorEngagementThresholdMet(
  sideUnits: Unit[],
  enemyOwnerId: string,
  allUnits: Unit[],
  fraction: number = MAJOR_ENGAGEMENT_ARMY_FRACTION,
): boolean {
  const engaged = engagedLandPower(sideUnits);
  const globalEnemy = globalLandArmyPower(enemyOwnerId, allUnits);
  if (globalEnemy <= 0) return false;
  return engaged >= fraction * globalEnemy;
}

/**
 * Both land sides meet the threshold vs each other’s global army.
 */
export function bothSidesMeetMajorThreshold(
  side1: Unit[],
  side2: Unit[],
  owner1: string,
  owner2: string,
  allUnits: Unit[],
): boolean {
  if (side1.length === 0 || side2.length === 0) return false;
  return (
    majorEngagementThresholdMet(side1, owner2, allUnits) &&
    majorEngagementThresholdMet(side2, owner1, allUnits)
  );
}

const CAVALRY_TYPES: UnitType[] = ['cavalry', 'horse_archer', 'crusader_knight'];

function isCavLike(t: UnitType): boolean {
  return CAVALRY_TYPES.includes(t);
}

/** Multiplier on outgoing damage from this attacker’s doctrine. */
export function majorEngagementAttackMult(
  doctrine: MajorEngagementDoctrine,
  unitType: UnitType,
  flankBonus: number,
): number {
  const stats = getUnitStats({ type: unitType, armsLevel: 1 });
  const isRanged = stats.range >= 2;

  switch (doctrine) {
    case 'balanced':
      return 1;
    case 'shield_wall':
      return 0.92;
    case 'volley_focus':
      return isRanged ? 1.1 : 0.98;
    case 'flank_emphasis':
      return 1 + Math.min(0.12, flankBonus * 0.65);
    case 'hold_the_line':
      return 0.94;
    case 'cavalry_push':
      return isCavLike(unitType) ? 1.12 : 0.98;
    default:
      return 1;
  }
}

/** Multiplier on damage this defender receives (lower = tougher). */
export function majorEngagementDamageTakenMult(doctrine: MajorEngagementDoctrine): number {
  switch (doctrine) {
    case 'balanced':
      return 1;
    case 'shield_wall':
      return 0.88;
    case 'volley_focus':
      return 1.02;
    case 'flank_emphasis':
      return 0.98;
    case 'hold_the_line':
      return 0.9;
    case 'cavalry_push':
      return 1.02;
    default:
      return 1;
  }
}

export type EnemyTacticLabel =
  | 'Mixed line'
  | 'Mobile strike'
  | 'Ranged skirmish'
  | 'Heavy infantry'
  | 'Siege train';

/** Drop hex entries that no longer have two opposing owners present. */
export function pruneEndedMajorEngagements(
  strategies: Record<string, Record<string, MajorEngagementDoctrine>>,
  units: Unit[],
): Record<string, Record<string, MajorEngagementDoctrine>> {
  const ownerSets = new Map<string, Set<string>>();
  for (const u of units) {
    if (u.hp <= 0 || u.aboardShipId) continue;
    const k = tileKey(u.q, u.r);
    if (!ownerSets.has(k)) ownerSets.set(k, new Set());
    ownerSets.get(k)!.add(u.ownerId);
  }
  const out: Record<string, Record<string, MajorEngagementDoctrine>> = { ...strategies };
  for (const hexKey of Object.keys(out)) {
    const set = ownerSets.get(hexKey);
    if (!set || set.size < 2) delete out[hexKey];
  }
  return out;
}

/** UI-only label from enemy unit mix at the hex. */
export function inferEnemyTacticLabel(enemyUnits: Unit[]): EnemyTacticLabel {
  const land = enemyUnits.filter(u => u.hp > 0 && isLandMilitaryUnit(u) && !isNavalUnitType(u.type));
  if (land.length === 0) return 'Mixed line';
  let cav = 0,
    ranged = 0,
    siege = 0,
    inf = 0;
  for (const u of land) {
    const t = u.type;
    if (t === 'trebuchet' || t === 'battering_ram') siege++;
    else if (getUnitStats(u).range >= 2) ranged++;
    else if (isCavLike(t)) cav++;
    else inf++;
  }
  const n = land.length;
  if (siege >= 2 || siege / n >= 0.25) return 'Siege train';
  if (cav / n >= 0.35) return 'Mobile strike';
  if (ranged / n >= 0.4) return 'Ranged skirmish';
  if (inf / n >= 0.5 && ranged < n * 0.2) return 'Heavy infantry';
  return 'Mixed line';
}
