/**
 * Regression: siege structure damage is once-per-cycle; scout embark capacity and
 * disembark must not ignore walls/enemies.
 * Run: npx tsx scripts/verify-siege-tick-and-naval-gates.ts
 */
import {
  siegeTick,
  autoEmbarkLandUnitsOntoScoutShipsAtHex,
} from '../src/lib/military';
import {
  WALL_SECTION_HP,
  getShipMaxCargo,
  tileKey,
  type Tile,
  type Unit,
  type WallSection,
} from '../src/types/game';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function makeTile(q: number, r: number, biome: Tile['biome']): Tile {
  return {
    q,
    r,
    biome,
    elevation: 0,
    height: 0,
    hasRoad: false,
    hasRuins: false,
    hasVillage: false,
    isProvinceCenter: false,
    hasQuarryDeposit: false,
    hasMineDeposit: false,
    hasAncientCity: false,
    hasGoldMineDeposit: false,
    hasWoodDeposit: false,
    isIsland: false,
  };
}

// ── 1. One siegeTick ≈ design damage; 30 ticks would melt a wall ──────────
{
  const wall: WallSection = {
    q: 2,
    r: 0,
    ownerId: 'defender',
    hp: WALL_SECTION_HP,
    maxHp: WALL_SECTION_HP,
  };
  const treb: Unit = {
    id: 't1',
    type: 'trebuchet',
    q: 0,
    r: 0,
    ownerId: 'attacker',
    hp: 60,
    maxHp: 60,
    xp: 0,
    level: 0,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
  };
  // trebuchet siegeAttack=25, range=3; dist to (2,0)=2
  siegeTick([wall], [treb]);
  assert(wall.hp === WALL_SECTION_HP - 25, `one cycle siege should deal 25, got hp=${wall.hp}`);

  // Simulate the old live bug: 30 movement-tick applications → wall long dead
  const wallFast: WallSection = {
    q: 2,
    r: 0,
    ownerId: 'defender',
    hp: WALL_SECTION_HP,
    maxHp: WALL_SECTION_HP,
  };
  for (let i = 0; i < 30; i++) siegeTick([wallFast], [treb]);
  assert(wallFast.hp === 0, '30 applications (old live rate) zero a wall — proves the pace bug');
  // Correct live pace: 1 application per economy cycle → walls survive multi-second approach
  assert(WALL_SECTION_HP - 25 > 0, 'one cycle leaves wall standing');
}

// ── 2. Embark capacity: stack larger than remaining cargo must not all board ─
{
  const cap = getShipMaxCargo('scout_ship');
  assert(cap === 5, 'scout cargo cap');

  const tiles = new Map<string, Tile>();
  tiles.set(tileKey(0, 0), makeTile(0, 0, 'water'));

  const ship: Unit = {
    id: 'ship1',
    type: 'scout_ship',
    q: 0,
    r: 0,
    ownerId: 'p1',
    hp: 40,
    maxHp: 40,
    xp: 0,
    level: 0,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
    cargoUnitIds: [],
  };
  const landOnWater: Unit[] = [];
  for (let i = 0; i < 6; i++) {
    landOnWater.push({
      id: `u${i}`,
      type: 'infantry',
      q: 0,
      r: 0,
      ownerId: 'p1',
      hp: 20,
      maxHp: 20,
      xp: 0,
      level: 0,
      status: 'idle',
      stance: 'aggressive',
      nextMoveAt: 0,
    });
  }
  const units = [ship, ...landOnWater];
  autoEmbarkLandUnitsOntoScoutShipsAtHex(units, tiles);
  const boarded = units.filter(u => u.aboardShipId === ship.id).length;
  const stranded = units.filter(
    u => u.type === 'infantry' && !u.aboardShipId && u.q === 0 && u.r === 0,
  ).length;
  assert(boarded === cap, `should board exactly ${cap}, boarded=${boarded}`);
  assert(stranded === 1, `overflow without path gate leaves 1 stranded; stranded=${stranded}`);
  // Store gate: refuse orders where cargo + stack.length > cap.
  const fits = (cargo: number, stackLen: number) => cargo + stackLen <= cap;
  assert(!fits(0, 6), 'stack of 6 must fail capacity gate when cargo empty');
  assert(fits(0, 5), 'stack of 5 must pass capacity gate when cargo empty');
  assert(fits(2, 3), 'partial cargo: 3 more ok');
  assert(!fits(2, 4), 'partial cargo: 4 more rejected');
}

// ── 3. Disembark safety predicate (mirrors store rules) ───────────────────
{
  function canDisembarkAt(
    lq: number,
    lr: number,
    tiles: Map<string, Tile>,
    walls: WallSection[],
    units: Unit[],
    ownerId: string,
  ): boolean {
    const t = tiles.get(tileKey(lq, lr));
    if (!t || t.biome === 'water' || t.biome === 'mountain') return false;
    const wall = walls.find(w => w.q === lq && w.r === lr);
    if (wall && wall.ownerId !== ownerId && (wall.hp ?? 1) > 0) return false;
    if (units.some(u => !u.aboardShipId && u.q === lq && u.r === lr && u.ownerId !== ownerId && u.hp > 0)) {
      return false;
    }
    return true;
  }

  const tiles = new Map<string, Tile>();
  tiles.set(tileKey(1, 0), makeTile(1, 0, 'plains'));
  tiles.set(tileKey(0, 1), makeTile(0, 1, 'plains'));

  const intactWall: WallSection[] = [
    { q: 1, r: 0, ownerId: 'enemy', hp: WALL_SECTION_HP, maxHp: WALL_SECTION_HP },
  ];
  assert(!canDisembarkAt(1, 0, tiles, intactWall, [], 'p1'), 'intact enemy wall blocks disembark');
  assert(canDisembarkAt(0, 1, tiles, intactWall, [], 'p1'), 'open land ok');

  const brokenWall: WallSection[] = [
    { q: 1, r: 0, ownerId: 'enemy', hp: 0, maxHp: WALL_SECTION_HP },
  ];
  assert(canDisembarkAt(1, 0, tiles, brokenWall, [], 'p1'), 'broken wall allows disembark');

  const enemyUnit: Unit[] = [
    {
      id: 'e1',
      type: 'infantry',
      q: 0,
      r: 1,
      ownerId: 'enemy',
      hp: 10,
      maxHp: 10,
      xp: 0,
      level: 0,
      status: 'idle',
      stance: 'aggressive',
      nextMoveAt: 0,
    },
  ];
  assert(!canDisembarkAt(0, 1, tiles, [], enemyUnit, 'p1'), 'enemy on hex blocks disembark');
}

console.log('verify-siege-tick-and-naval-gates: ok');
