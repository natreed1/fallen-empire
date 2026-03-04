/**
 * Trend optimizer: analyze league/historical results and produce trend-report.json
 * with per-param classification (stable-good, exploratory, unstable-bad) and
 * recommended mutation ranges. Used when LEAGUE_MUTATION_PROFILE=trend.
 *
 * Input: artifacts/league-last.json and/or historical ndjson (if present)
 * Output: artifacts/trend-report.json, optional artifacts/trend-seed-params.json
 *
 * Run: npx ts-node -r tsconfig-paths/register --project tsconfig.train.json scripts/optimize-trends.ts
 */

import * as path from 'path';
import * as fs from 'fs';
import type { AiParams } from '../src/lib/ai';
import { DEFAULT_AI_PARAMS } from '../src/lib/ai';
import { SCALAR_PARAM_KEYS } from '../src/lib/aiParamsSchema';

const ARTIFACTS_DIR = path.join(process.cwd(), 'artifacts');
const LEAGUE_LAST = path.join(ARTIFACTS_DIR, 'league-last.json');
const TREND_REPORT_PATH = path.join(ARTIFACTS_DIR, 'trend-report.json');
const TREND_SEED_PARAMS_PATH = path.join(ARTIFACTS_DIR, 'trend-seed-params.json');

/** Param keys we analyze (all scalar evolvable params). */
const PARAM_KEYS = SCALAR_PARAM_KEYS;

type ParamKey = (typeof PARAM_KEYS)[number];

export type ParamClassification = 'stable-good' | 'exploratory' | 'unstable-bad';

export type TrendReport = {
  generatedAt: string;
  source: string;
  sampleCount: number;
  topK: number;
  params: Record<
    string,
    {
      mean: number;
      variance: number;
      spread: number;
      correlationWithPerformance: number;
      classification: ParamClassification;
      recommendedMutationRange: [number, number];
      suggestedCenter: number;
    }
  >;
  recommendedMutationRanges: Record<string, [number, number]>;
};

function isParamKey(k: string): k is ParamKey {
  return (PARAM_KEYS as readonly string[]).includes(k);
}

function getParamValue(p: Partial<AiParams>, key: ParamKey): number {
  const v = (p as unknown as Record<string, unknown>)[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const def = (DEFAULT_AI_PARAMS as unknown as Record<string, unknown>)[key];
  return typeof def === 'number' ? def : 0;
}

/** Extract candidates with params and performance from league-last.json. */
function loadLeagueLast(): { params: AiParams; points: number }[] {
  if (!fs.existsSync(LEAGUE_LAST)) return [];
  const raw = fs.readFileSync(LEAGUE_LAST, 'utf8');
  const data = JSON.parse(raw) as {
    history?: { season: number; standingsA: { id: string; points: number; params?: AiParams }[]; standingsB: { id: string; points: number; params?: AiParams }[]; standingsC: { id: string; points: number; params?: AiParams }[] }[];
    finalStandingsA?: { id: string; points: number; params?: AiParams }[];
  };
  const out: { params: AiParams; points: number }[] = [];
  const seen = new Set<string>();
  const history = data.history ?? [];
  const finalA = data.finalStandingsA ?? [];
  for (const h of history) {
    for (const s of [...(h.standingsA ?? []), ...(h.standingsB ?? []), ...(h.standingsC ?? [])]) {
      const pts = (s as { points?: number }).points ?? 0;
      const params = (s as { params?: AiParams }).params;
      if (params && typeof params === 'object') {
        const key = JSON.stringify(params);
        if (!seen.has(key)) { seen.add(key); out.push({ params: { ...DEFAULT_AI_PARAMS, ...params }, points: pts }); }
      }
    }
  }
  for (const s of finalA) {
    const params = (s as { params?: AiParams }).params;
    const pts = (s as { points?: number }).points ?? 0;
    if (params && typeof params === 'object') {
      const key = JSON.stringify(params);
      if (!seen.has(key)) { seen.add(key); out.push({ params: { ...DEFAULT_AI_PARAMS, ...params }, points: pts }); }
    }
  }
  return out;
}

/** Load historical ndjson from artifacts (e.g. league-history.ndjson). */
function loadHistoricalNdjson(): { params: AiParams; points: number }[] {
  const ndjsonPath = path.join(ARTIFACTS_DIR, 'league-history.ndjson');
  if (!fs.existsSync(ndjsonPath)) return [];
  const lines = fs.readFileSync(ndjsonPath, 'utf8').trim().split('\n').filter(Boolean);
  const out: { params: AiParams; points: number }[] = [];
  for (const line of lines) {
    try {
      const row = JSON.parse(line) as { params?: AiParams; points?: number; score?: number };
      const params = row.params;
      const points = row.points ?? row.score ?? 0;
      if (params && typeof params === 'object') {
        out.push({ params: { ...DEFAULT_AI_PARAMS, ...params }, points });
      }
    } catch {
      // skip malformed lines
    }
  }
  return out;
}

function mean(arr: number[]): number {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function variance(arr: number[]): number {
  if (arr.length <= 1) return 0;
  const m = mean(arr);
  return arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length;
}

function correlation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 2) return 0;
  const mx = mean(x);
  const my = mean(y);
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < x.length; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const den = Math.sqrt(dx2 * dy2);
  return den === 0 ? 0 : num / den;
}

/** Classify param: stable-good (low variance, positive corr), exploratory (medium), unstable-bad (high variance, negative corr). */
function classify(
  varianceVal: number,
  correlationVal: number,
  spread: number,
): ParamClassification {
  const absCorr = Math.abs(correlationVal);
  if (varianceVal > spread * 0.5 && correlationVal < -0.1) return 'unstable-bad';
  if (varianceVal < spread * 0.15 && correlationVal > 0.1) return 'stable-good';
  return 'exploratory';
}

/** Recommended mutation range: narrow for stable-good, medium for exploratory, corrective for unstable-bad. */
function recommendedRange(
  key: ParamKey,
  meanVal: number,
  classification: ParamClassification,
  spread: number,
): [number, number] {
  const def = getParamValue(DEFAULT_AI_PARAMS, key);
  const lo = key === 'siegeChance' ? 0.05 : key === 'recruitGoldThreshold' ? 100 : key === 'foodBufferThreshold' || key === 'farmPriorityThreshold' ? 0 : 0.5;
  const hi = key === 'siegeChance' ? 0.5 : key === 'recruitGoldThreshold' ? 800 : key === 'foodBufferThreshold' || key === 'farmPriorityThreshold' ? 30 : key === 'maxRecruitsWhenRich' || key === 'maxRecruitsWhenPoor' ? 5 : 2;
  const range = hi - lo;
  let halfWidth: number;
  if (classification === 'stable-good') {
    halfWidth = range * 0.08;
  } else if (classification === 'unstable-bad') {
    halfWidth = range * 0.2;
  } else {
    halfWidth = range * 0.15;
  }
  const center = classification === 'unstable-bad' ? def : meanVal;
  const low = Math.max(lo, center - halfWidth);
  const high = Math.min(hi, center + halfWidth);
  return [low, high];
}

function main() {
  const leagueSamples = loadLeagueLast();
  const ndjsonSamples = loadHistoricalNdjson();
  const combined = [...leagueSamples, ...ndjsonSamples];
  const source = leagueSamples.length
    ? (ndjsonSamples.length ? 'league-last.json + league-history.ndjson' : 'league-last.json')
    : ndjsonSamples.length
      ? 'league-history.ndjson'
      : 'none';

  if (combined.length < 3) {
    console.warn('optimize-trends: need at least 3 samples with params; found', combined.length, '- writing minimal trend report.');
    if (!fs.existsSync(ARTIFACTS_DIR)) fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
    const minimal: TrendReport = {
      generatedAt: new Date().toISOString(),
      source,
      sampleCount: combined.length,
      topK: 0,
      params: {},
      recommendedMutationRanges: {},
    };
    fs.writeFileSync(TREND_REPORT_PATH, JSON.stringify(minimal, null, 2), 'utf8');
    console.log('Wrote', TREND_REPORT_PATH);
    return;
  }

  const topK = Math.max(3, Math.min(20, Math.floor(combined.length * 0.4)));
  const sorted = [...combined].sort((a, b) => b.points - a.points);
  const top = sorted.slice(0, topK);
  const points = top.map(t => t.points);
  const paramsReport: TrendReport['params'] = {};

  for (const key of PARAM_KEYS) {
    const values = top.map(t => getParamValue(t.params, key));
    const meanVal = mean(values);
    const varianceVal = variance(values);
    const spread = Math.max(1e-6, Math.max(...values) - Math.min(...values));
    const correlationVal = correlation(values, points);
    const classification = classify(varianceVal, correlationVal, spread);
    const [low, high] = recommendedRange(key, meanVal, classification, spread);
    paramsReport[key] = {
      mean: meanVal,
      variance: varianceVal,
      spread,
      correlationWithPerformance: correlationVal,
      classification,
      recommendedMutationRange: [low, high],
      suggestedCenter: classification === 'unstable-bad' ? getParamValue(DEFAULT_AI_PARAMS, key) : meanVal,
    };
  }

  const recommendedMutationRanges: Record<string, [number, number]> = {};
  for (const key of PARAM_KEYS) {
    recommendedMutationRanges[key] = paramsReport[key].recommendedMutationRange;
  }

  const report: TrendReport = {
    generatedAt: new Date().toISOString(),
    source,
    sampleCount: combined.length,
    topK,
    params: paramsReport,
    recommendedMutationRanges,
  };

  if (!fs.existsSync(ARTIFACTS_DIR)) fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  fs.writeFileSync(TREND_REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
  console.log('Wrote', TREND_REPORT_PATH);

  const seedParams: AiParams = { ...DEFAULT_AI_PARAMS };
  const seedRecord = seedParams as unknown as Record<string, number>;
  for (const key of PARAM_KEYS) {
    seedRecord[key] = paramsReport[key].suggestedCenter;
  }
  fs.writeFileSync(TREND_SEED_PARAMS_PATH, JSON.stringify(seedParams, null, 2), 'utf8');
  console.log('Wrote', TREND_SEED_PARAMS_PATH);
}

main();
