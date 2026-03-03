/**
 * Headless simulation health check. Runs N games and reports:
 * - games with any combat deaths
 * - games with any owner flips/captures
 * - average units at end
 * - draw rate
 *
 * Run: npx ts-node -r tsconfig-paths/register --project tsconfig.train.json scripts/diag-sim-health.ts
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
  let totalUnitsAtEnd = 0;
  let draws = 0;

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
    totalUnitsAtEnd += diagnostics.unitsAtEnd;
    if (winner === null) draws++;
  }

  const drawRate = (draws / NUM_GAMES) * 100;
  const avgUnits = totalUnitsAtEnd / NUM_GAMES;

  console.log('Results:');
  console.log(`  Games with any combat deaths: ${gamesWithDeaths}/${NUM_GAMES}`);
  console.log(`  Games with any owner flip/capture: ${gamesWithOwnerFlip}/${NUM_GAMES}`);
  console.log(`  Average units at end: ${avgUnits.toFixed(1)}`);
  console.log(`  Draw rate: ${drawRate.toFixed(1)}% (${draws}/${NUM_GAMES})`);
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
