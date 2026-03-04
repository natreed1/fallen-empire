# Plan: Defender Unit, Siege, Scout Towers, and Defenses

**Current scope:** Implement **defender unit only** (balanced, L2 barracks + iron cost). Scout tower is in scope for later; **do not focus on Redoubt or Ballista** (deferred).

**Summary:** Defender: front-line unit with more HP than infantry, high damage resistance, low attack; defensive stance bonus when on a friendly city hex. Recruited **only from level‑2 barracks**, costs **gold + iron**. Trebuchet/scout/defenses (redoubt, ballista) remain as future work.

---

## 1. Defender Unit (implement now)

**Role:** Front line / bodyguard for city or back-line units. **More HP than infantry** (infantry = 100), high damage resistance, low attack. **Defensive stance on friendly city hex:** when on a friendly city center hex, extra damage-reduction bonus; off that hex, base damage resistance only.

**Recruitment:**
- **Requires level‑2 barracks** (upgraded). Cannot recruit defender from L1 barracks.
- **Costs:** gold + **iron** (e.g. 1–2 iron per defender). Deduct from city storage (same pattern as L2 arms for upgraded units); reject if not enough iron.

**Balanced stats (suggested):**
- **HP:** 130 (more than infantry 100). No L2 variant for defender (or same stats if L2 exists later).
- **Attack:** 8 (low; infantry 15).
- **Range:** 1. **Speed:** 0.9 (slightly slower than infantry 1.0).
- **Damage resistance:** e.g. 0.25 (25% less damage taken); on city hex e.g. 0.40 (40% less).
- **Upkeep:** 1 food (same as infantry). No gun upkeep.

**Implementation:**
- **[`src/types/game.ts`](src/types/game.ts):** Add `'defender'` to `UnitType`; `UNIT_COSTS` extended for defender to include `iron?: number` (or add `DEFENDER_IRON_COST`); `UNIT_BASE_STATS` / `UNIT_L2_STATS` with `damageResist`, `damageResistOnCityHex`; defender has more `maxHp` than infantry (130).
- **[`src/store/useGameStore.ts`](src/store/useGameStore.ts):** In `recruitUnit`, for `type === 'defender'`: require `barracksLvl >= 2`; require city has enough iron (e.g. `DEFENDER_IRON_COST`); deduct iron from a city that has it (e.g. same city or any owned city).
- **[`src/lib/combat.ts`](src/lib/combat.ts):** Apply `damageResist` when resolving damage to a unit; if defender on friendly city hex use `damageResistOnCityHex`. Helper: `u.type === 'defender'` and `cities.some(c => c.ownerId === u.ownerId && c.q === u.q && c.r === u.r)`.
- **[`src/components/game/HexGrid.tsx`](src/components/game/HexGrid.tsx):** Sprite for `defender` (path + scale).
- **[`src/components/ui/GameHUD.tsx`](src/components/ui/GameHUD.tsx):** Add defender to barracks panel **only when barracks is L2**; show gold + iron cost; add to stack summary counts.
- **AI ([`src/lib/ai.ts`](src/lib/ai.ts)):** Recruit defender only when barracks L2 and iron available; add to recruit choices with appropriate weight.

---

## 2. Current Wall System (reference)

Walls are implemented as **wall sections** around cities. No changes to walls in this defender-only scope; this section documents current behavior.

**Data:** `WallSection`: `{ q, r, ownerId, hp?, maxHp? }`. Stored in game state as `wallSections: WallSection[]`. Each section has **WALL_SECTION_HP = 50** when built.

**Building:** Player builds walls via **Build wall ring** from the city/build menu: `buildWallRing(cityId, ring)` places sections on hexes at **ring** distance from the city center. Only hexes that are valid (not water, not already a wall, etc.) get a section. Each section costs **WALL_SECTION_STONE_COST = 5** stone; stone is deducted from the city’s storage.

**Movement:** In `stepTowardZOC` (movement/pathfinding), **enemy** wall sections are checked: if a neighbor hex has an enemy wall with **hp > 0**, that neighbor is skipped—**intact enemy walls block movement**. Friendly walls do not block the owner. So troops cannot walk through an enemy city’s wall ring until sections are broken.

**Siege:** `siegeTick` runs each cycle: trebuchets (range 3) and battering rams (range 1) deal **siege damage** to enemy wall sections in range. When a section’s hp reaches 0 (or undefined), it is considered broken and **no longer blocks movement**. Walls do not attack; they only absorb damage until broken.

**Summary:** Walls = ring of 50‑HP sections around a city, built with stone; enemy walls block movement until siege units break them.

---

## 3. Trebuchets: Immobile Buildings (Field-Only) — deferred

**Design:**
- Trebuchets are **buildings** (or static structures), **not units**. They **cannot move**.
- Built **only in the field by builders** (same flow as today: construction site → builder BP → completion). Not recruitable from barracks.

**Implementation:**
- **Data model:** Either (A) keep trebuchet as a “unit” with `speed: 0` and **exclude from movement** (simplest), or (B) introduce a separate “field structure” type (e.g. `TrebuchetSite` with q, r, ownerId, hp) and remove trebuchet from the unit list. Option A is less invasive: trebuchet remains a unit, `UNIT_BASE_STATS.trebuchet.speed = 0` (or already 0.6 → set 0), and **movement tick skips units with speed 0** (or skip `type === 'trebuchet'`).
- **[`src/types/game.ts`](src/types/game.ts):** Set trebuchet speed to `0` in `UNIT_BASE_STATS` and `UNIT_L2_STATS` (if still used for siege).
- **[`src/lib/military.ts`](src/lib/military.ts):** In `movementTick`, when grouping armies or advancing, **exclude trebuchets** from moving (e.g. filter out `u.type === 'trebuchet'` from units that can have a target / move). Siege tick already uses trebuchets in place for range-3 damage to walls.
- **Barracks:** Remove trebuchet from barracks recruitment (human + AI): **[`src/store/useGameStore.ts`](src/store/useGameStore.ts)** reject `recruitUnit(..., 'trebuchet')` with message; **[`src/components/ui/GameHUD.tsx`](src/components/ui/GameHUD.tsx)** remove from `MILITARY_RECRUIT_INFO`; **[`src/lib/ai.ts`](src/lib/ai.ts)** remove `'trebuchet'` from `siegeChoices` (rams can stay in barracks or become field-built; see below).
- **UI:** Keep “Build Trebuchet (this hex)” for builders on a valid hex. Tooltip/description can say “Immobile siege. Range 3 vs walls.”

---

## 4. Scout Towers (Field-Built, Vision Only) — okay for later

**Design:**
- Builders build **scout towers** **in the field** (any valid non-city, non-water/mountain hex).
- **Vision:** **4 tiles** in every direction (vision range **4**). No attack, no movement; **map knowledge only**.

**Implementation:**
- **State:** New structure type for placed scout towers. Options: (1) Store as `ScoutTower[]` with `{ id, q, r, ownerId }` in game state, or (2) a `Map<string, { ownerId }>` keyed by `tileKey(q,r)` for “structure on this hex.” Option 1 is clearer and allows multiple structures per hex if needed later.
- **Construction:** New construction site type `'scout_tower'`. Constants: `SCOUT_TOWER_BP_COST`, `SCOUT_TOWER_GOLD_COST`. Store action `buildScoutTowerInField(q, r)`; same checks as trebuchet (builder on hex, not city, not water/mountain). On completion, **add** a scout tower to state (do not spawn a unit).
- **Vision:** **[`src/lib/vision.ts`](src/lib/vision.ts):** In `computeVisibleHexes`, add a loop over **scout towers** owned by the player and add vision sources with range **4** (constant `SCOUT_TOWER_VISION_RANGE = 4` in [`src/types/game.ts`](src/types/game.ts)). Pass scout towers into `computeVisibleHexes` (extend signature and all call sites: store, gameCore, etc.).
- **Types:** In [`src/types/game.ts`](src/types/game.ts): `ConstructionSiteType` includes `'scout_tower'`; define `ScoutTower` interface and add `scoutTowers: ScoutTower[]` (or equivalent) to game state.
- **Store ([`src/store/useGameStore.ts`](src/store/useGameStore.ts)):** In construction tick, when `site.type === 'scout_tower'` and BP complete, push to `scoutTowers` and remove site. Recompute `visibleHexes` after state changes (already done each tick).
- **UI:** Hex panel: “Build Scout Tower” when builder on hex, with cost/BP. No attack/move UI for scout towers (they are not units).
- **Rendering:** Draw a small tower or marker on hexes that have a scout tower (HexGrid or overlay).
- **AI:** Optional: allow AI to build scout towers (e.g. when builder idle and gold/BP available, place near frontier or key paths).

---

## 5. Defenses (Redoubt / Ballista) — not in focus

**Design:**
- **Defenses** can **only** be built on hexes **owned by a city** (i.e. in that city’s territory).
- Two defense types with distinct names and roles:

| Name       | Role              | Range | Attack | Max HP | Notes                                      |
|------------|-------------------|-------|--------|--------|--------------------------------------------|
| **Redoubt**  | Close-range, sturdy | 1     | 18     | 90     | Strong hit, tanky; punishes melee at gate. |
| **Ballista** | Long-range, chip   | 2     | 10     | 50     | Weaker hit, longer reach; cleared by siege.|

- **Balancing rationale:** Infantry 15 atk / 100 HP, archer 12 atk / 2 range / 50 HP, wall section 50 HP. Redoubt is slightly above infantry damage and much tankier than a single unit so it holds chokepoints; Ballista is archer-like damage at range 2 but lower HP so trebuchet/archers can remove it. Both static (no movement); act as turrets when enemies are in range.

**Costs (suggested):**
- **Redoubt:** 15 gold, 40 stone, 80 BP (builder or city).
- **Ballista:** 12 gold, 25 stone, 60 BP.

**Implementation:**
- **State:** `DefenseType = 'redoubt' | 'ballista'`. Store as `Defense[]` with `{ id, type, q, r, ownerId, cityId?, hp, maxHp }`.
- **Placement rule:** Only on hexes in own city territory (`territory.get(tileKey(q,r))?.playerId === ownerId`).
- **Build path:** Builder on a hex in territory can “Build Redoubt” or “Build Ballista” (or city panel → choose hex in territory). `ConstructionSiteType` includes `'redoubt'` and `'ballista'`; on completion add to `defenses[]`.
- **Combat:** Defenses in combat tick: when enemy units within range, defense deals damage; defenses have HP and can be damaged/destroyed. Constants in [`src/types/game.ts`](src/types/game.ts): e.g. `DEFENSE_STATS.redoubt = { range: 1, attack: 18, maxHp: 90 }`, `DEFENSE_STATS.ballista = { range: 2, attack: 10, maxHp: 50 }`.
- **Rendering:** Draw defense sprites or markers on hexes (HexGrid).

---

## 6. Battering Ram (Optional)

- If rams stay in barracks: no change beyond removing trebuchet from barracks.
- If rams also become **field-only** (built by builders, like trebuchet): same pattern as trebuchet—construction site `'battering_ram'`, `buildBatteringRamInField(q,r)`, spawn ram **unit** on completion. Rams can remain mobile (unit with speed) or be made immobile like trebuchet; current design has them mobile.

---

## 7. Order of Work (current scope: defender only)

1. **Types and constants:** Add `defender` to `UnitType`; `UNIT_COSTS` (gold + iron for defender); `UNIT_BASE_STATS` / `UNIT_L2_STATS` (HP 130, attack 8, damageResist, damageResistOnCityHex); `DEFENDER_IRON_COST` (e.g. 1 or 2).
2. **Store:** `recruitUnit` for defender: require barracks L2; require and deduct iron from city storage.
3. **Combat:** Apply damage resistance (and on-city-hex bonus for defender) in combat resolution.
4. **UI:** Barracks panel shows defender only when barracks is L2; display gold + iron cost. Stack summary and unit lists include defender.
5. **Sprite:** Defender texture/key in HexGrid.
6. **AI:** Recruit defender when barracks L2 and iron available.

**Later (not this push):** Scout towers, trebuchet field-only, redoubt/ballista, battering ram changes.

---

## 8. Summary Table

| Item | Behavior |
|------|----------|
| **Defender unit (implement now)** | Barracks **L2 only**; costs **gold + iron**. More HP than infantry (130), high damage resistance, low attack (8). Defensive stance bonus on friendly city hex. Front line / bodyguard. |
| **Walls (current)** | Ring around city; 5 stone per section, 50 HP each. Enemy walls block movement until siege (treb/ram) breaks them. |
| **Scout tower** | Okay for later. Field-built, vision 4. |
| **Trebuchet / Redoubt / Ballista** | Deferred; not in focus. |
| **Palisades** | Not in scope. |
