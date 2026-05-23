/**
 * Regression check for multiplayer move authority.
 *
 * A client's plan must never be able to order units owned by the opposing
 * player. Run with:
 *   npm exec --yes tsx -- scripts/verify-multiplayer-move-authority.ts
 */
import { DEFAULT_AI_PARAMS, initMultiplayerGame, stepSimulation } from '../src/core/gameCore';
import { emptyAiActions } from '../src/lib/ai';
import { hexNeighbors, tileKey, type City, type Unit } from '../src/types/game';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function landNeighbor(city: City, state: ReturnType<typeof initMultiplayerGame>) {
  const next = hexNeighbors(city.q, city.r).find(([q, r]) => {
    const tile = state.tiles.get(tileKey(q, r));
    return tile && tile.biome !== 'water' && tile.biome !== 'mountain';
  });
  assert(Boolean(next), `expected land neighbor for ${city.id}`);
  return { q: next![0], r: next![1] };
}

const state = initMultiplayerGame(12345, {
  width: 24,
  height: 24,
  mapTerrain: 'no_water',
});
const [p1City, p2City] = state.cities;
assert(Boolean(p1City && p2City), 'expected two multiplayer capitals');

const p1Dest = landNeighbor(p1City!, state);
const p2Dest = landNeighbor(p2City!, state);

const p1Unit: Unit = {
  id: 'p1-unit',
  type: 'infantry',
  q: p1City!.q,
  r: p1City!.r,
  ownerId: p1City!.ownerId,
  hp: 100,
  maxHp: 100,
  xp: 0,
  level: 0,
  status: 'idle',
  stance: 'aggressive',
  nextMoveAt: 0,
};
const p2Unit: Unit = {
  id: 'p2-unit',
  type: 'infantry',
  q: p2City!.q,
  r: p2City!.r,
  ownerId: p2City!.ownerId,
  hp: 100,
  maxHp: 100,
  xp: 0,
  level: 0,
  status: 'idle',
  stance: 'aggressive',
  nextMoveAt: 0,
};

state.units = [p1Unit, p2Unit];

const next = stepSimulation(
  state,
  DEFAULT_AI_PARAMS,
  DEFAULT_AI_PARAMS,
  undefined,
  undefined,
  {
    humanPlansByPlayerId: {
      [p1City!.ownerId]: {
        ...emptyAiActions(),
        moveTargets: [
          { unitId: p1Unit.id, toQ: p1Dest.q, toR: p1Dest.r },
          { unitId: p2Unit.id, toQ: p2Dest.q, toR: p2Dest.r },
        ],
      },
      [p2City!.ownerId]: emptyAiActions(),
    },
  },
);

const movedP1 = next.units.find(u => u.id === p1Unit.id);
const hijackedP2 = next.units.find(u => u.id === p2Unit.id);
assert(Boolean(movedP1), 'expected p1 unit after step');
assert(Boolean(hijackedP2), 'expected p2 unit after step');

const p1HasMoveOrder =
  (movedP1!.targetQ === p1Dest.q && movedP1!.targetR === p1Dest.r) ||
  (movedP1!.q === p1Dest.q && movedP1!.r === p1Dest.r);
assert(
  p1HasMoveOrder,
  'owned unit should accept its player move target',
);
assert(hijackedP2!.q === p2City!.q && hijackedP2!.r === p2City!.r, 'opponent unit position must not change');
assert(hijackedP2!.targetQ == null && hijackedP2!.targetR == null, 'opponent unit target must not be set');
assert(hijackedP2!.status === 'idle', 'opponent unit status must remain idle');

console.log('verify-multiplayer-move-authority: ok');
