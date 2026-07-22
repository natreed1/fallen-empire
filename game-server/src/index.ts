/**
 * Authoritative multiplayer match process: WebSocket rooms + headless {@link stepSimulation}.
 * Run from repo root: `npm run game-server` or `cd game-server && npm run dev`.
 *
 * Each server interval runs one full {@link stepSimulation} (economy + one movement pass).
 * The client live loop runs 30 movement ticks per economy; SimState.globalMovementTick
 * advances by 30 per step so timers/scouts/capture stay in the same tick space. Finer
 * movement parity would require extracting a movement-only step and calling it 30× per economy.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import {
  initMultiplayerGame,
  stepSimulation,
  DEFAULT_AI_PARAMS,
  type SimState,
} from '../../src/core/gameCore.ts';
import { emptyAiActions, type AiActions } from '../../src/lib/ai.ts';
import { serializeSimState, type SerializedSimState } from '../../src/lib/simStateSerialization.ts';
import { MAX_MATCH_ECONOMY_CYCLES } from '../../src/types/game.ts';
import { mergeClientPlan, sanitizeClientPlan } from './clientPlans.ts';

const PORT = Number(process.env.PORT ?? 3333);
const TICK_MS = Number(process.env.MULTIPLAYER_TICK_MS ?? 4000);

const P1 = 'player_ai';
const P2 = 'player_ai_2';

const SIM_SPEEDS = [0.5, 1, 2, 4] as const;
type SimSpeedMultiplier = (typeof SIM_SPEEDS)[number];

type ClientMeta = { socket: WebSocket; role: 'host' | 'guest'; playerId: typeof P1 | typeof P2 };

type Room = {
  id: string;
  state: SimState | null;
  clients: Map<WebSocket, ClientMeta>;
  pending: Record<string, AiActions>;
  tickTimer: ReturnType<typeof setInterval> | null;
  /** Economy / AI step interval (derived from {@link TICK_MS} / speed). */
  effectiveTickMs: number;
  speedMultiplier: SimSpeedMultiplier;
  paused: boolean;
};

const rooms = new Map<string, Room>();

function roomEffectiveTickMs(room: Room): number {
  return Math.max(250, Math.round(TICK_MS / room.speedMultiplier));
}

function getOrCreateRoom(roomId: string): Room {
  let r = rooms.get(roomId);
  if (!r) {
    r = {
      id: roomId,
      state: null,
      clients: new Map(),
      pending: { [P1]: emptyAiActions(), [P2]: emptyAiActions() },
      tickTimer: null,
      speedMultiplier: 1,
      paused: false,
      effectiveTickMs: TICK_MS,
    };
    r.effectiveTickMs = roomEffectiveTickMs(r);
    rooms.set(roomId, r);
  }
  return r;
}

function broadcast(room: Room, msg: object): void {
  const raw = JSON.stringify(msg);
  for (const { socket } of room.clients.values()) {
    if (socket.readyState === WebSocket.OPEN) socket.send(raw);
  }
}

function broadcastLobby(room: Room): void {
  room.effectiveTickMs = roomEffectiveTickMs(room);
  broadcast(room, {
    type: 'lobby',
    players: room.clients.size,
    maxPlayers: 2,
    started: room.clients.size >= 2 && room.state != null,
    tickMs: room.effectiveTickMs,
    paused: room.paused,
    speedMultiplier: room.speedMultiplier,
  });
}

function broadcastSimSettings(room: Room): void {
  room.effectiveTickMs = roomEffectiveTickMs(room);
  broadcast(room, {
    type: 'sim_settings',
    tickMs: room.effectiveTickMs,
    paused: room.paused,
    speedMultiplier: room.speedMultiplier,
  });
}

function hasClientWithRole(room: Room, role: ClientMeta['role']): boolean {
  return Array.from(room.clients.values()).some(client => client.role === role);
}

function stepRoom(room: Room): void {
  if (!room.state || room.state.phase !== 'playing') return;
  const plans: Record<string, AiActions> = {
    [P1]: room.pending[P1] ?? emptyAiActions(),
    [P2]: room.pending[P2] ?? emptyAiActions(),
  };
  room.pending[P1] = emptyAiActions();
  room.pending[P2] = emptyAiActions();

  room.state = stepSimulation(
    room.state,
    DEFAULT_AI_PARAMS,
    DEFAULT_AI_PARAMS,
    undefined,
    undefined,
    { humanPlansByPlayerId: plans },
  );

  if (room.state.phase === 'playing' && room.state.cycle >= MAX_MATCH_ECONOMY_CYCLES) {
    room.state = { ...room.state, phase: 'victory' };
  }

  const ser = serializeSimState(room.state) as SerializedSimState;
  broadcast(room, { type: 'state', payload: ser });
}

function maybeStartTick(room: Room): void {
  if (room.tickTimer) return;
  if (room.paused || room.clients.size < 2 || !room.state) return;
  const ms = roomEffectiveTickMs(room);
  room.effectiveTickMs = ms;
  room.tickTimer = setInterval(() => stepRoom(room), ms);
  stepRoom(room);
}

function stopTick(room: Room): void {
  if (room.tickTimer) {
    clearInterval(room.tickTimer);
    room.tickTimer = null;
  }
}

function restartTickIfRunning(room: Room): void {
  if (!room.tickTimer) return;
  stopTick(room);
  maybeStartTick(room);
}

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (socket) => {
  socket.on('message', (data) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(data));
    } catch {
      socket.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      socket.send(JSON.stringify({ type: 'error', message: 'Invalid message' }));
      return;
    }
    const msg = parsed as {
      type?: unknown;
      roomId?: unknown;
      role?: unknown;
      plan?: unknown;
      paused?: unknown;
      speedMultiplier?: unknown;
    };

    if (msg.type === 'sim_control') {
      let found: Room | undefined;
      let meta: ClientMeta | undefined;
      for (const r of rooms.values()) {
        const m = r.clients.get(socket);
        if (m) {
          found = r;
          meta = m;
          break;
        }
      }
      if (!found || !meta) {
        socket.send(JSON.stringify({ type: 'error', message: 'Not in a room' }));
        return;
      }
      if (meta.role !== 'host') {
        socket.send(JSON.stringify({ type: 'error', message: 'Only the host can change game speed or pause.' }));
        return;
      }
      let changed = false;
      if (typeof msg.paused === 'boolean' && msg.paused !== found.paused) {
        found.paused = msg.paused;
        changed = true;
        if (msg.paused) stopTick(found);
        else maybeStartTick(found);
      }
      if (
        typeof msg.speedMultiplier === 'number' &&
        (SIM_SPEEDS as readonly number[]).includes(msg.speedMultiplier)
      ) {
        const sp = msg.speedMultiplier as SimSpeedMultiplier;
        if (sp !== found.speedMultiplier) {
          found.speedMultiplier = sp;
          changed = true;
          restartTickIfRunning(found);
        }
      }
      if (changed) {
        broadcastSimSettings(found);
        broadcastLobby(found);
      }
      return;
    }

    if (msg.type === 'join') {
      if (
        typeof msg.roomId !== 'string' ||
        msg.roomId.trim().length === 0 ||
        (msg.role !== 'host' && msg.role !== 'guest')
      ) {
        socket.send(JSON.stringify({ type: 'error', message: 'Invalid room id or role.' }));
        return;
      }
      const room = getOrCreateRoom(msg.roomId);
      if (room.clients.has(socket)) return;

      if (msg.role === 'host') {
        if (hasClientWithRole(room, 'host')) {
          socket.send(JSON.stringify({ type: 'error', message: 'Host slot is already occupied.' }));
          return;
        }
        if (!room.state) {
          const seed = Math.floor(Math.random() * 1e9);
          room.state = initMultiplayerGame(seed);
        }
        room.clients.set(socket, { socket, role: 'host', playerId: P1 });
      } else {
        if (!room.state) {
          socket.send(JSON.stringify({ type: 'error', message: 'Room not created yet — host must join first.' }));
          return;
        }
        if (hasClientWithRole(room, 'guest')) {
          socket.send(JSON.stringify({ type: 'error', message: 'Guest slot is already occupied.' }));
          return;
        }
        room.clients.set(socket, { socket, role: 'guest', playerId: P2 });
      }

      socket.send(
        JSON.stringify({
          type: 'joined',
          roomId: room.id,
          role: msg.role,
          playerSlot: msg.role === 'host' ? P1 : P2,
          tickMs: roomEffectiveTickMs(room),
          paused: room.paused,
          speedMultiplier: room.speedMultiplier,
        }),
      );

      if (room.state) {
        socket.send(JSON.stringify({ type: 'state', payload: serializeSimState(room.state) }));
      }

      broadcastLobby(room);
      maybeStartTick(room);
      return;
    }

    if (msg.type === 'plan' && msg.plan !== undefined) {
      let found: Room | undefined;
      let meta: ClientMeta | undefined;
      for (const r of rooms.values()) {
        const m = r.clients.get(socket);
        if (m) {
          found = r;
          meta = m;
          break;
        }
      }
      if (!found || !meta) {
        socket.send(JSON.stringify({ type: 'error', message: 'Not in a room' }));
        return;
      }
      if (!found.state) {
        socket.send(JSON.stringify({ type: 'error', message: 'Room has no active game' }));
        return;
      }
      const cur = found.pending[meta.playerId] ?? emptyAiActions();
      const sanitized = sanitizeClientPlan(msg.plan, found.state, meta.playerId);
      found.pending[meta.playerId] = mergeClientPlan(cur, sanitized);
      return;
    }
  });

  socket.on('close', () => {
    for (const [rid, room] of rooms) {
      if (room.clients.delete(socket)) {
        stopTick(room);
        if (room.clients.size === 0) rooms.delete(rid);
      }
    }
  });
});

console.log(`Fallen Empire game server listening on ws://localhost:${PORT} (tick ${TICK_MS}ms)`);
console.log(`Create a room id (e.g. ${randomUUID()}) — host joins with role host, guest with role guest.`);
