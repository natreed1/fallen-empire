/**
 * Authoritative multiplayer match process: WebSocket rooms + headless {@link stepSimulation}.
 * Run from repo root: `npm run game-server` or `cd game-server && npm run dev`.
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

const PORT = Number(process.env.PORT ?? 3333);
const TICK_MS = Number(process.env.MULTIPLAYER_TICK_MS ?? 4000);

const P1 = 'player_ai';
const P2 = 'player_ai_2';

type ClientMeta = { socket: WebSocket; role: 'host' | 'guest'; playerId: typeof P1 | typeof P2 };

type Room = {
  id: string;
  state: SimState | null;
  clients: Map<WebSocket, ClientMeta>;
  pending: Record<string, AiActions>;
  tickTimer: ReturnType<typeof setInterval> | null;
};

const rooms = new Map<string, Room>();

function getOrCreateRoom(roomId: string): Room {
  let r = rooms.get(roomId);
  if (!r) {
    r = {
      id: roomId,
      state: null,
      clients: new Map(),
      pending: { [P1]: emptyAiActions(), [P2]: emptyAiActions() },
      tickTimer: null,
    };
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
  broadcast(room, {
    type: 'lobby',
    players: room.clients.size,
    maxPlayers: 2,
    started: room.clients.size >= 2 && room.state != null,
  });
}

function mergePlan(base: AiActions, patch: Partial<AiActions>): AiActions {
  const mt = new Map<string, { unitId: string; toQ: number; toR: number }>();
  for (const m of base.moveTargets) mt.set(m.unitId, m);
  for (const m of patch.moveTargets ?? []) mt.set(m.unitId, m);
  return {
    ...base,
    ...patch,
    moveTargets: Array.from(mt.values()),
  };
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

  const ser = serializeSimState(room.state) as SerializedSimState;
  broadcast(room, { type: 'state', payload: ser });
}

function maybeStartTick(room: Room): void {
  if (room.tickTimer) return;
  if (room.clients.size < 2 || !room.state) return;
  room.tickTimer = setInterval(() => stepRoom(room), TICK_MS);
  stepRoom(room);
}

function stopTick(room: Room): void {
  if (room.tickTimer) {
    clearInterval(room.tickTimer);
    room.tickTimer = null;
  }
}

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (socket) => {
  socket.on('message', (data) => {
    let msg: { type?: string; roomId?: string; role?: 'host' | 'guest'; plan?: Partial<AiActions> };
    try {
      msg = JSON.parse(String(data));
    } catch {
      socket.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      return;
    }

    if (msg.type === 'join' && msg.roomId && msg.role) {
      const room = getOrCreateRoom(msg.roomId);
      if (room.clients.has(socket)) return;

      if (msg.role === 'host') {
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
        if (room.clients.size >= 2) {
          socket.send(JSON.stringify({ type: 'error', message: 'Room is full.' }));
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
          tickMs: TICK_MS,
        }),
      );

      if (room.state) {
        socket.send(JSON.stringify({ type: 'state', payload: serializeSimState(room.state) }));
      }

      broadcastLobby(room);
      maybeStartTick(room);
      return;
    }

    if (msg.type === 'plan' && msg.plan) {
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
      const cur = found.pending[meta.playerId] ?? emptyAiActions();
      found.pending[meta.playerId] = mergePlan(cur, msg.plan);
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
