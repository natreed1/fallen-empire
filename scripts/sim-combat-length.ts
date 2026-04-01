/**
 * Sanity-check combat duration: 5v5 L1 infantry same-hex melee should land near
 * CYCLE_INTERVAL_SEC ticks (1 economy cycle). Passes a distinct `nowMs` per tick so hit/glance
 * rolls vary each swing. Run:
 *   npm run sim-combat-length
 */
import { combatTick } from '../src/lib/military';
import {
  Unit,
  UNIT_BASE_STATS,
  CYCLE_INTERVAL_SEC,
  COMBAT_UNIT_DAMAGE_SCALE,
  COMBAT_KILL_XP,
} from '../src/types/game';

function makeInf(id: string, ownerId: string): Unit {
  const s = UNIT_BASE_STATS.infantry;
  return {
    id,
    type: 'infantry',
    q: 0,
    r: 0,
    ownerId,
    hp: s.maxHp,
    maxHp: s.maxHp,
    xp: 0,
    level: 0,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
  };
}

function runOneBattle(): number {
  const units: Unit[] = [];
  for (let i = 0; i < 5; i++) units.push(makeInf(`a${i}`, 'owner_a'));
  for (let i = 0; i < 5; i++) units.push(makeInf(`b${i}`, 'owner_b'));

  let ticks = 0;
  const maxTicks = 400;
  while (ticks < maxTicks) {
    const aliveA = units.filter(u => u.ownerId === 'owner_a' && u.hp > 0);
    const aliveB = units.filter(u => u.ownerId === 'owner_b' && u.hp > 0);
    if (aliveA.length === 0 || aliveB.length === 0) break;

    const killed = combatTick(units, [], 0, [], new Map(), ticks * 1000);
    for (const id of killed.killedUnitIds) {
      const u = units.find(x => x.id === id);
      if (u) u.hp = 0;
    }
    ticks++;
  }
  return ticks;
}

function main() {
  const runs = 5;
  const results: number[] = [];
  for (let r = 0; r < runs; r++) results.push(runOneBattle());
  const mean = results.reduce((a, b) => a + b, 0) / results.length;
  const target = CYCLE_INTERVAL_SEC;
  console.log(`COMBAT_UNIT_DAMAGE_SCALE=${COMBAT_UNIT_DAMAGE_SCALE} COMBAT_KILL_XP=${COMBAT_KILL_XP}`);
  console.log(`5v5 L1 infantry same-hex ticks per run: ${results.join(', ')}`);
  console.log(`Mean: ${mean.toFixed(1)} (target ~${target} = 1 economy cycle)`);
  const lo = target * 0.8;
  const hi = target * 1.25;
  const ok = mean >= lo && mean <= hi;
  if (!ok) {
    console.error(`Mean outside ${lo.toFixed(0)}–${hi.toFixed(0)} ticks; retune COMBAT_UNIT_DAMAGE_SCALE / COMBAT_KILL_XP in types/game.ts`);
    process.exit(1);
  }
}

main();
