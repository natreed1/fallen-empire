/**
 * Regression: retreatAt must be stamped with simTimeMs, not Date.now().
 * Live RT loop passes simTimeMs into movementTick; wall-clock stamps never elapse.
 *
 * Run: npx tsx scripts/verify-retreat-sim-time.ts
 */
import { movementTick } from '../src/lib/military';
import { RETREAT_DELAY_MS, tileKey, type Tile, type Unit } from '../src/types/game';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function plainsTile(q: number, r: number): Tile {
  return {
    q,
    r,
    elevation: 0.4,
    moisture: 0.4,
    temperature: 0.5,
    biome: 'plains',
  };
}

function makeUnit(partial: Partial<Unit> & Pick<Unit, 'id' | 'ownerId' | 'q' | 'r'>): Unit {
  return {
    type: 'infantry',
    hp: 10,
    maxHp: 10,
    xp: 0,
    level: 0,
    status: 'fighting',
    stance: 'aggressive',
    nextMoveAt: 0,
    ...partial,
  };
}

function tilesAround(): Map<string, Tile> {
  const tiles = new Map<string, Tile>();
  for (let q = -2; q <= 2; q++) {
    for (let r = -2; r <= 2; r++) {
      tiles.set(tileKey(q, r), plainsTile(q, r));
    }
  }
  return tiles;
}

function runRetreatCase(label: string, retreatAt: number, simNow: number): Unit {
  const units: Unit[] = [
    makeUnit({ id: 'friendly', ownerId: 'p1', q: 0, r: 0, retreatAt }),
    makeUnit({ id: 'enemy', ownerId: 'p2', q: 0, r: 0 }),
  ];
  movementTick(units, [], tilesAround(), [], [], simNow);
  const u = units.find(x => x.id === 'friendly')!;
  console.log(
    `${label}: status=${u.status} pos=(${u.q},${u.r}) retreatAt=${u.retreatAt ?? 'cleared'} target=(${u.targetQ ?? '-'},${u.targetR ?? '-'})`,
  );
  return u;
}

// Bug repro: wall-clock stamp vs sim clock — unit must NOT retreat
{
  const simNow = 5_000;
  const wallStamp = Date.now() + RETREAT_DELAY_MS;
  const u = runRetreatCase('wall-clock stamp (broken)', wallStamp, simNow);
  assert(u.status === 'fighting', 'wall-clock retreatAt must not fire against simTimeMs');
  assert(u.q === 0 && u.r === 0, 'wall-clock retreat must leave unit on combat hex');
  assert(u.retreatAt === wallStamp, 'wall-clock retreatAt must remain pending');
}

// Correct stamp: after delay elapses on sim clock, unit picks retreat hex and moves
{
  const orderedAt = 10_000;
  const retreatAt = orderedAt + RETREAT_DELAY_MS;
  const before = runRetreatCase('sim stamp before delay', retreatAt, orderedAt + 1_000);
  assert(before.status === 'fighting', 'retreat must wait for RETREAT_DELAY_MS on sim clock');
  assert(before.retreatAt === retreatAt, 'retreatAt still pending before delay');

  const after = runRetreatCase('sim stamp after delay', retreatAt, orderedAt + RETREAT_DELAY_MS);
  assert(after.status === 'moving', 'retreat must set status moving after sim delay');
  assert(after.retreatAt === undefined, 'retreatAt cleared after execution');
  assert(!(after.q === 0 && after.r === 0 && after.targetQ === 0 && after.targetR === 0), 'must leave combat hex');
  assert(
    after.targetQ !== undefined &&
      after.targetR !== undefined &&
      (after.targetQ !== 0 || after.targetR !== 0),
    'retreat target must be a neighboring escape hex',
  );
}

// Store-facing stamp parity: simTimeMs + RETREAT_DELAY_MS is what setRetreat must use
{
  const simTimeMs = 42_000;
  const stamped = simTimeMs + RETREAT_DELAY_MS;
  assert(stamped === 44_000, 'human/AI retreat stamp = simTimeMs + RETREAT_DELAY_MS');
  const u = runRetreatCase('store stamp formula', stamped, simTimeMs + RETREAT_DELAY_MS);
  assert(u.status === 'moving', 'store-formula stamp must execute at delay boundary');
}

console.log('verify-retreat-sim-time: ok');
