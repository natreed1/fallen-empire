# Tiered Seasonal Simulation System

Target: **95+ reliability** through seasonal simulation alone (no human eval loops). Improvement comes from tiered curriculum, fixed anchors, robustness-first scoring, holdout validation, scenario battery, and automated telemetry/rollback.

## Design Constraints (Mandatory)

- **Tiered curriculum with competency gates**
  - **Tier C**: Economy/survival (anti-starvation baseline).
  - **Tier B**: Combat proficiency (must clear battle tests).
  - **Tier A**: Full strategic robustness and adaptation.

- **Permanent fixed anchors**
  - Anchors remain in all seasons as benchmark opponents.
  - Anchors are ineligible for final champion title.

- **Robustness-first scoring**
  - Selection by composite robustness score: `mean - λ·std - tailPenalty·worstDecile` across seeds/maps/opponents.
  - Prefer stable generalists over brittle spike performers.

- **Frozen holdout suite**
  - Run every N seasons.
  - Holdout set is never used for mutation/selection decisions.

- **Scenario battle-test battery**
  - Targeted tests: defense rush, siege break, resource shock, village timing.
  - Promotion/champion eligibility must satisfy scenario minimum thresholds.

- **Hybrid mutation portfolio**
  - Stable: 65% (configurable)
  - Medium exploration: 25%
  - Wildcard: 10%
  - Ratios configurable with guardrails.

- **Lineage diversity controls**
  - Cap per-lineage representation per tier/season.
  - Prevent single-family collapse of meta diversity.

- **Strict tier integrity**
  - **Hard tier-size invariants**: After each season, exact counts are enforced: |A|=tierSizeA, |B|=tierSizeB, |C|=tierSizeC (C overflow → replace bottom with mutations; C underflow → new agents by caller).
  - **Two-stage promotion**: Stage 1 = strict passers (gates + scenario min); Stage 2 = fill remaining slots with best robustness from the tier below (tagged probation).
  - **Non-overlap**: Promote/relegate sets are disjoint and applied atomically (single new-tier map then apply).
  - **Probation**: Fallback-promoted bots get probation; after N seasons without improvement they are auto-relegated.
  - **Gate scheduling**: Gates start lenient (seasons 1..gateLenientUntilSeason) and tighten afterward to avoid early lockout.

- **Anti-degenerate behavior penalties**
  - Penalize draw, no-combat score farming, starvation-lock, non-interactive exploit policies.

- **Champion eligibility gates**
  - Champion must be non-anchor.
  - Must pass holdout robustness + full anchor gauntlet + scenario minimums.

- **Deterministic regression harness**
  - Reproducible A/B checks using fixed seeds before/after major changes.

- **Automated telemetry + rollback triggers**
  - Track draw rate, starvation-lock frequency, decisiveness, holdout delta, lineage concentration.
  - If thresholds regress, auto-rollback to last stable checkpoint.

## Running

```bash
# Default: 12 seasons, tier size 8, holdout every 3 seasons
npm run seasonal-sim

# Tune via env
SIM_SEASONS=20 SIM_TIER_SIZE=8 SIM_HOLDOUT_EVERY_N=3 npm run seasonal-sim
```

## Configuration (env)

| Env | Default | Description |
|-----|---------|-------------|
| `SIM_SEASONS` | 12 | Number of seasons. |
| `SIM_TIER_SIZE` | 8 | Default size per tier (C/B/A). |
| `SIM_TIER_SIZE_C` / `_B` / `_A` | same | Override per tier. |
| `SIM_PROMOTE_COUNT` | 2 | Fixed quota: promote top N from B→A and C→B each season. |
| `SIM_RELEGATE_COUNT` | 2 | Fixed quota: relegate bottom N from A→B and B→C each season. |
| `SIM_MUTATION_STABLE_RATIO` | 0.65 | Fraction of mutations that are stable. |
| `SIM_MUTATION_MEDIUM_RATIO` | 0.25 | Medium exploration. |
| `SIM_MUTATION_WILDCARD_RATIO` | 0.10 | Wildcard exploration. |
| `SIM_MUTATION_*_STRENGTH` | 0.08 / 0.18 / 0.35 | Mutation strength per bucket. |
| `SIM_ROBUST_LAMBDA` | 0.35 | Variance penalty in robustness score. |
| `SIM_HOLDOUT_EVERY_N` | 3 | Run holdout every N seasons. |
| `SIM_HOLDOUT_NUM_GAMES` | 20 | Games per holdout run. |
| `SIM_SCENARIO_MIN_PROMOTION` | 0 | Min scenario score for promotion. |
| `SIM_SCENARIO_MIN_CHAMPION` | 10 | Min scenario score for champion. |
| `SIM_PROBATION_SEASONS` | 2 | Seasons before auto-relegate for fallback-promoted (probation) bots. |
| `SIM_GATE_LENIENT_UNTIL_SEASON` | 3 | Seasons 1..N use lenient gates; then tighten. |
| `SIM_LINEAGE_CAP_PER_TIER` | 0.4 | Max fraction of a tier from one lineage. |
| `SIM_ROLLBACK_MAX_DRAW_RATE` | 0.92 | Rollback if draw rate exceeds. |
| `SIM_ROLLBACK_MAX_STARVATION_RATE` | 0.6 | Rollback if starvation-lock rate exceeds. |
| `SIM_ROLLBACK_MIN_DECISIVENESS` | 0.08 | Rollback if decisiveness below. |
| `SIM_MAX_CYCLES` | 300 | Max cycles per game. |
| `SIM_MAP_SIZE` | 38 | Map width/height. |

## Regression harness

Reproducible A/B comparison with fixed seeds:

```bash
npm run regression-harness
# Or with explicit params and seeds:
REGRESSION_PARAMS_A=public/ai-params.json REGRESSION_PARAMS_B=artifacts/baseline.json REGRESSION_SEEDS=10001,10002,10003 npm run regression-harness
```

## Artifacts

- `artifacts/sim-system-checkpoint.json` — Last stable checkpoint (used for rollback).
- `artifacts/sim-system-telemetry.ndjson` — One JSON object per line per season (draw rate, decisiveness, etc.).
- `public/ai-params.json` — Champion params (after run).

## Files

- `scripts/seasonal-sim.ts` — Main entry.
- `scripts/regression-harness.ts` — Deterministic A/B harness.
- `scripts/sim-system/` — Config, types, anchors, scoring, mutation, lineage, gates, scenario-battery, holdout, telemetry, season.

## Related

- [ROBUST_TRAINING.md](./ROBUST_TRAINING.md) — League archetypes, trend mutation, robust selection.
- [AI_TRAINING.md](./AI_TRAINING.md) — Headless sim, train-ai script.
