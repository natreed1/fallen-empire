# Fallen Empire — Hex Strategy Map Engine

A procedurally generated hex-based strategy game map built with **Next.js 14**, **React Three Fiber**, and **Zustand**.

## Quick Start

```bash
cd fallen-empire
npm install
npm run dev
```

Open [http://localhost:3010](http://localhost:3010) (see `package.json` `dev` script for the port) to view the map.

## Documentation

- **[docs/README.md](docs/README.md)** — index of all design, deploy, and sim docs
- **[docs/WORKFLOW.md](docs/WORKFLOW.md)** — ideas, backlog, notes (editable at `/workflow` in dev)

## Common npm scripts


| Script                                            | Use                                                                          |
| ------------------------------------------------- | ---------------------------------------------------------------------------- |
| `npm run dev`                                     | Next.js client (default **port 3010**)                                       |
| `npm run game-server` / `npm run game-server:dev` | WebSocket game server for online play ([docs/DEPLOY.md](docs/DEPLOY.md))     |
| `npm run train-ai`                                | Evolve AI parameters headlessly ([docs/AI_TRAINING.md](docs/AI_TRAINING.md)) |
| `npm run validate-ai-params`                      | Check current AI param JSON against schema                                   |
| `npm run lint`                                    | Next.js ESLint                                                               |


Other scripts under `scripts/` (tournaments, regression harness, seasonal sim, etc.) are wired in `package.json`; see [docs/AI_TRAINING.md](docs/AI_TRAINING.md) and [docs/OPTIMIZATION.md](docs/OPTIMIZATION.md) for context.

## Repository layout


| Area                         | Path                        | Role                                                                          |
| ---------------------------- | --------------------------- | ----------------------------------------------------------------------------- |
| **App & routes**             | `src/app/`                  | Next.js App Router (`page.tsx`, `/login`, `/workflow`, `/evolve`, API routes) |
| **3D & map UI**              | `src/components/game/`      | `GameScene`, `HexGrid`, `MapController`                                       |
| **HUD & panels**             | `src/components/ui/`        | `GameHUD`, themed building panels                                             |
| **Game rules & sim helpers** | `src/lib/`                  | AI, combat, economy, siege, multiplayer bridge, map generation, etc.          |
| **Headless simulation**      | `src/core/gameCore.ts`      | Bot-vs-bot stepping for training and diagnostics                              |
| **Client state**             | `src/store/useGameStore.ts` | Zustand store, live tick, cycle runner                                        |
| **Types & constants**        | `src/types/game.ts`         | Tiles, units, tech tree, map config                                           |
| **Realtime server**          | `game-server/`              | Node WebSocket host for 1v1 ([docs/DEPLOY.md](docs/DEPLOY.md))                |
| **Tooling & training**       | `scripts/`                  | `train-ai.ts`, sim batteries, asset Python scripts                            |


## Private hosting (password gate)

Production deploys use a **built-in site password** by default (see `[src/lib/siteAuth.ts](src/lib/siteAuth.ts)`). Override with `SITE_PASSWORD` / `COOKIE_SECRET` in Vercel or `[.env.local](.env.example)` if needed. Locally, leave those unset for an open dev server, or set both to test `/login`.

## Controls

- **Pan:** Click + drag (or arrow keys)
- **Zoom:** Scroll wheel

## Architecture (client map stack)

The **visible map** still centers on instanced hex rendering and procedural terrain. Higher-level gameplay (cities, units, economy, AI) lives in `src/lib/` and `useGameStore`; **headless** training reuses `src/core/gameCore.ts`.

```
src/
├── app/                      # App Router, API routes, auth
├── components/game/          # GameScene, HexGrid, MapController
├── components/ui/            # HUD, panels, workflow viewer
├── lib/                      # Rules: mapGenerator, military, ai, economy, siege, …
├── core/gameCore.ts          # SimState, stepSimulation (training / diagnostics)
├── store/useGameStore.ts     # Live game state and tick
└── types/game.ts             # Types, tech tree, DEFAULT_MAP_CONFIG
```

## Map Generation Pipeline

### Pass 1: Biome Generation

- Multi-octave **simplex noise** (3 octaves) for elevation
- Separate noise layer for moisture
- Island-like **edge falloff** so water surrounds the landmass
- Biome classification: `elevation × moisture → biome`

### Pass 2: Collapsed Empire Overlay

1. **Province Centers:** Selected from plains/forest tiles with minimum spacing (Poisson-like)
2. **Road Network:** A* pathfinding between each center and its 3 nearest neighbors (cost: plains=1, forest=2, desert=2.5, mountain=5, water=impassable)
3. **Ruins:** Scattered with weighted probability (3× near roads, 2× near road-adjacent tiles)

## Rendering Strategy

All 10,000 hexes are rendered using **InstancedMesh** batched by type:

- 5 biome layers (water, plains, forest, mountain, desert)
- 1 road overlay layer
- 1 ruins overlay layer
- 1 province center marker layer (cone geometry)

This keeps draw calls to ~8 regardless of map size.

## Configuration

Edit `DEFAULT_MAP_CONFIG` in `src/types/game.ts`:


| Parameter         | Default | Description                          |
| ----------------- | ------- | ------------------------------------ |
| `width`           | 100     | Grid columns                         |
| `height`          | 100     | Grid rows                            |
| `seed`            | 42      | PRNG seed (deterministic generation) |
| `noiseScale`      | 0.035   | Elevation noise frequency            |
| `moistureScale`   | 0.045   | Moisture noise frequency             |
| `provinceDensity` | 0.015   | % of land tiles that become centers  |
| `ruinDensity`     | 0.03    | Base probability of ruins per tile   |


## Tech Stack

- **Next.js 14** (App Router)
- **TypeScript**
- **React Three Fiber** + **drei**
- **Zustand** (state management)
- **simplex-noise** (terrain generation)
- **Tailwind CSS** (UI overlays)

