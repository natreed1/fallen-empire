/**
 * Regression: seed-pool league resume must keep 1/1 promo quotas even when
 * LEAGUE_SEED_POOL env is omitted (checkpoint.seedPool is the source of truth).
 *
 * Bug: TOP_K/BOT_K were derived only from process.env at module load. Resuming a
 * 6/3/3 seed-pool checkpoint without the env var used default 2/2 quotas, which
 * overlap top/bottom slices in size-3 B/C divisions and corrupt roster topology
 * before champion selection writes public/ai-params.json.
 */
import assert from 'node:assert/strict';
import {
  DEFAULT_AI_PARAMS,
  type AiParams,
} from '../src/core/gameCore';
import {
  type Candidate,
  type Division,
  type Stats,
  leaguePromoCounts,
  promoteRelegateAndReplace,
  resolveSeedPoolMode,
} from './tournament-league';

function emptyStats(): Stats {
  return {
    points: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    killsFor: 0,
    killsAgainst: 0,
    cityDiff: 0,
    popDiff: 0,
    goldDiff: 0,
    decisiveGames: 0,
    noCombatGames: 0,
    farmsBuiltEarly: 0,
    farmsBuiltLate: 0,
    marketsBuilt: 0,
    minesBuilt: 0,
    quarriesBuilt: 0,
    barracksBuilt: 0,
    factoriesBuilt: 0,
    academiesBuilt: 0,
    goldMinesBuilt: 0,
  };
}

function cand(id: string, division: Division, points: number, params: AiParams = DEFAULT_AI_PARAMS): Candidate {
  const seasonStats = emptyStats();
  seasonStats.points = points;
  seasonStats.wins = Math.max(0, Math.floor(points / 100));
  seasonStats.decisiveGames = seasonStats.wins;
  return { id, params: { ...params }, division, seasonStats };
}

function counts(candidates: Candidate[]): Record<Division, number> {
  return {
    A: candidates.filter(c => c.division === 'A').length,
    B: candidates.filter(c => c.division === 'B').length,
    C: candidates.filter(c => c.division === 'C').length,
  };
}

function seedPoolRoster(): Candidate[] {
  // 6/3/3 seed-pool shape with strictly ordered points within each division.
  return [
    cand('a1', 'A', 600),
    cand('a2', 'A', 500),
    cand('a3', 'A', 400),
    cand('a4', 'A', 300),
    cand('a5', 'A', 200),
    cand('a6', 'A', 100),
    cand('b1', 'B', 300),
    cand('b2', 'B', 200),
    cand('b3', 'B', 100),
    cand('c1', 'C', 300),
    cand('c2', 'C', 200),
    cand('c3', 'C', 100),
  ];
}

// ── 1) Mode / quota helpers ──────────────────────────────────────────────────
{
  assert.deepEqual(leaguePromoCounts(true), { topK: 1, botK: 1 });
  assert.deepEqual(leaguePromoCounts(false), { topK: 2, botK: 2 });

  // Resume without env must still treat checkpoint.seedPool as seed-pool mode.
  assert.equal(resolveSeedPoolMode('artifacts/seed_pool_v1.json', ''), true);
  assert.equal(resolveSeedPoolMode(undefined, ''), false);
  assert.equal(resolveSeedPoolMode(undefined, 'artifacts/seed_pool_v1.json'), true);
  assert.equal(resolveSeedPoolMode('', 'artifacts/seed_pool_v1.json'), true);
  console.log('OK: resolveSeedPoolMode + leaguePromoCounts prefer checkpoint seed-pool shape');
}

// ── 2) Wrong 2/2 quotas corrupt 6/3/3 topology (historical bug) ──────────────
{
  const candidates = seedPoolRoster();
  const elites = candidates.filter(c => c.division === 'A').slice(0, 2);
  const beforeB = new Set(candidates.filter(c => c.division === 'B').map(c => c.id));

  // Simulate resume that forgot LEAGUE_SEED_POOL → default 2/2 quotas.
  promoteRelegateAndReplace(candidates, elites, 2, 2);
  const after = counts(candidates);

  assert.notDeepEqual(
    after,
    { A: 6, B: 3, C: 3 },
    'buggy 2/2 quotas on seed-pool divisions must scramble 6/3/3 sizes',
  );
  // With size-3 B, top-2 and bottom-2 slices overlap; last-write-wins leaves A/C unbalanced.
  assert.ok(after.A !== 6 || after.C !== 3, 'overlapping 2/2 slices must unbalance A or C');
  void beforeB;
  console.log('OK: historical 2/2 quotas scramble seed-pool division sizes', after);
}

// ── 3) Correct 1/1 quotas preserve 6/3/3 topology ────────────────────────────
{
  const candidates = seedPoolRoster();
  const elites = candidates.filter(c => c.division === 'A').slice(0, 2);
  const { topK, botK } = leaguePromoCounts(true);
  assert.equal(topK, 1);
  assert.equal(botK, 1);

  promoteRelegateAndReplace(candidates, elites, topK, botK);
  const after = counts(candidates);
  assert.deepEqual(after, { A: 6, B: 3, C: 3 });

  // Expected single swaps with ordered points: a6↔b1, b3↔c1; c3 mutated stays in C.
  assert.equal(candidates.find(c => c.id === 'b1')?.division, 'A');
  assert.equal(candidates.find(c => c.id === 'a6')?.division, 'B');
  assert.equal(candidates.find(c => c.id === 'c1')?.division, 'B');
  assert.equal(candidates.find(c => c.id === 'b3')?.division, 'C');
  assert.equal(candidates.find(c => c.id === 'c3')?.division, 'C');
  console.log('OK: seed-pool 1/1 quotas preserve 6/3/3 and move single border slots');
}

// ── 4) Resume path: checkpoint seedPool alone selects 1/1 ────────────────────
{
  const mode = resolveSeedPoolMode('artifacts/seed_pool_v1.json', /* env omitted */ '');
  const { topK, botK } = leaguePromoCounts(mode);
  const candidates = seedPoolRoster();
  const elites = candidates.filter(c => c.division === 'A').slice(0, 2);
  promoteRelegateAndReplace(candidates, elites, topK, botK);
  assert.deepEqual(counts(candidates), { A: 6, B: 3, C: 3 });
  console.log('OK: checkpoint-only resume keeps seed-pool promo quotas');
}

console.log('\nAll verify-seed-pool-resume-promo checks passed.');
