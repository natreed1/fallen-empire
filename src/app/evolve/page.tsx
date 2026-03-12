'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import type { GenerationData } from '@/lib/evolutionRunner';
import type { AiParams } from '@/lib/ai';

const TRAIT_KEYS: (keyof AiParams)[] = [
  'siegeChance',
  'scoutChance',
  'incorporateVillageChance',
  'foodBufferThreshold',
  'targetDefenderWeight',
  'recruitGoldThreshold',
];

function formatTraitKey(k: string): string {
  return k.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase()).trim();
}

// ─── Chart Components ─────────────────────────────────────────────────────

function ScoreChart({ generations }: { generations: GenerationData[] }) {
  const pad = { t: 28, r: 24, b: 36, l: 48 };
  const w = 500;
  const h = 200;
  const chartW = w - pad.l - pad.r;
  const chartH = h - pad.t - pad.b;

  const scores = generations.map((g) => g.baselineScore);
  const minS = scores.length ? Math.min(...scores) : 0;
  const maxS = scores.length ? Math.max(...scores) : 100;
  const range = maxS - minS || 1;

  const points = scores.map((s, i) => {
    const x = pad.l + (i / Math.max(1, scores.length - 1)) * chartW;
    const y = pad.t + chartH - ((s - minS) / range) * chartH;
    return `${x},${y}`;
  }).join(' ');

  const gridLines = 5;
  const hasData = generations.length > 0;

  return (
    <div className="rounded-2xl bg-white/80 backdrop-blur-xl p-6 shadow-sm border border-gray-200/60">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[15px] font-semibold text-gray-900">Fitness Trajectory</h3>
        {hasData && (
          <span className="text-xs text-gray-500 tabular-nums font-medium">
            {minS.toFixed(0)} → {maxS.toFixed(0)}
          </span>
        )}
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[200px]">
        {Array.from({ length: gridLines }).map((_, i) => {
          const y = pad.t + (i / (gridLines - 1)) * chartH;
          const v = maxS - (i / (gridLines - 1)) * range;
          return (
            <g key={i}>
              <line x1={pad.l} y1={y} x2={w - pad.r} y2={y} stroke="#e5e7eb" strokeWidth="0.5" />
              <text x={pad.l - 8} y={y + 4} textAnchor="end" fontSize="11" fill="#9ca3af" fontWeight="500">
                {v.toFixed(0)}
              </text>
            </g>
          );
        })}
        {hasData ? (
          <>
            <defs>
              <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#007AFF" stopOpacity="0.25" />
                <stop offset="1" stopColor="#007AFF" stopOpacity="0" />
              </linearGradient>
            </defs>
            <polyline fill="url(#scoreGrad)" stroke="none" points={`${pad.l},${pad.t + chartH} ${points} ${w - pad.r},${pad.t + chartH}`} />
            <polyline fill="none" stroke="#007AFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" points={points} />
          </>
        ) : (
          <text x={w / 2} y={h / 2} textAnchor="middle" fontSize="14" fill="#9ca3af">
            Run evolution to see fitness growth
          </text>
        )}
      </svg>
    </div>
  );
}

function TraitChart({ generations, selectedTraits }: { generations: GenerationData[]; selectedTraits: (keyof AiParams)[] }) {
  const pad = { t: 28, r: 24, b: 40, l: 110 };
  const w = 580;
  const h = 220;
  const chartW = w - pad.l - pad.r;
  const chartH = h - pad.t - pad.b;
  const colors = ['#007AFF', '#34C759', '#5856D6', '#FF9500', '#FF2D55', '#5AC8FA'];

  const series = selectedTraits.map((key) => ({
    key,
    values: generations.map((g) => (typeof g.baseline[key] === 'number' ? (g.baseline[key] as number) : 0)),
  })).filter((s) => s.values.length > 0);

  const allVals = series.flatMap((s) => s.values);
  const minVal = allVals.length ? Math.min(...allVals) : 0;
  const maxVal = allVals.length ? Math.max(...allVals) : 1;
  const range = maxVal - minVal || 1;
  const hasData = generations.length > 0 && series.length > 0;

  return (
    <div className="rounded-2xl bg-white/80 backdrop-blur-xl p-6 shadow-sm border border-gray-200/60">
      <h3 className="text-[15px] font-semibold text-gray-900 mb-4">Parameter Evolution</h3>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[220px]">
        {hasData ? (
          <>
            {series.map((s, si) => {
              const pts = s.values.map((v, i) => {
                const x = pad.l + (i / Math.max(1, s.values.length - 1)) * chartW;
                const y = pad.t + chartH - ((v - minVal) / range) * chartH;
                return `${x},${y}`;
              }).join(' ');
              return (
                <polyline
                  key={s.key}
                  fill="none"
                  stroke={colors[si % colors.length]}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={pts}
                />
              );
            })}
            {selectedTraits.slice(0, series.length).map((key, i) => (
              <g key={key}>
                <circle cx={pad.l - 55} cy={pad.t + (i + 0.5) * (chartH / Math.max(1, series.length))} r="5" fill={colors[i % colors.length]} />
                <text x={pad.l - 46} y={pad.t + (i + 0.5) * (chartH / Math.max(1, series.length)) + 4} fontSize="11" fill="#374151" fontWeight="500">
                  {formatTraitKey(key)}
                </text>
              </g>
            ))}
          </>
        ) : (
          <text x={w / 2} y={h / 2} textAnchor="middle" fontSize="14" fill="#9ca3af">
            Parameter drift over generations
          </text>
        )}
      </svg>
    </div>
  );
}

function LineageTree({ generations }: { generations: GenerationData[] }) {
  const nodeR = 14;
  const genH = 48;
  const w = 440;
  const h = Math.max(220, generations.length * genH + 60);
  const hasData = generations.length > 0;

  return (
    <div className="rounded-2xl bg-white/80 backdrop-blur-xl p-6 shadow-sm border border-gray-200/60 overflow-x-auto">
      <h3 className="text-[15px] font-semibold text-gray-900 mb-4">Lineage</h3>
      <svg viewBox={`0 0 ${w} ${h}`} className="min-w-[360px]" preserveAspectRatio="xMidYMin meet">
        {hasData ? (
          <>
            {generations.length >= 2 &&
              generations.slice(0, -1).map((_, i) => (
                <line
                  key={`trunk-${i}`}
                  x1={w / 2}
                  y1={36 + i * genH + nodeR}
                  x2={w / 2}
                  y2={36 + (i + 1) * genH}
                  stroke="#007AFF"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              ))}
            {generations.map((g, i) => {
              const cx = w / 2;
              const cy = 36 + i * genH + nodeR;
              const isBest = i === generations.length - 1;
              return (
                <g key={g.gen}>
                  <circle cx={cx} cy={cy} r={nodeR} fill={isBest ? '#007AFF' : '#e5e7eb'} stroke={isBest ? '#007AFF' : '#d1d5db'} strokeWidth="1.5" />
                  <text x={cx} y={cy + 5} textAnchor="middle" fontSize="12" fill={isBest ? 'white' : '#374151'} fontWeight="600">
                    {g.gen}
                  </text>
                  <text x={cx + nodeR + 14} y={cy + 5} fontSize="11" fill="#6b7280" fontWeight="500">
                    {g.baselineScore.toFixed(0)}
                  </text>
                  {g.population.slice(1, 4).map((_, j) => {
                    const px = cx + (j % 2 === 0 ? -1 : 1) * (70 + j * 24);
                    return <circle key={j} cx={px} cy={cy} r={8} fill="#f3f4f6" stroke="#e5e7eb" strokeWidth="1" />;
                  })}
                </g>
              );
            })}
          </>
        ) : (
          <text x={w / 2} y={h / 2} textAnchor="middle" fontSize="14" fill="#9ca3af">
            Evolutionary lineage will appear
          </text>
        )}
      </svg>
    </div>
  );
}

function PopulationSpread({ generations }: { generations: GenerationData[] }) {
  const pad = { t: 28, r: 24, b: 36, l: 48 };
  const w = 440;
  const h = 140;
  const chartW = w - pad.l - pad.r;
  const chartH = h - pad.t - pad.b;

  const means = generations.map((g) => (g.population.length ? g.population.reduce((a, c) => a + c.score, 0) / g.population.length : 0));
  const mins = generations.map((g) => (g.population.length ? Math.min(...g.population.map((c) => c.score)) : 0));
  const maxs = generations.map((g) => (g.population.length ? Math.max(...g.population.map((c) => c.score)) : 0));
  const allVals = [...mins, ...maxs, ...means];
  const minV = allVals.length ? Math.min(...allVals) : 0;
  const maxV = allVals.length ? Math.max(...allVals) : 100;
  const range = maxV - minV || 1;
  const hasData = generations.length > 0;

  const meanPoints = means.map((m, i) => {
    const x = pad.l + (i / Math.max(1, means.length - 1)) * chartW;
    const y = pad.t + chartH - ((m - minV) / range) * chartH;
    return `${x},${y}`;
  }).join(' ');

  return (
    <div className="rounded-2xl bg-white/80 backdrop-blur-xl p-6 shadow-sm border border-gray-200/60">
      <h3 className="text-[15px] font-semibold text-gray-900 mb-4">Population Diversity</h3>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[140px]">
        {hasData ? (
          <>
            {generations.map((g, i) => {
              const x = pad.l + (i / Math.max(1, generations.length - 1)) * chartW;
              const yMin = pad.t + chartH - ((maxs[i] - minV) / range) * chartH;
              const yMax = pad.t + chartH - ((mins[i] - minV) / range) * chartH;
              return (
                <rect key={i} x={x - 5} y={yMin} width={10} height={yMax - yMin} fill="#007AFF" opacity="0.12" rx="2" />
              );
            })}
            <polyline fill="none" stroke="#007AFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" points={meanPoints} />
          </>
        ) : (
          <text x={w / 2} y={h / 2} textAnchor="middle" fontSize="14" fill="#9ca3af">
            Score spread per generation
          </text>
        )}
      </svg>
    </div>
  );
}

// ─── Config Input ──────────────────────────────────────────────────────────

function ConfigInput({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-gray-500 uppercase tracking-wider mb-1.5">
        {label}
      </label>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Math.max(min, Math.min(max, +e.target.value || min)))}
        className="w-full px-4 py-2.5 rounded-xl bg-gray-100/80 border-0 text-gray-900 text-[15px] font-medium focus:ring-2 focus:ring-blue-500/40 focus:bg-white transition-all outline-none"
      />
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────

export default function EvolvePage() {
  const [status, setStatus] = useState<'idle' | 'running' | 'done'>('idle');
  const [generations, setGenerations] = useState<GenerationData[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState({
    generations: 10,
    populationSize: 8,
    matchesPerPair: 6,
    maxCycles: 200,
    mapSize: 36,
  });

  const startEvolution = useCallback(async () => {
    setStatus('running');
    setGenerations([]);
    setError(null);
    try {
      const res = await fetch('/api/evolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (!res.ok) throw new Error(res.statusText);
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      if (!reader) throw new Error('No body');
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.done) { setStatus('done'); return; }
              if (data.error) { setError(data.error); setStatus('done'); return; }
              setGenerations((prev) => [...prev, data]);
            } catch { /* skip */ }
          }
        }
      }
      setStatus('done');
    } catch (e) {
      setError(String(e));
      setStatus('done');
    }
  }, [config]);

  const lastGen = generations[generations.length - 1];
  const firstScore = generations[0]?.baselineScore ?? 0;
  const lastScore = lastGen?.baselineScore ?? 0;
  const delta = lastScore - firstScore;

  return (
    <div className="min-h-screen bg-[#f5f5f7] text-gray-900">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur-xl border-b border-gray-200/60">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link
              href="/"
              className="text-[15px] text-gray-500 hover:text-gray-900 transition-colors"
            >
              ← Game
            </Link>
            <div>
              <h1 className="text-[22px] font-semibold text-gray-900 tracking-tight">
                Evolution Lab
              </h1>
              <p className="text-[13px] text-gray-500 mt-0.5">
                Train and observe AI parameter evolution
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {status === 'running' && lastGen && (
              <div className="flex items-center gap-3 text-[14px] text-gray-600">
                <span className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                  Gen {lastGen.gen} / {config.generations}
                </span>
                <span className="tabular-nums">{(lastGen.elapsedMs / 1000).toFixed(1)}s</span>
              </div>
            )}
            <button
              onClick={startEvolution}
              disabled={status === 'running'}
              className="px-6 py-2.5 rounded-full bg-[#007AFF] text-white font-medium text-[15px] hover:bg-[#0051D5] disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.98]"
            >
              {status === 'running' ? 'Running…' : 'Start'}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        {error && (
          <div className="rounded-2xl bg-red-50 border border-red-200/80 text-red-700 px-5 py-4 text-[14px]">
            {error}
          </div>
        )}

        {/* Config */}
        <div className="rounded-2xl bg-white/80 backdrop-blur-xl p-6 shadow-sm border border-gray-200/60">
          <h2 className="text-[15px] font-semibold text-gray-900 mb-4">Configuration</h2>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-5">
            <ConfigInput label="Generations" value={config.generations} min={4} max={20} onChange={(v) => setConfig((c) => ({ ...c, generations: v }))} />
            <ConfigInput label="Population" value={config.populationSize} min={4} max={16} onChange={(v) => setConfig((c) => ({ ...c, populationSize: v }))} />
            <ConfigInput label="Matches" value={config.matchesPerPair} min={2} max={12} onChange={(v) => setConfig((c) => ({ ...c, matchesPerPair: v }))} />
            <ConfigInput label="Max cycles" value={config.maxCycles} min={100} max={500} onChange={(v) => setConfig((c) => ({ ...c, maxCycles: v }))} />
            <ConfigInput label="Map size" value={config.mapSize} min={24} max={56} onChange={(v) => setConfig((c) => ({ ...c, mapSize: v }))} />
          </div>
        </div>

        {/* Summary */}
        {status === 'done' && generations.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Final fitness', value: lastScore.toFixed(1), color: 'text-gray-900' },
              { label: 'Δ fitness', value: `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}`, color: delta >= 0 ? 'text-[#34C759]' : 'text-[#FF9500]' },
              { label: 'Generations', value: String(generations.length), color: 'text-gray-900' },
              { label: 'Time', value: `${((lastGen?.elapsedMs ?? 0) / 1000).toFixed(1)}s`, color: 'text-gray-900' },
            ].map(({ label, value, color }) => (
              <div key={label} className="rounded-2xl bg-white/80 backdrop-blur-xl p-5 shadow-sm border border-gray-200/60">
                <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wider mb-1">{label}</p>
                <p className={`text-[20px] font-semibold tabular-nums ${color}`}>{value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Charts */}
        <div className="grid gap-6 lg:grid-cols-2">
          <ScoreChart generations={generations} />
          <LineageTree generations={generations} />
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <PopulationSpread generations={generations} />
          <TraitChart generations={generations} selectedTraits={TRAIT_KEYS} />
        </div>

        {/* Best params */}
        {status === 'done' && lastGen && (
          <div className="rounded-2xl bg-white/80 backdrop-blur-xl p-6 shadow-sm border border-gray-200/60">
            <h3 className="text-[15px] font-semibold text-gray-900 mb-3">Best Parameters (Gen {lastGen.gen})</h3>
            <pre className="text-[12px] overflow-x-auto text-gray-600 font-mono bg-gray-50 rounded-xl p-5 max-h-72 overflow-y-auto border border-gray-100">
              {JSON.stringify(lastGen.baseline, null, 2)}
            </pre>
          </div>
        )}
      </main>
    </div>
  );
}
