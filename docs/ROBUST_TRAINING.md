# Robust Training System

Backward-compatible extension of the league tournament for trend-driven mutation, domain-randomized scenarios, fixed archetype adversaries, and robust selection scoring.

## Architecture Overview

- **Trend optimizer** (`scripts/optimize-trends.ts`): Reads `artifacts/league-last.json` (and optional `artifacts/league-history.ndjson`), computes per-param weighted mean, variance, and correlation with performance among top performers. Classifies params as `stable-good`, `exploratory`, or `unstable-bad` and writes recommended mutation ranges to `artifacts/trend-report.json` and optional `artifacts/trend-seed-params.json`.

- **Domain randomization** (`scripts/lib/scenarios.ts`): Named scenarios (`balanced`, `tight`, `wide`, `lean-food`, `high-expansion`) provide different map/config overrides. When `LEAGUE_DOMAIN_RANDOMIZATION=1`, each match selects a scenario deterministically from the seed so training sees varied conditions.

- **Fixed archetypes** (`scripts/lib/archetypes.ts`): Four non-mutated adversaries are always in the evaluation pool when `LEAGUE_INCLUDE_ARCHETYPES=1`: **Berserker** (ultra aggressive rush), **Turtle** (defensive econ), **Expansion** (village/city growth first), **Siege Attrition** (slow siege pressure). Every season, each league candidate plays each archetype (both sides); archetype results are weighted (e.g. 35%) into the final score.

- **Robust selection** (in `scripts/tournament-league.ts`): When `LEAGUE_USE_ROBUST_SELECTION=1`, candidates are ranked by robust score: `mean - lambda * std - tailPenalty * worstDecile` over all game scores (division + archetype). Legacy path uses raw points (and optionally combined division + archetype points).

- **Trend-shaped mutation**: When `LEAGUE_MUTATION_PROFILE=trend`, mutation uses `trend-report.json` to narrow mutation for stable-good params, medium for exploratory, and corrective bias away from unstable-bad. Falls back to legacy mutation if the report is missing.

- **Champion library** (`artifacts/champion-library.json`): After each run, the champion is appended, deduped by param-distance threshold, and capped (e.g. 50). Can be used as optional opponents in diversity scheduling.

- **Validation harness** (`scripts/validate-robustness.ts`): Runs 100+ randomized matches and reports draw rate, owner flip rate, no-combat rate, starvation lock frequency, and robust score vs baseline. Exits non-zero if regression thresholds are violated.

## Environment Flags

| Flag | Default | Description |
|------|---------|-------------|
| `LEAGUE_DOMAIN_RANDOMIZATION` | off | `1` = per-match scenario from `LEAGUE_SCENARIO_MIX` (deterministic by seed). |
| `LEAGUE_SCENARIO_MIX` | `balanced:0.4,tight:0.2,wide:0.2,lean-food:0.1,high-expansion:0.1` | Scenario name:weight pairs. |
| `LEAGUE_INCLUDE_ARCHETYPES` | off | `1` = fixed archetypes are always evaluated (recommended in robust mode). |
| `LEAGUE_ARCHETYPE_WEIGHT` | `0.35` | Weight (0–1) for archetype match results in combined score (legacy path). |
| `LEAGUE_USE_ROBUST_SELECTION` | off | `1` = rank by robust score (mean − λ·std − tail·worstDecile). |
| `LEAGUE_ROBUST_LAMBDA` | `0.35` | Penalty factor for standard deviation. |
| `LEAGUE_TAIL_PENALTY` | `0.25` | Penalty factor for worst decile. |
| `LEAGUE_MUTATION_PROFILE` | `legacy` | `trend` = use trend report for mutation ranges; falls back to legacy if missing. |
| `CHAMPION_LIBRARY_CAP` | `50` | Max entries in champion-library.json. |
| `CHAMPION_LIBRARY_PARAM_DISTANCE_THRESHOLD` | `0.05` | Min param distance to keep a distinct library entry. |

## Sample Commands

**Default (unchanged behavior):**
```bash
npm run tournament-league
# or
LEAGUE_SEASONS=12 LEAGUE_DIV_SIZE=8 npm run tournament-league
```

**Robust training (all new features):**
```bash
LEAGUE_DOMAIN_RANDOMIZATION=1 \
LEAGUE_USE_ROBUST_SELECTION=1 \
LEAGUE_MUTATION_PROFILE=trend \
LEAGUE_INCLUDE_ARCHETYPES=1 \
LEAGUE_SEASONS=30 \
npm run tournament-league
```

**Generate trend report from last league run:**
```bash
npm run optimize-trends
# Writes artifacts/trend-report.json and artifacts/trend-seed-params.json
```

**Validate robustness (after training):**
```bash
npm run validate-robustness
# or with more matches / domain randomization
VALIDATE_NUM_MATCHES=120 LEAGUE_DOMAIN_RANDOMIZATION=1 npm run validate-robustness
```

## Example Outputs

**trend-report.json** (excerpt):
```json
{
  "generatedAt": "2025-03-03T12:00:00.000Z",
  "source": "league-last.json",
  "sampleCount": 18,
  "topK": 8,
  "params": {
    "siegeChance": {
      "mean": 0.21,
      "variance": 0.002,
      "correlationWithPerformance": 0.12,
      "classification": "stable-good",
      "recommendedMutationRange": [0.18, 0.26],
      "suggestedCenter": 0.21
    }
  },
  "recommendedMutationRanges": { ... }
}
```

**champion-library.json** (excerpt):
```json
[
  {
    "id": "seed_A_0",
    "params": { "siegeChance": 0.22, ... },
    "points": 420,
    "robustScore": 38.5,
    "addedAt": "2025-03-03T12:00:00.000Z"
  }
]
```

**League report (archetype-inclusive):**  
Standings include `archetypePoints` when `LEAGUE_INCLUDE_ARCHETYPES=1`. Final ranking uses combined score (or robust score when `LEAGUE_USE_ROBUST_SELECTION=1`).

## Backward Compatibility

- With **no new flags**, `npm run tournament-league` behaves as before: same division round-robin, same mutation, same champion selection by points.
- New behavior is opt-in via `LEAGUE_DOMAIN_RANDOMIZATION`, `LEAGUE_USE_ROBUST_SELECTION`, `LEAGUE_MUTATION_PROFILE`, and `LEAGUE_INCLUDE_ARCHETYPES` (archetypes default on but only add extra matches; combined scoring only affects ranking when archetype weight is used or robust selection is on).
- All scheduling (scenario choice, match seeds, archetype match order) is deterministic given the same env and season count.

## Summary of Changes

- **Added:** `scripts/optimize-trends.ts`, `scripts/validate-robustness.ts`, `scripts/lib/scenarios.ts`, `scripts/lib/archetypes.ts`, `artifacts/champion-library.json`, `docs/ROBUST_TRAINING.md`.
- **Modified:** `scripts/tournament-league.ts` — feature flags, domain randomization (getSimOpts), fixed archetype matches, robust score and combined points, trend-shaped mutation, champion library append/dedupe/cap, league report now includes `params` and `archetypePoints` for trend optimizer input.
- **Preserved:** Existing scripts and default behavior when new flags are off; deterministic, seeded scheduling throughout.
