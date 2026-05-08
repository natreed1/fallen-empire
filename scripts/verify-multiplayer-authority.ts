/**
 * Focused checks for multiplayer server authority boundaries.
 *
 * Run: npm run verify-multiplayer-authority
 */
import { DEFAULT_AI_PARAMS, initMultiplayerGame, stepSimulation } from '../src/core/gameCore';
import { emptyAiActions } from '../src/lib/ai';
import { mergeMultiplayerPlan } from '../src/lib/multiplayerPlan';
import { hexDistance, type Unit } from '../src/types/game';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function makeUnit(id: string, ownerId: string, q: number, r: number): Unit {
  return {
    id,
    ownerId,
    type: 'infantry',
    q,
    r,
    hp: 20,
    maxHp: 20,
    xp: 0,
    level: 0,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
  };
}

function distantLandTarget(state: ReturnType<typeof initMultiplayerGame>, q: number, r: number): { q: number; r: number } {
  const target = [...state.tiles.values()].find(t => t.biome !== 'water' && hexDistance(q, r, t.q, t.r) >= 6);
  assert(Boolean(target), 'expected a distant land target');
  return { q: target!.q, r: target!.r };
}

const P1 = 'player_ai';
const P2 = 'player_ai_2';

function verifyMoveTargetsStayOwnerScoped(): void {
  const base = initMultiplayerGame(98765, { width: 24, height: 24, mapTerrain: 'no_water' });
  const p1City = base.cities.find(c => c.ownerId === P1);
  const p2City = base.cities.find(c => c.ownerId === P2);
  assert(Boolean(p1City && p2City), 'expected both multiplayer capitals');

  const targetFromP2 = distantLandTarget(base, p2City!.q, p2City!.r);
  const state = {
    ...base,
    units: [
      makeUnit('p1-unit', P1, p1City!.q, p1City!.r),
      makeUnit('p2-unit', P2, p2City!.q, p2City!.r),
    ],
  };

  const afterSpoof = stepSimulation(
    state,
    DEFAULT_AI_PARAMS,
    DEFAULT_AI_PARAMS,
    undefined,
    undefined,
    {
      humanPlansByPlayerId: {
        [P1]: { ...emptyAiActions(), moveTargets: [{ unitId: 'p2-unit', toQ: targetFromP2.q, toR: targetFromP2.r }] },
        [P2]: emptyAiActions(),
      },
    },
  );
  const p2AfterSpoof = afterSpoof.units.find(u => u.id === 'p2-unit');
  assert(Boolean(p2AfterSpoof), 'expected spoof-targeted unit to remain alive');
  assert(p2AfterSpoof!.targetQ == null && p2AfterSpoof!.targetR == null, 'enemy move order must be ignored');
  assert(p2AfterSpoof!.status !== 'moving', 'enemy unit must not enter moving status from another player plan');

  const targetFromP1 = distantLandTarget(base, p1City!.q, p1City!.r);
  const afterOwnOrder = stepSimulation(
    state,
    DEFAULT_AI_PARAMS,
    DEFAULT_AI_PARAMS,
    undefined,
    undefined,
    {
      humanPlansByPlayerId: {
        [P1]: { ...emptyAiActions(), moveTargets: [{ unitId: 'p1-unit', toQ: targetFromP1.q, toR: targetFromP1.r }] },
        [P2]: emptyAiActions(),
      },
    },
  );
  const p1AfterOwnOrder = afterOwnOrder.units.find(u => u.id === 'p1-unit');
  assert(Boolean(p1AfterOwnOrder), 'expected own ordered unit to remain alive');
  assert(
    p1AfterOwnOrder!.targetQ === targetFromP1.q && p1AfterOwnOrder!.targetR === targetFromP1.r,
    'own move order should still be accepted',
  );
}

function verifyPlanPatchSanitization(): void {
  const merged = mergeMultiplayerPlan(
    { ...emptyAiActions(), moveTargets: [{ unitId: 'u1', toQ: 0, toR: 0 }] },
    {
      builds: null,
      recruits: 'not-an-array',
      moveTargets: [
        { unitId: 'u1', toQ: 3, toR: 4 },
        { unitId: '', toQ: 1, toR: 1 },
        { unitId: 'u2', toQ: 1.25, toR: 2 },
      ],
      scouts: [{ targetQ: 1, targetR: 2 }, { targetQ: 'bad', targetR: 2 }],
    },
  );

  assert(Array.isArray(merged.builds) && merged.builds.length === 0, 'malformed builds must not replace base array');
  assert(Array.isArray(merged.recruits) && merged.recruits.length === 0, 'malformed recruits must not replace base array');
  assert(merged.moveTargets.length === 1, 'only valid move targets should be retained');
  assert(merged.moveTargets[0].unitId === 'u1' && merged.moveTargets[0].toQ === 3, 'valid move target should update by unit id');
  assert(merged.scouts.length === 1 && merged.scouts[0].targetQ === 1, 'valid scouts should be retained');
}

verifyMoveTargetsStayOwnerScoped();
verifyPlanPatchSanitization();

console.log('verify-multiplayer-authority: ok');
