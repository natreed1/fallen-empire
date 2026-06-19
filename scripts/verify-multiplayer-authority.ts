/**
 * Regression checks for multiplayer authority and fog-of-war rendering.
 * Run with: npm exec --yes tsx -- scripts/verify-multiplayer-authority.ts
 */
import { spawn, type ChildProcess } from 'child_process';
import { readFileSync } from 'fs';
import WebSocket, { type RawData } from 'ws';
import { initMultiplayerGame, stepSimulation, DEFAULT_AI_PARAMS } from '../src/core/gameCore';
import { emptyAiActions } from '../src/lib/ai';
import type { SerializedSimState } from '../src/lib/simStateSerialization';
import type { Unit } from '../src/types/game';

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parsePayload(data: unknown): unknown {
  if (typeof data === 'string') return JSON.parse(data);
  if (Buffer.isBuffer(data)) return JSON.parse(data.toString('utf8'));
  if (Array.isArray(data)) return JSON.parse(Buffer.concat(data).toString('utf8'));
  if (data instanceof ArrayBuffer) return JSON.parse(Buffer.from(data).toString('utf8'));
  if (ArrayBuffer.isView(data)) {
    return JSON.parse(Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8'));
  }
  return JSON.parse(String(data));
}

async function connect(port: number): Promise<WebSocket> {
  const deadline = Date.now() + 5000;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          ws.close();
          reject(new Error('WebSocket connect timeout'));
        }, 500);
        const onOpen = () => {
          cleanup();
          resolve();
        };
        const onError = (err: Error) => {
          cleanup();
          reject(err);
        };
        const cleanup = () => {
          clearTimeout(timer);
          ws.off('open', onOpen);
          ws.off('error', onError);
        };
        ws.once('open', onOpen);
        ws.once('error', onError);
      });
      return ws;
    } catch (err) {
      lastErr = err;
      await delay(100);
    }
  }
  throw new Error(`Could not connect to game server: ${String(lastErr)}`);
}

function waitForMessage<T = any>(
  ws: WebSocket,
  predicate: (msg: T) => boolean,
  timeoutMs = 4000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for WebSocket message'));
    }, timeoutMs);
    const onMessage = (data: RawData) => {
      const msg = parsePayload(data) as T;
      if (!predicate(msg)) return;
      cleanup();
      resolve(msg);
    };
    const onError = () => {
      cleanup();
      reject(new Error('WebSocket error'));
    };
    const cleanup = () => {
      clearTimeout(timer);
      ws.off('message', onMessage);
      ws.off('error', onError);
    };
    ws.on('message', onMessage);
    ws.on('error', onError);
  });
}

async function withServer<T>(fn: (port: number) => Promise<T>): Promise<T> {
  const port = 36000 + Math.floor(Math.random() * 2000);
  const child = spawn('npm', ['run', 'game-server'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      MULTIPLAYER_TICK_MS: '250',
    },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout?.on('data', chunk => { output += String(chunk); });
  child.stderr?.on('data', chunk => { output += String(chunk); });

  try {
    return await fn(port);
  } catch (err) {
    throw new Error(`${(err as Error).message}\nServer output:\n${output}`);
  } finally {
    await stopChild(child);
  }
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  if (child.pid) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  } else {
    child.kill('SIGTERM');
  }
  await Promise.race([
    new Promise<void>(resolve => child.once('exit', () => resolve())),
    delay(1500).then(() => {
      if (child.exitCode !== null) return;
      if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      } else {
        child.kill('SIGKILL');
      }
    }),
  ]);
}

function verifySharedMoveAuthority(): void {
  const p1 = 'player_ai';
  const p2 = 'player_ai_2';
  const base = initMultiplayerGame(987654);
  const p2City = base.cities.find(c => c.ownerId === p2);
  assert(p2City != null, 'expected a P2 city in multiplayer seed');
  const victim: Unit = {
    id: 'verify-p2-unit',
    type: 'infantry',
    q: p2City.q,
    r: p2City.r,
    ownerId: p2,
    hp: 100,
    maxHp: 100,
    xp: 0,
    level: 0,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
  };
  const target = Array.from(base.tiles.values()).find(t => t.q !== victim.q || t.r !== victim.r);
  assert(target != null, 'expected an alternate move target');
  const state = {
    ...base,
    units: [victim],
  };

  const stepped = stepSimulation(
    state,
    DEFAULT_AI_PARAMS,
    DEFAULT_AI_PARAMS,
    undefined,
    undefined,
    {
      humanPlansByPlayerId: {
        [p1]: { ...emptyAiActions(), moveTargets: [{ unitId: victim.id, toQ: target.q, toR: target.r }] },
        [p2]: emptyAiActions(),
      },
    },
  );
  const after = stepped.units.find(u => u.id === victim.id);
  assert(after != null, 'victim unit should survive the step');
  assert(
    after.targetQ !== target.q || after.targetR !== target.r,
    'P1 plan must not retarget a P2 unit',
  );
}

function verifyFogRenderingSources(): void {
  const hexGrid = readFileSync('src/components/game/HexGrid.tsx', 'utf8');
  assert(hexGrid.includes('opacity: 0.93'), 'unknown fog overlay should stay nearly opaque');
  assert(
    /for \(const tile of discoveredTilesMap\.values\(\)\) \{[\s\S]*groups\[tile\.biome\]\.push\(tile\);/.test(hexGrid),
    'terrain biome groups must be built from discovered tiles',
  );
  assert(
    /for \(const t of discoveredTilesMap\.values\(\)\) \{[\s\S]*isCoastalWaterTile\(t, discoveredTilesMap\)[\s\S]*isBeachLandTile\(t, discoveredTilesMap\)/.test(hexGrid),
    'shoreline layers must not inspect undiscovered tiles',
  );
}

async function verifyServerAuthority(): Promise<void> {
  await withServer(async port => {
    const sockets: WebSocket[] = [];
    try {
      const roomId = `verify-${Date.now()}`;
      const host = await connect(port);
      sockets.push(host);
      const hostJoined = waitForMessage(host, msg => msg.type === 'joined');
      const initialState = waitForMessage<{ type: string; payload: SerializedSimState }>(
        host,
        msg => msg.type === 'state',
      );
      host.send(JSON.stringify({ type: 'join', roomId, role: 'host' }));
      await hostJoined;

      const duplicateHost = await connect(port);
      sockets.push(duplicateHost);
      const duplicateHostRejected = waitForMessage(duplicateHost, msg => msg.type === 'error');
      duplicateHost.send(JSON.stringify({ type: 'join', roomId, role: 'host' }));
      const duplicateHostError = await duplicateHostRejected;
      assert(String(duplicateHostError.message).includes('Host slot'), 'duplicate host must be rejected');

      const initialStateMsg = await initialState;

      host.send(JSON.stringify({
        type: 'plan',
        plan: {
          moveTargets: [
            { unitId: 'opponent-or-missing-unit', toQ: 3, toR: 3 },
            { unitId: 'opponent-or-missing-unit', toQ: Number.NaN, toR: 3 },
          ],
        },
      }));
      host.send(JSON.stringify({ type: 'plan', plan: { moveTargets: { unitId: 'bad-shape', toQ: 4, toR: 4 } } }));

      const guest = await connect(port);
      sockets.push(guest);
      const guestJoined = waitForMessage(guest, msg => msg.type === 'joined');
      const nextState = waitForMessage<{ type: string; payload: SerializedSimState }>(
        host,
        msg => msg.type === 'state' && msg.payload.cycle > initialStateMsg.payload.cycle,
      );
      guest.send(JSON.stringify({ type: 'join', roomId, role: 'guest' }));
      await guestJoined;

      const nextStateMsg = await nextState;
      assert(nextStateMsg.payload.phase === 'playing', 'server should survive malformed move plan');
    } finally {
      for (const socket of sockets) socket.terminate();
    }
  });
}

async function main(): Promise<void> {
  verifySharedMoveAuthority();
  verifyFogRenderingSources();
  await verifyServerAuthority();
  console.log('verify-multiplayer-authority: ok');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
