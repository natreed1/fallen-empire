# Fallen Empire — Hex Strategy Map Engine

A procedurally generated hex-based strategy game map built with **Next.js 14**, **React Three Fiber**, and **Zustand**.

## Quick Start

```bash
cd fallen-empire
npm install
npm run dev
```

Open [http://localhost:3010](http://localhost:3010) (see `package.json` `dev` script for the port) to view the map.

## Private hosting (password gate)

To share the game on a **private** URL (e.g. Vercel), set `SITE_PASSWORD` and `COOKIE_SECRET` in the environment. See [`.env.example`](.env.example) and the full steps in [`docs/DEPLOY.md`](docs/DEPLOY.md). With both unset, the app stays open (normal local development).

## Controls

- **Pan:** Click + drag (or arrow keys)
- **Zoom:** Scroll wheel

## Architecture

```
src/
├── app/
│   ├── globals.css          # Tailwind base styles
│   ├── layout.tsx           # Root layout with metadata
│   └── page.tsx             # Entry point (dynamic imports GameScene)
├── components/game/
│   ├── GameScene.tsx         # R3F Canvas, camera, lights, UI overlay
│   ├── HexGrid.tsx           # InstancedMesh rendering (5 biome + 3 overlay layers)
│   └── MapController.tsx     # Isometric pan/zoom via MapControls
├── lib/
│   └── mapGenerator.ts       # Pure map generation (noise + empire overlay)
├── store/
│   └── useGameStore.ts       # Zustand store holding the grid state
└── types/
    └── game.ts               # Tile types, hex math, visual constants
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

| Parameter        | Default | Description                          |
|------------------|---------|--------------------------------------|
| `width`          | 100     | Grid columns                         |
| `height`         | 100     | Grid rows                            |
| `seed`           | 42      | PRNG seed (deterministic generation) |
| `noiseScale`     | 0.035   | Elevation noise frequency            |
| `moistureScale`  | 0.045   | Moisture noise frequency             |
| `provinceDensity`| 0.015   | % of land tiles that become centers  |
| `ruinDensity`    | 0.03    | Base probability of ruins per tile   |

## Tech Stack

- **Next.js 14** (App Router)
- **TypeScript**
- **React Three Fiber** + **drei**
- **Zustand** (state management)
- **simplex-noise** (terrain generation)
- **Tailwind CSS** (UI overlays)
