/**
 * Regression: ruined academy/university must not grant BP/research/graduates;
 * multiplayer room session must reclaim roles and clear host pause on disconnect.
 */
import {
  computeConstructionAvailableBp,
  computeRoadAvailableBp,
  getUniversityBuilderSlots,
} from '../src/lib/builders';
import {
  computeLiteracyPerCycle,
  computeResearchPerCycle,
} from '../src/lib/researchTick';
import { rollUniversityGraduate } from '../src/lib/nationalCouncil';
import {
  applyClientDisconnect,
  decideRoomJoin,
  pruneDeadClients,
  type SessionRoom,
} from '../game-server/src/roomSession';
import type { City, CityBuilding, ConstructionSite, Player, TerritoryInfo } from '../src/types/game';
import { tileKey } from '../src/types/game';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const ruinedAcademy: CityBuilding = {
  type: 'academy',
  q: 0,
  r: 1,
  level: 3,
  buildingState: 'ruins',
  hp: 0,
  maxHp: 210,
};

const liveAcademy: CityBuilding = {
  type: 'academy',
  q: 0,
  r: 1,
  level: 3,
  buildingState: 'normal',
  hp: 210,
  maxHp: 210,
};

const ruinedUniversity: CityBuilding = {
  type: 'university',
  q: 1,
  r: 0,
  level: 3,
  buildingState: 'ruins',
  hp: 0,
  maxHp: 135,
  universitySpecialization: 'research',
};

const liveUniversity: CityBuilding = {
  type: 'university',
  q: 1,
  r: 0,
  level: 3,
  buildingState: 'normal',
  hp: 135,
  maxHp: 135,
  universitySpecialization: 'research',
};

function makeCity(buildings: CityBuilding[]): City {
  return {
    id: 'c1',
    name: 'Test',
    q: 0,
    r: 0,
    ownerId: 'p1',
    population: 120,
    morale: 80,
    storage: {
      food: 0,
      goods: 0,
      guns: 0,
      gunsL2: 0,
      iron: 0,
      stone: 0,
      wood: 0,
      refinedWood: 0,
    },
    storageCap: {
      food: 0,
      goods: 0,
      guns: 0,
      gunsL2: 0,
      iron: 0,
      stone: 0,
      wood: 0,
      refinedWood: 0,
    },
    buildings,
    universityBuilderTask: 'expand_quarries',
    universityBuilderSlotTasks: ['expand_quarries', 'expand_quarries', 'expand_quarries'],
  };
}

const player: Player = {
  id: 'p1',
  name: 'H',
  color: '#fff',
  gold: 100,
  taxRate: 0.3,
  foodPriority: 'military',
  isHuman: true,
  kingdomId: 'crusaders',
  education: { level: 1, literacy: 50 },
  researchedTechs: [],
  activeResearch: null,
  researchProgress: 0,
};

// ── Academy / university operational gates ──────────────────────────

assert(getUniversityBuilderSlots(liveAcademy) === 3, 'live academy slots');
assert(getUniversityBuilderSlots(ruinedAcademy) === 0, 'ruined academy grants 0 builder slots');

const cityLive = makeCity([liveAcademy]);
const cityRuined = makeCity([ruinedAcademy]);
const territory = new Map<string, TerritoryInfo>([
  [tileKey(2, 0), { playerId: 'p1', cityId: 'c1' }],
]);
const site: ConstructionSite = {
  id: 's1',
  type: 'quarry',
  q: 2,
  r: 0,
  ownerId: 'p1',
  cityId: 'c1',
  bpAccumulated: 0,
  bpRequired: 100,
};

const bpLive = computeConstructionAvailableBp(site, territory, [cityLive], [site]);
const bpRuined = computeConstructionAvailableBp(site, territory, [cityRuined], [site]);
assert(bpLive > bpRuined, 'ruined academy must not contribute construction workforce BP');
assert(
  computeRoadAvailableBp({ q: 2, r: 0, ownerId: 'p1' }, territory, [cityRuined]) === 0,
  'ruined academy must not contribute road BP',
);

const litLive = computeLiteracyPerCycle(player, [makeCity([liveUniversity])], undefined, [], []);
const litRuined = computeLiteracyPerCycle(player, [makeCity([ruinedUniversity])], undefined, [], []);
assert(litLive > litRuined, 'ruined university must not add literacy');

const resLive = computeResearchPerCycle(player, [makeCity([liveUniversity])], undefined, [], []);
const resRuined = computeResearchPerCycle(player, [makeCity([ruinedUniversity])], undefined, [], []);
assert(resLive > resRuined, 'ruined university must not add research points');

let sawGraduate = false;
for (let seed = 0; seed < 200; seed++) {
  const g = rollUniversityGraduate(ruinedUniversity, 200, seed);
  assert(g.kind === 'none', `ruined university must never graduate (seed ${seed})`);
}
for (let seed = 0; seed < 200 && !sawGraduate; seed++) {
  if (rollUniversityGraduate(liveUniversity, 200, seed).kind !== 'none') sawGraduate = true;
}
assert(sawGraduate, 'live university should graduate sometimes (sanity)');

// ── Multiplayer session hygiene ─────────────────────────────────────

type FakeSocket = { readyState: number; id: string };
const OPEN = 1;
const CLOSED = 3;

function roomOf(entries: Array<[FakeSocket, 'host' | 'guest']>): SessionRoom {
  const clients = new Map<any, any>();
  for (const [sock, role] of entries) {
    clients.set(sock, { socket: sock, role, playerId: role === 'host' ? 'p1' : 'p2' });
  }
  return { clients, paused: false };
}

const zombieGuest = { readyState: OPEN, id: 'zombie-guest' };
const hostA = { readyState: OPEN, id: 'host-a' };
const deadGuest = { readyState: CLOSED, id: 'dead-guest' };

const fullZombie = roomOf([
  [hostA, 'host'],
  [zombieGuest, 'guest'],
]);
const reclaim = decideRoomJoin(fullZombie as any, 'guest', (s: any) => s.readyState === OPEN);
assert(reclaim.ok === true && reclaim.replaced === zombieGuest, 'guest reconnect reclaims zombie seat');

const deadPruned = roomOf([
  [hostA, 'host'],
  [deadGuest, 'guest'],
]);
assert(pruneDeadClients(deadPruned as any, (s: any) => s.readyState === OPEN) === 1, 'prune closed sockets');
const afterPrune = decideRoomJoin(deadPruned as any, 'guest', (s: any) => s.readyState === OPEN);
assert(afterPrune.ok === true && afterPrune.replaced === null, 'guest can join after dead prune');

const pausedRoom: SessionRoom = {
  clients: new Map(),
  paused: true,
};
applyClientDisconnect(pausedRoom, {
  socket: hostA as any,
  role: 'host',
  playerId: 'p1',
});
assert(pausedRoom.paused === false, 'host disconnect clears pause softlock');

const guestLeavePaused: SessionRoom = {
  clients: new Map(),
  paused: true,
};
applyClientDisconnect(guestLeavePaused, {
  socket: zombieGuest as any,
  role: 'guest',
  playerId: 'p2',
});
assert(guestLeavePaused.paused === true, 'guest disconnect does not clear host pause');

console.log('verify-ruined-academy-and-mp-session: ok');
