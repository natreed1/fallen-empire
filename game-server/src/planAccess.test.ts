import assert from 'node:assert/strict';
import { emptyAiActions } from '../../src/lib/ai.ts';
import { mergePlayerPlan } from './planAccess.ts';

const first = mergePlayerPlan(emptyAiActions(), {
  moveTargets: [
    { unitId: 'u1', toQ: 1, toR: 2 },
    { unitId: 'bad-q', toQ: Number.NaN, toR: 2 },
    { unitId: 'bad-r', toQ: 1, toR: Infinity },
    { unitId: 5, toQ: 1, toR: 2 },
  ],
  builds: [{ cityId: 'c1', type: 'barracks', q: 0, r: 0 }],
  recruits: [{ cityId: 'c1', type: 'infantry' }],
});

assert.deepEqual(first.moveTargets, [{ unitId: 'u1', toQ: 1, toR: 2 }]);
assert.deepEqual(first.builds, []);
assert.deepEqual(first.recruits, []);

const second = mergePlayerPlan(first, {
  moveTargets: [
    { unitId: 'u1', toQ: 4, toR: 5 },
    { unitId: 'u2', toQ: -1, toR: 0 },
  ],
});

assert.deepEqual(second.moveTargets, [
  { unitId: 'u1', toQ: 4, toR: 5 },
  { unitId: 'u2', toQ: -1, toR: 0 },
]);

assert.doesNotThrow(() => mergePlayerPlan(emptyAiActions(), { moveTargets: { unitId: 'u3', toQ: 1, toR: 1 } }));
assert.doesNotThrow(() => mergePlayerPlan(emptyAiActions(), null));

console.log('planAccess.test: ok');
