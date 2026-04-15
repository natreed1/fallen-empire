# Plan: Multiplayer 1v1 (shareable link + dedicated game server)

**Summary:** Add **real-time PvP** where one player hosts a match, shares a URL, and a second player joins. **Next.js** stays the app shell and client; a **separate Node process** runs **WebSockets + authoritative simulation** (in-memory rooms for v1). This matches the agreed architecture: avoid serverless game loops; keep one source of truth per match.

**Last updated:** 2026-04-15

---

## 1. Goals and non-goals

### Goals (v1)

- Two humans in one match, **stable** for a full session (~35 min game duration).
- **Join by link:** e.g. `/multiplayer?room=<id>` or `/play/<roomId>` with room created by host.
- **Server authority:** movement, combat resolution, economy cycles, and timers advance only on the game server; clients send **intents**, receive **state or events**.
- **Per-player visibility:** each client receives only what their fog-of-war allows (reuse existing vision concepts: `visibleHexes` / `exploredHexes` or equivalent).

### Non-goals (defer)

- Matchmaking, ELO, global lobby browser.
- Spectators (beyond maybe a later phase).
- Horizontal scaling of game processes (multiple shards) — v1 is **one game server process**, in-memory rooms.
- Mobile app or native clients.
- Full anti-cheat beyond “server validates everything.”

---

## 2. Current state (reference)

- **Client:** React + Three (`GameScene`, `MapController`, `HexGrid`), state in **`useGameStore.ts`** (Zustand), **real-time loop** via `setInterval` (`startRealTimeLoop`), **`Date.now()`**-based timers (`nextCycleTime`, captures, scouts, etc.).
- **Human identity:** `HUMAN_ID = 'player_human'` and many branches assume a single local human.
- **Headless stepping:** `src/core/gameCore.ts` (`stepSimulation`) — useful reference for deterministic ticks, not yet a drop-in network server.
- **No** WebSocket or multiplayer code in `package.json` or app flow today.
- **Deploy:** `DEPLOY.md` describes Vercel for the Next app; gameplay is browser-only today.

---

## 3. Target architecture

```
[Browser A] ──WS──► [ Game server: Node ]
[Browser B] ──WS──►     rooms + tick loop + validate intents
       ▲                      │
       └──── state/events ────┘
[Next.js]  static pages, API (optional: create room token only)
```

- **Game server:** Long-lived process (Fly.io, Railway, Render, VPS, or Docker). Holds `Map<roomId, RoomState>`.
- **Transport:** **WebSocket** (single full-duplex channel per client per match). JSON messages with a small versioned schema (`type`, `payload`).
- **Tick model:** Server owns **tick index** and/or **sim time**; replace or mirror client `Date.now()` for match-relative deadlines so both clients stay in sync.
- **Client:** “Thin” for multiplayer: either fork state application from server snapshots + deltas, or replay intents locally only after server ack (simpler: **server snapshot or event stream** early on).

---

## 4. Phased implementation

### Phase 0 — Repo and contracts (0.5–1 day)

- Add **`/game-server`** (or `packages/game-server`) with its own `package.json`: `ws` or `uWebSockets.js`, TypeScript, `tsx`/`ts-node` for dev.
- Define **message protocol** (version field on connect or first message):
  - Client → server: `join`, `intent` (move, recruit, build, … — start minimal).
  - Server → client: `welcome` (assigned `playerId`, `tick`), `state` (full or partial), `error`, `game_over`.
- Add **env:** `GAME_SERVER_URL` / `NEXT_PUBLIC_GAME_SERVER_URL` for WebSocket base URL (dev: `ws://localhost:3333`).

**Exit:** Two test clients (or a small HTML page) can connect, join the same room id, receive tick heartbeats.

---

### Phase 1 — Room lifecycle and join-by-link (1–2 days)

- **Create room:** Host opens “Create multiplayer game”; client generates or requests `roomId` (UUID), connects WebSocket, registers as **player 1**.
- **Join:** Second player opens shared URL with `roomId`; connects as **player 2**; server rejects when room full or already started (rules TBD: allow spectator later or not).
- **Optional thin Next route:** `POST /api/multiplayer/room` could mint `roomId` + short-lived secret; for v1, **client-generated UUID** is acceptable if the game server validates membership on first connect.

**Exit:** From two browsers, both show “in lobby” for same room; server lists 2 connections.

---

### Phase 2 — Extract simulation authority (largest slice; 1–2+ weeks)

**Objective:** One code path advances the world on the server.

- **Snapshot format:** Serialize game state to JSON-safe structures (convert `Map`/`Set` to arrays or plain objects; document in one module e.g. `serializeGameState` / `deserializeGameState`).
- **Tick loop on server:** Run at same logical rate as today (~1 Hz combat/movement tick, 30 s economy cycle — reuse constants from `src/types/game.ts`). Drive **`tick` or `simTimeMs`** from server only.
- **Refactor human-specific logic:** Replace global `HUMAN_ID` checks with **`sessionPlayerId`** (or two fixed ids in 1v1: `player_a`, `player_b`) everywhere intents and UI permissions matter.
- **Wire intents:** Map user actions currently calling Zustand methods to **messages** validated server-side (e.g. `moveUnit`, `setCityProduction` — prioritize the minimal set needed to play a short match).

**Exit:** Headless or scripted test: server runs a match with two fake clients sending intents; state advances without the React app.

---

### Phase 3 — Client integration (1 week)

- **Mode flag:** e.g. `gameMode === 'multiplayer'` or `connectionRole === 'online'`.
- **Disable local loop** in multiplayer: do not run `startRealTimeLoop` for full authority; instead apply **server messages** to a **receiver** slice of state (or full replace per tick for v1 simplicity).
- **HUD:** Only show controls for **local** `playerId`; opponent actions visible per fog rules.
- **Reconnect (minimal):** On reconnect, client sends `join` with same `roomId` + optional token; server sends **full snapshot** + current tick.

**Exit:** Two humans can complete a match over the internet against each other using the real UI.

---

### Phase 4 — Fog, bandwidth, polish (ongoing)

- **Fog filtering:** Server computes each player’s visibility; **strip** hidden units/tiles from payloads (or send binary patches per region later).
- **Delta updates:** Start with full-state snapshots every N ticks if needed; optimize to deltas once stable.
- **Desync detection:** Optional hash of critical state per tick in dev builds.

---

### Phase 5 — Deploy and ops

- **Dockerfile** for game server; health check endpoint (`GET /health`).
- **Deploy** game server to Fly/Railway/Render; set `NEXT_PUBLIC_GAME_SERVER_URL` in Vercel (or wherever Next is hosted).
- **CORS / WSS:** Use `wss://` in production; TLS termination at host or reverse proxy.

---

## 5. Key files and areas (expected touch points)

| Area | Files / notes |
|------|----------------|
| Protocol + server entry | New `game-server/src/index.ts`, `game-server/src/messages.ts` |
| Serialization | New or `src/lib/gameStateSerialization.ts` (shared types imported from `src/types/game.ts` where possible) |
| Simulation | `src/store/useGameStore.ts` (split “pure step” vs “React store”), `src/lib/gameLoop.ts`, `src/lib/military.ts`, `src/core/gameCore.ts` |
| Human / player id | `useGameStore.ts`, `GameHUD.tsx`, `MapController.tsx`, selection flows |
| Client WS hook | New hook e.g. `useMultiplayerConnection.ts`, wired from `GameScene.tsx` or page |

Exact file list will grow during Phase 2; treat this as a map, not an exhaustive checklist.

---

## 6. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| **Duplicate logic** (client vs server) | Prefer **shared modules** for validation and tick steps; server is canonical. |
| **Clock skew** | Server-owned tick index + sim-relative deadlines. |
| **Large payloads** | Fog filtering + later deltas; cap snapshot rate. |
| **Vercel confusion** | Document clearly: **Next = static/UI**; **game server = separate service** (`DEPLOY.md` addendum). |

---

## 7. Success criteria (v1 done)

- [ ] Two players, two machines, same match via shared link.
- [ ] No desync on core actions (move, fight, economy) under normal latency.
- [ ] Game server deployable with env-configured WebSocket URL; Next app works against prod `wss://`.

---

## Related docs

- [`DEPLOY.md`](DEPLOY.md) — current Next-only deploy; extend with game server section when ready.
- [`WORKFLOW.md`](WORKFLOW.md) — ideas/backlog for follow-ups (matchmaking, etc.).
