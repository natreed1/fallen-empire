# AI training (fast simulations)

The game can **self-improve** the AI by running many headless bot-vs-bot simulations and evolving the parameters that win most.

## Speed optimizations

- **Smaller map**: Training uses a **56×56** map by default (vs 100×100 in-game), so each step is much faster (fewer tiles for territory, economy, combat).
- **Shorter games**: **MAX_CYCLES = 250** (vs 400) so games end sooner when there’s a clear winner.
- **Parallel workers** (optional): Set `NUM_WORKERS = 4` (or `process.env.NUM_WORKERS`) in `scripts/train-ai.ts` to evaluate candidates in parallel. Workers require the worker script to run in your environment (e.g. compiled to JS). If workers fail, the script falls back to single-threaded.

## 1. Headless core (`src/core/gameCore.ts`)

- **`SimState`** – Minimal game state (tiles, cities, units, players, heroes, territory, cycle, phase, weather, scouts, etc.).
- **`initBotVsBotGame(seed, paramsA?, paramsB?)`** – Generates a map with the given seed and places two AI capitals at opposite corners. Returns initial `SimState`.
- **`stepSimulation(state, paramsA, paramsB)`** – One step = one economy cycle + one movement/combat/siege/capture tick. No UI, no real-time delay; runs as fast as the CPU allows.
- **`runSimulation(paramsA, paramsB, seed, maxCycles?)`** – Runs a full game until one side has no cities or `maxCycles` is reached. Returns **`SimResult`** (winner, cycle, cities/pop per side).

The core reuses the same logic as the main game (economy, upkeep, AI planning, movement, combat, siege, city capture, victory).

## 2. Training script (`scripts/train-ai.ts`)

Evolutionary training:

1. **Population** of 12 candidate param sets (default).
2. Each candidate is **evaluated** by playing 8 matches (default) vs the current baseline, alternating sides.
3. **Score** = wins (+100), losses (−30), cycle count, and city/pop margin.
4. **Selection**: keep top 4, **mutate** (small random changes) to refill the population.
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

### Tuning the script

In `scripts/train-ai.ts`:

- **`MATCHES_PER_PAIR`** – More = more accurate fitness, slower (default 8).
- **`POPULATION_SIZE`** – More candidates per generation (default 12).
- **`GENERATIONS`** – More = more evolution, slower (default 20).
- **`MAX_CYCLES`** – Max cycles per game before declaring a winner by pop/cities (default 400).
- **`MUTATION_STRENGTH`** – How much params change each mutation (default 0.15).
- **`TOP_K`** – How many top candidates to keep each generation (default 4).

## Evolvable params (`AiParams`)

Defined in `src/lib/ai.ts` and used by both the live game and the core:

- **`siegeChance`** – Chance to build siege instead of combat units.
- **`recruitGoldThreshold`** – Gold above this → recruit up to `maxRecruitsWhenRich` per city per cycle.
- **`maxRecruitsWhenRich`** / **`maxRecruitsWhenPoor`** – Recruits per city per cycle.
- **`targetDefenderWeight`** – Weight for “weakest city” targeting (higher = prefer fewer defenders).
- **`nearestTargetDistanceRatio`** – When to send a unit to a secondary target (distance ratio).
- **`builderRecruitChance`** – Chance to recruit a builder when academy and pop allow.

You can add more evolvable knobs in `AiParams` and in `planAiTurn`, then re-run training.
