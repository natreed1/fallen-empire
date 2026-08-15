import { describe, expect, it } from 'vitest';
import { combatTick, movementTick, siegeTick, landMilitaryContestsCityCapture } from '@/lib/military';
import {
  cityHasWallBreach,
  pickCityApproachHex,
  pickSiegeRallyHex,
} from '@/lib/siege';
import { planAiTurn, DEFAULT_AI_PARAMS } from '@/lib/ai';
import type { City, Player, Tile, Unit, WallSection } from '@/types/game';
import { WALL_SECTION_HP, getHexRing, getUnitStats, hexDistance, hexNeighbors, tileKey } from '@/types/game';

const HUMAN = 'player_human';
const AI = 'player_ai';

function plainsAt(q: number, r: number): Tile {
  return {
    q, r, biome: 'plains', elevation: 0.4, height: 0.4,
    hasRoad: false, hasRuins: false, hasVillage: false,
    isProvinceCenter: false, hasQuarryDeposit: false, hasMineDeposit: false,
    hasAncientCity: false, hasGoldMineDeposit: false, hasWoodDeposit: false, isIsland: false,
  };
}

function plainsMap(radius: number): Map<string, Tile> {
  const tiles = new Map<string, Tile>();
  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      tiles.set(tileKey(q, r), plainsAt(q, r));
    }
  }
  return tiles;
}

function cityAt(id: string, ownerId: string, q: number, r: number, pop = 40): City {
  return {
    id, name: ownerId === AI ? 'AI Keep' : 'Human Town', q, r, ownerId,
    population: pop, morale: 80,
    storage: { food: 20, goods: 0, guns: 0, gunsL2: 0, iron: 0, stone: 10, wood: 0, refinedWood: 0 },
    storageCap: { food: 80, goods: 0, guns: 0, gunsL2: 0, iron: 0, stone: 40, wood: 0, refinedWood: 0 },
    buildings: [{ type: 'city_center', q, r }],
  };
}

function ring1Walls(city: City, ownerId: string): WallSection[] {
  return hexNeighbors(city.q, city.r).map(([q, r]) => ({
    q, r, ownerId, hp: WALL_SECTION_HP, maxHp: WALL_SECTION_HP,
  }));
}

function makeUnit(
  partial: Partial<Unit> & Pick<Unit, 'id' | 'type' | 'q' | 'r' | 'ownerId'>,
): Unit {
  const stats = getUnitStats({ type: partial.type, armsLevel: 1 });
  return {
    hp: stats.maxHp,
    maxHp: stats.maxHp,
    xp: 0,
    level: 0,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
    ...partial,
  };
}

function player(id: string, name: string, isHuman: boolean): Player {
  return {
    id, name, color: '#fff', gold: 200, taxRate: 0.3, foodPriority: 'military', isHuman, kingdomId: 'crusaders',
  };
}

describe('siege playtest vs a walled AI city', () => {
  const tiles = plainsMap(8);
  const aiCity = cityAt('ai-keep', AI, 0, 0);
  const walls = ring1Walls(aiCity, AI);

  it('closed ring-1 walls have no breach; camp is outside the wall, not on it', () => {
    expect(cityHasWallBreach(aiCity, tiles, walls, HUMAN)).toBe(false);
    const camp = pickSiegeRallyHex(aiCity, 4, 0, tiles, walls, HUMAN);
    expect(camp).not.toBeNull();
    expect(hexDistance(0, 0, camp!.q, camp!.r)).toBe(2);
    expect(isWallAt(walls, camp!.q, camp!.r)).toBe(false);
  });

  it('infantry cannot walk onto a walled ring hex or the city center', () => {
    const inf = makeUnit({
      id: 'h-inf', type: 'infantry', q: 3, r: 0, ownerId: HUMAN,
      status: 'moving', targetQ: 0, targetR: 0,
    });
    for (let i = 0; i < 12; i++) {
      inf.nextMoveAt = 0;
      movementTick([inf], [], tiles, walls, [aiCity], 1_700_000_000_000 + i * 8000);
    }
    expect(hexDistance(inf.q, inf.r, 0, 0)).toBeGreaterThan(1);
    expect(inf.q !== 0 || inf.r !== 0).toBe(true);
  });

  it('plays a siege: camp, break a wall with a trebuchet, then infantry can enter and contest capture', () => {
    const treb = makeUnit({
      id: 'h-treb', type: 'trebuchet', q: 4, r: 0, ownerId: HUMAN,
      status: 'moving',
    });
    const inf = makeUnit({
      id: 'h-inf', type: 'infantry', q: 5, r: 0, ownerId: HUMAN,
      status: 'moving',
    });
    const garrison = makeUnit({
      id: 'ai-def', type: 'defender', q: 0, r: 0, ownerId: AI, stance: 'hold_the_line',
    });

    const camp = pickSiegeRallyHex(aiCity, treb.q, treb.r, tiles, walls, HUMAN)!;
    treb.targetQ = camp.q;
    treb.targetR = camp.r;
    inf.targetQ = camp.q;
    inf.targetR = camp.r;
    treb.siegingCityId = aiCity.id;
    inf.siegingCityId = aiCity.id;

    for (let i = 0; i < 16; i++) {
      treb.nextMoveAt = 0;
      inf.nextMoveAt = 0;
      movementTick([treb, inf, garrison], [], tiles, walls, [aiCity], 1_700_000_000_000 + i * 8000);
    }
    expect(hexDistance(treb.q, treb.r, 0, 0)).toBe(2);
    expect(isWallAt(walls, treb.q, treb.r)).toBe(false);

    const hpBefore = walls.reduce((s, w) => s + (w.hp ?? 0), 0);
    for (let i = 0; i < 4; i++) {
      siegeTick(walls, [treb, inf, garrison]);
    }
    const hpAfter = walls.reduce((s, w) => s + (w.hp ?? 0), 0);
    expect(hpAfter).toBeLessThan(hpBefore);
    expect(cityHasWallBreach(aiCity, tiles, walls, HUMAN)).toBe(true);

    inf.targetQ = 0;
    inf.targetR = 0;
    inf.status = 'moving';
    inf.nextMoveAt = 0;
    delete inf.siegingCityId;
    inf.assaulting = true;

    for (let i = 0; i < 10; i++) {
      inf.nextMoveAt = 0;
      movementTick([treb, inf, garrison], [], tiles, walls, [aiCity], 1_700_000_100_000 + i * 8000);
      combatTick([treb, inf, garrison], [], 1, [aiCity], tiles, 1_700_000_100_000 + i * 8000);
    }

    expect(hexDistance(inf.q, inf.r, 0, 0)).toBeLessThanOrEqual(1);
    const onCenter = landMilitaryContestsCityCapture(inf, 0, 0);
    const adjacent = hexDistance(inf.q, inf.r, 0, 0) === 1;
    expect(onCenter || adjacent).toBe(true);
  });

  it('AI facing a closed wall camps outside instead of ordering a charge onto the keep', () => {
    const aiInf = makeUnit({ id: 'ai-inf', type: 'infantry', q: 3, r: 2, ownerId: AI });
    const aiTreb = makeUnit({ id: 'ai-treb', type: 'trebuchet', q: 3, r: 1, ownerId: AI });
    const walledHuman = cityAt('h-keep', HUMAN, 0, 0);
    const humanWalls = ring1Walls(walledHuman, HUMAN);
    const plan = planAiTurn(
      AI,
      [walledHuman, cityAt('ai-home', AI, 5, 3)],
      [aiInf, aiTreb],
      [player(HUMAN, 'You', true), player(AI, 'AI', false)],
      tiles,
      new Map(),
      { ...DEFAULT_AI_PARAMS, scoutChance: 0, contestedZoneCommitShare: 0 },
      humanWalls,
    );
    expect(plan.moveTargets.length).toBeGreaterThan(0);
    for (const mt of plan.moveTargets) {
      expect(mt.toQ === 0 && mt.toR === 0).toBe(false);
      expect(hexDistance(0, 0, mt.toQ, mt.toR)).toBeGreaterThanOrEqual(2);
      expect(isWallAt(humanWalls, mt.toQ, mt.toR)).toBe(false);
    }
    const approach = pickCityApproachHex(walledHuman, aiInf.q, aiInf.r, tiles, humanWalls, AI);
    expect(approach.mode).toBe('camp');
  });
});

function isWallAt(walls: WallSection[], q: number, r: number): boolean {
  return walls.some(w => w.q === q && w.r === r && (w.hp ?? 0) > 0);
}
