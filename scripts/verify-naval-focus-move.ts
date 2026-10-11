/**
 * Focused ship orders must not drag every other unit on the hex.
 * Run: npx tsx scripts/verify-naval-focus-move.ts
 */
import { tileKey, type Tile, type Unit } from '../src/types/game';
import { useGameStore } from '../src/store/useGameStore';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function water(q: number, r: number): Tile {
  return {
    q,
    r,
    biome: 'water',
    elevation: 0,
    height: 0,
    hasRoad: false,
    hasRuins: false,
    hasVillage: false,
    isProvinceCenter: false,
    hasQuarryDeposit: false,
    hasMineDeposit: false,
    hasAncientCity: false,
    hasGoldMineDeposit: false,
    hasWoodDeposit: false,
    isIsland: false,
  };
}

function ship(id: string, type: Unit['type'], extra: Partial<Unit> = {}): Unit {
  return {
    id,
    type,
    q: 0,
    r: 0,
    ownerId: 'player_human',
    hp: 10,
    maxHp: 10,
    xp: 0,
    level: 0,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
    ...extra,
  };
}

function seed(units: Unit[], stackMoveUnitId: string | null) {
  const tiles = new Map<string, Tile>([
    [tileKey(0, 0), water(0, 0)],
    [tileKey(1, 0), water(1, 0)],
  ]);
  useGameStore.setState({
    phase: 'playing',
    gameMode: 'human_vs_ai',
    units,
    tiles,
    territory: new Map(),
    selectedHex: { q: 0, r: 0 },
    stackMoveUnitId,
    uiMode: 'move',
    pendingMove: null,
    pendingTacticalOrders: null,
    tacticalIncludedUnitTypes: 'all',
    defaultMarchFormation: { enabled: false, preset: 'classic_four', width: 3, depth: 3 },
  });
}

const scout = ship('scout', 'scout_ship', {
  status: 'moving',
  targetQ: 4,
  targetR: 1,
  patrolCenterQ: 0,
  patrolCenterR: 0,
  patrolRadius: 2,
});
const warship = ship('war', 'warship');

seed([scout, warship], 'war');
useGameStore.getState().moveSelectedUnits(1, 0);

const afterFocus = useGameStore.getState().units;
const movedWar = afterFocus.find(u => u.id === 'war');
const stayedScout = afterFocus.find(u => u.id === 'scout');
assert(movedWar?.status === 'moving' && movedWar.targetQ === 1 && movedWar.targetR === 0, 'focused warship should sail to (1,0)');
assert(
  stayedScout?.status === 'moving' && stayedScout.targetQ === 4 && stayedScout.targetR === 1,
  'unfocused scout must keep its existing march',
);
assert(stayedScout?.patrolCenterQ === 0 && stayedScout.patrolRadius === 2, 'unfocused scout must keep patrol orders');

seed([ship('scout', 'scout_ship'), ship('war', 'warship')], null);
useGameStore.getState().moveSelectedUnits(1, 0);
const both = useGameStore.getState().units;
assert(
  both.every(u => u.status === 'moving' && u.targetQ === 1 && u.targetR === 0),
  'with no ship focus, the whole naval stack should move together',
);

console.log('verify-naval-focus-move: ok');
