# Balance: Level 3 & Defender System

Quick reference for tuning the L2 (stone) / L3 (iron) / defender system. Use this when adjusting costs or stats.

---

## 1. Current numbers

### Costs (gold / stone / iron)

| Unit        | L1      | L2           | L3           |
|------------|---------|--------------|--------------|
| Infantry   | 1g      | 1g + 2 stone | 2g + 1 iron  |
| Cavalry    | 3g      | 3g + 3 stone | 5g + 2 iron  |
| Ranged     | 2g      | 2g + 2 stone | 3g + 1 iron  |
| Defender   | —       | —            | **2 iron only** |

### Stats (HP / attack / upkeep)

| Unit     | L1        | L2           | L3            |
|----------|-----------|--------------|---------------|
| Infantry | 100 / 15  | 120 / 18     | 140 / 21      |
| Cavalry  | 75 / 20   | 90 / 24      | 105 / 28      |
| Ranged   | 50 / 12   | 60 / 14      | 70 / 17       |
| Defender | —         | —            | 130 / 8, 25% resist (40% on city) |

- Food: 1 per infantry/ranged/defender, 2 per cavalry/siege.
- L2 combat: +1 gunsL2/cycle (infantry/cavalry), +2 (ranged).
- L3 combat: +2 gunsL2/cycle (all three).

### Economy (per cycle, per building)

- **Quarry:** 5 stone (with workers).
- **Mine:** 2 iron.
- **Factory L2:** 1 iron → 10 gunsL2.

---

## 2. Balance notes

- **L1 → L2:** Same gold, add stone + gunsL2 upkeep. Stone is plentiful (quarry 5/cycle); L2 is the “mid tier” that doesn’t use iron.
- **L2 → L3:** More gold + iron and double gunsL2 upkeep. One L2 factory supports 5 L3 combat units (10 gunsL2/cycle) or 10 L2 infantry. Iron competes with defenders and gold mine (20 iron).
- **Defender:** 2 iron only, no gold, no gunsL2. One mine ≈ one defender per cycle. Very efficient for holding a hex (effective HP ~173 off city, ~217 on city with resist). Intentionally an iron sink that doesn’t compete with gold; can be tuned (e.g. 3 iron) if defender spam dominates.

---

## 3. Things to watch

1. **Defender spam:** If one mine makes defenders too easy, consider 3 iron or a small gold cost.
2. **L3 vs more L2:** L3 is better per slot but costs iron + 2× gunsL2; if iron is scarce, mass L2 may still be better. Fine to leave as-is and tune after playtests.
3. **Starvation vs recruitment:** Recruit is still gold/stone/iron driven; food-aware caps (see SIMULATION_ECONOMY_ANALYSIS.md) help sim balance.

---

## 4. Where to change numbers

- **Costs:** `src/types/game.ts` — `UNIT_COSTS`, `UNIT_L2_COSTS`, `UNIT_L3_COSTS`, `DEFENDER_IRON_COST`.
- **Stats:** `UNIT_BASE_STATS`, `UNIT_L2_STATS`, `UNIT_L3_STATS` in same file.
- **Economy:** `BUILDING_PRODUCTION` (quarry stone, mine iron), `FACTORY_L2_IRON_PER_CYCLE` / `FACTORY_L2_ARMS_PER_CYCLE`.

*Last updated: 2026-03-04*
