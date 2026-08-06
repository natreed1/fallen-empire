/**
 * Regression: timed abilities must stamp deadlines with simTimeMs, not Date.now().
 * Live combatTick passes simTimeMs into getVolleyFireBonus / isAbilityActive;
 * wall-clock stamps never expire → permanent +50% volley damage.
 *
 * Run: npx tsx scripts/verify-ability-sim-time.ts
 */
import { getVolleyFireBonus, isAbilityActive, isAbilityOnCooldown } from '../src/lib/combat';
import { ABILITY_DEFS, type Unit } from '../src/types/game';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function makeArcher(partial: Partial<Unit> = {}): Unit {
  return {
    id: 'archer-1',
    ownerId: 'human',
    type: 'ranged',
    q: 0,
    r: 0,
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

const volley = ABILITY_DEFS.volley_fire;
const simNow = 12_000;

// Correct path: stamp with sim clock
{
  const u = makeArcher({
    abilityActive: true,
    abilityActiveUntil: simNow + volley.durationMs,
    abilityCooldownUntil: simNow + volley.durationMs + volley.cooldownMs,
  });
  assert(isAbilityActive(u, simNow), 'volley should be active at activation sim time');
  assert(getVolleyFireBonus(u, simNow) === 1.5, 'volley bonus should apply while active');
  assert(
    !isAbilityActive(u, simNow + volley.durationMs + 1),
    'volley should expire after duration on sim clock',
  );
  assert(
    getVolleyFireBonus(u, simNow + volley.durationMs + 1) === 1.0,
    'volley bonus should end after duration',
  );
  assert(
    isAbilityOnCooldown(u, simNow + volley.durationMs + 1),
    'cooldown should still apply after duration on sim clock',
  );
  assert(
    !isAbilityOnCooldown(u, simNow + volley.durationMs + volley.cooldownMs + 1),
    'cooldown should clear after duration+cooldown on sim clock',
  );
  console.log('sim-stamped volley: active→expire→cooldown clear OK');
}

// Bug repro: wall-clock stamp vs sim clock → permanent active
{
  const wall = Date.now();
  const u = makeArcher({
    abilityActive: true,
    abilityActiveUntil: wall + volley.durationMs,
    abilityCooldownUntil: wall + volley.durationMs + volley.cooldownMs,
  });
  assert(
    isAbilityActive(u, simNow) && getVolleyFireBonus(u, simNow) === 1.5,
    'wall-stamped volley is active at small simNow (bug condition)',
  );
  // Even far into a match, wall deadlines never elapse against simTimeMs
  const lateSim = 3_600_000; // 1h of sim ticks
  assert(
    isAbilityActive(u, lateSim) && getVolleyFireBonus(u, lateSim) === 1.5,
    'wall-stamped volley remains active at late sim time (bug condition)',
  );
  console.log('wall-stamped volley: permanent-active bug condition confirmed');
}

console.log('verify-ability-sim-time: all assertions passed');
