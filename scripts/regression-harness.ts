/**
 * Deterministic regression harness: reproducible A/B checks using fixed seeds
 * before/after major changes. Run with params A and B (e.g. baseline vs candidate).
 *
 * Run: npx ts-node -r tsconfig-paths/register --project tsconfig.train.json scripts/regression-harness.ts
 * Env: REGRESSION_SEEDS=10001,10002,10003 (comma-separated fixed seeds)
 *      REGRESSION_PARAMS_A=public/ai-params.json (path to first params)
 *      REGRESSION_PARAMS_B=public/ai-params.json (path to second, or omit for default)
 */

import * as path from 'path';
import * as fs from 'fs';
import {
  runSimulationWithDiagnostics,
  DEFAULT_AI_PARAMS,
  type AiParams,
  type RunSimulationOptions,
} from '../src/core/gameCore';

const DEFAULT_SEEDS = [10001, 10002, 10003, 10004, 10005];
const MAX_CYCLES = parseInt(process.env.REGRESSION_MAX_CYCLES || '300', 10);
const MAP_SIZE = parseInt(process.env.REGRESSION_MAP_SIZE || '38', 10);

function loadParams(filePath: string): AiParams {
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) return DEFAULT_AI_PARAMS;
  const raw = fs.readFileSync(resolved, 'utf8');
  return { ...DEFAULT_AI_PARAMS, ...JSON.parse(raw) } as AiParams;
}

function getSeeds(): number[] {
  const env = process.env.REGRESSION_SEEDS;
  if (!env) return DEFAULT_SEEDS;
  return env.split(',').map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n));
}

function main(): void {
  const pathA = process.env.REGRESSION_PARAMS_A || path.join(process.cwd(), 'public', 'ai-params.json');
  const pathB = process.env.REGRESSION_PARAMS_B || '';
  const paramsA = loadParams(pathA);
  const paramsB = pathB ? loadParams(pathB) : DEFAULT_AI_PARAMS;
  const seeds = getSeeds();
  const opts: RunSimulationOptions = { maxCycles: MAX_CYCLES, mapConfigOverride: { width: MAP_SIZE, height: MAP_SIZE } };

  console.log('Regression harness (deterministic A/B)');
  console.log(`  Params A: ${pathA}`);
  console.log(`  Params B: ${pathB || 'DEFAULT_AI_PARAMS'}`);
  console.log(`  Seeds: ${seeds.join(', ')}`);
  console.log(`  MaxCycles: ${MAX_CYCLES}  Map: ${MAP_SIZE}x${MAP_SIZE}`);
  console.log('');

  let winsA = 0;
  let winsB = 0;
  let draws = 0;
  let totalKills = 0;
  let gamesWithOwnerFlip = 0;

  for (const seed of seeds) {
    const r1 = runSimulationWithDiagnostics(paramsA, paramsB, seed, MAX_CYCLES, opts);
    const r2 = runSimulationWithDiagnostics(paramsB, paramsA, seed + 1, MAX_CYCLES, opts);
    if (r1.winner === 'ai1') winsA++;
    else if (r1.winner === 'ai2') winsB++;
    else draws++;
    if (r2.winner === 'ai2') winsA++;
    else if (r2.winner === 'ai1') winsB++;
    else draws++;
    totalKills += r1.diagnostics.totalKills + r2.diagnostics.totalKills;
    if (r1.diagnostics.hadOwnerFlip || r2.diagnostics.hadOwnerFlip) gamesWithOwnerFlip++;
  }

  const totalGames = seeds.length * 2;
  console.log('Results (deterministic):');
  console.log(`  Wins A: ${winsA}  Wins B: ${winsB}  Draws: ${draws}`);
  console.log(`  Draw rate: ${((draws / totalGames) * 100).toFixed(1)}%`);
  console.log(`  Total kills: ${totalKills}  Games with owner flip: ${gamesWithOwnerFlip}`);
}

main();
