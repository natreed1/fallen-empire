# Workflow — Notes, Ideas & Backlog

A single place to capture ideas, things to build, and notes so we can see them and come back later. Tell the AI to **add to workflow** (or to **ideas**, **backlog**, or **notes**) and it will update this file.

---

## How to use

| You say… | What gets updated |
|----------|-------------------|
| *"Add [X] to ideas"* / *"I have an idea: …"* | **Ideas** below |
| *"Add [X] to backlog"* / *"We should build …"* / *"Come back to this"* | **Backlog** below |
| *"Note [X]"* / *"Document this"* / *"Add to notes"* | **Notes** below |
| *"What’s in the workflow?"* / *"Show workflow"* | This file |
| *"Run the changes check"* / *"Check changes"* | Use the prompt in [CURSOR_SIMULATION_FIX_OUTLINE.MD](./CURSOR_SIMULATION_FIX_OUTLINE.MD) |

---

**Use it in the browser:** Run the app and open [/workflow](http://localhost:3000/workflow) to view and edit this doc (like a simple Google Doc). Use **Edit** to change it and **Save** to write back to this file.

---

## Ideas

*Future features, "would be cool", rough concepts. No commitment yet.*

- *(none yet)*

---

## Backlog

*Things we decided to build or revisit. Ready to pick up when we have time.*

- **Level 3 units, L2→stone, L3→iron, defender at L3** — L2 units cost stone; L3 units cost iron (more expensive, better stats); defenders are L3-only and cost iron only. See [Plan: Level 3 units, stone/iron](./PLAN_LEVEL3_UNITS_STONE_IRON.md).
- **L3/defender balance pass** — After playtests or sim runs: tune defender iron (e.g. 3 if spammy), L3 costs/upkeep, or economy. See [Balance: L3 & defender](./BALANCE_L3_DEFENDER.md).
- **Food-aware recruit gating** — Add food budget check and “max sustainable units” cap in AI so sim doesn’t overshoot into starvation lock. See [Simulation economy analysis](./SIMULATION_ECONOMY_ANALYSIS.md).

---

## Notes

*Decisions, context, or one-off info that doesn’t belong in a design doc.*

- **Sim economy collapse (seed 42, 56×56):** Pop overshoots then crashes to 1; units keep rising; food → 0; permanent starvation, no decisive combat. Root cause: recruit is gold-driven, not food-driven; units don’t consume pop on recruit. Fix: food-aware recruit gating + sustainable-unit cap, then optional growth smoothing. See [SIMULATION_ECONOMY_ANALYSIS.md](./SIMULATION_ECONOMY_ANALYSIS.md).
- **AI build-order bug (fixed):** In `src/lib/ai.ts`, the `if (!toBuild)` block had a brace/else-if nesting bug: the branch that sets barracks/factory/market/academy was *outside* the block, so it only ran when `toBuild` was already set. Result: AI often never chose factory, market, or academy (and sometimes not even barracks in the non–farm-first path), so it under-invested in military and economy → passive, non-decisive games with little expansion. Fixed by moving all else-ifs inside the `if (!toBuild)` block.
- **Movement supply gate (fixed):** In `src/lib/military.ts` movementTick, units beyond `SUPPLY_VICINITY_RADIUS` (24) were idled if the next step was further from any friendly city. On 38×38 the enemy is ~30+ hexes away, so armies stopped at ~24 hexes and never reached the enemy — “built many soldiers but didn’t attack or expand.” Removed that gate; units can now move toward their target even when out of supply. Upkeep still applies HP loss for unsupplied units.
- **Move targets only for idle (fixed):** In the browser we only applied AI move targets when `unit.status === 'idle'`. The sim applies when `status !== 'fighting'` (idle, moving, or starving). So in the browser, units that went out of supply became `starving` and then never got new orders. Aligned browser with sim: apply move targets to any non-fighting unit so bots keep pushing and expanding like in headless sims.
- **Farm priority blocking barracks (fixed):** When `farmPriorityThreshold` is set (e.g. champion 19), the AI was choosing “build farm” whenever food surplus was below that, *before* the normal build-order block. So it never reached “no barracks → build barracks” and kept building farms only → no units, no expansion. Fix: only apply the food-tight farm priority when the city already has a barracks (`hasBarracks`), so the first barracks is always built and recruitment can start.
- **L3/defender balance:** Current numbers follow PLAN_LEVEL3 and PLAN_DEFENDER. Defender = 2 iron only (no gold, no gunsL2); L3 combat = gold + iron + 2 gunsL2/cycle. One mine ≈ 1 defender/cycle; L3 competes with defender and gold mine for iron. See [BALANCE_L3_DEFENDER.md](./BALANCE_L3_DEFENDER.md) for cost/stat table and tuning knobs.
- **4-player incentives and win conditions:** Checked how AI incentives and win-condition handling carry over to 4-bot. **Win conditions:** Conquest victory and time's-up are both implemented for 4-bot in the store: conquest = exactly one AI has cities (`whoHasCities.length === 1`); time's up = rank all four by cities then pop, declare winner. **AI incentives:** In `src/lib/ai.ts`, `enemyCities = cities.filter(c => c.ownerId !== aiPlayerId)` — so in 4-player each AI sees all 3 opponents' cities. Targeting uses a single sorted list (weakest first by pop + defenders), primary target + up to 3 alternates via `nearestTargetDistanceRatio`; scouts pick nearest enemy. No code assumes exactly two players, so incentives carry over. **Caveat:** Headless sim and training (`gameCore`) are 2-player only; evolved params are tuned for 2-player. 4-bot uses the same params; behavior is consistent but not specifically evolved for 4-player.

---

## Related docs

- [Plan: Level 3 units, stone/iron](./PLAN_LEVEL3_UNITS_STONE_IRON.md) — L3 tier, L2 stone, L3 iron, defender L3-only
- [Balance: L3 & defender](./BALANCE_L3_DEFENDER.md) — cost/stat table, economy, tuning notes
- [Siege & Combat Design](./SIEGE_AND_COMBAT_DESIGN.md) — city capture, siege, supply, combat rules (and **Implementation checklist** for changes check)
- [AI Training](./AI_TRAINING.md) — sim, fitness, workers
- [Cursor simulation fix outline](./CURSOR_SIMULATION_FIX_OUTLINE.MD) — changes check prompt and sim/training points
- [Simulation economy analysis](./SIMULATION_ECONOMY_ANALYSIS.md) — starvation lock, food-aware recruit gating
- [Optimization](./OPTIMIZATION.md) — evolutionary model, GPU notes

*Last updated: 2026-03-04*
