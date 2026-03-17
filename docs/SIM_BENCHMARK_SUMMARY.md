# Simulation benchmark summary (optimization audit)

Short controlled benchmark: 8 games, seedBase=42, maxCycles=200, map=32×32. Same seeds/settings for repeatability.

## Commands

- **Full diagnostics (default):** `npm run benchmark-sim`
- **Minimal diagnostics:** `SIM_DIAG=minimal npm run benchmark-sim`
- **Per-season phase timing:** `SIM_DEBUG_TIMING=1 npm run seasonal-sim` (then run for 1–2 seasons and read `[timing]` lines)

## Benchmark table (representative runs)

| Mode    | Total ms | Ms/game | Notes                    |
|---------|----------|---------|---------------------------|
| full    | ~3850–3900 | ~480–488 | Full telemetry per cycle  |
| minimal | ~3850–3900 | ~480–488 | Only kills/abort for scoring |

*Variance between full and minimal in short 200-cycle games is within noise; gains from minimal diagnostics scale with cycle count and unit count. Indexed lookups (unitById, clusterByKey, heroLogisticianByHex) reduce constant factors in the hot path.*

## Determinism

Same seed produces the same outcome (winner, cycle). No gameplay behavior change; optimizations are lookup/index only.

## Validation

1. `npm run validate-ai-params` — OK  
2. `npm run diag-sim-health` — use when needed (may require local npm/ts-node)  
3. `npm run benchmark-sim` — reports total ms, ms per game, and first 3 (winner, cycle) for determinism check  

## Phase timing (seasonal-sim)

With `SIM_DEBUG_TIMING=1`, each season prints a line like:

```
[timing] season total=XXXms  runGames=XXXms  scenarios=XXXms  holdout=XXXms  telemetry=XXXms  rollback=XXXms  checkpoint=XXXms  promo=XXXms  underflow=XXXms
```

Use this to see which phase dominates (typically `runGames`).
