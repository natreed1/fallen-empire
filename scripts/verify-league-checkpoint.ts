import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DEFAULT_AI_PARAMS, type AiParams } from '../src/core/gameCore';
import {
  loadLeagueCheckpoint,
  restoreCandidatesFromCheckpoint,
  saveLeagueCheckpoint,
  selectChampion,
  type Candidate,
  type DivisionStanding,
  type LeagueCheckpoint,
  type LeagueReport,
  type Stats,
} from './tournament-league';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function stats(points: number, wins: number): Stats {
  return {
    points,
    wins,
    losses: 0,
    draws: 0,
    killsFor: points,
    killsAgainst: 0,
    cityDiff: 0,
    popDiff: 0,
    goldDiff: 0,
    decisiveGames: wins,
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

function candidate(id: string, division: Candidate['division'], points: number, wins: number): Candidate {
  return {
    id,
    division,
    params: { ...DEFAULT_AI_PARAMS } as AiParams,
    seasonStats: stats(points, wins),
    gameScores: [points],
  };
}

function standing(c: Candidate): DivisionStanding {
  return {
    id: c.id,
    ...c.seasonStats,
    params: c.params,
  };
}

const weak = candidate('weak-a', 'A', 1, 0);
const champion = candidate('actual-champion', 'A', 100, 8);
const b = candidate('division-b', 'B', 20, 2);
const c = candidate('division-c', 'C', 10, 1);
const candidates = [weak, champion, b, c];
const report: LeagueReport = {
  seasons: 12,
  divSize: 2,
  history: [{
    season: 12,
    standingsA: [standing(champion), standing(weak)],
    standingsB: [standing(b)],
    standingsC: [standing(c)],
    promotionsRelegations: [],
  }],
  champion: { id: '', division: 'A' },
  finalStandingsA: [],
};

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'league-checkpoint-test-'));
const checkpointPath = path.join(tempDir, 'league-checkpoint.json');

try {
  saveLeagueCheckpoint(checkpointPath, 13, candidates, report);
  const loaded = loadLeagueCheckpoint(checkpointPath);
  assert(loaded, 'expected saved checkpoint to load');
  assert(loaded.version === 'v2', 'new checkpoints must use the score-preserving format');

  const restored = restoreCandidatesFromCheckpoint(loaded);
  const selected = selectChampion(restored.filter(entry => entry.division === 'A'));
  assert(selected.id === champion.id, 'completed-season resume selected a different champion');
  assert(selected.seasonStats.points === 100, 'completed-season resume lost champion points');
  assert(selected.gameScores?.[0] === 100, 'completed-season resume lost robust-selection scores');

  const legacy: LeagueCheckpoint = {
    ...loaded,
    version: 'v1',
    candidates: loaded.candidates.map(({ seasonStats: _stats, gameScores: _scores, ...entry }) => entry),
  };
  const restoredLegacy = restoreCandidatesFromCheckpoint(legacy);
  const selectedLegacy = selectChampion(restoredLegacy.filter(entry => entry.division === 'A'));
  assert(selectedLegacy.id === champion.id, 'legacy completed checkpoint did not recover final standings');

  fs.writeFileSync(checkpointPath, '{"version":"v2","candidates":', 'utf8');
  let rejectedCorruption = false;
  try {
    loadLeagueCheckpoint(checkpointPath);
  } catch {
    rejectedCorruption = true;
  }
  assert(rejectedCorruption, 'corrupt checkpoint silently restarted the league');

  console.log('League checkpoint regression guards passed.');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
