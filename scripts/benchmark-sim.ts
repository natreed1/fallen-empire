/**
 * Short controlled benchmark: same seeds/settings to compare sim throughput.
 * Usage:
 *   SIM_DIAG=full   npx ts-node -r tsconfig-paths/register --project tsconfig.train.json scripts/benchmark-sim.ts
 *   SIM_DIAG=minimal npx ts-node -r tsconfig-paths/register --project tsconfig.train.json scripts/benchmark-sim.ts
 * Or: npm run benchmark-sim (uses env SIM_DIAG if set)
 *
 * Reports: total ms, ms per game, winner/cycle for determinism check.
 */

import {
  runSimulationWithDiagnostics,
  DEFAULT_AI_PARAMS,
  type RunSimulationOptions,
} from '../src/core/gameCore';

const NUM_GAMES = 8;
const SEED_BASE = 42;
const MAX_CYCLES = 200;
const MAP_SIZE = 32;

function main(): void {
  const diagnosticsLevel = process.env.SIM_DIAG === 'minimal' ? 'minimal' : 'full';
  const opts: RunSimulationOptions = {
    maxCycles: MAX_CYCLES,
    mapConfigOverride: { width: MAP_SIZE, height: MAP_SIZE },
    diagnosticsLevel,
  };

  console.log('Benchmark: ' + NUM_GAMES + ' games, seedBase=' + SEED_BASE + ', maxCycles=' + MAX_CYCLES + ', map=' + MAP_SIZE + 'x' + MAP_SIZE);
  console.log('diagnosticsLevel:', diagnosticsLevel);
  console.log('');

  const t0 = performance.now();
  const results: { winner: string | null; cycle: number }[] = [];
  for (let i = 0; i < NUM_GAMES; i++) {
    const seed = SEED_BASE + i * 2;
    const r = runSimulationWithDiagnostics(DEFAULT_AI_PARAMS, DEFAULT_AI_PARAMS, seed, MAX_CYCLES, opts);
    results.push({ winner: r.winner, cycle: r.cycle });
  }
  const totalMs = performance.now() - t0;

  console.log('Total ms:', totalMs.toFixed(0));
  console.log('Ms per game:', (totalMs / NUM_GAMES).toFixed(1));
  console.log('Determinism check (winner, cycle) first 3:', results.slice(0, 3).map(r => `${r.winner}/${r.cycle}`).join(', '));
  console.log('Done.');
}

main();
