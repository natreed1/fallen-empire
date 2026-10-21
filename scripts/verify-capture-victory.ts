/**
 * HUD Capture must not end a multi-rival match when only the first AI is eliminated.
 * Run: npx tsx scripts/verify-capture-victory.ts
 */
import { anyNonHumanEmpireHasCity } from '../src/lib/matchVictory';
import { useGameStore } from '../src/store/useGameStore';

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

const players = [
  { id: 'player_human', isHuman: true },
  { id: 'player_ai', isHuman: false },
  { id: 'player_ai_2', isHuman: false },
];

assert(
  anyNonHumanEmpireHasCity(
    [
      { ownerId: 'player_human' },
      { ownerId: 'player_ai_2' },
    ],
    players,
  ),
  'second rival still owns a city',
);
assert(
  !anyNonHumanEmpireHasCity([{ ownerId: 'player_human' }], players),
  'no rival cities left',
);
assert(
  !anyNonHumanEmpireHasCity(
    [{ ownerId: 'player_ai' }],
    [{ id: 'player_human', isHuman: true }],
  ),
  'cities owned by ids that are not rival players do not count',
);

const city = (id: string, ownerId: string, q: number, r: number, name: string) =>
  ({
    id,
    name,
    q,
    r,
    ownerId,
    population: 8,
    buildings: [],
    storage: { food: 0, goods: 0, guns: 0, gunsL2: 0, iron: 0, stone: 0, wood: 0, refinedWood: 0 },
    storageCap: { food: 1, goods: 1, guns: 1, gunsL2: 1, iron: 1, stone: 1, wood: 1, refinedWood: 1 },
    morale: 50,
  }) as never;

const unit = {
  id: 'u1',
  type: 'infantry',
  q: 2,
  r: 3,
  ownerId: 'player_human',
  hp: 10,
  maxHp: 10,
  xp: 0,
  level: 0,
  status: 'idle',
  stance: 'aggressive',
  nextMoveAt: 0,
} as never;

useGameStore.setState({
  phase: 'playing',
  gameMode: 'human_vs_ai',
  cycle: 4,
  players: [
    { id: 'player_human', name: 'You', isHuman: true, gold: 0, taxRate: 0.3, foodPriority: 'civilian', color: '#fff' },
    { id: 'player_ai', name: 'North', isHuman: false, gold: 0, taxRate: 0.3, foodPriority: 'military', color: '#f00' },
    { id: 'player_ai_2', name: 'South', isHuman: false, gold: 0, taxRate: 0.3, foodPriority: 'military', color: '#00f' },
  ] as never,
  cities: [city('c-ai', 'player_ai', 2, 3, 'Northkeep'), city('c-ai2', 'player_ai_2', 8, 8, 'Southkeep')],
  units: [unit],
  tiles: new Map(),
  notifications: [],
});

useGameStore.getState().captureCity('c-ai');
{
  const s = useGameStore.getState();
  assert(s.phase === 'playing', `expected playing after eliminating only the first AI, got ${s.phase}`);
  assert(s.cities.find(c => c.id === 'c-ai')?.ownerId === 'player_human', 'captured city should flip');
  assert(s.cities.find(c => c.id === 'c-ai2')?.ownerId === 'player_ai_2', 'second rival city must remain');
  assert(
    s.notifications.some(n => n.message.includes('Northkeep captured')),
    'should announce the capture, not match victory',
  );
  assert(!s.notifications.some(n => n.message.includes('Victory')), 'must not declare victory');
}

useGameStore.setState({
  phase: 'playing',
  notifications: [],
  units: [{ ...(unit as object), q: 8, r: 8 } as never],
});
useGameStore.getState().captureCity('c-ai2');
{
  const s = useGameStore.getState();
  assert(s.phase === 'victory', `expected victory after the last rival city, got ${s.phase}`);
  assert(
    s.notifications.some(n => n.message.includes('Victory')),
    'last rival city should end the match',
  );
}

console.log('verify-capture-victory: ok');
