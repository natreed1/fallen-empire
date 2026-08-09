/**
 * Verifies NEW critical bugs found 2026-08-09:
 * 1) Auto-replenish must not queue L3/defender from barracks L2
 * 2) AI upgrade path can take barracks L2→L3 when tech allows
 * 3) MP remap covers heroes, scout towers, and combatMorale keys/ownerIds
 */
import { computeArmyReplenishment } from '../src/lib/armyReplenishment';
import { applyAiUpgrades } from '../src/lib/applyAiPlan';
import { remapSimStateForClient } from '../src/lib/multiplayerRemap';
import type { SimState } from '../src/core/gameCore';
import type { City, Player, Unit, UnitStack } from '../src/types/game';
import { BARACKS_L3_UPGRADE_COST, STARTING_TECHS } from '../src/types/game';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// ── 1) Replenish L3 barracks gate ───────────────────────────────────
{
  const stack: UnitStack = {
    id: 's1',
    ownerId: 'p1',
    homeCityId: 'c1',
    name: 'Iron',
    composition: [
      { unitType: 'infantry', armsLevel: 3, count: 1 },
      { unitType: 'defender', armsLevel: 3, count: 1 },
    ],
    autoReplenish: true,
    rallyQ: 0,
    rallyR: 0,
  };
  const cityL2: City = {
    id: 'c1',
    name: 'X',
    q: 0,
    r: 0,
    ownerId: 'p1',
    population: 100,
    morale: 80,
    storage: { food: 50, goods: 0, guns: 10, gunsL2: 10, iron: 20, stone: 20, wood: 0, refinedWood: 0 },
    storageCap: { food: 100, goods: 50, guns: 50, gunsL2: 50, iron: 50, stone: 50, wood: 50, refinedWood: 50 },
    buildings: [{ type: 'barracks', q: 0, r: 1, level: 2 }],
  };
  const player: Player = {
    id: 'p1',
    name: 'H',
    color: '#fff',
    gold: 500,
    taxRate: 0.3,
    foodPriority: 'military',
    isHuman: true,
    kingdomId: 'traders',
    researchedTechs: [...STARTING_TECHS, 'military_tactics_2', 'iron_working', 'gunpowder'],
  };
  const blocked = computeArmyReplenishment({
    unitStacks: [stack],
    units: [],
    cities: [cityL2],
    players: [player],
    cycle: 3,
    pendingRecruits: [],
  });
  assert(blocked.newPending.length === 0, 'barracks L2 must not auto-replenish L3/defender');

  const cityL3 = {
    ...cityL2,
    buildings: [{ type: 'barracks' as const, q: 0, r: 1, level: 3 }],
    archerDoctrineL3: 'marksman' as const,
  };
  const allowed = computeArmyReplenishment({
    unitStacks: [{ ...stack, composition: [{ unitType: 'infantry', armsLevel: 3, count: 1 }] }],
    units: [],
    cities: [cityL3],
    players: [player],
    cycle: 3,
    pendingRecruits: [],
  });
  assert(allowed.newPending.length === 1, 'barracks L3 may auto-replenish L3 infantry');
  assert(allowed.newPending[0]!.effectiveArmsLevel === 3, 'queued arms is L3');
}

// ── 2) AI barracks L2→L3 upgrade ────────────────────────────────────
{
  const city: City = {
    id: 'c1',
    name: 'AI',
    q: 0,
    r: 0,
    ownerId: 'player_ai',
    population: 40,
    morale: 80,
    storage: { food: 20, goods: 0, guns: 0, gunsL2: 0, iron: 0, stone: 0, wood: 0, refinedWood: 0 },
    storageCap: { food: 100, goods: 50, guns: 50, gunsL2: 50, iron: 50, stone: 50, wood: 50, refinedWood: 50 },
    buildings: [{ type: 'barracks', q: 0, r: 1, level: 2 }],
  };
  let gold = 100;
  const player: Pick<Player, 'gold' | 'researchedTechs'> = {
    gold,
    researchedTechs: [...STARTING_TECHS, 'military_tactics_2', 'iron_working', 'gunpowder'],
  };
  applyAiUpgrades(
    [{ cityId: 'c1', buildingQ: 0, buildingR: 1, type: 'barracks' }],
    {
      aiPlayerId: 'player_ai',
      cities: [city],
      getPlayer: () => ({ ...player, gold }),
      onSpendGold: (d) => { gold -= d; },
    },
  );
  assert((city.buildings[0]!.level ?? 1) === 3, 'AI barracks upgrades L2→L3');
  assert(gold === 100 - BARACKS_L3_UPGRADE_COST, 'AI pays L3 barracks cost');
  assert(city.archerDoctrineL3 === 'marksman', 'AI sets archer doctrine on L3 barracks');
}

// ── 3) MP remap heroes / scout towers / morale ──────────────────────
{
  const morale = new Map<string, { ownerId: string; morale: number }>([
    ['3,4:player_ai', { ownerId: 'player_ai', morale: 70 }],
    ['3,4:player_ai_2', { ownerId: 'player_ai_2', morale: 40 }],
  ]);
  const raw = {
    heroes: [{ id: 'h1', ownerId: 'player_ai', q: 1, r: 2, type: 'general', hp: 10, maxHp: 10 }],
    scoutTowers: [{ id: 'st1', ownerId: 'player_ai_2', q: 5, r: 5 }],
    combatMoraleState: morale,
    players: [
      { id: 'player_ai', isHuman: false },
      { id: 'player_ai_2', isHuman: false },
    ],
    cities: [],
    units: [],
    territory: new Map(),
    scrollInventory: {},
    scrollSearchVisited: {},
    scrollRegionClaimed: {},
    commanders: [],
    scoutMissions: [],
    constructions: [],
    wallSections: [],
    defenseInstallations: [],
    unitStacks: [],
    operationalArmies: [],
    pendingRecruits: [],
    cityCaptureHold: {},
    scrollAttachments: [],
  } as unknown as SimState;

  const host = remapSimStateForClient(raw, 'host');
  assert(host.heroes[0]!.ownerId === 'player_human', 'host hero remaps to local');
  assert(host.scoutTowers[0]!.ownerId === 'player_ai', 'host enemy scout tower remaps to opp');
  assert(host.combatMoraleState.has('3,4:player_human'), 'host morale key remapped');
  assert(host.combatMoraleState.get('3,4:player_human')!.ownerId === 'player_human', 'host morale owner remapped');
  assert(host.combatMoraleState.has('3,4:player_ai'), 'host opp morale key remapped');

  const guest = remapSimStateForClient(raw, 'guest');
  assert(guest.heroes[0]!.ownerId === 'player_ai', 'guest sees P1 as opp');
  assert(guest.scoutTowers[0]!.ownerId === 'player_human', 'guest scout tower remaps to local');
  assert(guest.combatMoraleState.has('3,4:player_human'), 'guest morale key remapped for P2');
}

console.log('verify-new-critical-bugs-1b77: ok');
