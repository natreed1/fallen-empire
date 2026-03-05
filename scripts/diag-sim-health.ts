/**
 * Headless simulation health check. Runs N games and reports:
 * - games with any combat deaths, total kills, owner flips, draw rate
 * - first cycle any starvation, first cycle all units starving, first cycle food zero per side
 * - starvation lock frequency (games where all-starving occurred)
 * - min/median population at end (collapse metrics)
 *
 * Validate with: DIAG_NUM_GAMES=40 DIAG_MAX_CYCLES=350 DIAG_MAP_SIZE=32 npm run diag-sim-health
 * One-game trace: DIAG_TRACE=1 npm run diag-sim-health  (writes artifacts/diag-trace-1.json)
 */

import * as path from 'path';
import {
  runSimulationWithDiagnostics,
  DEFAULT_AI_PARAMS,
  type RunSimulationOptions,
} from '../src/core/gameCore';

const NUM_GAMES = parseInt(process.env.DIAG_NUM_GAMES || '40', 10);
const MAX_CYCLES = parseInt(process.env.DIAG_MAX_CYCLES || '350', 10);
const MAP_SIZE = parseInt(process.env.DIAG_MAP_SIZE || '32', 10);
const DIAG_TRACE = process.env.DIAG_TRACE === '1' || process.env.DIAG_TRACE === 'true';

function main() {
  const opts: RunSimulationOptions = {
    maxCycles: MAX_CYCLES,
    mapConfigOverride: { width: MAP_SIZE, height: MAP_SIZE },
  };
  if (DIAG_TRACE) {
    opts.tracePath = path.join(process.cwd(), 'artifacts', 'diag-trace-1.json');
  }

  const runs = DIAG_TRACE ? 1 : NUM_GAMES;
  console.log('Headless sim health check');
  console.log(`  Games: ${runs}  Map: ${MAP_SIZE}x${MAP_SIZE}  MaxCycles: ${MAX_CYCLES}`);
  if (DIAG_TRACE) console.log('  Trace: writing per-cycle snapshot to', opts.tracePath);
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

  for (let i = 0; i < runs; i++) {
    const seed = (1000 + i * 7919) % 1_000_000;
    const { winner, diagnostics } = runSimulationWithDiagnostics(
      DEFAULT_AI_PARAMS,
      DEFAULT_AI_PARAMS,
      seed,
      MAX_CYCLES,
      opts,
    );
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
  console.log(`  builds_per_game_avg: farms_early=${(sumFarmsEarly / n).toFixed(1)} farms_late=${(sumFarmsLate / n).toFixed(1)} markets=${(sumMarkets / n).toFixed(1)} mines=${(sumMines / n).toFixed(1)} quarries=${(sumQuarries / n).toFixed(1)} barracks=${(sumBarracks / n).toFixed(1)} factories=${(sumFactories / n).toFixed(1)} academies=${(sumAcademies / n).toFixed(1)} gold_mines=${(sumGoldMines / n).toFixed(1)}`);
  const avgFirstStarvation = firstAnyStarvation.length ? firstAnyStarvation.reduce((a, b) => a + b, 0) / firstAnyStarvation.length : null;
  const avgFirstAllStarving = firstAllStarving.length ? firstAllStarving.reduce((a, b) => a + b, 0) / firstAllStarving.length : null;
  const avgFirstFoodZero1 = firstFoodZeroAi1.length ? firstFoodZeroAi1.reduce((a, b) => a + b, 0) / firstFoodZeroAi1.length : null;
  const avgFirstFoodZero2 = firstFoodZeroAi2.length ? firstFoodZeroAi2.reduce((a, b) => a + b, 0) / firstFoodZeroAi2.length : null;
  console.log(`  first_cycle_any_starvation: games=${firstAnyStarvation.length} avg_cycle=${avgFirstStarvation ?? '-'}`);
  console.log(`  first_cycle_all_starving: games=${firstAllStarving.length} avg_cycle=${avgFirstAllStarving ?? '-'}`);
  console.log(`  first_cycle_food_zero_ai1: games=${firstFoodZeroAi1.length} avg_cycle=${avgFirstFoodZero1 ?? '-'}`);
  console.log(`  first_cycle_food_zero_ai2: games=${firstFoodZeroAi2.length} avg_cycle=${avgFirstFoodZero2 ?? '-'}`);
  console.log('');

  const okDeaths = gamesWithDeaths > 0;
  const okDrawRate = drawRate < 95;
  if (okDeaths && okDrawRate) {
    console.log('  PASS (deaths present, draw rate not extreme)');
  } else {
    if (!okDeaths) console.log('  FAIL: no combat deaths in any game');
    if (!okDrawRate) console.log('  FAIL: draw rate too high');
  }
  if (DIAG_TRACE) console.log('  Trace written. Compare before/after changes.');
}

main();
