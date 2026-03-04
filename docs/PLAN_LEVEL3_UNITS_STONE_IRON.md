# Plan: Level 3 Units, L2→Stone, L3→Iron, Defender at L3

**Summary:** Introduce a third arms tier: **Level 2** units cost **stone** (not iron); **Level 3** units cost **iron** and are more expensive with better stats. **Defenders** are L3-only and **only cost iron** (no gold, or minimal gold). This gives a clear resource path: L1 = gold only, L2 = gold + stone, L3 = gold + iron (defender = iron only).

---

## 1. Current State (reference)

- **Unit arms levels:** `armsLevel?: 1 | 2`. L1 = `UNIT_BASE_STATS`, L2 = `UNIT_L2_STATS`. L2 requires L2 barracks + L2 arms (gunsL2 from upgraded factory).
- **Costs:** All combat units (infantry, cavalry, ranged) cost **gold only** at L1; at L2 they still cost only gold (no resource). **Defender** costs gold + iron, requires L2 barracks, has no L2 variant (same stats as “base” defender).
- **Resources:** Stone from quarries; iron from mines. Iron is used for building upgrades (e.g. gold mine), L2 factory consumption (1 iron → 10 gunsL2/cycle), and defender recruit.

---

## 2. Target Design

| Tier   | Resource cost     | Barracks / arms requirement   | Who gets it                    |
|--------|-------------------|------------------------------|--------------------------------|
| **L1** | Gold only         | L1 barracks                  | Infantry, cavalry, ranged      |
| **L2** | Gold + **stone**  | L2 barracks + L2 arms        | Infantry, cavalry, ranged      |
| **L3** | Gold + **iron**  | L2 barracks (or L3 barracks) | Infantry, cavalry, ranged      |
| **Defender** | **Iron only** (no gold) | L2 barracks        | Defender only; always L3 stats |

- **L2 units:** Require **stone** (from city storage). Stone is plentiful from quarries; L2 is the “mid tier” that doesn’t compete with iron.
- **L3 units:** Require **iron** (from city storage). More expensive (higher gold + iron), better stats than L2. Optional: require barracks L3 (new upgrade) or keep L2 barracks and only gate by cost + arms.
- **Defenders:** Recruited **only at L3** (no L1/L2). Cost **iron only** (e.g. 2–3 iron, 0 gold). Use `UNIT_L3_STATS` for defender (same defensive stats, just sourced from L3 table).

---

## 3. Data and Constants

### 3.1 Types (`src/types/game.ts`)

- **Unit:** Extend `armsLevel?: 1 | 2` to `armsLevel?: 1 | 2 | 3`.
- **UNIT_COSTS:** Today is `Record<UnitType, { gold: number; iron?: number }>`. Options:
  - **Option A (recommended):** Keep base `UNIT_COSTS` for L1 (gold only). Add:
    - `UNIT_L2_COSTS: Record<UnitType, { gold: number; stone?: number }>` — L2 infantry/cavalry/ranged: gold + stone; siege/defender/builder: no L2 cost (defender has its own).
    - `UNIT_L3_COSTS: Record<UnitType, { gold: number; iron?: number }>` — L3 infantry/cavalry/ranged: gold + iron; defender: iron only (e.g. `{ gold: 0, iron: 2 }` or `{ gold: 1, iron: 2 }`).
  - **Option B:** Single `UNIT_COSTS` with optional `stone` and `iron`, and a “level” or separate L2/L3 cost struct. More compact but messier branching.

Use **Option A** for clarity: L1 = `UNIT_COSTS` (gold only for combat), L2 = `UNIT_L2_COSTS` (gold + stone), L3 = `UNIT_L3_COSTS` (gold + iron; defender iron-only).

### 3.2 Unit stats

- **UNIT_L3_STATS:** New table, same shape as `UNIT_L2_STATS`. For infantry/cavalry/ranged: higher maxHp, attack, and optionally gunL2Upkeep than L2. For **defender:** same defensive stats as today (maxHp 130, attack 8, damageResist, damageResistOnCityHex); defender has no L1/L2, only L3.
- **UNIT_L2_STATS:** Unchanged; L2 still consumes gunsL2. L3 can use more gunsL2 per unit or same—design choice.

### 3.3 Cost constants (suggested)

- **L2 (stone):** e.g. infantry 1g + 2 stone, cavalry 3g + 3 stone, ranged 2g + 2 stone. Tune so L2 is clearly “mid tier” and doesn’t require iron.
- **L3 (iron):** e.g. infantry 2g + 1 iron, cavalry 5g + 2 iron, ranged 3g + 1 iron (more expensive than L2). Defender: 0g + 2 iron (or 1g + 2 iron if you want a small gold sink).
- **DEFENDER_IRON_COST:** Keep or rename to reflect “defender = L3, iron only” (e.g. 2 iron).

---

## 4. Recruitment Logic

### 4.1 Human recruit (`src/store/useGameStore.ts`)

- **recruitUnit(cityId, type, armsLevel)** — extend `armsLevel` to `1 | 2 | 3`.
- **L1 (armsLevel 1 or undefined):** Current behavior: gold only, no iron/stone. Barracks L1.
- **L2 (armsLevel 2):** Require L2 barracks; require **stone** from city storage (from `UNIT_L2_COSTS[type]`); require gunsL2 for combat units. Deduct **stone** (not iron). No change to gold deduction.
- **L3 (armsLevel 3):** Require L2 barracks (or L3 if we add barracks L3). Require **iron** (and gold for non-defender) from city storage. Require gunsL2 if L3 units consume gunsL2. Deduct iron (and gold). Spawn unit with `armsLevel: 3`.
- **Defender:** Always recruit as L3. Check `UNIT_L3_COSTS.defender` (iron only). Require L2 barracks; require city has enough iron; deduct iron only. Spawn with `armsLevel: 3`; use `UNIT_L3_STATS.defender` for HP/attack/resist.

### 4.2 AI recruit (`src/lib/ai.ts`, `src/core/gameCore.ts`)

- **AI plan:** Extend `AiRecruitAction.armsLevel` to `1 | 2 | 3`.
- **Affordability:** For L2: check city stone and `UNIT_L2_COSTS`. For L3: check city iron and `UNIT_L3_COSTS`. For defender: check iron only.
- **Choices:** When picking unit type and tier, include L3 options when barracks is L2 (or L3) and iron available; L2 when stone available; L1 when only gold. Defender only as L3 when iron available.

---

## 5. Combat, Upkeep, Movement

- **Stats lookup:** Everywhere that currently does `armsLevel === 2 ? UNIT_L2_STATS : UNIT_BASE_STATS` must become: `armsLevel === 3 ? UNIT_L3_STATS : armsLevel === 2 ? UNIT_L2_STATS : UNIT_BASE_STATS`. Defender always has `armsLevel === 3`, so it always uses `UNIT_L3_STATS`.
- **Files to update:**
  - `src/lib/combat.ts` — `getUnitAttack`, `awardXp` (stats by armsLevel 1/2/3).
  - `src/lib/military.ts` — damage resistance, movement speed, upkeep (stats by armsLevel).
  - `src/lib/gameLoop.ts` — upkeep (food, guns, gunsL2) from correct stats.
  - `src/components/ui/GameHUD.tsx` — stack/unit tooltips and recruit panel (show L1/L2/L3 and costs: L2 = stone, L3 = iron; defender = iron only).

---

## 6. UI

- **Barracks panel:** Show three tiers for infantry/cavalry/ranged: L1 (gold), L2 (gold + stone), L3 (gold + iron). Show defender once as “L3, iron only” (no L1/L2 defender).
- **Cost labels:** “5g”, “3g + 2 stone”, “4g + 1 iron”, “2 iron” (defender).
- **Disable buttons:** L2 when no stone or no L2 barracks/arms; L3 when no iron or no L2 barracks; defender when no iron or no L2 barracks.

---

## 7. Defender-Only Summary

- **Defenders start at level 3:** Recruited only with `armsLevel: 3`; use `UNIT_L3_STATS.defender`.
- **Defenders only take iron:** Cost is iron only (e.g. 2 iron, 0 gold). No stone, no gold. Deduct from city storage; reject if not enough iron.
- **No L1/L2 defender:** Remove any notion of defender at L1 or L2; barracks panel and AI never offer defender at any tier other than L3.

---

## 8. Order of Work

1. **Types (`src/types/game.ts`):** Add `armsLevel?: 1 | 2 | 3`; add `UNIT_L2_COSTS` (gold + stone for L2 combat units); add `UNIT_L3_COSTS` (gold + iron for L3 combat, iron-only for defender); add `UNIT_L3_STATS` (all unit types; defender = current defender stats).
2. **Recruit (store):** L2 path: require and deduct **stone**. L3 path: require and deduct **iron** (and gold for non-defender). Defender: L3 only, iron-only cost.
3. **Combat / upkeep / movement:** Use three-way stats lookup (L1 / L2 / L3) everywhere.
4. **AI:** Extend recruit action to L3; affordability for stone (L2) and iron (L3/defender); include L3 and defender in choices when resources and barracks allow.
5. **UI:** Barracks panel: L1 / L2 / L3 tiers and defender (L3, iron only); cost strings and disable logic for stone/iron.
6. **gameCore (headless):** Same recruit and stats logic as store so sim and training stay in sync.

---

## 9. Summary Table

| Unit type   | L1        | L2              | L3              | Defender      |
|------------|-----------|-----------------|-----------------|---------------|
| **Cost**   | Gold only | Gold + **stone** | Gold + **iron** | **Iron only** |
| **Stats**  | BASE      | L2              | L3              | L3 only       |
| **Barracks** | L1       | L2 + L2 arms    | L2 (or L3)      | L2            |

*Last updated: 2026-03-04*
