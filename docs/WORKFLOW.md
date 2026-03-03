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

- **Food-aware recruit gating** — Add food budget check and “max sustainable units” cap in AI so sim doesn’t overshoot into starvation lock. See [Simulation economy analysis](./SIMULATION_ECONOMY_ANALYSIS.md).

---

## Notes

*Decisions, context, or one-off info that doesn’t belong in a design doc.*

- **Sim economy collapse (seed 42, 56×56):** Pop overshoots then crashes to 1; units keep rising; food → 0; permanent starvation, no decisive combat. Root cause: recruit is gold-driven, not food-driven; units don’t consume pop on recruit. Fix: food-aware recruit gating + sustainable-unit cap, then optional growth smoothing. See [SIMULATION_ECONOMY_ANALYSIS.md](./SIMULATION_ECONOMY_ANALYSIS.md).

---

## Related docs

- [Siege & Combat Design](./SIEGE_AND_COMBAT_DESIGN.md) — city capture, siege, supply, combat rules (and **Implementation checklist** for changes check)
- [AI Training](./AI_TRAINING.md) — sim, fitness, workers
- [Cursor simulation fix outline](./CURSOR_SIMULATION_FIX_OUTLINE.MD) — changes check prompt and sim/training points
- [Simulation economy analysis](./SIMULATION_ECONOMY_ANALYSIS.md) — starvation lock, food-aware recruit gating
- [Optimization](./OPTIMIZATION.md) — evolutionary model, GPU notes

*Last updated: 2026-03-01*
