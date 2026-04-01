import {
  Unit, Hero, getUnitStats,
} from '@/types/game';

/**
 * Get effective attack for a unit, considering armsLevel, level and hero buff.
 * Formula: BaseAttack * (1 + level * 0.1) * hero bonus * optional stack scroll * commander
 */
export function getUnitAttack(
  unit: Unit,
  hero?: Hero,
  opts?: { attackMult?: number; commanderAttackMult?: number },
): number {
  const stats = getUnitStats(unit);
  const base = stats.attack;
  const levelBonus = 1 + unit.level * 0.1;
  const heroBonus = hero?.type === 'general' ? 1.1 : 1.0;
  const scrollMult = opts?.attackMult ?? 1;
  const cmdMult = opts?.commanderAttackMult ?? 1;
  return Math.floor(base * levelBonus * heroBonus * scrollMult * cmdMult);
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
    return true; // leveled up
  }
  return false;
}
