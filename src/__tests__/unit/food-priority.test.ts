import { describe, expect, it } from 'vitest';
import { foodAvailableForCivilians, militaryFoodDemand } from '@/lib/empireEconomy';
import { processEconomyTurn } from '@/lib/gameLoop';
import { upkeepTick } from '@/lib/military';
import type { City, Player, Tile, Unit } from '@/types/game';
import { getUnitStats, tileKey } from '@/types/game';

function plainsAt(q: number, r: number): Tile {
  return {
    q, r, biome: 'plains', elevation: 0.4, height: 0.4,
    hasRoad: false, hasRuins: false, hasVillage: false,
    isProvinceCenter: false, hasQuarryDeposit: false, hasMineDeposit: false,
    hasAncientCity: false, hasGoldMineDeposit: false, hasWoodDeposit: false, isIsland: false,
  };
}

function city(ownerId: string, food: number, pop: number): City {
  return {
    id: 'c1', name: 'Town', q: 0, r: 0, ownerId,
    population: pop, morale: 80,
    storage: { food, goods: 0, guns: 0, gunsL2: 0, iron: 0, stone: 0, wood: 0, refinedWood: 0 },
    storageCap: { food: 80, goods: 0, guns: 0, gunsL2: 0, iron: 0, stone: 0, wood: 0, refinedWood: 0 },
    buildings: [{ type: 'city_center', q: 0, r: 0 }],
  };
}

function player(id: string, priority: Player['foodPriority']): Player {
  return {
    id, name: id, color: '#fff', gold: 0, taxRate: 0.3, foodPriority: priority, isHuman: true,
  };
}

function infantry(id: string, ownerId: string): Unit {
  const stats = getUnitStats({ type: 'infantry', armsLevel: 1 });
  return {
    id, type: 'infantry', q: 0, r: 0, ownerId,
    hp: stats.maxHp, maxHp: stats.maxHp, xp: 0, level: 0,
    status: 'idle', stance: 'aggressive', nextMoveAt: 0,
  };
}

describe('food priority', () => {
  it('reserves military upkeep when Feed Army is set', () => {
    expect(foodAvailableForCivilians(10, 10, 'military')).toBe(0);
    expect(foodAvailableForCivilians(10, 10, 'civilian')).toBe(10);
    expect(foodAvailableForCivilians(12, 10, 'military')).toBe(2);
  });

  it('Feed Army leaves grain for troops; Feed People lets civilians empty the stores', () => {
    const tiles = new Map<string, Tile>([[tileKey(0, 0), plainsAt(0, 0)]]);
    const units = Array.from({ length: 10 }, (_, i) => infantry(`u${i}`, 'p1'));
    expect(militaryFoodDemand(units, 'p1')).toBe(10);

    const armyFirst = processEconomyTurn(
      [city('p1', 10, 40)], units, [player('p1', 'military')],
      tiles, new Map(), 1, 0,
    );
    expect(armyFirst.cities[0]!.storage.food).toBe(10);
    expect(armyFirst.cities[0]!.population).toBeLessThan(40);
    upkeepTick(armyFirst.units, armyFirst.cities, [], 1, tiles, new Map());
    expect(armyFirst.units.every(u => u.status !== 'starving')).toBe(true);

    const peopleFirst = processEconomyTurn(
      [city('p1', 10, 40)], units.map(u => ({ ...u })), [player('p1', 'civilian')],
      tiles, new Map(), 1, 0,
    );
    expect(peopleFirst.cities[0]!.storage.food).toBe(0);
    upkeepTick(peopleFirst.units, peopleFirst.cities, [], 1, tiles, new Map());
    expect(peopleFirst.units.some(u => u.status === 'starving')).toBe(true);
  });
});
