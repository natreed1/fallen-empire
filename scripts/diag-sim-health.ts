/**
 * Headless simulation health check. Runs N games and reports:
 * - games with any combat deaths, total kills, owner flips, draw rate
 * - first cycle any starvation, first cycle all units starving, first cycle food zero per side
 * - starvation lock frequency (games where all-starving occurred)
 * - min/median population at end (collapse metrics)
 *
 * Validate with: DIAG_NUM_GAMES=40 DIAG_MAX_CYCLES=350 DIAG_MAP_SIZE=32 npm run diag-sim-health
 * No-combat gate (games with zero kills and no firstCombatCycle), excluding naval-islands+gauntlet only:
 *   DIAG_MAX_NEVER_COMBAT_OTHER_PCT=10 (default 10) — FAIL if that bucket exceeds this percent.
 * One-game trace: DIAG_TRACE=1 npm run diag-sim-health  (writes artifacts/diag-trace-1.json)
 * Match training maps: DIAG_MATCH_TRAIN_SIM=1 (uses TRAIN_* envs like `train-ai` / `regression-harness`).
 * Per-game JSONL (seed, kills, firstCombatCycle, flips, builds, sword shortage, scenario bucket, AI plan counts): DIAG_PER_GAME_JSON=artifacts/diag-per-game.jsonl
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  runSimulationWithDiagnostics,
  DEFAULT_AI_PARAMS,
  type RunSimulationOptions,
} from '../src/core/gameCore';
import { getTrainSimOptsForSeed, readTrainSimMatchConfigFromEnv } from './lib/trainSimOptions';
import { selectScenario } from './lib/scenarios';

type ScenarioAgg = {
  n: number;
  sumKills: number;
  zeroKillGames: number;
  sumL1ShortPerCycle: number;
  sumRetreatsPerCycle: number;
  sumMovesPerCycle: number;
  sumFightingCycleFrac: number;
};

const NUM_GAMES = parseInt(process.env.DIAG_NUM_GAMES || '40', 10);
const MAX_CYCLES = parseInt(process.env.DIAG_MAX_CYCLES || '350', 10);
const MAP_SIZE = parseInt(process.env.DIAG_MAP_SIZE || '32', 10);
const DIAG_TRACE = process.env.DIAG_TRACE === '1' || process.env.DIAG_TRACE === 'true';
const MATCH_TRAIN_SIM =
  process.env.DIAG_MATCH_TRAIN_SIM === '1' || process.env.DIAG_MATCH_TRAIN_SIM === 'true';
const PER_GAME_JSONL = process.env.DIAG_PER_GAME_JSON?.trim();
/** Max allowed % of non–naval-islands+gauntlet games that end with no combat kills and no firstCombatCycle. */
const MAX_NEVER_COMBAT_OTHER_PCT = parseFloat(process.env.DIAG_MAX_NEVER_COMBAT_OTHER_PCT || '10');

function main() {
  const trainCfg = readTrainSimMatchConfigFromEnv();
  const flatOpts: RunSimulationOptions = {
    maxCycles: MAX_CYCLES,
    mapConfigOverride: { width: MAP_SIZE, height: MAP_SIZE },
  };
  if (DIAG_TRACE) {
    flatOpts.tracePath = path.join(process.cwd(), 'artifacts', 'diag-trace-1.json');
  }

  const runs = DIAG_TRACE ? 1 : NUM_GAMES;
  console.log('Headless sim health check');
  if (MATCH_TRAIN_SIM) {
    console.log(
      `  Games: ${runs}  DIAG_MATCH_TRAIN_SIM maxCycles=${trainCfg.maxCycles} mapSize=${trainCfg.mapSize} scenarioMix=${trainCfg.useScenarioMix} navalPostInit=${trainCfg.navalPostInit}`,
    );
  } else {
    console.log(`  Games: ${runs}  Map: ${MAP_SIZE}x${MAP_SIZE}  MaxCycles: ${MAX_CYCLES}`);
  }
  if (DIAG_TRACE) console.log('  Trace: writing per-cycle snapshot to', flatOpts.tracePath);
  console.log('');

  let gamesWithDeaths = 0;
  let gamesWithOwnerFlip = 0;
  let totalKillsAll = 0;
  let totalUnitsAtEnd = 0;
  let draws = 0;
  let gamesWithAllStarvingLock = 0;
  let gamesWithTotalStarvationAbort = 0;
  const firstAnyStarvation: number[] = [];
  const firstAllStarving: number[] = [];
  const firstFoodZeroAi1: number[] = [];
  const firstFoodZeroAi2: number[] = [];
  const finalTotalPop: number[] = [];
  let sumFarmsEarly = 0;
  let sumFarmsLate = 0;
  let sumMarkets = 0;
  let sumMines = 0;
  let sumQuarries = 0;
  let sumBarracks = 0;
  let sumFactories = 0;
  let sumAcademies = 0;
  let sumGoldMines = 0;
  let zeroKillGames = 0;
  /** No combat/coastal/closing kills entire game (`firstCombatCycle` never set). */
  let zeroKillNeverCombat = 0;
  let zeroKillButHadOwnerFlip = 0;
  const firstCombatWhenKills: number[] = [];
  const scenarioAgg = new Map<string, ScenarioAgg>();

  let sumL1ShortPerCycleAll = 0;
  let sumRetreatsPerCycleAll = 0;
  let sumMovesPerCycleAll = 0;
  let sumFightingCycleFracAll = 0;
  /** Games not using scenario `naval-islands+gauntlet` (includes flat map n/a). */
  let gamesNonNavalGauntlet = 0;
  /** Subset: zero kills and firstCombatCycle unset (no resolving combat kills). */
  let neverCombatNonNavalGauntlet = 0;

  let perGameFd: number | undefined;
  if (PER_GAME_JSONL) {
    const abs = path.isAbsolute(PER_GAME_JSONL) ? PER_GAME_JSONL : path.join(process.cwd(), PER_GAME_JSONL);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    perGameFd = fs.openSync(abs, 'w');
  }

  for (let i = 0; i < runs; i++) {
    const baseSeed = (1000 + i * 7919) % 1_000_000;
    let simResult: ReturnType<typeof runSimulationWithDiagnostics> | null = null;
    let usedSeed = baseSeed;
    let simOptsUsed: RunSimulationOptions = flatOpts;
    for (let bump = 0; bump < 200; bump++) {
      try {
        const seed = baseSeed + bump;
        usedSeed = seed;
        const opts: RunSimulationOptions = MATCH_TRAIN_SIM
          ? {
              ...getTrainSimOptsForSeed(seed, trainCfg),
              ...(DIAG_TRACE ? { tracePath: path.join(process.cwd(), 'artifacts', 'diag-trace-1.json') } : {}),
            }
          : { ...flatOpts };
        simOptsUsed = opts;
        const cap = opts.maxCycles ?? MAX_CYCLES;
        simResult = runSimulationWithDiagnostics(
          DEFAULT_AI_PARAMS,
          DEFAULT_AI_PARAMS,
          seed,
          cap,
          opts,
        );
        break;
      } catch {
        /* rare maps where corner capitals cannot be placed — try next seed */
      }
    }
    if (!simResult) {
      throw new Error(`diag-sim-health: could not init any of 200 seeds starting at ${baseSeed}`);
    }
    const { winner, diagnostics } = simResult;
    const kills = diagnostics.totalKills;
    const cy = Math.max(1, simResult.cycle);
    const l1ShortCycles =
      (diagnostics.cyclesGunsL1ShortAi1 ?? 0) + (diagnostics.cyclesGunsL1ShortAi2 ?? 0);
    const l2ShortCycles =
      (diagnostics.cyclesGunsL2ShortAi1 ?? 0) + (diagnostics.cyclesGunsL2ShortAi2 ?? 0);
    const l1ShortPerCyc = l1ShortCycles / cy;
    const retreatsTotal =
      (diagnostics.aiRetreatOrdersAi1 ?? 0) + (diagnostics.aiRetreatOrdersAi2 ?? 0);
    const movesTotal = (diagnostics.aiMoveOrdersAi1 ?? 0) + (diagnostics.aiMoveOrdersAi2 ?? 0);
    const retreatsPerCyc = retreatsTotal / cy;
    const movesPerCyc = movesTotal / cy;
    const fightCyc = diagnostics.cyclesAnyFightingAfterCombat ?? 0;
    const fightingCycleFrac = fightCyc / cy;

    sumL1ShortPerCycleAll += l1ShortPerCyc;
    sumRetreatsPerCycleAll += retreatsPerCyc;
    sumMovesPerCycleAll += movesPerCyc;
    sumFightingCycleFracAll += fightingCycleFrac;

    let scenarioBucket = 'n/a';
    if (MATCH_TRAIN_SIM && trainCfg.useScenarioMix && trainCfg.scenarioMix.length > 0) {
      const sn = selectScenario(trainCfg.scenarioMix, usedSeed);
      scenarioBucket = sn + (simOptsUsed.postInit === 'naval-gauntlet' ? '+gauntlet' : '');
    } else if (MATCH_TRAIN_SIM) {
      scenarioBucket = 'train_flat_map';
    }
    {
      let a = scenarioAgg.get(scenarioBucket);
      if (!a) {
        a = {
          n: 0,
          sumKills: 0,
          zeroKillGames: 0,
          sumL1ShortPerCycle: 0,
          sumRetreatsPerCycle: 0,
          sumMovesPerCycle: 0,
          sumFightingCycleFrac: 0,
        };
        scenarioAgg.set(scenarioBucket, a);
      }
      a.n++;
      a.sumKills += kills;
      if (kills === 0) a.zeroKillGames++;
      a.sumL1ShortPerCycle += l1ShortPerCyc;
      a.sumRetreatsPerCycle += retreatsPerCyc;
      a.sumMovesPerCycle += movesPerCyc;
      a.sumFightingCycleFrac += fightingCycleFrac;
    }

    if (kills === 0) {
      zeroKillGames++;
      if (diagnostics.firstCombatCycle == null) zeroKillNeverCombat++;
      if (diagnostics.hadOwnerFlip) zeroKillButHadOwnerFlip++;
    } else if (diagnostics.firstCombatCycle != null) {
      firstCombatWhenKills.push(diagnostics.firstCombatCycle);
    }
    const isNavalGauntlet = scenarioBucket === 'naval-islands+gauntlet';
    if (!isNavalGauntlet) {
      gamesNonNavalGauntlet++;
      if (kills === 0 && diagnostics.firstCombatCycle == null) neverCombatNonNavalGauntlet++;
    }
    if (perGameFd !== undefined) {
      const br = (diagnostics.buildsAi1?.barracks ?? 0) + (diagnostics.buildsAi2?.barracks ?? 0);
      const fac = (diagnostics.buildsAi1?.factory ?? 0) + (diagnostics.buildsAi2?.factory ?? 0);
      fs.writeSync(
        perGameFd,
        `${JSON.stringify({
          i,
          seed: usedSeed,
          scenarioBucket,
          kills,
          winner,
          cycle: simResult.cycle,
          firstCombatCycle: diagnostics.firstCombatCycle ?? null,
          firstOwnerFlipCycle: diagnostics.firstOwnerFlipCycle ?? null,
          hadOwnerFlip: diagnostics.hadOwnerFlip,
          unitsAtEnd: diagnostics.unitsAtEnd,
          buildsBarracksSum: br,
          buildsFactorySum: fac,
          cyclesGunsL1ShortAi1: diagnostics.cyclesGunsL1ShortAi1 ?? 0,
          cyclesGunsL1ShortAi2: diagnostics.cyclesGunsL1ShortAi2 ?? 0,
          cyclesGunsL2ShortAi1: diagnostics.cyclesGunsL2ShortAi1 ?? 0,
          cyclesGunsL2ShortAi2: diagnostics.cyclesGunsL2ShortAi2 ?? 0,
          l1ShortPerCycle: Number(l1ShortPerCyc.toFixed(4)),
          l2ShortCycles,
          retreatsTotal,
          movesTotal,
          retreatsPerCycle: Number(retreatsPerCyc.toFixed(4)),
          movesPerCycle: Number(movesPerCyc.toFixed(2)),
          cyclesAnyFightingAfterCombat: fightCyc,
          fightingCycleFrac: Number(fightingCycleFrac.toFixed(4)),
        })}\n`,
      );
    }
    if (diagnostics.totalKills > 0) gamesWithDeaths++;
    if (diagnostics.hadOwnerFlip) gamesWithOwnerFlip++;
    totalKillsAll += diagnostics.totalKills;
    totalUnitsAtEnd += diagnostics.unitsAtEnd;
    if (winner === null) draws++;
    if (diagnostics.firstCycleAllStarving != null) gamesWithAllStarvingLock++;
    if (diagnostics.totalStarvationAbort) gamesWithTotalStarvationAbort++;
    if (diagnostics.firstCycleAnyStarvation != null) firstAnyStarvation.push(diagnostics.firstCycleAnyStarvation);
    if (diagnostics.firstCycleAllStarving != null) firstAllStarving.push(diagnostics.firstCycleAllStarving);
    if (diagnostics.firstCycleFoodZeroAi1 != null) firstFoodZeroAi1.push(diagnostics.firstCycleFoodZeroAi1);
    if (diagnostics.firstCycleFoodZeroAi2 != null) firstFoodZeroAi2.push(diagnostics.firstCycleFoodZeroAi2);
    const fp1 = diagnostics.finalAi1Pop ?? 0;
    const fp2 = diagnostics.finalAi2Pop ?? 0;
    finalTotalPop.push(fp1 + fp2);
    sumFarmsEarly += (diagnostics.buildsAi1Early?.farm ?? 0) + (diagnostics.buildsAi2Early?.farm ?? 0);
    sumFarmsLate += (diagnostics.buildsAi1Late?.farm ?? 0) + (diagnostics.buildsAi2Late?.farm ?? 0);
    sumMarkets += (diagnostics.buildsAi1?.market ?? 0) + (diagnostics.buildsAi2?.market ?? 0);
    sumMines += (diagnostics.buildsAi1?.mine ?? 0) + (diagnostics.buildsAi2?.mine ?? 0);
    sumQuarries += (diagnostics.buildsAi1?.quarry ?? 0) + (diagnostics.buildsAi2?.quarry ?? 0);
    sumBarracks += (diagnostics.buildsAi1?.barracks ?? 0) + (diagnostics.buildsAi2?.barracks ?? 0);
    sumFactories += (diagnostics.buildsAi1?.factory ?? 0) + (diagnostics.buildsAi2?.factory ?? 0);
    sumAcademies += (diagnostics.buildsAi1?.academy ?? 0) + (diagnostics.buildsAi2?.academy ?? 0);
    sumGoldMines += (diagnostics.buildsAi1?.gold_mine ?? 0) + (diagnostics.buildsAi2?.gold_mine ?? 0);
  }

  if (perGameFd !== undefined) {
    fs.closeSync(perGameFd);
    console.log(`  per_game_jsonl: ${PER_GAME_JSONL}`);
  }

  const n = runs;
  const drawRate = (draws / n) * 100;
  const avgUnits = totalUnitsAtEnd / n;
  const starvationLockFreq = (gamesWithAllStarvingLock / n) * 100;

  const sortedPop = [...finalTotalPop].sort((a, b) => a - b);
  const minPop = sortedPop.length ? sortedPop[0] : 0;
  const medianPop = sortedPop.length
    ? sortedPop[Math.floor(sortedPop.length / 2)]
    : 0;

  console.log('Results:');
  console.log(`  games_with_combat_deaths: ${gamesWithDeaths}/${n}`);
  console.log(`  games_with_owner_flip: ${gamesWithOwnerFlip}/${n}`);
  console.log(`  total_kills: ${totalKillsAll}`);
  console.log(`  avg_units_at_end: ${avgUnits.toFixed(1)}`);
  console.log(`  draw_rate_pct: ${drawRate.toFixed(1)} (${draws}/${n})`);
  const totalStarvationAbortFreq = (gamesWithTotalStarvationAbort / n) * 100;
  console.log(`  starvation_lock_frequency_pct: ${starvationLockFreq.toFixed(1)} (${gamesWithAllStarvingLock}/${n} games with all-starving)`);
  console.log(`  total_starvation_abort_frequency_pct: ${totalStarvationAbortFreq.toFixed(1)} (${gamesWithTotalStarvationAbort}/${n} games aborted both irrecoverable)`);
  console.log(`  final_pop_min: ${minPop}`);
  console.log(`  final_pop_median: ${medianPop}`);
  console.log(
    `  ai_instant_builds_placed_per_game_avg (excludes spawn farm/barracks/academy on capitals): farms_early=${(sumFarmsEarly / n).toFixed(1)} farms_late=${(sumFarmsLate / n).toFixed(1)} markets=${(sumMarkets / n).toFixed(1)} mines=${(sumMines / n).toFixed(1)} quarries=${(sumQuarries / n).toFixed(1)} barracks_extra=${(sumBarracks / n).toFixed(1)} factories=${(sumFactories / n).toFixed(1)} academies_extra=${(sumAcademies / n).toFixed(1)} gold_mines=${(sumGoldMines / n).toFixed(1)}`,
  );
  const avgFirstStarvation = firstAnyStarvation.length ? firstAnyStarvation.reduce((a, b) => a + b, 0) / firstAnyStarvation.length : null;
  const avgFirstAllStarving = firstAllStarving.length ? firstAllStarving.reduce((a, b) => a + b, 0) / firstAllStarving.length : null;
  const avgFirstFoodZero1 = firstFoodZeroAi1.length ? firstFoodZeroAi1.reduce((a, b) => a + b, 0) / firstFoodZeroAi1.length : null;
  const avgFirstFoodZero2 = firstFoodZeroAi2.length ? firstFoodZeroAi2.reduce((a, b) => a + b, 0) / firstFoodZeroAi2.length : null;
  console.log(`  first_cycle_any_starvation: games=${firstAnyStarvation.length} avg_cycle=${avgFirstStarvation ?? '-'}`);
  console.log(`  first_cycle_all_starving: games=${firstAllStarving.length} avg_cycle=${avgFirstAllStarving ?? '-'}`);
  console.log(`  first_cycle_food_zero_ai1: games=${firstFoodZeroAi1.length} avg_cycle=${avgFirstFoodZero1 ?? '-'}`);
  console.log(`  first_cycle_food_zero_ai2: games=${firstFoodZeroAi2.length} avg_cycle=${avgFirstFoodZero2 ?? '-'}`);
  const sortedFc = [...firstCombatWhenKills].sort((a, b) => a - b);
  const medFirstCombat =
    sortedFc.length === 0 ? null : sortedFc[Math.floor(sortedFc.length / 2)];
  console.log('');
  console.log('Combat / kills (diagnostic.totalKills = closing+combat+coastal only; upkeep never kills — hp floors at 1):');
  const neverCombatAllPct = (100 * zeroKillNeverCombat) / n;
  const neverCombatOtherPct =
    gamesNonNavalGauntlet > 0 ? (100 * neverCombatNonNavalGauntlet) / gamesNonNavalGauntlet : null;
  console.log(
    `  games_zero_kills: ${zeroKillGames}/${n} (${((100 * zeroKillGames) / n).toFixed(1)}%)  of those never_first_combat_kill: ${zeroKillNeverCombat}  zero_kills_but_had_city_flip: ${zeroKillButHadOwnerFlip}`,
  );
  console.log(
    `  never_combat_pct_all_games: ${neverCombatAllPct.toFixed(1)} (${zeroKillNeverCombat}/${n})  — no kills and firstCombatCycle never set`,
  );
  console.log(
    `  never_combat_pct_non_naval_gauntlet: ${neverCombatOtherPct != null ? `${neverCombatOtherPct.toFixed(1)} (${neverCombatNonNavalGauntlet}/${gamesNonNavalGauntlet})` : 'n/a'}  — exclude scenario naval-islands+gauntlet; gate ≤${MAX_NEVER_COMBAT_OTHER_PCT}%`,
  );
  console.log(
    `  median_first_combat_cycle (games with kills>0, n=${firstCombatWhenKills.length}): ${medFirstCombat ?? '-'}`,
  );
  console.log('');
  console.log('Sword / gun upkeep (L1 = swords) + AI plan proxies (summed both AIs, normalized per game cycle):');
  console.log(
    `  avg_l1_sword_short_cycles_per_game_cycle: ${(sumL1ShortPerCycleAll / n).toFixed(3)}  (max 2.0 if both AIs short swords every cycle)`,
  );
  console.log(
    `  avg_retreat_orders_per_cycle: ${(sumRetreatsPerCycleAll / n).toFixed(3)}  avg_move_orders_per_cycle: ${(sumMovesPerCycleAll / n).toFixed(2)}`,
  );
  console.log(
    `  avg_fraction_of_cycles_with_land_fighting_after_combat: ${(sumFightingCycleFracAll / n).toFixed(3)}  (low + low kills ⇒ few resolving engagements)`,
  );
  if (MATCH_TRAIN_SIM && scenarioAgg.size > 0) {
    console.log('');
    console.log('By scenario bucket (same seed draw as train-ai / league):');
    const rows = [...scenarioAgg.entries()].sort((a, b) => b[1].n - a[1].n);
    for (const [bucket, a] of rows) {
      const avgK = a.sumKills / a.n;
      const zr = (100 * a.zeroKillGames) / a.n;
      const l1 = a.sumL1ShortPerCycle / a.n;
      const mv = a.sumMovesPerCycle / a.n;
      const fg = a.sumFightingCycleFrac / a.n;
      console.log(
        `  ${bucket}: n=${a.n}  avg_kills=${avgK.toFixed(1)}  zero_kill_pct=${zr.toFixed(1)}  avg_l1_short/cyc=${l1.toFixed(3)}  avg_moves/cyc=${mv.toFixed(2)}  avg_fight_frac=${fg.toFixed(3)}`,
      );
    }
    const naval = scenarioAgg.get('naval-islands+gauntlet');
    const nonNaval = [...scenarioAgg.entries()].filter(([k]) => k !== 'naval-islands+gauntlet');
    if (naval && nonNaval.length > 0) {
      let nk = 0;
      let sumK = 0;
      let sumZ = 0;
      for (const [, v] of nonNaval) {
        nk += v.n;
        sumK += v.sumKills;
        sumZ += v.zeroKillGames;
      }
      const avgNavalK = naval.sumKills / naval.n;
      const avgOtherK = nk > 0 ? sumK / nk : 0;
      const zNaval = (100 * naval.zeroKillGames) / naval.n;
      const zOther = nk > 0 ? (100 * sumZ) / nk : 0;
      console.log('');
      console.log(
        `  naval-islands+gauntlet vs all_other_scenarios: avg_kills ${avgNavalK.toFixed(1)} vs ${avgOtherK.toFixed(1)}  zero_kill_pct ${zNaval.toFixed(1)} vs ${zOther.toFixed(1)}`,
      );
    }
  }
  console.log('');

  const okDeaths = gamesWithDeaths > 0;
  const okDrawRate = drawRate < 95;
  const okNoCombatOther =
    gamesNonNavalGauntlet === 0 ||
    neverCombatOtherPct == null ||
    neverCombatOtherPct <= MAX_NEVER_COMBAT_OTHER_PCT;
  if (okDeaths && okDrawRate && okNoCombatOther) {
    console.log(
      `  PASS (deaths present, draw rate < 95%, never-combat non-naval-gauntlet ≤ ${MAX_NEVER_COMBAT_OTHER_PCT}%)`,
    );
  } else {
    if (!okDeaths) console.log('  FAIL: no combat deaths in any game');
    if (!okDrawRate) console.log('  FAIL: draw rate too high');
    if (!okNoCombatOther && neverCombatOtherPct != null) {
      console.log(
        `  FAIL: never-combat in non-naval-gauntlet games ${neverCombatOtherPct.toFixed(1)}% > ${MAX_NEVER_COMBAT_OTHER_PCT}%`,
      );
    }
  }
  if (DIAG_TRACE) console.log('  Trace written. Compare before/after changes.');
}

main();
