# AGENTS.md

## Cursor Cloud specific instructions

Fallen Empire is a browser-based hex strategy game: **Next.js 14 (App Router) + React Three Fiber + Zustand**, TypeScript-first, with an optional standalone Node WebSocket multiplayer server. State is fully in-memory (browser Zustand + game-server rooms) — there is **no database, Redis, or other backing service** to run. Package manager is **npm** (root and `game-server/` each have their own lockfile). See `README.md` for architecture and `package.json` `scripts` for the full command list.

### Services

| Service | Command (from repo root) | Port | Required for |
| --- | --- | --- | --- |
| Next.js dev app | `npm run dev` | **3010** | The game itself, plus `/workflow` and `/evolve` routes and the auth API. This is the primary product surface. |
| Multiplayer game server | `npm run game-server` | **3333** (WS) | Only 1v1 Online multiplayer. Optional for solo/vs-AI/spectate/battle-test. |

Non-obvious notes:

- **Dev port is 3010, not 3000.** Some docs mention 3000; the `dev` script pins `-p 3010`.
- The dev server uses `WATCHPACK_POLLING=true` (already in the `dev` script) so file-watch/hot-reload works reliably in this VM.
- No password gate by default: leave `SITE_PASSWORD`/`COOKIE_SECRET` unset in local dev (see `.env.example`) so the app stays open. Set both only to test `/login`.

### Game server gotcha (important)

- Start it with the **root** command `npm run game-server` (which runs `npx tsx game-server/src/index.ts` using the latest `tsx`). This works.
- Do **not** use the game-server's own local scripts (`cd game-server && npm start` / `npm run dev`). Its pinned `tsx@4.21.0` fails with `SyntaxError: ... does not provide an export named 'DEFAULT_AI_PARAMS'` (an ESM re-export resolution quirk in `src/core/gameCore.ts`). The root command's newer `tsx` resolves it correctly.
- On a cold VM `npx tsx` may prompt to install `tsx` interactively. To start non-interactively, run `npx --yes tsx game-server/src/index.ts` from the repo root.
- Quick health check: connect a WS client to `ws://127.0.0.1:3333` and send `{"type":"join","roomId":"<uuid>","role":"host"}` — the server replies with `joined`, then a full `state`, then `lobby`. (Note the field is `roomId`, not `room`.)

### Lint / static checks

- `npm run lint` runs `next lint`. The repo did not ship an ESLint config, so a minimal `.eslintrc.json` (`extends: next/core-web-vitals`) was added to keep lint non-interactive. Without it, `next lint` prompts and blocks.
- `npm run lint` currently reports **pre-existing** `react-hooks/exhaustive-deps` warnings and `react-hooks/rules-of-hooks` errors in `src/components/game/HexGrid.tsx` and `src/components/ui/GameHUD.tsx`. These are in existing product code, not environment issues.

### Headless simulation / AI CLI tools

- No automated unit/integration test suite exists yet. Validation is via CLI sim scripts (`npm run validate-ai-params`, `train-ai`, `regression-harness`, etc.) which run through `npx ts-node` with `tsconfig.train.json`, and via manual browser play.
- Python scripts under `scripts/*.py` (`npm run generate-biomes`, etc.) are only for regenerating sprite/biome assets and are not needed to run or play the game.
