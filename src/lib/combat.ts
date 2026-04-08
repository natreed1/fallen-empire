import {
  Unit, Hero, Tile, City, type Biome, type UnitType, type TerritoryInfo,
  getUnitStats, tileKey, hexNeighbors, hexTouchesBiome,
  TERRAIN_DEFENSE_BONUS, TERRAIN_RANGED_ATTACK_BONUS, TERRAIN_CAVALRY_PENALTY,
  RIVER_CROSSING_ATTACK_PENALTY,
  COUNTER_MULTIPLIER,
  MORALE_MAX, MORALE_START, MORALE_ALLY_DEATH_DROP, MORALE_HERO_DEATH_DROP,
  MORALE_KILL_BOOST, MORALE_COMMANDER_PRESENCE_BOOST, MORALE_HOME_TERRITORY_BOOST,
  MORALE_OUTNUMBER_DRAIN_PER_TICK, MORALE_WAVER_THRESHOLD, MORALE_WAVER_ATTACK_PENALTY,
  MORALE_ROUT_THRESHOLD,
  FLANK_2_HEX_BONUS, FLANK_3_HEX_BONUS,
  STANCE_AGGRESSIVE_ATTACK_BONUS, STANCE_AGGRESSIVE_DEFENSE_PENALTY,
  STANCE_DEFENSIVE_DEFENSE_BONUS, STANCE_DEFENSIVE_ATTACK_PENALTY,
  STANCE_HOLD_DEFENSE_BONUS,
  type Commander,
} from '@/types/game';

// ─── Terrain Combat Modifiers ─────────────────────────────────────

export interface TerrainModifiers {
  attackMult: number;
  defenseMult: number;
}

export function getTerrainAttackModifier(
  attackerTile: Tile | undefined,
  targetTile: Tile | undefined,
  attackerType: UnitType,
): number {
  let mult = 1.0;
  if (!attackerTile || !targetTile) return mult;
  const rangedBonus = TERRAIN_RANGED_ATTACK_BONUS[attackerTile.biome] ?? 0;
  const stats = getUnitStats({ type: attackerType, armsLevel: 1 });
  if (rangedBonus > 0 && stats.range >= 2) mult += rangedBonus;
  const cavPenalty = TERRAIN_CAVALRY_PENALTY[targetTile.biome] ?? 0;
  if (cavPenalty > 0 && (attackerType === 'cavalry' || attackerType === 'horse_archer' || attackerType === 'crusader_knight')) {
    mult -= cavPenalty;
  }
  return Math.max(0.5, mult);
}

export function getTerrainDefenseModifier(
  defenderTile: Tile | undefined,
): number {
  if (!defenderTile) return 1.0;
  const bonus = TERRAIN_DEFENSE_BONUS[defenderTile.biome] ?? 0;
  return 1.0 + bonus;
}

export function getRiverCrossingPenalty(
  attackerTile: Tile | undefined,
  tiles: Map<string, Tile>,
  attackerQ: number,
  attackerR: number,
): number {
  if (!attackerTile || attackerTile.biome === 'water') return 1.0;
  if (hexTouchesBiome(tiles, attackerQ, attackerR, 'water')) {
    return 1.0 - RIVER_CROSSING_ATTACK_PENALTY;
  }
  return 1.0;
}

// ─── Unit Counter Multipliers ─────────────────────────────────────

export function getCounterMultiplier(attackerType: UnitType, targetType: UnitType): number {
  return COUNTER_MULTIPLIER[attackerType]?.[targetType] ?? 1.0;
}

// ─── Flanking Bonus ───────────────────────────────────────────────

export function getFlankingBonus(
  targetQ: number,
  targetR: number,
  attackerOwnerId: string,
  unitsByHex: Record<string, Unit[]>,
): number {
  const neighbors = hexNeighbors(targetQ, targetR);
  let friendlyHexes = 0;
  for (const [nq, nr] of neighbors) {
    const key = tileKey(nq, nr);
    const hexUnits = unitsByHex[key];
    if (!hexUnits) continue;
    if (hexUnits.some(u => u.ownerId === attackerOwnerId && u.hp > 0 && u.stance === 'aggressive')) {
      friendlyHexes++;
    }
  }
  if (friendlyHexes >= 3) return FLANK_3_HEX_BONUS;
  if (friendlyHexes >= 2) return FLANK_2_HEX_BONUS;
  return 0;
}

// ─── Stance Modifiers ─────────────────────────────────────────────

export function getStanceAttackMult(stance: Unit['stance']): number {
  switch (stance) {
    case 'aggressive': return 1 + STANCE_AGGRESSIVE_ATTACK_BONUS;
    case 'defensive': return 1 - STANCE_DEFENSIVE_ATTACK_PENALTY;
    case 'hold_the_line': return 1.0;
    case 'skirmish': return 0.85;
    default: return 1.0;
  }
}

export function getStanceDefenseMult(stance: Unit['stance']): number {
  switch (stance) {
    case 'aggressive': return 1 - STANCE_AGGRESSIVE_DEFENSE_PENALTY;
    case 'defensive': return 1 + STANCE_DEFENSIVE_DEFENSE_BONUS;
    case 'hold_the_line': return 1 + STANCE_HOLD_DEFENSE_BONUS;
    case 'skirmish': return 1.0;
    default: return 1.0;
  }
}

// ─── Morale System ────────────────────────────────────────────────

export type MoraleState = Map<string, { ownerId: string; morale: number }>;

export function initMorale(): MoraleState {
  return new Map();
}

export function getStackMorale(state: MoraleState, hexKey: string, ownerId: string): number {
  const key = `${hexKey}:${ownerId}`;
  return state.get(key)?.morale ?? MORALE_START;
}

export function setStackMorale(state: MoraleState, hexKey: string, ownerId: string, morale: number): void {
  const key = `${hexKey}:${ownerId}`;
  state.set(key, { ownerId, morale: Math.max(0, Math.min(MORALE_MAX, morale)) });
}

export function adjustMoraleOnKill(state: MoraleState, hexKey: string, killerOwnerId: string, victimOwnerId: string): void {
  const killerMorale = getStackMorale(state, hexKey, killerOwnerId);
  setStackMorale(state, hexKey, killerOwnerId, killerMorale + MORALE_KILL_BOOST);
  const victimMorale = getStackMorale(state, hexKey, victimOwnerId);
  setStackMorale(state, hexKey, victimOwnerId, victimMorale - MORALE_ALLY_DEATH_DROP);
}

export function adjustMoraleOnHeroDeath(state: MoraleState, hexKey: string, ownerId: string): void {
  const morale = getStackMorale(state, hexKey, ownerId);
  setStackMorale(state, hexKey, ownerId, morale - MORALE_HERO_DEATH_DROP);
}

export function tickMorale(
  state: MoraleState,
  hexKey: string,
  ownerId: string,
  friendlyCount: number,
  enemyCount: number,
  hasCommander: boolean,
  isHomeTerr: boolean,
): void {
  let morale = getStackMorale(state, hexKey, ownerId);
  if (hasCommander) morale += MORALE_COMMANDER_PRESENCE_BOOST;
  if (isHomeTerr) morale += MORALE_HOME_TERRITORY_BOOST;
  if (enemyCount > friendlyCount * 1.5) morale -= MORALE_OUTNUMBER_DRAIN_PER_TICK;
  if (enemyCount > friendlyCount * 2) morale -= MORALE_OUTNUMBER_DRAIN_PER_TICK;
  setStackMorale(state, hexKey, ownerId, morale);
}

export function getMoraleAttackPenalty(morale: number): number {
  if (morale < MORALE_WAVER_THRESHOLD) return 1 - MORALE_WAVER_ATTACK_PENALTY;
  return 1.0;
}

export function shouldRout(morale: number): boolean {
  return morale < MORALE_ROUT_THRESHOLD;
}

// ─── Ability Helpers ──────────────────────────────────────────────

export function isAbilityActive(unit: Unit, now: number): boolean {
  if (!unit.abilityActive) return false;
  if (unit.abilityActiveUntil && now > unit.abilityActiveUntil) return false;
  return true;
}

export function isAbilityOnCooldown(unit: Unit, now: number): boolean {
  return !!(unit.abilityCooldownUntil && now < unit.abilityCooldownUntil);
}

export function getShieldWallDefenseBonus(unit: Unit): number {
  if (unit.type !== 'infantry' || !unit.abilityActive) return 0;
  return 0.40;
}

export function getShieldWallAttackPenalty(unit: Unit): number {
  if (unit.type !== 'infantry' || !unit.abilityActive) return 1.0;
  return 0.50;
}

export function getVolleyFireBonus(unit: Unit, now: number): number {
  if ((unit.type !== 'ranged' && unit.type !== 'horse_archer') || !isAbilityActive(unit, now)) return 1.0;
  return 1.50;
}

export function getChargeBonus(unit: Unit): number {
  if ((unit.type !== 'cavalry') || !unit.chargeReady) return 1.0;
  return 2.0;
}

// ─── Core Attack / XP ─────────────────────────────────────────────

/**
 * Get effective attack for a unit, considering armsLevel, level, hero buff, stance, terrain, counters, abilities.
 */
export function getUnitAttack(
  unit: Unit,
  hero?: Hero,
  opts?: {
    attackMult?: number;
    commanderAttackMult?: number;
    terrainAttackMult?: number;
    counterMult?: number;
    stanceMult?: number;
    flankingBonus?: number;
    moraleMult?: number;
    abilityMult?: number;
  },
): number {
  const stats = getUnitStats(unit);
  const base = stats.attack;
  const levelBonus = 1 + unit.level * 0.1;
  const heroBonus = hero?.type === 'general' ? 1.1 : 1.0;
  const scrollMult = opts?.attackMult ?? 1;
  const cmdMult = opts?.commanderAttackMult ?? 1;
  const terrainMult = opts?.terrainAttackMult ?? 1;
  const counterMult = opts?.counterMult ?? 1;
  const stanceMult = opts?.stanceMult ?? 1;
  const flankBonus = 1 + (opts?.flankingBonus ?? 0);
  const moraleMult = opts?.moraleMult ?? 1;
  const abilityMult = opts?.abilityMult ?? 1;
  return Math.floor(base * levelBonus * heroBonus * scrollMult * cmdMult * terrainMult * counterMult * stanceMult * flankBonus * moraleMult * abilityMult);
}

/**
 * Award XP to a unit.  If XP >= 100, level up: reset XP, increase maxHp, partial heal.
 */
export function awardXp(unit: Unit, amount: number): boolean {
  unit.xp += amount;
  if (unit.xp >= 100) {
    unit.xp -= 100;
    unit.level += 1;
    const stats = getUnitStats(unit);
    unit.maxHp = Math.floor(stats.maxHp * (1 + unit.level * 0.1));
    unit.hp = Math.min(unit.hp + 20, unit.maxHp);
    return true;
  }
  return false;
}
