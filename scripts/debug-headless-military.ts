/**
 * One-off: sample military counts / kills through early headless cycles.
 * Run: npx ts-node -r tsconfig-paths/register --project tsconfig.train.json scripts/debug-headless-military.ts
 */
import {
  initBotVsBotGame,
  stepSimulation,
  DEFAULT_AI_PARAMS,
  type SimDiagnostics,
} from '../src/core/gameCore';
import { planAiTurn } from '../src/lib/ai';
import { isNavalUnitType, type Unit, type ScrollItem } from '../src/types/game';
import { landPending } from '../src/lib/battalionTraining';
import { calculateTerritory } from '../src/lib/territory';

const AI1 = 'player_ai';
const AI2 = 'player_ai_2';

function landMil(units: Unit[], pid: string) {
  return units.filter(u => u.ownerId === pid && u.hp > 0 && u.type !== 'builder' && !isNavalUnitType(u.type as never));
}

function main() {
  const seed = parseInt(process.env.DEBUG_SEED || '10001', 10);
  const maxSnap = parseInt(process.env.DEBUG_MAX_CYCLE || '120', 10);
  let state = initBotVsBotGame(seed, DEFAULT_AI_PARAMS, DEFAULT_AI_PARAMS, { width: 38, height: 38 });
  const diag: SimDiagnostics = {
    totalKills: 0,
    hadOwnerFlip: false,
    buildsAi1: {},
    buildsAi2: {},
    buildsAi1Early: {},
    buildsAi2Early: {},
    buildsAi1Late: {},
    buildsAi2Late: {},
  };

  console.log('cycle', 'ai1Mil', 'ai2Mil', 'pend', 'landP', 'kills', 'phase', '| sample units');
  for (let c = 0; c < maxSnap && state.phase === 'playing'; c++) {
    if (c === 8) {
      const terr = calculateTerritory(state.cities, state.tiles);
      const scrollInv: Record<string, ScrollItem[]> = { [AI1]: [], [AI2]: [] };
      for (const pid of [AI1, AI2]) {
        const plan = planAiTurn(
          pid,
          state.cities,
          state.units,
          state.players,
          state.tiles,
          terr,
          DEFAULT_AI_PARAMS,
          state.wallSections,
          state.contestedZoneHexKeys,
          state.commanders ?? [],
          scrollInv,
          state.scrollAttachments ?? [],
          state.scrollRelics ?? [],
          state.scrollRegionClaimed ?? { mexca: [], hills_lost: [], forest_secrets: [], isle_lost: [] },
          state.config.mapTerrain,
          { pendingRecruits: state.pendingRecruits },
        );
        const u0 = landMil(state.units, pid)[0];
        const mt = plan.moveTargets.find(m => m.unitId === u0?.id);
        console.log(
          `[plan snapshot c=${state.cycle} ${pid}] capital`,
          state.cities.find(x => x.ownerId === pid)?.q,
          state.cities.find(x => x.ownerId === pid)?.r,
          'unit',
          u0 ? `${u0.q},${u0.r}` : 'none',
          'moveTarget',
          mt ? `${mt.toQ},${mt.toR}` : 'none',
          'defendAssign',
          plan.defendAssignments?.find(d => d.unitId === u0?.id) ?? 'none',
        );
      }
      console.log('contestedZoneHexKeys (first 5)', (state.contestedZoneHexKeys ?? []).slice(0, 5));
    }
    const before = diag.totalKills;
    state = stepSimulation(state, DEFAULT_AI_PARAMS, DEFAULT_AI_PARAMS, diag);
    const stepKills = diag.totalKills - before;
    const pr = state.pendingRecruits ?? [];
    const p = pr.length;
    const landP = pr.filter(landPending).length;
    const m1 = landMil(state.units, AI1);
    const m2 = landMil(state.units, AI2);
    const sample = [...m1, ...m2]
      .map(u => `${u.ownerId === AI1 ? '1' : '2'}:${u.type}@${u.q},${u.r} ${u.status}`)
      .join(' | ');
    if (c <= 15 || c % 20 === 0 || stepKills > 0) {
      console.log(state.cycle, m1.length, m2.length, p, landP, stepKills, diag.totalKills, state.phase, '|', sample);
    }
  }
  console.log('final cycle', state.cycle, 'phase', state.phase, 'totalKills', diag.totalKills);
}

main();
