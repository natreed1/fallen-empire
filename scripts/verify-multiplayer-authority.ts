import { DEFAULT_AI_PARAMS, initMultiplayerGame, stepSimulation } from '../src/core/gameCore';
import { emptyAiActions } from '../src/lib/ai';
import { tileKey, type Unit } from '../src/types/game';
import { mergeClientPlan } from '../game-server/src/clientPlans';

const P1 = 'player_ai';
const P2 = 'player_ai_2';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function movableUnit(units: Unit[], ownerId: string): Unit {
  const unit = units.find(u => u.ownerId === ownerId && u.hp > 0 && u.status !== 'fighting');
  assert(!!unit, `expected a movable unit for ${ownerId}`);
  return unit!;
}

function differentMapHex(state: ReturnType<typeof initMultiplayerGame>, unit: Unit): { q: number; r: number } {
  for (const tile of state.tiles.values()) {
    if ((tile.q !== unit.q || tile.r !== unit.r) && state.tiles.has(tileKey(tile.q, tile.r))) {
      return { q: tile.q, r: tile.r };
    }
  }
  throw new Error('expected at least one alternate map hex');
}

const initial = initMultiplayerGame(424242);
const p1Unit = movableUnit(initial.units, P1);
const p2Unit = movableUnit(initial.units, P2);
const p1Target = differentMapHex(initial, p1Unit);
const p2HijackTarget = differentMapHex(initial, p2Unit);

const sanitized = mergeClientPlan(
  emptyAiActions(),
  {
    builds: [{ cityId: 'enemy-city', type: 'barracks' }],
    moveTargets: [
      { unitId: p1Unit.id, toQ: p1Target.q, toR: p1Target.r },
      { unitId: p2Unit.id, toQ: p2HijackTarget.q, toR: p2HijackTarget.r },
      { unitId: p1Unit.id, toQ: Number.NaN, toR: p1Target.r },
    ],
  },
  initial,
  P1,
);

assert(sanitized.builds.length === 0, 'client plan must not accept non-move actions');
assert(sanitized.moveTargets.length === 1, 'client plan must only keep legal own-unit moves');
assert(sanitized.moveTargets[0].unitId === p1Unit.id, 'client plan kept the wrong unit move');

const stepped = stepSimulation(
  initial,
  DEFAULT_AI_PARAMS,
  DEFAULT_AI_PARAMS,
  undefined,
  undefined,
  {
    humanPlansByPlayerId: {
      [P1]: {
        ...emptyAiActions(),
        moveTargets: [
          { unitId: p1Unit.id, toQ: p1Target.q, toR: p1Target.r },
          { unitId: p2Unit.id, toQ: p2HijackTarget.q, toR: p2HijackTarget.r },
        ],
      },
      [P2]: emptyAiActions(),
    },
  },
);

const movedP1 = stepped.units.find(u => u.id === p1Unit.id);
const protectedP2 = stepped.units.find(u => u.id === p2Unit.id);
assert(!!movedP1 && movedP1.targetQ === p1Target.q && movedP1.targetR === p1Target.r, 'own-unit move was rejected');
assert(
  !!protectedP2 &&
    (protectedP2.targetQ !== p2HijackTarget.q || protectedP2.targetR !== p2HijackTarget.r),
  'cross-owner move target was applied',
);

console.log('verify-multiplayer-authority: ok');
