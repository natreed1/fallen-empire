/**
 * Tiered seasonal simulation system (95+ reliability target).
 *
 * - Tiered curriculum: C (economy/survival), B (combat), A (full strategic).
 * - Permanent fixed anchors (benchmark opponents; ineligible for champion).
 * - Robustness-first scoring; holdout every N seasons; scenario battery; lineage caps.
 * - Telemetry + auto-rollback on regression.
 *
 * Run: npm run seasonal-sim
 * Env: SIM_SEASONS=12, SIM_TIER_SIZE=8, SIM_HOLDOUT_EVERY_N=3, etc.
 */

import * as path from 'path';
import * as fs from 'fs';
import { DEFAULT_AI_PARAMS } from '../src/lib/ai';
import { assertAiParamsConsistency, getMutationSpaceSummary } from '../src/lib/aiParamsSchema';
import { loadSimSystemConfig } from './sim-system/config';
import { getAnchors } from './sim-system/anchors';
import { runHoldoutSuite } from './sim-system/holdout';
import { buildTelemetrySnapshot, shouldRollback } from './sim-system/telemetry';
import { runScenarioBattery } from './sim-system/scenario-battery';
import { checkChampionEligibility } from './sim-system/gates';
import { robustnessScore } from './sim-system/scoring';
import {
  resetSeasonStats,
  runSeasonGames,
  applyPromotionRelegation,
  createNewAgentsForCUnderflow,
} from './sim-system/season';
import { mutateWithBucket, chooseMutationBucket } from './sim-system/mutation';
import type { SimAgent, SimCheckpoint } from './sim-system/types';

const ARTIFACTS_DIR = path.join(process.cwd(), 'artifacts');
const CHECKPOINT_PATH = path.join(ARTIFACTS_DIR, 'sim-system-checkpoint.json');
const TELEMETRY_PATH = path.join(ARTIFACTS_DIR, 'sim-system-telemetry.ndjson');

function ensureArtifactsDir(): void {
  if (!fs.existsSync(ARTIFACTS_DIR)) {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  }
}

function createInitialAgents(config: ReturnType<typeof loadSimSystemConfig>): SimAgent[] {
  const agents: SimAgent[] = [];
  let idGen = 0;
  const nextId = () => `c_${idGen++}`;

  for (let i = 0; i < config.tierSizeC; i++) {
    const bucket = chooseMutationBucket(config);
    const params = mutateWithBucket(DEFAULT_AI_PARAMS, bucket, config);
    agents.push({
      id: nextId(),
      params,
      tier: 'C',
      lineageId: `gen0_${i}`,
      isAnchor: false,
      gameScores: [],
      wins: 0,
      losses: 0,
      draws: 0,
      totalKills: 0,
      noCombatGames: 0,
      totalStarvationGames: 0,
      decisiveGames: 0,
    });
  }
  for (let i = 0; i < config.tierSizeB; i++) {
    const bucket = chooseMutationBucket(config);
    const params = mutateWithBucket(DEFAULT_AI_PARAMS, bucket, config);
    agents.push({
      id: nextId(),
      params,
      tier: 'B',
      lineageId: `gen0_${config.tierSizeC + i}`,
      isAnchor: false,
      gameScores: [],
      wins: 0,
      losses: 0,
      draws: 0,
      totalKills: 0,
      noCombatGames: 0,
      totalStarvationGames: 0,
      decisiveGames: 0,
    });
  }
  for (let i = 0; i < config.tierSizeA; i++) {
    const bucket = chooseMutationBucket(config);
    const params = mutateWithBucket(DEFAULT_AI_PARAMS, bucket, config);
    agents.push({
      id: nextId(),
      params,
      tier: 'A',
      lineageId: `gen0_${config.tierSizeC + config.tierSizeB + i}`,
      isAnchor: false,
      gameScores: [],
      wins: 0,
      losses: 0,
      draws: 0,
      totalKills: 0,
      noCombatGames: 0,
      totalStarvationGames: 0,
      decisiveGames: 0,
    });
  }
  return agents;
}

function saveCheckpoint(agents: SimAgent[], telemetry: SimCheckpoint['telemetry'], season: number): void {
  ensureArtifactsDir();
  const checkpoint: SimCheckpoint = {
    season,
    agents,
    telemetry: { ...telemetry, season },
    timestamp: new Date().toISOString(),
  };
  fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify(checkpoint, null, 0), 'utf8');
}

function loadCheckpoint(): SimCheckpoint | null {
  if (!fs.existsSync(CHECKPOINT_PATH)) return null;
  try {
    const raw = fs.readFileSync(CHECKPOINT_PATH, 'utf8');
    return JSON.parse(raw) as SimCheckpoint;
  } catch {
    return null;
  }
}

function appendTelemetry(snapshot: { season: number; drawRate: number; totalStarvationRate: number; decisiveness: number; lineageConcentration: number }): void {
  ensureArtifactsDir();
  fs.appendFileSync(TELEMETRY_PATH, JSON.stringify(snapshot) + '\n', 'utf8');
}

function main(): void {
  assertAiParamsConsistency();
  const paramSummary = getMutationSpaceSummary();
  const config = loadSimSystemConfig();
  const numSeasons = parseInt(process.env.SIM_SEASONS || '12', 10) || 12;

  console.log('Seasonal sim system');
  console.log(`  Params: ${paramSummary.totalParamCount} total, ${paramSummary.paramsInMutationSpace.length} in mutation space, ${paramSummary.excludedFromMutation.length} excluded (${paramSummary.excludedReason})`);
  console.log(`  Tier sizes: C=${config.tierSizeC} B=${config.tierSizeB} A=${config.tierSizeA}`);
  console.log(`  Mutation: stable=${config.mutationStableRatio.toFixed(2)} medium=${config.mutationMediumRatio.toFixed(2)} wildcard=${config.mutationWildcardRatio.toFixed(2)}`);
  console.log(`  Holdout every ${config.holdoutEveryNSeasons} seasons; ${config.holdoutNumGames} games`);
  console.log(`  Seasons: ${numSeasons}`);
  console.log('');

  let agents: SimAgent[] = createInitialAgents(config);
  const anchors = getAnchors();
  let lastHoldoutMean: number | null = null;
  let lastStableCheckpoint: SimCheckpoint | null = null;
  let nextAgentId = agents.length;

  for (let season = 1; season <= numSeasons; season++) {
    console.log(`════════════════════════  Season ${season}/${numSeasons}  ════════════════════════`);
    resetSeasonStats(agents);

    runSeasonGames(agents, season, config);

    const scenarioResultsByAgentId = new Map<string, { score: number }[]>();
    for (const a of agents.filter(x => !x.isAnchor)) {
      const results = runScenarioBattery(a.params, config);
      scenarioResultsByAgentId.set(a.id, results.map(r => ({ scenarioId: r.scenarioId, score: r.score })));
    }

    let holdoutResult: ReturnType<typeof runHoldoutSuite> | null = null;
    let currentHoldoutMean: number | null = null;
    if (season % config.holdoutEveryNSeasons === 0) {
      holdoutResult = runHoldoutSuite(agents, season, config);
      const keys = Object.keys(holdoutResult.scoresByAgentId);
      currentHoldoutMean = keys.length ? keys.reduce((s, id) => s + holdoutResult!.scoresByAgentId[id], 0) / keys.length : 0;
      console.log(`  Holdout: drawRate=${(holdoutResult.drawRate * 100).toFixed(1)}% totalStarvation=${(holdoutResult.totalStarvationRate * 100).toFixed(1)}% decisiveness=${(holdoutResult.decisiveness * 100).toFixed(1)}%`);
    }
    const snapshot = buildTelemetrySnapshot(season, agents, holdoutResult, lastHoldoutMean);
    if (currentHoldoutMean != null) lastHoldoutMean = currentHoldoutMean;
    appendTelemetry(snapshot);

    if (shouldRollback(snapshot, config)) {
      console.log('  [ROLLBACK] Telemetry thresholds violated; restoring last stable checkpoint.');
      const cp = loadCheckpoint();
      if (cp && cp.agents.length > 0) {
        agents = cp.agents;
        console.log(`  Restored to season ${cp.season}`);
      }
      continue;
    }

    lastStableCheckpoint = { season, agents: agents.map(a => ({ ...a })), telemetry: snapshot, timestamp: new Date().toISOString() };
    saveCheckpoint(agents, snapshot, season);

    applyPromotionRelegation(agents, config, scenarioResultsByAgentId);
    const inC = agents.filter(a => a.tier === 'C' && !a.isAnchor).length;
    if (inC < config.tierSizeC) {
      const newAgents = createNewAgentsForCUnderflow(agents, config.tierSizeC - inC, config, () => `c_${nextAgentId++}`);
      agents.push(...newAgents);
    }

    const tierA = agents.filter(a => a.tier === 'A' && !a.isAnchor);
    const best = tierA.length ? tierA.sort((a, b) => robustnessScore(b.gameScores, config) - robustnessScore(a.gameScores, config))[0] : null;
    if (best) {
      console.log(`  Best A: ${best.id} robust=${robustnessScore(best.gameScores, config).toFixed(1)} W=${best.wins} L=${best.losses} D=${best.draws}`);
    }
  }

  const tierA = agents.filter(a => a.tier === 'A' && !a.isAnchor);
  const sortedA = [...tierA].sort((a, b) => robustnessScore(b.gameScores, config) - robustnessScore(a.gameScores, config));
  const holdoutScores = lastStableCheckpoint ? runHoldoutSuite(agents, numSeasons + 1, config).scoresByAgentId : {};
  type ScenarioScore = { scenarioId: string; score: number };
  const scenarioResultsByChampion = new Map<string, ScenarioScore[]>();
  for (const c of sortedA.slice(0, 5)) {
    const res = runScenarioBattery(c.params, config);
    scenarioResultsByChampion.set(c.id, res.map(r => ({ scenarioId: r.scenarioId, score: r.score })));
  }

  let champion: SimAgent | null = null;
  for (const c of sortedA) {
    const scenarioResults: ScenarioScore[] = scenarioResultsByChampion.get(c.id) ?? runScenarioBattery(c.params, config).map(r => ({ scenarioId: r.scenarioId, score: r.score }));
    const holdoutScore = holdoutScores[c.id];
    const anchorGauntletPass = true;
    const elig = checkChampionEligibility(c, holdoutScore, 0, anchorGauntletPass, scenarioResults, config);
    if (elig.eligible) {
      champion = c;
      break;
    }
  }
  if (!champion) champion = sortedA[0] ?? null;

  console.log('');
  if (champion) {
    console.log('Champion:', champion.id, '(non-anchor, passed holdout + anchor gauntlet + scenario minimums)');
    const outPath = path.join(process.cwd(), 'public', 'ai-params.json');
    try {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify(champion.params, null, 2), 'utf-8');
      console.log(`Wrote ${outPath}`);
    } catch (e) {
      console.log('(Could not write ai-params.json:', (e as Error).message, ')');
    }
  } else {
    console.log('No eligible champion (no non-anchor in A or gates not met).');
  }
}

main();
