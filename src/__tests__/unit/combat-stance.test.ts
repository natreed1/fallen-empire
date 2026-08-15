import { describe, expect, it } from 'vitest';
import {
  getFlankingBonus,
  getStanceAttackMult,
  getStanceDefenseMult,
  stanceContributesFlank,
  stanceInitiatesCrossHexFire,
  stancePursuesOnHit,
} from '@/lib/combat';
import type { ArmyStance, Unit } from '@/types/game';
import { FLANK_2_HEX_BONUS, tileKey } from '@/types/game';

describe('combat stance helpers', () => {
  it('lets defensive and hold_the_line initiate cross-hex fire', () => {
    expect(stanceInitiatesCrossHexFire('aggressive')).toBe(true);
    expect(stanceInitiatesCrossHexFire('skirmish')).toBe(true);
    expect(stanceInitiatesCrossHexFire('defensive')).toBe(true);
    expect(stanceInitiatesCrossHexFire('hold_the_line')).toBe(true);
    expect(stanceInitiatesCrossHexFire('passive')).toBe(false);
  });

  it('counts hold/defend as flanking pressure, not passive or skirmish', () => {
    expect(stanceContributesFlank('hold_the_line')).toBe(true);
    expect(stanceContributesFlank('defensive')).toBe(true);
    expect(stanceContributesFlank('aggressive')).toBe(true);
    expect(stanceContributesFlank('passive')).toBe(false);
    expect(stanceContributesFlank('skirmish')).toBe(false);
  });

  it('only aggressive chases after being shot', () => {
    expect(stancePursuesOnHit('aggressive')).toBe(true);
    const noChase: ArmyStance[] = ['defensive', 'hold_the_line', 'skirmish', 'passive'];
    for (const s of noChase) expect(stancePursuesOnHit(s)).toBe(false);
  });

  it('applies aggressive defense penalty and defensive/hold bonuses', () => {
    expect(getStanceDefenseMult('aggressive')).toBeLessThan(1);
    expect(getStanceDefenseMult('defensive')).toBeGreaterThan(1);
    expect(getStanceDefenseMult('hold_the_line')).toBeGreaterThan(getStanceDefenseMult('defensive'));
    expect(getStanceAttackMult('aggressive')).toBeGreaterThan(1);
    expect(getStanceAttackMult('defensive')).toBeLessThan(1);
  });

  it('awards a 2-hex flank when hold_the_line neighbors surround a target', () => {
    const stub = (id: string, ownerId: string, q: number, r: number, stance: ArmyStance): Unit =>
      ({
        id, type: 'infantry', q, r, ownerId, hp: 10, maxHp: 10, xp: 0, level: 0,
        status: 'idle', stance, nextMoveAt: 0,
      }) as Unit;
    const byHex: Record<string, Unit[]> = {
      [tileKey(1, 0)]: [stub('a', 'p1', 1, 0, 'hold_the_line')],
      [tileKey(0, 1)]: [stub('b', 'p1', 0, 1, 'defensive')],
      [tileKey(0, 0)]: [stub('e', 'p2', 0, 0, 'aggressive')],
    };
    expect(getFlankingBonus(0, 0, 'p1', byHex)).toBe(FLANK_2_HEX_BONUS);
  });

  it('does not count passive neighbors as a flank', () => {
    const stub = (id: string, ownerId: string, q: number, r: number, stance: ArmyStance): Unit =>
      ({
        id, type: 'infantry', q, r, ownerId, hp: 10, maxHp: 10, xp: 0, level: 0,
        status: 'idle', stance, nextMoveAt: 0,
      }) as Unit;
    const byHex: Record<string, Unit[]> = {
      [tileKey(1, 0)]: [stub('a', 'p1', 1, 0, 'passive')],
      [tileKey(0, 1)]: [stub('b', 'p1', 0, 1, 'skirmish')],
    };
    expect(getFlankingBonus(0, 0, 'p1', byHex)).toBe(0);
  });
});
