# Siege & Combat Design (from Q&A)

This document captures the design answers for city capture, siege, defense, supply, and related systems.

---

## 1. City capture & walls

- **Capture rule:** You must fight any defender; capturing a city takes **one cycle**.
- **Walls:** Troops cannot march into a city through walls. Entering requires a **siege unit** (trebuchet or battering ram) to create an opening.
- **Walls and trebuchet:** Walls affect trebuchet line of sight and must be broken before troops can enter.

## 2. Defender vs attacker

- **Defender:** Can set all troops in a stack to defend a city: click stack → **Defend** → select the city. One order covers the whole stack.
- **Attacker:** Requires **micromanagement per tile** (move/attack per hex).
- **When attacked:** Troops **auto-attack back** (whether defending or attacking). This can be overridden by a **march/retreat** order (e.g. “Retreat”).

## 3. Interception

- Player **selects the hex** where they want to intercept the enemy army (interception point).

## 4–5. Disengage & retreat

- Troops **can disengage**.
- **Retreat** has a **2 second delay** (lag) before it takes effect.
- Retreat is a command; otherwise troops fight to the death.

## 6–7. Supply and siege perimeter

- **Supply (siege) definition:** All **supply tiles** are non-mountain, non-river tiles that connect the city to the outside. “Leaving city covered” = cutting those off.
- **Perimeter:** Each **perimeter hex** (around the city) must have **at least one** (friendly) unit; there can be **multiple** units per perimeter hex.
- A **surrounded** city has all supply tiles (all perimeter hexes) covered by the besieger.

## 8. (n/a)

## 9. Grain and surrounded cities

- From **tiles inside the city**, the owner can produce **grain** (food).
- When a city is **fully surrounded**, it becomes **its own supply cluster** (isolated); it can still use internal tiles for grain.

## 10. Supply when not fully surrounded

- If the city is **not fully surrounded**, supply can still flow (yes, supply works when not surrounded).

## 11. Food priority

- Depends on **priority selected in city menu**. This behavior **already exists** (no change).

## 12. City production during siege

- **Yes**, city can still produce; same rules as field units (e.g. supply/cluster rules).

## 13. City fall (population zero & assault)

- If **population (including military) hits zero**, the city can be **easily taken**.
- **New: Assault.** While surrounding a city, the attacker can choose to **Assault** (massive attack debuffs for the attacker—e.g. scaling walls is costly).
- **Capture condition:** The attacking player **holds the city center hex for 5 seconds** to capture the city.

## 14. (Not right now)

## 15. Population

- Population **can go to zero**.

## 16. Field buildings (builders)

- **No buildings built by builders in the field** (no field structures like towers).
- (If any structure:) It has **HP**, can be **broken by enemy units** (low HP, must be defended). Build time **one cycle**.

## 17–19. Trebuchet

- **Range:** Targets walls and buildings **exactly 3 hexes away**.
- Defenders **can shoot the trebuchet** as long as it is in range (no special immunity).
- (18 = “just answered” re range/targeting.)

## 20. Troop max

- **No limit** on total troops (no hard cap beyond population).

## 21–22. Troop limits and population

- **No max** for number of troops in absolute terms.
- **Troop limit rule:** **1 troop per 1 population** (you can only have as many troops as you have population).
- Troops **do not reduce the population count until they die** (recruitment does not subtract population; when a unit dies, that’s when the population is effectively “lost” or the slot freed—see implementation note).

## 23. Garrison and city identity

- Units in a city **still count as city A** (garrison belongs to that city for ownership/identity).

## 24. (No)

## 25. Cap

- **No cap** (reinforces no arbitrary troop cap).

## 26. Forced engagement

- **Force engagement** when two armies **cross paths** if **at least one** has stance **Aggressor** (aggressive).

## 27–28. (Yes)

## 29. Walls and movement

- Walls **affect trebuchet line of sight** and **must be broken** before (normal) troops can enter.

## 30. Retreat delay

- Retreat has a **slight delay** (implement as **2 second** lag).

## 31. Taking the city

- You **must take the city by stepping on the hex** (physical control of the city tile).
- Once you **starve them** (full siege), taking the city should be **easy** (e.g. assault with reduced or no wall penalty when pop is zero).

## 32. Retreat command

- Troops **only retreat if commanded**; otherwise they **fight to the death**.

## 33. (Yes)

## 34. Disband

- Option to **disband** units (yes).

## 35. Capture condition (hex)

- **Enemy military on hex + no defender** (attacker controls hex with no defending unit) → can capture/claim.

## 36. Production

- **Production does not change** (e.g. when under siege, same production rules; see 12).

## 37–40. (Yes)

## 41. Siege status UI

- **Siege status** appears on the **stack pane** (unit stack panel).

## 42–43. One-click siege

- **Yes**; **one click** to initiate/apply siege (e.g. “Set siege” or “Assault” from stack pane).

## 44. Siege mode name

- Use the term **“Siege”** for this mode/state.

## 45. (Yes)

## 46. Defender boost

- Defenders **should not** get a (extra) boost (beyond existing mechanics).

## 47. Build time

- **Yes**, but **don’t make the time too long** (e.g. trebuchet/ram build or wall repair—keep build times moderate).

## 48. Siege duration

- **Few cycles** (siege resolution over a few cycles, not instant).

## 49. (No)

## 50. Village vs city

- **Village and city are the same thing** for now (no separate village mechanics).

---

## Implementation checklist (summary)

| # | Topic | Key rule |
|---|--------|----------|
| 1 | City capture | Fight defender; 1 cycle to capture; need siege unit to pass walls |
| 2 | Defend order | Stack → Defend → select city (one order for whole stack) |
| 2 | Attack | Per-tile micromanagement; when attacked, auto-attack back; override with Retreat |
| 3 | Interception | Player selects interception hex |
| 5–6, 30 | Retreat | 2 s delay; retreat only when commanded |
| 7 | Siege perimeter | Each perimeter hex ≥ 1 unit; can have multiple |
| 9–10 | Supply | City can be own cluster when surrounded; grain from internal tiles |
| 13 | City fall | Pop=0 → easy take; Assault = big attack debuff; hold center 5 s to capture |
| 16 | Field buildings | No builder-built field buildings (or: low HP, 1 cycle build, breakable) |
| 17–19 | Trebuchet | Range 3 vs walls/buildings; can be shot by defenders in range |
| 21–22 | Troop limit | 1 troop per population; no pop deduction until death (or slot freed on death) |
| 26 | Engagement | Force engagement on path cross if one side is Aggressor |
| 29 | Walls | Block trebuchet LOS; must be broken for troops to enter |
| 31 | Take city | Must step on hex; starve then easy |
| 34 | Disband | Allow disband |
| 35 | Capture | Enemy on hex + no defender |
| 41–44 | UI | Siege on stack pane; one-click siege; call it “Siege” |
| 46 | Defender | No extra defender boost |
| 50 | Village | Same as city for now |

---

## Implementation notes (current codebase)

All 50 design points are implemented:

- **§1, 17–19, 29:** Siege units (trebuchet, battering ram), wall HP, broken walls don't block; trebuchet/ram damage walls in `siegeTick`; walls block movement until broken.
- **§2:** Defend order: stack → Defend → click friendly city; `defendCityId` and move to city.
- **§3:** Interception: stack → Intercept → click hex (same as move target).
- **§5, 30, 32:** Retreat: 2 s delay; retreat command; no attack while `retreatAt` set.
- **§6–7, 9–10:** Supply/surrounded: `computeTradeClusters` already treats a city with all neighbors blocked as its own cluster.
- **§13, 31, 35:** City capture: hold center 5 s; pop=0 = instant capture; assault debuff; capture when enemy on hex + no defender.
- **§21–22:** Troop limit 1 per population; no pop on recruit; pop lost when unit dies; `originCityId`.
- **§26:** Force engagement when paths cross (enemy moving toward our hex blocks that step).
- **§34:** Disband: removes selected units and returns population to `originCityId`.
- **§41–44:** Stack pane: siege status (Defending / Retreating / Assault), Defend, Intercept, Retreat, Siege (Assault), Disband.
- **§46:** No extra defender boost. **§50:** Village = city.

When implementing wall placement, set `hp` and `maxHp` to `WALL_SECTION_HP` on new `WallSection`s.
