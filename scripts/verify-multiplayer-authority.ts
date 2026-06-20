import assert from 'assert';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { readFileSync } from 'fs';
import WebSocket from 'ws';
import { initMultiplayerGame, stepSimulation, DEFAULT_AI_PARAMS } from '../src/core/gameCore';
import { emptyAiActions } from '../src/lib/ai';
import { remapSimStateForClient } from '../src/lib/multiplayerRemap';
import { tileKey } from '../src/types/game';

const P1 = 'player_ai';
const P2 = 'player_ai_2';

function findReachableTarget(state: ReturnType<typeof initMultiplayerGame>, q: number, r: number): { q: number; r: number } {
  for (const tile of state.tiles.values()) {
    if (tile.q === q && tile.r === r) continue;
    if (tile.biome === 'water' || tile.biome === 'mountain') continue;
    return { q: tile.q, r: tile.r };
  }
  throw new Error('No reachable target tile found');
}

function verifyStepSimulationMoveOwnership(): void {
  const state = initMultiplayerGame(4242, { width: 32, height: 32 });
  const p1Unit = state.units.find(u => u.ownerId === P1 && u.hp > 0);
  const p2Unit = state.units.find(u => u.ownerId === P2 && u.hp > 0);
  assert(p1Unit, 'expected a living P1 starting unit');
  assert(p2Unit, 'expected a living P2 starting unit');

  const p1Target = findReachableTarget(state, p1Unit.q, p1Unit.r);
  const p2Original = { targetQ: p2Unit.targetQ, targetR: p2Unit.targetR };

  const badTarget = findReachableTarget(state, p2Unit.q, p2Unit.r);
  const next = stepSimulation(
    state,
    DEFAULT_AI_PARAMS,
    DEFAULT_AI_PARAMS,
    undefined,
    undefined,
    {
      humanPlansByPlayerId: {
        [P1]: {
          ...emptyAiActions(),
          moveTargets: [
            { unitId: p1Unit.id, toQ: p1Target.q, toR: p1Target.r },
            { unitId: p2Unit.id, toQ: badTarget.q, toR: badTarget.r },
          ],
        },
        [P2]: emptyAiActions(),
      },
    },
  );

  const p1After = next.units.find(u => u.id === p1Unit.id);
  const p2After = next.units.find(u => u.id === p2Unit.id);
  assert(p1After, 'expected P1 unit after simulation step');
  assert(p2After, 'expected P2 unit after simulation step');
  assert.equal(p1After.targetQ, p1Target.q, 'own move target should still be accepted');
  assert.equal(p1After.targetR, p1Target.r, 'own move target should still be accepted');
  assert.equal(p2After.targetQ, p2Original.targetQ, 'cross-owner plan must not retarget the opponent unit');
  assert.equal(p2After.targetR, p2Original.targetR, 'cross-owner plan must not retarget the opponent unit');
  assert(state.tiles.has(tileKey(p1Target.q, p1Target.r)), 'sanity check target exists');
}

function verifyMultiplayerMoraleRemap(): void {
  const state = initMultiplayerGame(4243, { width: 32, height: 32 });
  state.combatMoraleState = new Map([
    [`${tileKey(3, 4)}:${P1}`, { ownerId: P1, morale: 72 }],
    [`${tileKey(5, 6)}:${P2}`, { ownerId: P2, morale: 81 }],
  ]);

  const host = remapSimStateForClient(state, 'host');
  assert.equal(host.combatMoraleState.get(`${tileKey(3, 4)}:player_human`)?.morale, 72);
  assert.equal(host.combatMoraleState.get(`${tileKey(5, 6)}:player_ai`)?.morale, 81);

  const guest = remapSimStateForClient(state, 'guest');
  assert.equal(guest.combatMoraleState.get(`${tileKey(3, 4)}:player_ai`)?.morale, 72);
  assert.equal(guest.combatMoraleState.get(`${tileKey(5, 6)}:player_human`)?.morale, 81);
}

function verifyFogAndCameraStaticGuards(): void {
  const hexGrid = readFileSync('src/components/game/HexGrid.tsx', 'utf8');
  assert.match(hexGrid, /opacity:\s*0\.93/, 'unknown fog must remain opaque enough to hide terrain');
  assert.match(
    hexGrid,
    /const terrainBiomeGroups[\s\S]*?for \(const tile of discoveredTilesMap\.values\(\)\)/,
    'terrain layers must be built from discovered tiles only',
  );
  assert.match(
    hexGrid,
    /const terrainShoreline[\s\S]*?for \(const t of discoveredTilesMap\.values\(\)\)/,
    'shoreline layers must be built from discovered tiles only',
  );
  assert.match(
    hexGrid,
    /<MountainSnowLayer tiles=\{terrainBiomeGroups\.mountain\} tilesMap=\{discoveredTilesMap\} \/>/,
    'snow layer must not inspect undiscovered mountain neighbors',
  );

  const gameScene = readFileSync('src/components/game/GameScene.tsx', 'utf8');
  assert.match(
    gameScene,
    /if \(isPlayableCameraMode\)[\s\S]*?enteredPlaying[\s\S]*?setMapTarget\(liveTarget\)/,
    'playable modes must snap to the live camera target when entering play',
  );

  const mapController = readFileSync('src/components/game/MapController.tsx', 'utf8');
  assert.match(
    mapController,
    /lastAppliedTargetKeyRef/,
    'MapController must allow a changed initial target while preserving user pan afterwards',
  );
}

function waitForServerReady(proc: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error(`Server did not become ready. Output:\n${output}`)), 10_000);
    const onData = (data: Buffer) => {
      output += data.toString();
      if (output.includes('Fallen Empire game server listening')) {
        clearTimeout(timeout);
        resolve();
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.once('exit', code => {
      clearTimeout(timeout);
      reject(new Error(`Server exited early with code ${code}. Output:\n${output}`));
    });
  });
}

function openSocket(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

function waitForMessage(socket: WebSocket, type: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), 10_000);
    const onMessage = (raw: WebSocket.RawData) => {
      const msg = JSON.parse(String(raw)) as Record<string, unknown>;
      if (msg.type === type) {
        clearTimeout(timeout);
        socket.off('message', onMessage);
        resolve(msg);
      }
    };
    socket.on('message', onMessage);
  });
}

async function verifyDuplicateHostRejected(): Promise<void> {
  const port = 36_000 + Math.floor(Math.random() * 2_000);
  const proc = spawn('npm', ['run', 'game-server'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), MULTIPLAYER_TICK_MS: '60000' },
  });
  try {
    await waitForServerReady(proc);
    const roomId = `authority-${Date.now()}`;
    const hostA = await openSocket(port);
    hostA.send(JSON.stringify({ type: 'join', roomId, role: 'host' }));
    const joined = await waitForMessage(hostA, 'joined');
    assert.equal(joined.playerSlot, P1, 'first host should receive P1');

    const hostB = await openSocket(port);
    hostB.send(JSON.stringify({ type: 'join', roomId, role: 'host' }));
    const error = await waitForMessage(hostB, 'error');
    assert.match(String(error.message), /host slot|room is full/i, 'duplicate host must be rejected');

    hostA.close();
    hostB.close();
  } finally {
    proc.kill('SIGTERM');
  }
}

async function main(): Promise<void> {
  verifyStepSimulationMoveOwnership();
  verifyMultiplayerMoraleRemap();
  verifyFogAndCameraStaticGuards();
  await verifyDuplicateHostRejected();
  console.log('multiplayer authority regression checks passed');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
