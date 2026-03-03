# Simulation economy analysis — why combat doesn’t fire

Observed behavior and fix direction from running headless sims (seed 42, 56×56). **Implemented:** food-aware recruit gating, max sustainable military cap, and thin-buffer pop growth scaling (see below).

---

## What was observed (actual sim numbers)

**By cycle snapshots (seed 42, 56×56):**

| Cycle | Pop      | Units | Food   | Notes                    |
|-------|----------|-------|--------|--------------------------|
| 10    | ~68–80   | ~18   | ~59–64 | Still stable             |
| 20    | ~142–168 | ~40+  | ~30–42 | Demand starts crushing supply |
| 30    | ~34–40 → 1 | ~66–67 | 0    | Pop crashes; units keep rising; almost all starving |
| 40+   | 1 (pinned) | ~66+ | 0    | Permanent starvation lock |

---

## Root causes

1. **Population spikes too hard early** — Grain-driven growth overshoots, then collapses when food runs out.
2. **Recruitment is too aggressive** relative to food economy — AI recruits up to `maxRecruitsWhenRich`/`maxRecruitsWhenPoor` based on gold, not food.
3. **Units persist while city pop collapses** — Recruit doesn’t consume pop immediately; only unit death reduces pop. So military upkeep can exceed food forever.
4. **Once food hits zero** — Unit statuses go starving and the sim stalls tactically (no decisive engagement).

**Why this kills combat:** Army upkeep dominates food permanently; armies get stuck in starving state; economy collapses before armies can meet decisively.

---

## Fix direction (implementation order)

### 1. Food-aware recruit gating in AI (P0) — **done**

**Where:** `src/lib/ai.ts` — inside the recruit loop (e.g. where `actions.recruits.push(...)` is called).

**Logic:**

- Before recruiting, estimate next-turn food budget:
  - `foodIncome - (civFoodDemand + projectedMilitaryFoodDemand)`
- If deficit or low buffer, **reduce or skip** recruits (e.g. skip siege/cavalry first, then trim count).
- Need access to: current food income (from economy), civilian food demand (e.g. pop × rate), current military food demand, and per-unit upkeep (from `UNIT_BASE_STATS` / `UNIT_L2_STATS`).

**Note:** `planAiTurn` currently gets `cities`, `units`, `players`, `tiles`, `territory`. You may need to pass in cluster/food stats or compute a simple food surplus in the AI layer (or add a small helper that uses existing economy math from `gameLoop.ts`).

### 2. Cap army size by sustainable upkeep (P0) — **done**

- Add a **“max sustainable units”** heuristic from food production (e.g. total food income − civilian demand, divided by average military food per unit).
- **Hard-stop recruiting** when total military units are at or above this cap (or when adding one more would push projected upkeep over surplus).

### 3. Smooth pop growth (P1) — **done**

- **Where:** Population growth logic (e.g. `src/lib/gameLoop.ts` or wherever logistic growth is applied).
- **Change:** Lower effective growth when food buffer is thin (not only when storage is already zero). Avoid overshoot into immediate collapse.

### 4. Optional balancing safety (after gating)

- Slightly reduce military food upkeep **or** increase early farm throughput. Only after recruit gating is in place, so the cause is demand control first.

---

## Non-goals (per Cursor outline)

- Do not redesign economy balance before sim timing and recruit gating are fixed.
- Do not change AI policy knobs (evolved params) before food-aware gating is in.

---

## Implementation summary

- **`src/lib/ai.ts`**: `estimateAiFoodSurplus()` (food income − civ − military; `maxSustainableMilitary`). In the military recruit block: if `militaryCount >= maxSustainableMilitary` then no recruits; else if `surplus < 0` then 0; else if `surplus < 10` then at most 1; else cap by `maxSustainableMilitary - militaryCount` and gold-based max.
- **`src/lib/gameLoop.ts`**: In `populationGrowthPhase`, when `city.storage.food > 0` but `< civDemandCity` (pop × 0.25), scale raw births by `storage.food / civDemandCity` so growth is reduced when the buffer is thin.

## References

- AI recruit logic: `src/lib/ai.ts` (recruits, `maxRecruitsWhenRich` / `maxRecruitsWhenPoor`, gold threshold).
- Economy / food: `src/lib/gameLoop.ts` (production, consumption, population growth).
- Unit upkeep: `src/types/game.ts` (`UNIT_BASE_STATS`, `UNIT_L2_STATS`, food per unit).
