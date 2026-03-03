/**
 * Headless simulation health check. Runs N games and reports:
 * - games with any combat deaths, total kills, owner flips, draw rate
 * - first cycle any starvation, first cycle all units starving, first cycle food zero per side
 *
 * Run: DIAG_NUM_GAMES=50 DIAG_MAX_CYCLES=1000 DIAG_MAP_SIZE=56 npm run diag-sim-health
 */

import {
  runSimulationWithDiagnostics,
  DEFAULT_AI_PARAMS,
  type RunSimulationOptions,
} from '../src/core/gameCore';

const NUM_GAMES = parseInt(process.env.DIAG_NUM_GAMES || '40', 10);
const MAX_CYCLES = parseInt(process.env.DIAG_MAX_CYCLES || '220', 10);
const MAP_SIZE = parseInt(process.env.DIAG_MAP_SIZE || '56', 10);

const OPTS: RunSimulationOptions = {
  maxCycles: MAX_CYCLES,
  mapConfigOverride: { width: MAP_SIZE, height: MAP_SIZE },
};

function main() {
  console.log('Headless sim health check');
  console.log(`  Games: ${NUM_GAMES}  Map: ${MAP_SIZE}x${MAP_SIZE}  MaxCycles: ${MAX_CYCLES}`);
  console.log('');

  let gamesWithDeaths = 0;
  let gamesWithOwnerFlip = 0;
  let totalKillsAll = 0;
  let totalUnitsAtEnd = 0;
  let draws = 0;
  const firstAnyStarvation: number[] = [];
  const firstAllStarving: number[] = [];
  const firstFoodZeroAi1: number[] = [];
  const firstFoodZeroAi2: number[] = [];

  for (let i = 0; i < NUM_GAMES; i++) {
    const seed = (1000 + i * 7919) % 1_000_000;
    const { winner, diagnostics } = runSimulationWithDiagnostics(
      DEFAULT_AI_PARAMS,
      DEFAULT_AI_PARAMS,
      seed,
      MAX_CYCLES,
      OPTS,
    );
    if (diagnostics.totalKills > 0) gamesWithDeaths++;
    if (diagnostics.hadOwnerFlip) gamesWithOwnerFlip++;
    totalKillsAll += diagnostics.totalKills;
    totalUnitsAtEnd += diagnostics.unitsAtEnd;
    if (winner === null) draws++;
    if (diagnostics.firstCycleAnyStarvation != null) firstAnyStarvation.push(diagnostics.firstCycleAnyStarvation);
    if (diagnostics.firstCycleAllStarving != null) firstAllStarving.push(diagnostics.firstCycleAllStarving);
    if (diagnostics.firstCycleFoodZeroAi1 != null) firstFoodZeroAi1.push(diagnostics.firstCycleFoodZeroAi1);
    if (diagnostics.firstCycleFoodZeroAi2 != null) firstFoodZeroAi2.push(diagnostics.firstCycleFoodZeroAi2);
  }

  const drawRate = (draws / NUM_GAMES) * 100;
  const avgUnits = totalUnitsAtEnd / NUM_GAMES;

  console.log('Results:');
  console.log(`  games_with_combat_deaths: ${gamesWithDeaths}/${NUM_GAMES}`);
  console.log(`  games_with_owner_flip: ${gamesWithOwnerFlip}/${NUM_GAMES}`);
  console.log(`  total_kills: ${totalKillsAll}`);
  console.log(`  avg_units_at_end: ${avgUnits.toFixed(1)}`);
  console.log(`  draw_rate_pct: ${drawRate.toFixed(1)} (${draws}/${NUM_GAMES})`);
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
}

main();
