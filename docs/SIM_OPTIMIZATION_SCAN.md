# AI simulation system — optimization scan

Scan of the AI simulation pipeline for performance optimizations **without removing complexity**. Hot path: `runSimulation` → `stepSimulation` (economy → upkeep → AI plan → apply actions → movement → combat → siege → territory).

---

## 1. gameCore.ts — stepSimulation

### 1.1 Redundant filters and iterations
- **Current:** `ai1Military`, `ai2Military`; then `ai1Units`/`ai2Units` again for diagnostics; `cities.filter(c => c.ownerId === AI_ID)` repeated for foodAi1, diagnostics ai1Cities, traceCallback ai1CitiesFiltered.
- **Optimization:** Compute `ai1Cities`, `ai2Cities`, `ai1Units`, `ai2Units` once after upkeep (and derive ai1Military/ai2Military from units or keep both). Reuse everywhere: food sums, diagnostics, traceCallback, avgMilitaryDistanceToAnchor.

### 1.2 City/recruit lookup by id
- **Current:** `cities.find(c => c.id === build.cityId)` and `cities.find(c => c.id === rec.cityId)` in tight loops; O(n) per build/recruit.
- **Optimization:** Build `Map<string, City>` from `cities` once at start of AI application; use for build.cityId and rec.cityId. Same for wall ring `wr.cityId`.

### 1.3 Occupied tile checks
- **Current:** `cities.some(c => c.buildings.some(b => b.q === build.q && b.r === build.r))` and `constructions.some(cs => cs.q === build.q && cs.r === build.r)` per build — O(cities × buildings) and O(constructions).
- **Optimization:** Build a `Set<string>` of `tileKey(q,r)` for all building positions and construction sites once per step (or per AI loop). O(1) lookup per build.

### 1.4 avgMilitaryDistanceToAnchor (diagnostics)
- **Current:** `Math.min(...ai1Cities.map(c => hexDistance(u.q, u.r, c.q, c.r)))` — allocates array and uses spread every unit.
- **Optimization:** Inline loop: `let minD = Infinity; for (const c of ai1Cities) { const d = hexDistance(...); if (d < minD) minD = d; }` — no allocation, same result.

### 1.5 Ring telemetry wallByKey
- **Current:** `new Map(state.wallSections.map(w => [tileKey(w.q, w.r), w]))` each cycle when diagnostics enabled. Fine for small wall count; optional: reuse if state.wallSections reference unchanged (risky due to mutations elsewhere).

### 1.6 wallSectionsAfterAi
- **Current:** `state.wallSections.map(w => ({ ...w }))` every cycle. Necessary when sections are added; no obvious reduction without structural change.

---

## 2. ai.ts — planAiTurn

### 2.1 Village iteration
- **Current:** Two full passes over `tiles.values()` — one for villageTilesForIncorp, one for villagesNeedingUnits; each pass does `cities.some(...)` and `aiUnits.filter(...)` per tile.
- **Optimization:** Single pass: for each tile with village, compute whether it has military and score once; push into either list or both. Build a `Set` of city center keys (tileKey(c.q,c.r)) once for the `cities.some(c => c.q === tile.q && c.r === tile.r)` check.

### 2.2 Math.min(...array) and repeated filters
- **Current:** `avgDistToAnchor` uses `Math.min(...aiCities.map(c => hexDistance(...)))` and filters `aiUnits.filter(u => u.type !== 'builder')` multiple times; same in scoreVillageExpansion and newAvg.
- **Optimization:** Precompute `militaryUnits = aiUnits.filter(u => u.type !== 'builder')` once. Replace every `Math.min(...arr.map(...))` with a small loop (minDistanceToCities(unit, cities) helper) to avoid array alloc and spread.

### 2.3 Enemy target scoring
- **Current:** `enemyUnitCount(ec.q, ec.r)` filters all units per enemy city; `distToOurs(ec)` does `Math.min(...aiCities.map(...))`.
- **Optimization:** Same as 2.2: loop for min distance. enemyUnitCount is O(units) per city which is acceptable for small city count; optional: spatial hash for units by (q,r) if units get large.

---

## 3. gameLoop.ts — processEconomyTurn

### 3.1 Clusters
- **Current:** `computeTradeClusters(newCities, tiles, units, territory)` once per turn; result passed to upkeepTick. Good — no redundant cluster computation in step.

### 3.2 productionPhase
- **Current:** `computeTerrainFoodByCity` does one pass over territory; productionPhase then iterates cities. Already optimized (single territory pass).

### 3.3 deepCloneCity
- **Current:** `cities.map(c => deepCloneCity(c))` — ensure deepCloneCity is as shallow as possible where state isn’t shared (e.g. storage, buildings). No change suggested without profiling.

---

## 4. military.ts — upkeepTick

### 4.1 Hero lookup per unit
- **Current:** `heroes.find(h => h.q === u.q && h.r === u.r && h.ownerId === u.ownerId && h.type === 'logistician')` inside cluster unit loop — O(units × heroes).
- **Optimization:** Build `Map<string, Hero>` keyed by `tileKey(q,r)` (or ownerId+tileKey) for logistician heroes once per upkeepTick; O(heroes) build + O(units) lookups.

### 4.2 supplyCache
- **Current:** Supply cache avoids recomputing cluster key when unit position unchanged. Good.

---

## 5. military.ts — movementTick / combatTick

### 5.1 groupArmies
- **Current:** Groups units by (targetQ, targetR, ownerId). One pass over moving units. Acceptable.

### 5.2 stepTowardZOC
- **Current:** Called per army per tick; reads tiles, units, wallSections. Likely dominant cost when many armies; no change without profiling (pathfinding is inherently work).

### 5.3 combatTick
- **Current:** Resolves combat per hex/stack. Structure is appropriate; optimizations would be local (e.g. reduce allocations in inner loops) and require profiling.

---

## 6. train-ai.ts / workers

### 6.1 Seed
- **Current:** `(Date.now() + i * 1000) % 1_000_000` — non-deterministic. Use deterministic seed from (generation, candidateIndex, matchIndex) for reproducibility; no perf cost.

### 6.2 Worker payload
- **Current:** Sends full `population[job.candidateId]` and `baseline` (full AiParams) per message. Params are small; acceptable unless worker count is very high.

### 6.3 evaluateCandidateMain
- **Current:** Sequential runMatch calls; when NUM_WORKERS > 1, parallel path is used. Good.

---

## 7. Territory and logistics

### 7.1 calculateTerritory
- **Current:** Called once at end of step in gameCore (when cities/ownership change). Not on the inner cycle hot path. Good.

### 7.2 computeTradeClusters
- **Current:** Called once in processEconomyTurn; result reused in upkeepTick. Good.

---

## Implemented (this pass)

- **gameCore:** City-by-id map for AI build/recruit/wall lookups; occupied tile Set for build validity; reuse ai1Cities/ai2Cities for diagnostics and avoid Math.min spread in avgMilitaryDistanceToAnchor.
- **planAiTurn:** Precompute militaryUnits; single-pass village collection with city key Set; minDistanceToCities loop helper; use both in avgDistToAnchor and scoreVillageExpansion.

---

## Not implemented (optional follow-up)

- Hero-by-position map in upkeepTick (small win unless many heroes).
- Deterministic seeds in train-ai for reproducibility.
- Deeper allocation reduction in combatTick/movementTick (profile first).
- Spatial indexing for units (e.g. by hex) if unit count grows large.
