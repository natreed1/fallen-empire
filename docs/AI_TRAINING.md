# AI training (fast simulations)

The game can **self-improve** the AI by running many headless bot-vs-bot simulations and evolving the parameters that win most.

## Speed optimizations

- **Smaller map**: Training uses a **38×38** map by default (vs 67×67 in-game), so each step is much faster (fewer tiles for territory, economy, combat).
- **Game length**: Default **TRAIN_MAX_CYCLES = 520** (override with env) so more matches can reach a decisive winner before the cap.
- **Single-process evaluation**: Matches run sequentially in the main Node process so `npm run train-ai` works the same with `npx` and local installs (no separate worker `ts-node` resolution).

## 1. Headless core (`src/core/gameCore.ts`)

- `**SimState`** – Full game state including tiles, cities, units, players, heroes, territory, cycle, phase, weather, scouts, **pending land recruits** (same delayed-completion pipeline as the live store), **contested zone hex keys**, **commanders**, **scroll progress/inventory/attachments**, and more.
- `**initBotVsBotGame(seed, paramsA?, paramsB?)`** – Generates a map with the given seed and places two AI capitals at opposite corners. Sets up **contested zone**, **starting commanders** (5 per AI), and **scroll inventory**. Returns initial `SimState`.
- `**stepSimulation(state, paramsA, paramsB)`** – One step = one economy cycle + contested zone payouts + scroll search progress + AI planning (including new actions) + movement/combat/siege/capture + commander sync + scroll carrier cleanup.
- `**runSimulation(paramsA, paramsB, seed, maxCycles?)`** – Runs a full game until one side has no cities or `maxCycles` is reached. Returns `**SimResult`** (winner, cycle, cities/pop per side).
- **Naval gauntlet** – `RunSimulationOptions.postInit: 'naval-gauntlet'` seeds scout/warship/transport ships and infantry after `initBotVsBotGame` (for scenario battery / island maps). Bots receive `**naval_technology`** and `**advanced_naval`** in `researchedTechs` so ports/shipyards and ships are legal in headless sim. Domain scenario `**naval-islands`** is in `scripts/lib/scenarios.ts` (see also `**naval_crossing`** in `scripts/sim-system/scenario-battery.ts`).

The core reuses the same logic as the main game (economy, upkeep, AI planning, movement, combat, siege, city capture, victory, **contested zone payouts**, **scroll discovery**, **commander syncing**). **Simulation clock consistency:** headless runs use simulated time (`simTimeMs`, 30s per cycle) for movement/combat gating so units advance and engage correctly; the live game still uses wall-clock time.

**Cross-water / embark telemetry (headless `SimResult`):** Each `runSimulation` / `runSimulationWithDiagnostics` result includes end-state fields derived from spawn capitals and landmass flood-fill:

- `**ai1OverseasCities` / `ai2OverseasCities`** — cities owned by that side whose hex is **not** on the same **water-bounded** landmass as their original capital (so island hops / overseas conquests count).
- `**ai1OverseasLandMilitary` / `ai2OverseasLandMilitary`** — land armies (not builders, not on ships) **standing** on another landmass than spawn.
- `**ai1CargoAboard` / `ai2CargoAboard`** — land units currently **embarked** on friendly ships (`aboardShipId`).

Recompute from any `SimState` with `computeTravelMetrics(state)` in `gameCore.ts`. Training logs print these when `TRAIN_NAVAL_EDUCATION=1` or `TRAIN_LOG_TRAVEL=1`. Diagnostics already track `**shipsQueuedAi1` / `shipsQueuedAi2`** (ship recruits queued over the game).

### Live parity checklist (headless vs `useGameStore.runCycle`)

Shared code applies AI **instant** building placement, **upgrades**, **pending land recruits**, and **pending ship recruits** (`src/lib/applyAiPlan.ts`, `src/lib/pendingLandRecruit.ts`, `src/lib/pendingShipRecruit.ts`). Each step:

1. Completes pending land and ship recruits whose `completesAtCycle` equals the new cycle, then HP regen and `computeArmyReplenishment`.
2. Runs economy, contested zone, upkeep, then `**planAiTurn`**.
3. Applies the same instant builds/recruit queue as the client; **wall rings** still use construction sites + BP.
4. Ticks constructions (walls), scouts, movement/combat/siege.

**Mutation:** `MUTATION_EXCLUDED_KEYS` in `aiParamsSchema.ts` holds parameters not yet read by `planAiTurn`, so evolution does not waste budget on them; `l3AcquisitionWeight` and `l2AdoptionRate` are wired (L3 tier pick and L3 ranged variant when no doctrine).

## 2. Training script (`scripts/train-ai.ts`)

By default, each evaluation match uses **domain-randomized map scenarios** (`TRAIN_USE_SCENARIO_MIX=1`): the scenario is chosen deterministically from the mix using the match seed (aligned with `scripts/tournament-league.ts`). When the draw is `**naval-islands`** and `TRAIN_NAVAL_POSTINIT=1`, the run also uses `**postInit: 'naval-gauntlet'`** so evolution sees seeded fleets. Set `TRAIN_USE_SCENARIO_MIX=0` for the older behavior (fixed square map size only).

Evolutionary training:

1. **Seed** from `**TRAIN_SEED_JSON`** if set, else `**artifacts/last-train-baseline.json**` (after a previous full run), else `**public/ai-params.json`**, else code defaults. See `**TRAIN_FROM_CHAMPION`**.
2. **Population** of 12 candidate param sets (default).
3. Each candidate is **evaluated** by playing `TRAIN_MATCHES_PER_PAIR` match pairs vs the **current generation baseline** (alternating sides), plus optional pairs vs fixed `**DEFAULT_AI_PARAMS`** (`TRAIN_VS_DEFAULT_MATCHES`, default 4) so fitness tracks the same opponent as `validate-robustness`.
4. **Score** = per-arm `effectiveScore = mean − TRAIN_VARIANCE_PENALTY * std` on match-pair sums, then **blended**: `TRAIN_SELFPLAY_WEIGHT` (default 0.7) on self-play + `TRAIN_VS_DEFAULT_WEIGHT` (default 0.3) on vs-default. Win/loss/draw/city/pop/cycle terms include a **faster-win** bonus (`TRAIN_WON_QUICKLY_BONUS` per cycle before cap).
5. **Selection**: keep top 4 (`ELITE_COUNT`), **mutate** (small random changes) to refill the population.
6. Repeat for **20 generations** (default).

**Run from project root:**

```bash
npm run train-ai
```

Or:

```bash
npx ts-node -r tsconfig-paths/register --project tsconfig.train.json scripts/train-ai.ts
```

**Output:**

- Best params printed to stdout (exported JSON is **best-over-all** by blend score across generations; see `Best-over-all:` in the log).
- If possible, written to `**public/ai-params.json`** (or `**TRAIN_OUT_JSON`**).
- **Chaining runs:** each completed **full** training run also writes `**artifacts/last-train-baseline.json`**. The next `train-ai` loads that after `**TRAIN_SEED_JSON`** (if set) and before `**public/ai-params.json**`, unless `**TRAIN_FROM_CHAMPION=0**`. **Naval education** does not update this file; merge with a full run via `**TRAIN_SEED_JSON`** if needed.
- **Reproducibility:** On start, the process logs all `TRAIN_*` env vars and writes `**artifacts/last-train-run-env.json`** (and appends to `**artifacts/training-live.log`**).

The game loads this file on startup (see `GameScene` fetch of `/ai-params.json`), so after training you can refresh and play against the evolved AI.

For **improvements to the optimization model** (fitness, diversity, CPU throughput, and when/where **GPU** can help), see `**docs/OPTIMIZATION.md`** — section "Suggested improvements to the optimization model" and "Where GPU fits (and doesn't)".

### Tuning the script

Env overrides (all optional):


| Env var                    | Default                                                        | Description                                                                                                                                                                                                                                                                                                       |
| -------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TRAIN_POPULATION_SIZE`    | 12                                                             | Candidates per generation                                                                                                                                                                                                                                                                                         |
| `TRAIN_GENERATIONS`        | 20                                                             | Evolution rounds                                                                                                                                                                                                                                                                                                  |
| `TRAIN_MATCHES_PER_PAIR`   | 12                                                             | Matches per candidate (higher = more accurate, slower)                                                                                                                                                                                                                                                            |
| `TRAIN_MAX_CYCLES`         | 520                                                            | Max cycles per game                                                                                                                                                                                                                                                                                               |
| `TRAIN_MAP_SIZE`           | 38                                                             | Map width/height                                                                                                                                                                                                                                                                                                  |
| `TRAIN_ELITE_COUNT`        | 4                                                              | Top candidates kept each generation                                                                                                                                                                                                                                                                               |
| `TRAIN_MUTATION_STRENGTH`  | 0.15                                                           | Mutation range scale (0.05–0.5)                                                                                                                                                                                                                                                                                   |
| `TRAIN_VARIANCE_PENALTY`   | 0.5                                                            | Penalize inconsistent performance                                                                                                                                                                                                                                                                                 |
| `TRAIN_DRAW_PENALTY`       | 10                                                             | Score penalty for draws                                                                                                                                                                                                                                                                                           |
| `TRAIN_VS_DEFAULT_MATCHES` | 4                                                              | Extra match pairs per candidate vs fixed `DEFAULT_AI_PARAMS` (0 = self-play only).                                                                                                                                                                                                                                |
| `TRAIN_SELFPLAY_WEIGHT`    | 0.7                                                            | Blend weight on self-play `effectiveScore` (normalized with `TRAIN_VS_DEFAULT_WEIGHT` when vs-default matches > 0).                                                                                                                                                                                               |
| `TRAIN_VS_DEFAULT_WEIGHT`  | 0.3                                                            | Blend weight on vs-`DEFAULT_AI_PARAMS` `effectiveScore`.                                                                                                                                                                                                                                                          |
| `TRAIN_WON_QUICKLY_BONUS`  | 0.1                                                            | Per-cycle bonus when the candidate wins before `TRAIN_MAX_CYCLES` (larger = more pressure for fast wins).                                                                                                                                                                                                         |
| `TRAIN_FROM_CHAMPION`      | 1                                                              | Set 0 to start from `DEFAULT_AI_PARAMS` (ignore `**artifacts/last-train-baseline.json`** and `**public/ai-params.json**`).                                                                                                                                                                                        |
| `TRAIN_USE_SCENARIO_MIX`   | 1                                                              | Set **0** to use a plain `TRAIN_MAP_SIZE` square map only (legacy). When **1** (default), each match picks a scenario deterministically from the mix (same mechanism as `tournament-league` / `validate-robustness`).                                                                                             |
| `TRAIN_SCENARIO_MIX`       | (see `parseScenarioMix` default in `scripts/lib/scenarios.ts`) | Optional override string, e.g. `balanced:0.4,naval-islands:0.15,...` — same format as `LEAGUE_SCENARIO_MIX`.                                                                                                                                                                                                      |
| `TRAIN_NAVAL_POSTINIT`     | 1                                                              | When **1** (default) and the drawn scenario is `**naval-islands`**, runs `postInit: 'naval-gauntlet'` (seeded ships + infantry). Set **0** to use island geometry only without the seed.                                                                                                                          |
| `TRAIN_NAVAL_EDUCATION`    | 0                                                              | Set **1** for a **naval-only curriculum**: every match uses `**naval-islands`** + gauntlet; evolution mutates only `**navalRecruitBias`**, `**transportPriority`**, `**minShipsBeforeInvade**` (other params stay at seed). Use before a full mixed run so naval knobs learn without fighting land-economy noise. |
| `TRAIN_OUT_JSON`           | `public/ai-params.json`                                        | Output path for best params. Naval education defaults to `**artifacts/ai-params-naval-education.json**` via `npm run train-ai-naval`.                                                                                                                                                                             |


### Naval-first education (split training)

Naval games are sparse in the default scenario mix, so `**navalRecruitBias` / `transportPriority` / `minShipsBeforeInvade**` get few gradient steps. Run a short **naval-only** pass, then a full `**train-ai`** with the result as seed:

```bash
npm run train-ai-naval
# then merge naval tuning into broader evolution (champion + naval file):
TRAIN_SEED_JSON=artifacts/ai-params-naval-education.json npm run train-ai
```

`train-ai-naval` sets `TRAIN_NAVAL_EDUCATION=1`, forces `**naval-islands:1**`, enables gauntlet, writes `**artifacts/ai-params-naval-education.json**`, uses **450** max cycles (more time for conquest), and slightly shorter defaults (**12** generations, **14** matches/candidate). Override with the usual env vars if needed.

**Why timeouts used to look like “all draws”:** Conquest often does not finish before `maxCycles`, so `winner` is `null`. The trainer still needs a gradient: headless `SimResult` now includes `**ai1Ships` / `ai2Ships`** (alive naval units). In naval education mode, **timeout games** add extra score from **fleet count**, **population**, and **city count** margins so `navalRecruitBias` / `transportPriority` / `minShipsBeforeInvade` can move the needle even without a decisive capture.

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