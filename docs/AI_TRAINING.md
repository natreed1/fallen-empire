# AI training (fast simulations)

The game can **self-improve** the AI by running many headless bot-vs-bot simulations and evolving the parameters that win most.

## Speed optimizations

- **Smaller map**: Training uses a **38×38** map by default (vs 67×67 in-game), so each step is much faster (fewer tiles for territory, economy, combat).
- **Shorter games**: **MAX_CYCLES = 250** so games end sooner when there's a clear winner.
- **Parallel workers** (optional): Set `NUM_WORKERS` env var (or `process.env.NUM_WORKERS`) in `scripts/train-ai.ts` to evaluate candidates in parallel. Workers require the worker script to run in your environment (e.g. compiled to JS). If workers fail, the script falls back to single-threaded.

## 1. Headless core (`src/core/gameCore.ts`)

- **`SimState`** – Full game state including tiles, cities, units, players, heroes, territory, cycle, phase, weather, scouts, **pending land recruits** (same delayed-completion pipeline as the live store), **contested zone hex keys**, **commanders**, **scroll progress/inventory/attachments**, and more.
- **`initBotVsBotGame(seed, paramsA?, paramsB?)`** – Generates a map with the given seed and places two AI capitals at opposite corners. Sets up **contested zone**, **starting commanders** (5 per AI), and **scroll inventory**. Returns initial `SimState`.
- **`stepSimulation(state, paramsA, paramsB)`** – One step = one economy cycle + contested zone payouts + scroll search progress + AI planning (including new actions) + movement/combat/siege/capture + commander sync + scroll carrier cleanup.
- **`runSimulation(paramsA, paramsB, seed, maxCycles?)`** – Runs a full game until one side has no cities or `maxCycles` is reached. Returns **`SimResult`** (winner, cycle, cities/pop per side).

The core reuses the same logic as the main game (economy, upkeep, AI planning, movement, combat, siege, city capture, victory, **contested zone payouts**, **scroll discovery**, **commander syncing**). **Simulation clock consistency:** headless runs use simulated time (`simTimeMs`, 30s per cycle) for movement/combat gating so units advance and engage correctly; the live game still uses wall-clock time.

### Live parity checklist (headless vs `useGameStore.runCycle`)

Shared code applies AI **instant** building placement, **upgrades**, and **pending land recruits** (`src/lib/applyAiPlan.ts`, `src/lib/pendingLandRecruit.ts`). Each step:

1. Completes pending recruits whose `completesAtCycle` equals the new cycle, then HP regen and `computeArmyReplenishment`.
2. Runs economy, contested zone, upkeep, then **`planAiTurn`**.
3. Applies the same instant builds/recruit queue as the client; **wall rings** still use construction sites + BP.
4. Ticks constructions (walls), scouts, movement/combat/siege.

**Mutation:** `MUTATION_EXCLUDED_KEYS` in `aiParamsSchema.ts` holds parameters not yet read by `planAiTurn`, so evolution does not waste budget on them; `l3AcquisitionWeight` and `l2AdoptionRate` are wired (L3 tier pick and L3 ranged variant when no doctrine).

## 2. Training script (`scripts/train-ai.ts`)

Evolutionary training:

1. **Population** of 12 candidate param sets (default).
2. Each candidate is **evaluated** by playing 12 matches (default) vs the current baseline, alternating sides.
3. **Score** = wins (+100), losses (−30), draw penalty, cycle count, city/pop margin. Variance-penalized: `effectiveScore = mean − 0.5 * std`.
4. **Selection**: keep top 4 (`ELITE_COUNT`), **mutate** (small random changes) to refill the population.
5. Repeat for **20 generations** (default).

**Run from project root:**

```bash
npm run train-ai
```

Or:

```bash
npx ts-node -r tsconfig-paths/register --project tsconfig.train.json scripts/train-ai.ts
```

**Output:**

- Best params printed to stdout.
- If possible, written to **`public/ai-params.json`**.

The game loads this file on startup (see `GameScene` fetch of `/ai-params.json`), so after training you can refresh and play against the evolved AI.

For **improvements to the optimization model** (fitness, diversity, CPU throughput, and when/where **GPU** can help), see **`docs/OPTIMIZATION.md`** — section "Suggested improvements to the optimization model" and "Where GPU fits (and doesn't)".

### Tuning the script

Env overrides (all optional):

| Env var | Default | Description |
|---------|---------|-------------|
| `TRAIN_POPULATION_SIZE` | 12 | Candidates per generation |
| `TRAIN_GENERATIONS` | 20 | Evolution rounds |
| `TRAIN_MATCHES_PER_PAIR` | 12 | Matches per candidate (higher = more accurate, slower) |
| `TRAIN_MAX_CYCLES` | 250 | Max cycles per game |
| `TRAIN_MAP_SIZE` | 38 | Map width/height |
| `NUM_WORKERS` | auto | Parallel workers (0 = single-threaded) |
| `TRAIN_ELITE_COUNT` | 4 | Top candidates kept each generation |
| `TRAIN_MUTATION_STRENGTH` | 0.15 | Mutation range scale (0.05–0.5) |
| `TRAIN_VARIANCE_PENALTY` | 0.5 | Penalize inconsistent performance |
| `TRAIN_DRAW_PENALTY` | 10 | Score penalty for draws |
| `TRAIN_FROM_CHAMPION` | 1 | Set 0 to start from defaults instead of champion |

## Evolvable params (`AiParams`)

Defined in `src/lib/ai.ts`, schema in `src/lib/aiParamsSchema.ts`. Used by both the live game and the headless core.

### Economy & Recruitment
- `siegeChance`, `recruitGoldThreshold`, `maxRecruitsWhenRich`, `maxRecruitsWhenPoor`
- `foodBufferThreshold`, `sustainableMilitaryMultiplier`
- `farmFirstBias`, `farmPriorityThreshold`, `factoryUpgradePriority`
- `builderRecruitChance`, `builderRecruitForMinesAndSiege`
- `minePriorityThreshold`

### Targeting & Expansion
- `targetDefenderWeight`, `nearestTargetDistanceRatio`, `targetPopWeight`
- `scoutChance`, `incorporateVillageChance`
- `villageDefensePriority`, `villageRecapturePriority`

### Army Composition & Formation
- `l2AdoptionRate` (also **L3 marksman vs longbowman** when city has no archer doctrine), `l3AcquisitionWeight` (biases **L3 vs L2** arm tier when recruiting), `l3IronPerUnitTarget`, `l2StonePerUnitTarget`
- `militaryLevelMixTarget` (L1/L2/L3 shares), `militaryLevelMixCorrectionStrength`
- `targetRangedShare`, `targetSiegeShare`, `compositionCorrectionStrength`
- `assaultWingShare`, `screenWingShare`, `frontlineMeleeShare`, `flankCavalryShare`
- `backlineRangedDistance`, `siegeBacklineDistance`, `formationCohesion`
- `maxChaseDistance`, `targetDispersion`

### Defense & Walls
- `defenderCityHexCoverageTarget`, `defenderAssignmentPriority`
- `wallBuildPerCityTarget`, `wallBuildPriority`, `wallToDefenderSynergyWeight`
- `wallClosurePriority`, `wallRepairPriority`, `wallRingTarget`, `wallClosureUptimeWeight`

### Supply & Logistics
- `supplyExpansionPriority`, `supplyAnchorDistanceWeight`
- `supplyStarvationRiskWeight`, `supplyCityAcquisitionBias`

### Contested Zone (new)
- `contestedZoneCommitShare` – Share of idle military to divert toward contested hex band (0–0.5).
- `contestedZoneMinSurplusMilitary` – Min surplus units before diverting any (0–15).

### Commanders (new)
- `commanderFieldAssignRate` – Chance per cycle to assign a city-defense commander to a field army (0–1).
- `commanderMinArmySize` – Min stack size before attaching a commander (1–8).

### Scrolls (new)
- `scrollTerrainPriority` – Priority for positioning units on special terrain for scroll discovery (0–1).
- `scrollTerrainMaxDivert` – Max units diverted toward scroll terrain per cycle (0–5).

### University / Builder Tasks (new)
- `universityIronMinePref` – Preference for iron mines over quarries when setting university task (0–1).
- `universityCityDefenseThreshold` – When to switch university to city defenses (0–1).

## Diagnostics

`SimDiagnostics` (in `gameCore.ts`) tracks per-game telemetry for auditing:

- Kill counts, owner flips, starvation cycles, supply stress
- Ring completion, closure uptime, breach counts
- Build orders by phase (early/late)
- **Contested zone wins** per side
- **Scrolls discovered** per side
- **Commander field assignments** per side

Used by `scripts/diag-sim-health.ts`, `scripts/audit-strategy-flow.ts`, and `scripts/tournament-league.ts`.

Old saved JSON is always merged with `DEFAULT_AI_PARAMS` so new params get sensible defaults.
