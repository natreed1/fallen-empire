# Cursor Implementation Outline — Fix Headless Simulation for Reliable AI Training

Use this as an implementation brief inside Cursor. Goal: make headless simulations produce realistic combat/movement so training can reduce draw rate and improve consistently.

---

## Objective

Fix simulation-time bugs that cause combat starvation in headless training/eval.

### Current observed failure mode
- `runSimulation()` advances cycles as fast as CPU.
- `movementTick()` and combat-related gates depend on `Date.now()` and `nextMoveAt`/`retreatAt` wall-clock values.
- Result in headless: units recruit/build but rarely engage; draw rate is extreme.

---

## Required Changes (P0)

### 1) Introduce simulation clock in military layer

**Problem:** `src/lib/military.ts` uses `Date.now()` directly.

**Required refactor:**
- Add optional `nowMs` parameter to functions that currently read wall-clock time:
  - `movementTick(...)`
  - `combatTick(...)` (if needed for retreat handling consistency)
  - `resolveMeleeRound(...)` only if required by call chain
- Default `nowMs = Date.now()` to preserve live-game behavior.

**Target signature pattern:**
```ts
export function movementTick(
  units: Unit[],
  heroes: Hero[],
  tiles: Map<string, Tile>,
  wallSections: WallSection[] = [],
  cities: City[] = [],
  nowMs: number = Date.now(),
): void
```
Inside, replace all `Date.now()` checks/usages with `nowMs`.

### 2) Pass simulated time from gameCore

**Problem:** `src/core/gameCore.ts` already tracks `simTimeMs`, but does not pass it into military timing gates.

**Required refactor:**
- In `stepSimulation(...)`:
  - Compute `newSimTimeMs` (already exists).
  - Call military ticks with this value:
    - `movementTick(..., newSimTimeMs)`
    - `combatTick(..., newSimTimeMs)` if signature updated
  - Ensure any retreat/cooldown timestamps are compared against sim time, not wall time.

### 3) Normalize movement delay units

**Problem:** `nextMoveAt` delays use real milliseconds, but sim cycle increments are fixed (30,000 ms per cycle).

**Required behavior:** Keep using ms, but base all comparisons on `simTimeMs` in headless flow.

**Validation expectation:** Units should advance multiple steps across a 220-cycle match and frequently enter combat.

### 4) Add deterministic headless test harness for regression

Create `scripts/diag-sim-health.ts` that reports:
- games with any combat deaths
- games with any owner flips/captures
- average units at end
- draw rate

**Acceptance threshold (first pass):** For baseline params on 56×56, 220 cycles, 40 games:
- `gamesWithAnyDeaths > 0` (ideally high majority)
- draw rate materially below current extreme baseline

---

## Required Changes (P1)

### 5) Add richer eval metrics for draw quality

Update/add eval script outputs:
- economy deltas in draws (gold/pop/cities/goods/guns/stone/iron)
- combat intensity metrics:
  - total kills per game
  - first combat cycle
  - first city-owner flip cycle
This helps tune for "decisive but stable" behavior.

### 6) Add strategy-flow telemetry script

Add `scripts/audit-strategy-flow.ts`:
- first build cycle by building type
- first recruit cycle by unit type
- first village expand / first owner flip / first combat cycle
Use for model-to-model comparison (candidate vs baseline).

---

## Non-goals

- Do not redesign economy balance yet.
- Do not change AI policy knobs before sim timing is fixed.
- Do not tune CEM/train configs until headless realism is verified.

---

## File Touch Plan

**Primary files likely touched:**
- `src/lib/military.ts`
- `src/core/gameCore.ts`

**New diagnostics scripts:**
- `scripts/diag-sim-health.ts`
- `scripts/audit-strategy-flow.ts`

**Optional docs update:**
- `docs/AI_TRAINING.md` (add "simulation clock consistency" note)

---

## Acceptance Checklist

- [ ] Headless simulation uses sim-time for movement/combat gating.
- [ ] Regression diagnostic shows non-trivial deaths across sampled games.
- [ ] Draw rate significantly improved vs previous all-draw behavior.
- [ ] Eval outputs include draw-economy + combat intensity metrics.
- [ ] Strategy-flow telemetry scripts run from npm scripts.

---

## Suggested command sequence after implementation

```bash
# 1) Quick health check
npx ts-node -r tsconfig-paths/register --project tsconfig.train.json scripts/diag-sim-health.ts

# 2) Baseline eval
npm run eval-ai

# 3) Train after fixes
TRAIN_GENERATIONS=10 TRAIN_POPULATION_SIZE=12 TRAIN_MATCHES_PER_PAIR=6 npm run train-ai

# 4) Re-eval candidate
npm run eval-ai

# 5) Strategy flow comparison
npx ts-node -r tsconfig-paths/register --project tsconfig.train.json scripts/audit-strategy-flow.ts
```

---

## Prompt to paste into Cursor

*"Implement the simulation-timing refactor so headless training/eval uses simulation time instead of wall-clock time in movement/combat gates. Update military.ts and gameCore.ts accordingly, add diag-sim-health.ts and audit-strategy-flow.ts, and keep live-game behavior unchanged by defaulting timing params to Date.now() where not explicitly passed. Then run diagnostics and report before/after draw/combat metrics."*
