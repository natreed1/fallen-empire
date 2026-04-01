# Codebase Audit — Issues & Improvement Opportunities

Deep audit of the Fallen Empire codebase (Mar 2026). Findings are grouped by severity and area.

---

## Executive summary

| Area | Critical | High | Medium | Low |
|------|----------|------|--------|-----|
| Error handling | 1 | 0 | 1 | 0 |
| Type safety | 0 | 1 | 1 | 0 |
| Security | 0 | 2 | 0 | 0 |
| Tests | 0 | 1 | 0 | 0 |
| Dead code / duplication | 0 | 0 | 2 | 1 |
| Documentation / config | 0 | 0 | 2 | 1 |

**Top priorities:** Wrap the game tick in try/catch; validate evolve API body and consider auth for workflow/evolve; remove `.bak`; centralize hex key parsing; fix README/WORKFLOW port; add ESLint config and (optionally) a test suite.

---

## 1. Error handling

### 1.1 [Critical] Game tick has no try/catch

**Location:** `src/store/useGameStore.ts` — `setInterval` callback starting ~line 468.

The main game loop (movement, combat, siege, territory, construction, etc.) runs inside this callback with **no try/catch**. Any thrown error (e.g. from `movementTick`, `combatTick`, `processEconomyTurn`, or AI planning) will:

- Be an unhandled exception
- Potentially stop the interval or leave state inconsistent
- Leave the game stuck with no user-visible error

**Recommendation:** Wrap the entire tick callback in try/catch; on error, log it, call `clearAllTimers()`, and set phase (or a dedicated `gameError: string | null`) so the UI can show “Something went wrong” and offer restart.

### 1.2 [Medium] No React Error Boundary

There is no `ErrorBoundary` (or `componentDidCatch` / `getDerivedStateFromError`) anywhere. A render-time error in any component (e.g. `GameScene`, `HexGrid`, `GameHUD`) will take down the whole tree with no fallback UI.

**Recommendation:** Add an error boundary around the main game content (e.g. in `layout.tsx` or around the dynamic `GameScene`) so one broken component doesn’t blank the app.

### 1.3 Other notes

- **API routes:** `workflow` and `evolve` routes use try/catch and return 500 on failure; evolve stream has inner try/catch in `start()`.
- **Scripts:** Training and validation scripts generally use try/catch and `process.exit(1)` on failure.
- **Global handlers:** No `unhandledrejection` or `uncaughtException` handlers; adding them can help log and report production errors.

---

## 2. Type safety

### 2.1 [High] Evolve API body not validated

**Location:** `src/app/api/evolve/route.ts` (lines 38–45).

The POST body is cast to `Record<string, number>` and destructured with defaults. There is **no runtime validation**. Invalid or hostile input can cause:

- `NaN` / `Infinity` → logic bugs or crashes
- Huge values (e.g. `generations: 1e9`, `mapSize: 100000`) → long runs or OOM
- Negative numbers → unexpected behavior

**Recommendation:** Validate and clamp all inputs (e.g. with `aiParamsSchema`-style ranges or Zod): require number types, finite values, and upper bounds (e.g. `generations ≤ 100`, `mapSize ≤ 128`).

### 2.2 [Medium] Type assertions for dynamic data

Several places use `as unknown as Record<...>` or similar for JSON/dynamic keys:

- `src/lib/aiParams.ts` (43, 47)
- `src/lib/aiParamsSchema.ts` (168, 222, 242)
- `scripts/optimize-trends.ts`, `scripts/tournament-league.ts`
- `src/app/api/evolve/route.ts`: body cast without validation (see above)
- `src/app/api/workflow/route.ts`: body as `{ content?: string }` (runtime check exists for `content`)

**Recommendation:** Prefer typed parsers or schemas (e.g. Zod) for API request bodies and any JSON.parse results that are then asserted. For evolve, add validation before use.

### 2.3 Positive notes

- No `: any` or `<any>` in code (only in comments).
- `strict: true` in `tsconfig.json`; types are generally consistent.

---

## 3. Security

### 3.1 [High] Workflow PUT unauthenticated, no body size limit

**Location:** `src/app/api/workflow/route.ts`.

- **PUT** writes request body to `docs/WORKFLOW.md`. Anyone who can reach the API can overwrite the file.
- No authentication or authorization.
- No limit on `content` length → very large payloads could fill disk or cause DoS.

**Recommendation:** If the app is ever exposed beyond localhost: add auth or IP allowlist for this route, and enforce a max body size (e.g. 1MB).

### 3.2 [High] Evolve POST unauthenticated and unvalidated

**Location:** `src/app/api/evolve/route.ts`.

- **POST** runs the evolution stream (many simulations). Anyone who can hit the API can trigger expensive CPU-bound work.
- No authentication.
- Body not validated (see §2.1) → extreme values can cause long runs or OOM.

**Recommendation:** If evolve is exposed: add auth or rate limiting, and validate/bound all body parameters.

### 3.3 Other

- No hardcoded secrets; config is env or file-based.
- No `process.env` usage in `src/` for API keys.

---

## 4. Tests

### 4.1 [High] No test suite

- **No test runner** in `package.json` (no Jest, Vitest, or Playwright; no `"test"` script).
- **No test files** (`*.test.ts`, `*.spec.ts`, etc.).
- `.cursor/agents/test-qa.md` describes a planned setup (Vitest, coverage, Playwright, folder layout) but nothing is implemented.

**Recommendation:** Add a minimal test setup (e.g. Vitest) and start with a few high-value unit tests: e.g. `parseTileKey` / `tileKey` round-trip, combat math, territory or supply helpers. Then add integration tests for `gameCore.stepSimulation` or key scripts if desired.

---

## 5. Dead code and duplication

### 5.1 [Medium] Backup file in tree

**Location:** `src/components/ui/GameHUD.tsx.bak`.

A backup file is committed. It can confuse tools and merge behavior.

**Recommendation:** Remove `GameHUD.tsx.bak` from the repo (and add `*.bak` to `.gitignore` if desired).

### 5.2 [Medium] Inlined hex key parsing instead of `parseTileKey`

**Location:** `src/types/game.ts` exports `parseTileKey(key: string): [number, number]`.

The same logic (`key.split(',').map(Number)`) is inlined in:

- `src/lib/ai.ts` — 766, 792, 816
- `src/lib/military.ts` — 202, 215
- `src/lib/mapGenerator.ts` — 308, 359–360
- `src/components/game/HexGrid.tsx` — 513, 1018
- `src/components/ui/GameHUD.tsx` — 513
- `src/store/useGameStore.ts` — 2150, 2190, 2210

**Recommendation:** Replace all inlined `key.split(',').map(Number)` with `parseTileKey(key)`. Optionally harden `parseTileKey` (e.g. return or throw on malformed input) so bad keys don’t produce `[NaN, NaN]` silently.

### 5.3 [Low] Empty catch in aiParams

**Location:** `src/lib/aiParams.ts` (25, 53–55, 63–65).

`getAiParams` and `setAiParams` / `resetAiParams` use `try { ... } catch (_) {}` when reading/writing localStorage. Failures (e.g. quota, private mode) are swallowed with no logging or user feedback.

**Recommendation:** At least log in development; optionally set a store flag or show a toast so the user knows save/load failed.

---

## 6. Documentation and configuration

### 6.1 [Medium] Wrong port in docs

- **README.md:** Says “Open http://localhost:3000”; dev server runs on **3010** (`next dev -p 3010` in `package.json`).
- **docs/WORKFLOW.md:** Links to `http://localhost:3000/workflow`; same issue.

**Recommendation:** Update both to use port **3010** (or document that the port is configurable).

### 6.2 [Medium] ESLint not configured

Running `npm run lint` triggers Next.js’s “How would you like to configure ESLint?” prompt. There is no `.eslintrc.*` or `eslintConfig` in `package.json`, so the project isn’t using a fixed ESLint config.

**Recommendation:** Run the Next.js ESLint setup (e.g. “Strict”) so `npm run lint` runs without prompts and CI can enforce rules.

### 6.3 [Low] README and layout

README describes map generation and controls well but doesn’t mention `src/core/`, API routes, or the scripts. Optional: add a short “Scripts” and “API” subsection so new contributors know where to look.

### 6.4 JSDoc

No systematic JSDoc (`@param`, `@returns`) in `src/`. Some files have short comments. Adding JSDoc to public APIs (e.g. `gameCore`, `gameLoop`, key libs) would help maintainability.

---

## 7. Quick reference table

| Priority | Finding | File(s) |
|----------|---------|--------|
| Critical | Game tick has no try/catch | `src/store/useGameStore.ts` ~468+ |
| High | Evolve POST body not validated | `src/app/api/evolve/route.ts` 39–45 |
| High | Workflow PUT unauthenticated, no size limit | `src/app/api/workflow/route.ts` |
| High | Evolve POST unauthenticated | `src/app/api/evolve/route.ts` |
| High | No tests or test runner | (entire project) |
| Medium | No React Error Boundary | (none) |
| Medium | Backup file in repo | `src/components/ui/GameHUD.tsx.bak` |
| Medium | Inlined hex parsing instead of `parseTileKey` | ai.ts, military.ts, mapGenerator, HexGrid, GameHUD, useGameStore |
| Medium | Wrong port in README / WORKFLOW | README.md, docs/WORKFLOW.md |
| Medium | ESLint not configured | (no .eslintrc) |
| Low | Empty catch in aiParams | `src/lib/aiParams.ts` |
| Low | README could mention scripts/API | README.md |

---

## 8. Suggested order of work

1. **Immediate:** Wrap game tick in try/catch and set error state; fix README/WORKFLOW port; remove `GameHUD.tsx.bak`.
2. **Short term:** Validate and bound evolve POST body; add ESLint config; add an Error Boundary around the game.
3. **Next:** Introduce a test runner and a few unit tests; centralize hex key parsing on `parseTileKey`.
4. **If exposing APIs:** Add auth or rate limits for workflow and evolve; add body size limit for workflow PUT.

*Last updated: 2026-03-16*
