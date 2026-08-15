/**
 * Army-level combat posture: one click for a whole field army,
 * with hex/stack overrides when mixed tactics are needed.
 */

import type { ArmyStance, OperationalArmy, Unit } from '@/types/game';
import { isNavalUnitType } from '@/types/game';
import { isLandMilitaryUnit } from '@/lib/garrison';

export const ARMY_STANCE_OPTIONS: { id: ArmyStance; label: string; hint: string }[] = [
  { id: 'aggressive', label: 'Aggro', hint: 'More damage, thinner armor, chase when shot' },
  { id: 'defensive', label: 'Defend', hint: 'Hold ground, shoot in range, do not chase' },
  { id: 'hold_the_line', label: 'Hold', hint: 'Best armor, shoot in range, never leave the hex once fighting' },
  { id: 'skirmish', label: 'Skirm', hint: 'Shoot and kite if melee closes' },
  { id: 'passive', label: 'Pass', hint: 'No volleys; fight only if already in contact' },
];

export function isFieldArmyLandUnit(u: Unit): boolean {
  return u.hp > 0 && !u.aboardShipId && isLandMilitaryUnit(u);
}

export function armyForTrainingStack(
  armies: OperationalArmy[] | undefined,
  stackId: string | undefined,
  ownerId: string,
): OperationalArmy | undefined {
  if (!stackId || !armies?.length) return undefined;
  return armies.find(a => a.ownerId === ownerId && (a.stackIds ?? []).includes(stackId));
}

export function applyStanceToMatchingUnits(
  units: Unit[],
  match: (u: Unit) => boolean,
  stance: ArmyStance,
): Unit[] {
  return units.map(u => (match(u) ? { ...u, stance } : u));
}

export function applyRetreatToMatchingUnits(
  units: Unit[],
  match: (u: Unit) => boolean,
  retreatAt: number,
): Unit[] {
  return units.map(u => (match(u) && u.hp > 0 ? { ...u, retreatAt } : u));
}

export function applyArmyStance(
  units: Unit[],
  armies: OperationalArmy[],
  armyId: string,
  ownerId: string,
  stance: ArmyStance,
): { units: Unit[]; armies: OperationalArmy[] } {
  return {
    armies: armies.map(a => (a.id === armyId && a.ownerId === ownerId ? { ...a, stance } : a)),
    units: applyStanceToMatchingUnits(
      units,
      u => u.ownerId === ownerId && u.armyId === armyId && isFieldArmyLandUnit(u),
      stance,
    ),
  };
}

/** Stamp armyId + army stance onto a newly spawned recruit linked via training stack. */
export function stampRecruitFromOperationalArmy(
  unit: Unit,
  stackId: string | undefined,
  armies: OperationalArmy[] | undefined,
): Unit {
  const army = armyForTrainingStack(armies, stackId, unit.ownerId);
  if (!army) return unit;
  if (isNavalUnitType(unit.type) || unit.type === 'builder') return unit;
  return { ...unit, armyId: army.id, stance: army.stance };
}

export function attachUnitsToArmy(
  units: Unit[],
  unitIds: Set<string>,
  army: OperationalArmy,
): Unit[] {
  return units.map(u =>
    unitIds.has(u.id) ? { ...u, armyId: army.id, stance: army.stance } : u,
  );
}

export function majorityStance(units: Unit[]): ArmyStance | null {
  const land = units.filter(isFieldArmyLandUnit);
  if (land.length === 0) return null;
  const counts = new Map<ArmyStance, number>();
  for (const u of land) {
    counts.set(u.stance, (counts.get(u.stance) ?? 0) + 1);
  }
  let best: ArmyStance = land[0]!.stance;
  let n = 0;
  for (const [s, c] of counts) {
    if (c > n) {
      best = s;
      n = c;
    }
  }
  return best;
}
