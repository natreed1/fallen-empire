/**
 * Sanity check: halted units stay idle (no march targets) so village incorporation can resolve.
 * Run: npx tsx scripts/test-incorporation-halt.ts
 */
import { haltLandMilitaryOnHexForIncorporationQueueMutable } from '../src/lib/garrison';
import type { Unit } from '../src/types/game';

const u: Unit = {
  id: 'u1',
  type: 'infantry',
  q: 5,
  r: 5,
  ownerId: 'ai',
  hp: 10,
  maxHp: 10,
  xp: 0,
  level: 0,
  status: 'moving',
  stance: 'aggressive',
  targetQ: 20,
  targetR: 20,
  nextMoveAt: 999999,
  marchInitialHexDistance: 10,
};

haltLandMilitaryOnHexForIncorporationQueueMutable(u);

if (u.status !== 'idle' || u.targetQ !== undefined || u.targetR !== undefined || u.marchInitialHexDistance !== undefined) {
  console.error('FAIL: halt did not clear march state', u);
  process.exit(1);
}
console.log('ok: haltLandMilitaryOnHexForIncorporationQueueMutable clears march state');
