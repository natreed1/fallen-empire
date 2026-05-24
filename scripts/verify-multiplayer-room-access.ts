import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { randomUUID } from 'crypto';

type ServerMessage = {
  type?: string;
  role?: string;
  playerSlot?: string;
  message?: string;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForServer(server: ChildProcessWithoutNullStreams): Promise<void> {
  let output = '';
  const ready = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`server did not start; output:\n${output}`)), 15_000);
    server.stdout.on('data', chunk => {
      output += String(chunk);
      if (output.includes('Fallen Empire game server listening')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    server.stderr.on('data', chunk => {
      output += String(chunk);
    });
    server.on('exit', code => {
      clearTimeout(timeout);
      reject(new Error(`server exited early with code ${code}; output:\n${output}`));
    });
  });
  await ready;
}

function openSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`timed out connecting to ${url}`));
    }, 5_000);
    socket.addEventListener('open', () => {
      clearTimeout(timeout);
      resolve(socket);
    }, { once: true });
    socket.addEventListener('error', () => {
      clearTimeout(timeout);
      reject(new Error(`websocket connection failed for ${url}`));
    }, { once: true });
  });
}

function readMessage(socket: WebSocket, expectedType: string): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.removeEventListener('message', onMessage);
      reject(new Error(`timed out waiting for ${expectedType}`));
    }, 5_000);
    function onMessage(event: MessageEvent) {
      const raw = typeof event.data === 'string' ? event.data : Buffer.from(event.data as ArrayBuffer).toString('utf8');
      const parsed = JSON.parse(raw) as ServerMessage;
      if (parsed.type !== expectedType) return;
      clearTimeout(timeout);
      socket.removeEventListener('message', onMessage);
      resolve(parsed);
    }
    socket.addEventListener('message', onMessage);
  });
}

function send(socket: WebSocket, message: object): void {
  socket.send(JSON.stringify(message));
}

async function main() {
  const port = 37_000 + Math.floor(Math.random() * 1_000);
  const roomId = `room-access-${randomUUID()}`;
  const server = spawn('npm', ['--prefix', 'game-server', 'start'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), MULTIPLAYER_TICK_MS: '60000' },
  });

  const sockets: WebSocket[] = [];
  try {
    await waitForServer(server);
    const url = `ws://127.0.0.1:${port}`;

    const host = await openSocket(url);
    sockets.push(host);
    send(host, { type: 'join', roomId, role: 'host' });
    const hostJoined = await readMessage(host, 'joined');
    assert(hostJoined.role === 'host' && hostJoined.playerSlot === 'player_ai', 'first host should claim player_ai');

    const duplicateHost = await openSocket(url);
    sockets.push(duplicateHost);
    send(duplicateHost, { type: 'join', roomId, role: 'host' });
    const duplicateHostError = await readMessage(duplicateHost, 'error');
    assert(
      duplicateHostError.message === 'Host already joined this room.',
      `duplicate host should be rejected, got: ${duplicateHostError.message}`,
    );

    send(duplicateHost, { type: 'sim_control', paused: true });
    const controlError = await readMessage(duplicateHost, 'error');
    assert(controlError.message === 'Not in a room', 'rejected duplicate host must not retain host controls');

    const guest = await openSocket(url);
    sockets.push(guest);
    send(guest, { type: 'join', roomId, role: 'guest' });
    const guestJoined = await readMessage(guest, 'joined');
    assert(guestJoined.role === 'guest' && guestJoined.playerSlot === 'player_ai_2', 'guest should claim player_ai_2');

    const duplicateGuest = await openSocket(url);
    sockets.push(duplicateGuest);
    send(duplicateGuest, { type: 'join', roomId, role: 'guest' });
    const duplicateGuestError = await readMessage(duplicateGuest, 'error');
    assert(
      duplicateGuestError.message === 'Guest already joined this room.',
      `duplicate guest should be rejected, got: ${duplicateGuestError.message}`,
    );

    console.log('verify-multiplayer-room-access: ok');
  } finally {
    for (const socket of sockets) socket.close();
    server.kill('SIGTERM');
    await wait(250);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
