/**
 * Regression: multiplayer local outcome + host scrollSearchVisited remap.
 * Run: npx tsx --tsconfig tsconfig.json scripts/verify-multiplayer-outcome.ts
 */

import assert from 'assert';
import { getMultiplayerLocalOutcome } from '../src/lib/multiplayerOutcome.ts';
import { remapSimStateForClient } from '../src/lib/multiplayerRemap.ts';
import type { SimState } from '../src/core/gameCore.ts';
import type { City } from '../src/types/game.ts';

function city(ownerId: string, population = 10): City {
  return {
    id: `c_${ownerId}_${population}`,
    name: 'Test',
    q: 0,
    r: 0,
    ownerId,
    population,
    buildings: [],
    storage: { food: 0, wood: 0, stone: 0, gold: 0, iron: 0 },
    storageCap: { food: 0, wood: 0, stone: 0, gold: 0, iron: 0 },
  } as City;
}

function baseState(partial: Partial<SimState>): SimState {
  return {
    phase: 'playing',
    cycle: 1,
    tiles: new Map(),
    config: { width: 10, height: 10, seed: 1 },
    cities: [],
    units: [],
    players: [
      { id: 'player_ai', name: 'P1', isHuman: false, color: '#fff', gold: 0 },
      { id: 'player_ai_2', name: 'P2', isHuman: false, color: '#000', gold: 0 },
    ],
    heroes: [],
    commanders: [],
    territory: new Map(),
    contestedZoneHexKeys: [],
    scrollRelics: [],
    scrollRelicClusters: {},
    scrollSearchVisited: {},
    scrollRegionClaimed: {},
    scrollInventory: {},
    scrollAttachments: [],
    scoutMissions: [],
    scoutedHexes: new Set(),
    scoutTowers: [],
    wallSections: [],
    constructions: [],
    defenseInstallations: [],
    unitStacks: [],
    operationalArmies: [],
    pendingRecruits: [],
    cityCaptureHold: {},
    activeWeather: null,
    lastWeatherEndCycle: 0,
    combatMoraleState: new Map(),
    globalMovementTick: 0,
    simTimeMs: 0,
    ...partial,
  } as SimState;
}

// ── Outcome from cities ────────────────────────────────────────────
{
  const win = getMultiplayerLocalOutcome([city('player_human', 20), city('player_human', 5)]);
  assert.strictEqual(win.isWin, true);
  assert.match(win.message, /Victory|conquered/i);

  const lose = getMultiplayerLocalOutcome([city('player_ai', 20)]);
  assert.strictEqual(lose.isWin, false);
  assert.match(lose.message, /Defeat|fallen/i);

  const timeoutWin = getMultiplayerLocalOutcome([
    city('player_human', 30),
    city('player_human', 10),
    city('player_ai', 5),
  ]);
  assert.strictEqual(timeoutWin.isWin, true);
  assert.match(timeoutWin.message, /Time's up/i);

  const timeoutLose = getMultiplayerLocalOutcome([
    city('player_human', 5),
    city('player_ai', 10),
    city('player_ai', 10),
  ]);
  assert.strictEqual(timeoutLose.isWin, false);
}

// ── Host remap: P2-first insertion must not drop host scroll progress ─
{
  const state = baseState({
    scrollSearchVisited: {
      player_ai_2: { desert: ['d1'] },
      player_ai: { forest: ['f1'] },
    },
    scoutTowers: [
      { id: 't1', q: 1, r: 1, ownerId: 'player_ai' },
      { id: 't2', q: 2, r: 2, ownerId: 'player_ai_2' },
    ],
    combatMoraleState: new Map([
      ['3,4:player_ai', { ownerId: 'player_ai', morale: 80 }],
      ['5,6:player_ai_2', { ownerId: 'player_ai_2', morale: 40 }],
    ]),
  });

  const host = remapSimStateForClient(state, 'host');
  assert.deepStrictEqual(host.scrollSearchVisited.player_human, { forest: ['f1'] });
  assert.deepStrictEqual(host.scrollSearchVisited.player_ai, { desert: ['d1'] });
  assert.strictEqual(host.scoutTowers.find(t => t.id === 't1')?.ownerId, 'player_human');
  assert.strictEqual(host.scoutTowers.find(t => t.id === 't2')?.ownerId, 'player_ai');
  assert.strictEqual(host.combatMoraleState.get('3,4:player_human')?.morale, 80);
  assert.strictEqual(host.combatMoraleState.get('5,6:player_ai')?.morale, 40);

  const guest = remapSimStateForClient(state, 'guest');
  assert.deepStrictEqual(guest.scrollSearchVisited.player_human, { desert: ['d1'] });
  assert.deepStrictEqual(guest.scrollSearchVisited.player_ai, { forest: ['f1'] });
  assert.strictEqual(guest.scoutTowers.find(t => t.id === 't2')?.ownerId, 'player_human');
  assert.strictEqual(guest.combatMoraleState.get('5,6:player_human')?.morale, 40);
}

// ── Guest conquest shows local win after remap ─────────────────────
{
  const conquered = baseState({
    phase: 'victory',
    cities: [city('player_ai_2', 50), city('player_ai_2', 40)],
  });
  const guestView = remapSimStateForClient(conquered, 'guest');
  const outcome = getMultiplayerLocalOutcome(guestView.cities);
  assert.strictEqual(outcome.isWin, true);

  const hostView = remapSimStateForClient(conquered, 'host');
  const hostOutcome = getMultiplayerLocalOutcome(hostView.cities);
  assert.strictEqual(hostOutcome.isWin, false);
}

console.log('verify-multiplayer-outcome: ok');
