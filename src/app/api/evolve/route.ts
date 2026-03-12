import { NextRequest } from 'next/server';
import * as path from 'path';
import * as fs from 'fs';
import { runEvolutionStream, type EvolutionConfig, type GenerationData } from '@/lib/evolutionRunner';
import type { TrendMutationOverrides } from '@/lib/aiParamsSchema';

function loadTrendReportOverrides(): TrendMutationOverrides | undefined {
  const p = path.join(process.cwd(), 'artifacts', 'trend-report.json');
  if (!fs.existsSync(p)) return undefined;
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
    const params = data.params ?? data;
    const overrides: TrendMutationOverrides = {};
    const strengthByClass: Record<string, number> = {
      'stable-good': 0.7,
      exploratory: 1.2,
      'unstable-bad': 1.2,
      default: 1,
    };
    for (const [key, entry] of Object.entries(params)) {
      if (key === 'militaryLevelMixTarget' || !entry || typeof entry !== 'object') continue;
      const rec = entry as { recommendedMutationRange?: number[]; classification?: string };
      const rng = rec.recommendedMutationRange;
      if (!Array.isArray(rng) || rng.length < 2) continue;
      const [a, b] = rng;
      const min = Math.min(a, b);
      const max = Math.max(a, b);
      const strengthMultiplier = strengthByClass[rec.classification ?? ''] ?? strengthByClass.default;
      overrides[key as keyof TrendMutationOverrides] = { min, max, strengthMultiplier };
    }
    return Object.keys(overrides).length > 0 ? overrides : undefined;
  } catch {
    return undefined;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const {
      generations = 8,
      populationSize = 6,
      matchesPerPair = 4,
      maxCycles = 200,
      mapSize = 32,
    } = body as Record<string, number>;

    const config: EvolutionConfig = {
      generations,
      populationSize,
      matchesPerPair,
      maxCycles,
      mapConfig: { width: mapSize, height: mapSize },
      trendOverrides: loadTrendReportOverrides(),
    };

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: unknown) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        try {
          await runEvolutionStream(config, (data: GenerationData) => {
            send(data);
          });
          send({ done: true });
        } catch (err) {
          send({ error: String(err) });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
