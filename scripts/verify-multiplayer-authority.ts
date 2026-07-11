/**
 * Regression checks for multiplayer client authority (run with npm exec -- tsx).
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import {
  DEFAULT_AI_PARAMS,
  initMultiplayerGame,
  stepSimulation,
} from '../src/core/gameCore';
import { emptyAiActions, type AiActions } from '../src/lib/ai';
import type { Unit } from '../src/types/game';
import { sanitizeClientPlan } from '../game-server/src/clientPlans';

const P1 = 'player_ai';
const P2 = 'player_ai_2';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function makeUnit(id: string, ownerId: string, q: number, r: number): Unit {
  return {
    id,
    type: 'infantry',
    q,
    r,
    ownerId,
    hp: 10,
    maxHp: 10,
    xp: 0,
    level: 0,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
  };
}

function makeSeededState() {
  const base = initMultiplayerGame(20260711);
  const p1City = base.cities.find(city => city.ownerId === P1);
  const p2City = base.cities.find(city => city.ownerId === P2);
  assert(Boolean(p1City && p2City), 'multiplayer game should place both capitals');

  const p1Unit = makeUnit('p1-unit', P1, p1City!.q, p1City!.r);
  const p2Unit = makeUnit('p2-unit', P2, p2City!.q, p2City!.r);
  return {
    state: { ...base, units: [p1Unit, p2Unit] },
    p1City: p1City!,
    p2City: p2City!,
    p1Unit,
    p2Unit,
  };
}

{
  const { state, p1City, p2City, p1Unit, p2Unit } = makeSeededState();
  const sanitized = sanitizeClientPlan(
    {
      moveTargets: [
        { unitId: p2Unit.id, toQ: p1City.q, toR: p1City.r },
        { unitId: p1Unit.id, toQ: p2City.q, toR: p2City.r },
        { unitId: p1Unit.id, toQ: 9999, toR: 9999 },
        { unitId: p1Unit.id, toQ: 1.5, toR: p2City.r },
        { unitId: 'missing-unit', toQ: p2City.q, toR: p2City.r },
      ],
      recruits: [{ cityId: state.cities[0].id, type: 'infantry' }],
    } as Partial<AiActions>,
    state,
    P1,
  );
  const sanitizedMoves = sanitized.moveTargets ?? [];

  assert(sanitizedMoves.length === 1, 'sanitizer should keep only owned in-map move targets');
  assert(sanitizedMoves[0].unitId === p1Unit.id, 'sanitizer should drop opponent unit moves');
  assert(!('recruits' in sanitized), 'sanitizer should drop non-movement client actions');
}

{
  const { state, p1City, p2Unit } = makeSeededState();
  const next = stepSimulation(
    state,
    DEFAULT_AI_PARAMS,
    DEFAULT_AI_PARAMS,
    undefined,
    undefined,
    {
      humanPlansByPlayerId: {
        [P1]: {
          ...emptyAiActions(),
          moveTargets: [{ unitId: p2Unit.id, toQ: p1City.q, toR: p1City.r }],
        },
        [P2]: emptyAiActions(),
      },
    },
  );
  const p2After = next.units.find(unit => unit.id === p2Unit.id);
  assert(Boolean(p2After), 'opponent unit should still exist');
  assert(
    p2After!.targetQ !== p1City.q || p2After!.targetR !== p1City.r,
    'stepSimulation must ignore cross-owner moveTargets',
  );
}

{
  const { state, p2City, p1Unit } = makeSeededState();
  const next = stepSimulation(
    state,
    DEFAULT_AI_PARAMS,
    DEFAULT_AI_PARAMS,
    undefined,
    undefined,
    {
      humanPlansByPlayerId: {
        [P1]: {
          ...emptyAiActions(),
          moveTargets: [{ unitId: p1Unit.id, toQ: p2City.q, toR: p2City.r }],
        },
        [P2]: emptyAiActions(),
      },
    },
  );
  const p1After = next.units.find(unit => unit.id === p1Unit.id);
  assert(Boolean(p1After), 'owned unit should still exist');
  assert(p1After!.targetQ === p2City.q && p1After!.targetR === p2City.r, 'owned moveTargets should still apply');
}

{
  const serverSource = readFileSync(
    fileURLToPath(new URL('../game-server/src/index.ts', import.meta.url)),
    'utf8',
  );
  assert(serverSource.includes("hasClientRole(room, 'host')"), 'server should reject duplicate host joins');
  assert(serverSource.includes("hasClientRole(room, 'guest')"), 'server should reject duplicate guest joins');
  assert(serverSource.includes('sanitizeClientPlan(msg.plan'), 'server should sanitize raw WebSocket plans');
}

console.log('verify-multiplayer-authority: ok');
