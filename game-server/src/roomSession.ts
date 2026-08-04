/**
 * Multiplayer room session hygiene: dead-socket prune, role reclaim, host-pause cleanup.
 * Uses a minimal socket shape so shared verify scripts can import without `ws` types.
 */

export type RoomRole = 'host' | 'guest';

/** Minimal socket handle used by session helpers (compatible with `ws` WebSocket). */
export type RoomSocket = {
  readyState: number;
  close?: () => void;
};

export type RoomClientMeta = {
  socket: RoomSocket;
  role: RoomRole;
  playerId: string;
};

export type SessionRoom = {
  clients: Map<RoomSocket, RoomClientMeta>;
  paused: boolean;
};

/** Drop sockets that are no longer OPEN so capacity checks see live peers only. */
export function pruneDeadClients(
  room: SessionRoom,
  isOpen: (socket: RoomSocket) => boolean,
): number {
  let removed = 0;
  for (const [socket] of room.clients) {
    if (!isOpen(socket)) {
      room.clients.delete(socket);
      removed++;
    }
  }
  return removed;
}

export function findSocketByRole(room: SessionRoom, role: RoomRole): RoomSocket | null {
  for (const [socket, meta] of room.clients) {
    if (meta.role === role) return socket;
  }
  return null;
}

export type JoinDecision =
  | { ok: true; replaced: RoomSocket | null }
  | { ok: false; reason: string };

/**
 * Accept a join for `role`, reclaiming a prior seat for that role (reconnect / zombie),
 * or rejecting when both seats are held by other live roles.
 */
export function decideRoomJoin(
  room: SessionRoom,
  role: RoomRole,
  isOpen: (socket: RoomSocket) => boolean,
): JoinDecision {
  pruneDeadClients(room, isOpen);
  const existing = findSocketByRole(room, role);
  if (existing) {
    return { ok: true, replaced: existing };
  }
  if (room.clients.size >= 2) {
    return { ok: false, reason: 'Room is full.' };
  }
  return { ok: true, replaced: null };
}

/**
 * Apply disconnect side effects. Host leaving must clear pause so a guest is not soft-locked
 * waiting for an unpause only the departed host could send.
 */
export function applyClientDisconnect(room: SessionRoom, meta: RoomClientMeta | undefined): void {
  if (meta?.role === 'host' && room.paused) {
    room.paused = false;
  }
}
