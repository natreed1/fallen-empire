import {
  Unit, Hero, UNIT_BASE_STATS, UNIT_L2_STATS,
} from '@/types/game';

/**
 * Get effective attack for a unit, considering armsLevel, level and hero buff.
 * Formula: BaseAttack * (1 + level * 0.1) * hero bonus
 */
export function getUnitAttack(unit: Unit, hero?: Hero): number {
  const stats = unit.armsLevel === 2 ? UNIT_L2_STATS[unit.type] : UNIT_BASE_STATS[unit.type];
  const base = stats.attack;
  const levelBonus = 1 + unit.level * 0.1;
  const heroBonus = hero?.type === 'general' ? 1.1 : 1.0;
  return Math.floor(base * levelBonus * heroBonus);
}

/**
 * Award XP to a unit.  If XP >= 100, level up: reset XP, increase maxHp, partial heal.
 */
export function awardXp(unit: Unit, amount: number): boolean {
  unit.xp += amount;
  if (unit.xp >= 100) {
    unit.xp -= 100;
    unit.level += 1;
    const stats = unit.armsLevel === 2 ? UNIT_L2_STATS[unit.type] : UNIT_BASE_STATS[unit.type];
    unit.maxHp = Math.floor(stats.maxHp * (1 + unit.level * 0.1));
    unit.hp = Math.min(unit.hp + 20, unit.maxHp);
    return true; // leveled up
  }
  return false;
}
