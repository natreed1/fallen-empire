import { describe, expect, it } from 'vitest';
import { combatTick } from '@/lib/military';
import type { Tile, Unit } from '@/types/game';
import { getUnitStats, tileKey } from '@/types/game';

function plainsAt(q: number, r: number): Tile {
  return {
    q, r, biome: 'plains', elevation: 0.4, height: 0.4,
    hasRoad: false, hasRuins: false, hasVillage: false,
    isProvinceCenter: false, hasQuarryDeposit: false, hasMineDeposit: false,
    hasAncientCity: false, hasGoldMineDeposit: false, hasWoodDeposit: false, isIsland: false,
  };
}

function makeUnit(partial: Partial<Unit> & Pick<Unit, 'id' | 'type' | 'q' | 'r' | 'ownerId' | 'stance'>): Unit {
  const stats = getUnitStats({ type: partial.type, armsLevel: 1 });
  return {
    hp: stats.maxHp,
    maxHp: stats.maxHp,
    xp: 0,
    level: 0,
    status: 'idle',
    nextMoveAt: 0,
    ...partial,
  };
}

describe('combatTick stance behavior', () => {
  it('hold_the_line archers volley at an adjacent enemy; passive archers do not', () => {
    const tiles = new Map<string, Tile>([
      [tileKey(0, 0), plainsAt(0, 0)],
      [tileKey(2, 0), plainsAt(2, 0)],
    ]);
    const hold = makeUnit({
      id: 'hold-bow', type: 'ranged', q: 0, r: 0, ownerId: 'player_human', stance: 'hold_the_line',
    });
    const enemy = makeUnit({
      id: 'foe', type: 'infantry', q: 2, r: 0, ownerId: 'player_ai', stance: 'aggressive',
    });
    const holdResult = combatTick([hold, enemy], [], 1, [], tiles, 1_700_000_000_000);
    expect(holdResult.rangedShotFx.some(fx => fx.attackerId === 'hold-bow')).toBe(true);
    expect(enemy.hp).toBeLessThan(enemy.maxHp);

    const passive = makeUnit({
      id: 'pass-bow', type: 'ranged', q: 0, r: 0, ownerId: 'player_human', stance: 'passive',
    });
    const enemy2 = makeUnit({
      id: 'foe2', type: 'infantry', q: 2, r: 0, ownerId: 'player_ai', stance: 'aggressive',
    });
    const passResult = combatTick([passive, enemy2], [], 1, [], tiles, 1_700_000_000_000);
    expect(passResult.rangedShotFx.some(fx => fx.attackerId === 'pass-bow')).toBe(false);
    expect(enemy2.hp).toBe(enemy2.maxHp);
  });

  it('defensive archers also fire across hexes', () => {
    const tiles = new Map<string, Tile>([
      [tileKey(0, 0), plainsAt(0, 0)],
      [tileKey(2, 0), plainsAt(2, 0)],
    ]);
    const bow = makeUnit({
      id: 'def-bow', type: 'ranged', q: 0, r: 0, ownerId: 'player_human', stance: 'defensive',
    });
    const enemy = makeUnit({
      id: 'foe', type: 'infantry', q: 2, r: 0, ownerId: 'player_ai', stance: 'aggressive',
    });
    const result = combatTick([bow, enemy], [], 1, [], tiles, 1_700_000_000_000);
    expect(result.rangedShotFx.some(fx => fx.attackerId === 'def-bow')).toBe(true);
  });

  it('does not mark defensive victims for pursuit after a ranged hit', () => {
    const tiles = new Map<string, Tile>([
      [tileKey(0, 0), plainsAt(0, 0)],
      [tileKey(2, 0), plainsAt(2, 0)],
    ]);
    const shooter = makeUnit({
      id: 'atk-bow', type: 'ranged', q: 0, r: 0, ownerId: 'player_ai', stance: 'aggressive',
    });
    const defender = makeUnit({
      id: 'def-inf', type: 'infantry', q: 2, r: 0, ownerId: 'player_human', stance: 'defensive',
    });
    combatTick([shooter, defender], [], 1, [], tiles, 1_700_000_000_000);
    expect(defender.retaliateUnitId).toBeUndefined();
  });

  it('marks aggressive victims for pursuit after a ranged hit', () => {
    const tiles = new Map<string, Tile>([
      [tileKey(0, 0), plainsAt(0, 0)],
      [tileKey(2, 0), plainsAt(2, 0)],
    ]);
    const shooter = makeUnit({
      id: 'atk-bow', type: 'ranged', q: 0, r: 0, ownerId: 'player_ai', stance: 'aggressive',
    });
    const aggro = makeUnit({
      id: 'agg-inf', type: 'infantry', q: 2, r: 0, ownerId: 'player_human', stance: 'aggressive',
    });
    combatTick([shooter, aggro], [], 1, [], tiles, 1_700_000_000_000);
    expect(aggro.retaliateUnitId).toBe('atk-bow');
  });
});
