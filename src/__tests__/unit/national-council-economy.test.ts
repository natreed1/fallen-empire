import { describe, expect, it } from 'vitest';
import { computeCouncilBoosts, createPoliticianRecord } from '@/lib/nationalCouncil';
import { processEconomyTurn } from '@/lib/gameLoop';
import type { City, Player, Politician, Tile } from '@/types/game';
import { tileKey } from '@/types/game';

function town(ownerId: string): City {
  return {
    id: 'c1', name: 'Capital', q: 0, r: 0, ownerId,
    population: 100, morale: 100,
    storage: { food: 80, goods: 0, guns: 0, gunsL2: 0, iron: 0, stone: 0, wood: 0, refinedWood: 0 },
    storageCap: { food: 80, goods: 0, guns: 0, gunsL2: 0, iron: 0, stone: 0, wood: 0, refinedWood: 0 },
    buildings: [{ type: 'city_center', q: 0, r: 0 }],
  };
}

function ruler(id: string, council?: Player['nationalCouncil']): Player {
  return {
    id, name: id, color: '#fff', gold: 0, taxRate: 0.3, foodPriority: 'civilian', isHuman: true,
    nationalCouncil: council,
  };
}

describe('national council economy', () => {
  it('a treasurer economist raises tax gold vs an empty council', () => {
    const pol: Politician = createPoliticianRecord('p1', {
      name: 'Ada Coin',
      traitIds: ['economist'],
      portraitSeed: 1,
    });
    const boosts = computeCouncilBoosts(
      { appointments: [{ postId: 'treasurer', assigneeId: pol.id, assigneeKind: 'politician' }] },
      [],
      [pol],
    );
    expect(boosts.goldMult).toBeGreaterThan(1);

    const tiles = new Map<string, Tile>([[tileKey(0, 0), {
      q: 0, r: 0, biome: 'plains', elevation: 0.4, height: 0.4,
      hasRoad: false, hasRuins: false, hasVillage: false, isProvinceCenter: false,
      hasQuarryDeposit: false, hasMineDeposit: false, hasAncientCity: false,
      hasGoldMineDeposit: false, hasWoodDeposit: false, isIsland: false,
    }]]);

    const without = processEconomyTurn(
      [town('p1')], [], [ruler('p1')], tiles, new Map(), 1, 0,
    );
    const withCouncil = processEconomyTurn(
      [town('p1')], [],
      [ruler('p1', { appointments: [{ postId: 'treasurer', assigneeId: pol.id, assigneeKind: 'politician' }] })],
      tiles, new Map(), 1, 0, [], [], [pol],
    );
    expect(withCouncil.players[0]!.gold).toBeGreaterThan(without.players[0]!.gold);
  });
});
