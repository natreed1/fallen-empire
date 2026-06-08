import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';

import { emptyAiActions } from '../src/lib/ai';
import { initMultiplayerGame, stepSimulation, DEFAULT_AI_PARAMS } from '../src/core/gameCore';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type ServerProcess = ChildProcessByStdio<null, Readable, Readable>;

function waitForServerReady(child: ServerProcess, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for game server startup. Output:\n${output}`));
    }, timeoutMs);
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes('Fallen Empire game server listening')) {
        cleanup();
        resolve();
      }
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(new Error(`Game server exited before startup (code ${code}, signal ${signal}). Output:\n${output}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.stderr.off('data', onData);
      child.off('exit', onExit);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', onExit);
  });
}

function openSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      cleanup();
      ws.close();
      reject(new Error(`Timed out opening ${url}`));
    }, 5_000);
    const cleanup = () => {
      clearTimeout(timer);
      ws.removeEventListener('open', onOpen);
      ws.removeEventListener('error', onError);
    };
    const onOpen = () => {
      cleanup();
      resolve(ws);
    };
    const onError = () => {
      cleanup();
      reject(new Error(`Failed to open ${url}`));
    };
    ws.addEventListener('open', onOpen);
    ws.addEventListener('error', onError);
  });
}

function waitForMessage(
  ws: WebSocket,
  predicate: (msg: Record<string, unknown>) => boolean,
  timeoutMs = 5_000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for WebSocket message'));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
    };
    const onMessage = (event: MessageEvent) => {
      const parsed = JSON.parse(String(event.data)) as Record<string, unknown>;
      if (predicate(parsed)) {
        cleanup();
        resolve(parsed);
      }
    };
    ws.addEventListener('message', onMessage);
  });
}

async function verifySimulationMoveAuthority(): Promise<void> {
  const state = initMultiplayerGame(123);
  const p1City = state.cities.find(c => c.ownerId === 'player_ai');
  const p2City = state.cities.find(c => c.ownerId === 'player_ai_2');
  assert(p1City && p2City, 'multiplayer state should include both capitals');

  state.pendingRecruits.push(
    {
      id: 'pending-p1',
      playerId: 'player_ai',
      cityId: p1City.id,
      type: 'infantry',
      effectiveArmsLevel: 1,
      spawnQ: p1City.q,
      spawnR: p1City.r,
      completesAtCycle: 1,
    },
    {
      id: 'pending-p2',
      playerId: 'player_ai_2',
      cityId: p2City.id,
      type: 'infantry',
      effectiveArmsLevel: 1,
      spawnQ: p2City.q,
      spawnR: p2City.r,
      completesAtCycle: 1,
    },
  );

  const spawned = stepSimulation(
    state,
    DEFAULT_AI_PARAMS,
    DEFAULT_AI_PARAMS,
    undefined,
    undefined,
    { humanPlansByPlayerId: { player_ai: emptyAiActions(), player_ai_2: emptyAiActions() } },
  );
  const p1Unit = spawned.units.find(u => u.ownerId === 'player_ai');
  const p2Unit = spawned.units.find(u => u.ownerId === 'player_ai_2');
  assert(p1Unit && p2Unit, 'pending recruits should spawn valid test units');

  const next = stepSimulation(
    spawned,
    DEFAULT_AI_PARAMS,
    DEFAULT_AI_PARAMS,
    undefined,
    undefined,
    {
      humanPlansByPlayerId: {
        player_ai: {
          ...emptyAiActions(),
          moveTargets: [
            { unitId: p1Unit.id, toQ: p1Unit.q + 1, toR: p1Unit.r },
            { unitId: p2Unit.id, toQ: p2Unit.q + 1, toR: p2Unit.r },
          ],
        },
        player_ai_2: emptyAiActions(),
      },
    },
  );
  const ownUnit = next.units.find(u => u.id === p1Unit.id);
  const enemyUnit = next.units.find(u => u.id === p2Unit.id);
  assert(ownUnit?.q === p1Unit.q + 1 && ownUnit.r === p1Unit.r, 'owned unit should still accept its player move target');
  assert(enemyUnit?.q === p2Unit.q && enemyUnit.r === p2Unit.r, 'opponent unit must not move from cross-owner target');
  assert(enemyUnit?.targetQ === undefined && enemyUnit?.targetR === undefined, 'opponent unit must ignore cross-owner move target');
}

async function verifyLiveRoomGuards(): Promise<void> {
  const port = 34_700 + Math.floor(Math.random() * 1_000);
  const child = spawn('npm', ['run', 'game-server'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), MULTIPLAYER_TICK_MS: '60000' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  const sockets: WebSocket[] = [];
  try {
    await waitForServerReady(child);
    const url = `ws://127.0.0.1:${port}`;
    const roomId = `verify-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const host = await openSocket(url);
    sockets.push(host);
    host.send(JSON.stringify({ type: 'join', roomId, role: 'host' }));
    await waitForMessage(host, msg => msg.type === 'joined' && msg.role === 'host');

    const duplicateHost = await openSocket(url);
    sockets.push(duplicateHost);
    duplicateHost.send(JSON.stringify({ type: 'join', roomId, role: 'host' }));
    await waitForMessage(duplicateHost, msg => msg.type === 'error' && String(msg.message).includes('Host slot'));

    const guest = await openSocket(url);
    sockets.push(guest);
    guest.send(JSON.stringify({ type: 'join', roomId, role: 'guest' }));
    await waitForMessage(guest, msg => msg.type === 'joined' && msg.role === 'guest');

    const duplicateGuest = await openSocket(url);
    sockets.push(duplicateGuest);
    duplicateGuest.send(JSON.stringify({ type: 'join', roomId, role: 'guest' }));
    await waitForMessage(duplicateGuest, msg => msg.type === 'error');

    host.send(JSON.stringify({ type: 'plan', plan: { moveTargets: { unitId: 'bad', toQ: 1, toR: 1 } } }));
    await delay(250);
    assert(child.exitCode === null, 'malformed plan payload must not crash the game server');
  } finally {
    for (const ws of sockets) ws.close();
    if (child.exitCode === null) {
      if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {
          child.kill('SIGTERM');
        }
      }
      await Promise.race([
        new Promise<void>(resolve => child.once('exit', () => resolve())),
        delay(2_000).then(() => undefined),
      ]);
      if (child.exitCode === null && child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      }
    }
  }
}

async function verifyStaticGuards(): Promise<void> {
  const [
    gameCore,
    store,
    server,
    serverPackage,
    gameScene,
    mapController,
    hexGrid,
  ] = await Promise.all([
    readFile('src/core/gameCore.ts', 'utf8'),
    readFile('src/store/useGameStore.ts', 'utf8'),
    readFile('game-server/src/index.ts', 'utf8'),
    readFile('game-server/package.json', 'utf8'),
    readFile('src/components/game/GameScene.tsx', 'utf8'),
    readFile('src/components/game/MapController.tsx', 'utf8'),
    readFile('src/components/game/HexGrid.tsx', 'utf8'),
  ]);

  assert(gameCore.includes('unit && unit.ownerId === aiPlayerId && unit.hp > 0'), 'shared simulation must gate move targets by owner');
  assert(store.includes('unit && unit.ownerId === aiPlayerId && unit.hp > 0'), 'store simulation mirror must gate move targets by owner');
  assert(server.includes('sanitizeClientPlan') && server.includes('Host slot is already occupied'), 'server must sanitize plans and reject duplicate hosts');
  assert(!JSON.parse(serverPackage).type, 'game-server package must not force ESM mode');
  assert(gameScene.includes("phase !== 'playing' || enteredPlaying"), 'playable camera should sync before play and on play entry');
  assert(mapController.includes('targetChanged'), 'map controller should reapply changed initial playable targets');
  assert(hexGrid.includes('opacity: 0.93'), 'unknown fog must remain opaque enough to hide terrain');
  assert(hexGrid.includes('for (const tile of discoveredTilesMap.values())'), 'terrain layers must render only discovered tiles');
  assert((hexGrid.match(/DepositHighlightOverlay tiles={discoveredTilesMap}/g) ?? []).length >= 4, 'deposit highlights must not scan undiscovered tiles');
  assert(hexGrid.includes('tilesMap={discoveredTilesMap}'), 'mountain snow must not render on undiscovered terrain');
}

async function main(): Promise<void> {
  await verifySimulationMoveAuthority();
  await verifyLiveRoomGuards();
  await verifyStaticGuards();
  console.log('critical regression checks passed');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
