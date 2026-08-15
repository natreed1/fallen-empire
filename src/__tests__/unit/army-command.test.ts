import { describe, expect, it } from 'vitest';
import {
  applyArmyStance,
  attachUnitsToArmy,
  armyForTrainingStack,
  stampRecruitFromOperationalArmy,
} from '@/lib/armyCommand';
import { spawnUnitFromPendingLand, type PendingLandRecruit } from '@/lib/pendingLandRecruit';
import type { City, OperationalArmy, Unit } from '@/types/game';

function landUnit(id: string, armyId?: string): Unit {
  return {
    id,
    type: 'infantry',
    q: 0,
    r: 0,
    ownerId: 'p1',
    hp: 100,
    maxHp: 100,
    xp: 0,
    level: 0,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
    armyId,
  };
}

describe('army command stance', () => {
  it('sets stance on the army record and every attached land unit in one call', () => {
    const armies: OperationalArmy[] = [
      { id: 'a1', ownerId: 'p1', name: 'First', stance: 'aggressive', stackIds: [] },
    ];
    const units = [landUnit('u1', 'a1'), landUnit('u2', 'a1'), landUnit('u3', 'other')];
    const next = applyArmyStance(units, armies, 'a1', 'p1', 'hold_the_line');
    expect(next.armies[0]!.stance).toBe('hold_the_line');
    expect(next.units.find(u => u.id === 'u1')!.stance).toBe('hold_the_line');
    expect(next.units.find(u => u.id === 'u2')!.stance).toBe('hold_the_line');
    expect(next.units.find(u => u.id === 'u3')!.stance).toBe('aggressive');
  });

  it('inherits army stance when attaching a hex stack', () => {
    const army: OperationalArmy = {
      id: 'a1', ownerId: 'p1', name: 'First', stance: 'skirmish', stackIds: [],
    };
    const units = [landUnit('u1'), landUnit('u2')];
    const next = attachUnitsToArmy(units, new Set(['u1']), army);
    expect(next[0]!.armyId).toBe('a1');
    expect(next[0]!.stance).toBe('skirmish');
    expect(next[1]!.armyId).toBeUndefined();
    expect(next[1]!.stance).toBe('aggressive');
  });

  it('stamps armyId and stance onto recruits from a linked training stack', () => {
    const armies: OperationalArmy[] = [
      { id: 'a1', ownerId: 'p1', name: 'First', stance: 'defensive', stackIds: ['st1'] },
    ];
    expect(armyForTrainingStack(armies, 'st1', 'p1')?.id).toBe('a1');
    const u = stampRecruitFromOperationalArmy(landUnit('new'), 'st1', armies);
    expect(u.armyId).toBe('a1');
    expect(u.stance).toBe('defensive');
  });

  it('spawnUnitFromPendingLand inherits the operational army from the training stack', () => {
    const city = {
      id: 'c1', name: 'X', q: 0, r: 0, ownerId: 'p1', population: 20, morale: 80,
      storage: { food: 0, goods: 0, guns: 0, gunsL2: 0, iron: 0, stone: 0, wood: 0, refinedWood: 0 },
      storageCap: { food: 0, goods: 0, guns: 0, gunsL2: 0, iron: 0, stone: 0, wood: 0, refinedWood: 0 },
      buildings: [],
    } as City;
    const item: PendingLandRecruit = {
      id: 'pr1',
      playerId: 'p1',
      cityId: 'c1',
      type: 'ranged',
      effectiveArmsLevel: 1,
      spawnQ: 0,
      spawnR: 0,
      completesAtCycle: 2,
      stackId: 'st1',
    };
    const armies: OperationalArmy[] = [
      { id: 'a1', ownerId: 'p1', name: 'Bows', stance: 'skirmish', stackIds: ['st1'] },
    ];
    const u = spawnUnitFromPendingLand(item, [city], armies);
    expect(u).not.toBeNull();
    expect(u!.armyId).toBe('a1');
    expect(u!.stance).toBe('skirmish');
    expect(u!.stackId).toBe('st1');
  });
});
