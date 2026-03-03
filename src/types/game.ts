// ═══════════════════════════════════════════════════════════════════
//  FALLEN EMPIRE — Master Type Definitions & Game Constants
// ═══════════════════════════════════════════════════════════════════

// ─── Map Types ─────────────────────────────────────────────────────

export type Biome = 'water' | 'plains' | 'forest' | 'mountain' | 'desert';

export type Tile = {
  q: number;
  r: number;
  biome: Biome;
  elevation: number;
  height: number;
  hasRoad: boolean;
  hasRuins: boolean;
  hasVillage: boolean;
  isProvinceCenter: boolean;
  hasQuarryDeposit: boolean;
  hasMineDeposit: boolean;
  hasAncientCity: boolean;
  hasGoldMineDeposit: boolean;
};

export type MapConfig = {
  width: number;
  height: number;
  seed: number;
  noiseScale: number;
  moistureScale: number;
  provinceDensity: number;
  ruinDensity: number;
  villageDensity: number;
};

export const DEFAULT_MAP_CONFIG: MapConfig = {
  width: 100,
  height: 100,
  seed: 42,
  noiseScale: 0.035,
  moistureScale: 0.045,
  provinceDensity: 0.015,
  ruinDensity: 0.03,
  villageDensity: 0.02,
};

// ─── Visual Constants (Map) ────────────────────────────────────────

export const HEX_RADIUS = 1.0;
export const HEX_INNER_RATIO = 0.92;

export const BIOME_COLORS: Record<Biome, string> = {
  water: '#5aacff', plains: '#a8d84e', forest: '#4a9e32',
  mountain: '#f0f4f8', desert: '#ecd47a',
};
export const BIOME_COLORS_DARK: Record<Biome, string> = {
  water: '#3888dd', plains: '#80b830', forest: '#2d7a1c',
  mountain: '#d8dce4', desert: '#c4aa50',
};
export const MOUNTAIN_SNOW_COLOR = '#e8e8f0';
/** Mountains are flat (same as plains) so clicking is reliable; color makes them distinctly white. */
export const BIOME_HEIGHTS: Record<Biome, { base: number; variation: number }> = {
  water: { base: 0.12, variation: 0.03 }, plains: { base: 0.30, variation: 0.10 },
  forest: { base: 0.45, variation: 0.12 }, mountain: { base: 0.30, variation: 0.08 },
  desert: { base: 0.25, variation: 0.08 },
};
export const ROAD_COLOR = '#6b5b4a';  // darker brown for visibility on terrain (distinct from ruins)
export const RUINS_COLOR = '#6d5b4a';  // brown-tan, distinct from road
export const PROVINCE_CENTER_COLOR = '#f0c860';  // gold
export const VILLAGE_COLOR = '#c49560';  // tan, distinct from ruins
export const VILLAGE_ROOF_COLOR = '#8a5520';
export const ANCIENT_CITY_COLOR = '#7c3aed';  // purple for easy distinction
export const GOLD_MINE_DEPOSIT_COLOR = '#e8c030';  // gold/yellow
export const QUARRY_DEPOSIT_COLOR = '#6b7280';  // gray for stone deposits

// ─── Game Phase & UI ───────────────────────────────────────────────

export type GamePhase = 'setup' | 'place_city' | 'playing' | 'victory';
export type UIMode = 'normal' | 'move' | 'build' | 'build_mine' | 'build_quarry' | 'build_gold_mine' | 'build_road' | 'defend' | 'intercept';
export type FoodPriority = 'civilian' | 'military';
export type BuildingType = 'city_center' | 'farm' | 'factory' | 'barracks' | 'academy' | 'market' | 'quarry' | 'mine' | 'gold_mine';
/** Construction site type: buildings (in city) or field-built siege (builder on hex). */
export type ConstructionSiteType = BuildingType | 'trebuchet';
export type UnitType = 'infantry' | 'cavalry' | 'ranged' | 'builder' | 'trebuchet' | 'battering_ram';
export type UnitStatus = 'idle' | 'moving' | 'fighting' | 'starving';
export type ArmyStance = 'aggressive' | 'defensive' | 'passive';
export type HeroType = 'general' | 'logistician';

// ─── Player ────────────────────────────────────────────────────────

export interface Player {
  id: string;
  name: string;
  color: string;
  gold: number;
  taxRate: number;
  foodPriority: FoodPriority;
  isHuman: boolean;
}

// ─── City ──────────────────────────────────────────────────────────

export interface CityBuilding {
  type: BuildingType;
  q: number;
  r: number;
  level?: number;  // default 1; used for barracks, factory, quarry, mine, farm
  assignedWorkers?: number;  // all job buildings; employment tracked separately from population
}

export interface City {
  id: string;
  name: string;
  q: number;
  r: number;
  ownerId: string;
  population: number;
  morale: number;
  storage: { food: number; goods: number; guns: number; gunsL2: number; iron: number; stone: number };
  storageCap: { food: number; goods: number; guns: number; gunsL2: number; iron: number; stone: number };
  buildings: CityBuilding[];
  /** Cycles remaining as frontier city (+25% migration); only for incorporated villages */
  frontierCity?: number;
  /** Last cycle: natural growth (births − deaths) */
  lastNaturalGrowth?: number;
  /** Last cycle: migration (positive = immigrants, negative = emigrants) */
  lastMigration?: number;
  /** Smoothed carrying capacity (population expectations); lags actual production by ~2–4 cycles */
  expectedCarryingCapacity?: number;
}

// ─── Unit ──────────────────────────────────────────────────────────

export interface Unit {
  id: string;
  type: UnitType;
  q: number;
  r: number;
  ownerId: string;
  hp: number;
  maxHp: number;
  xp: number;
  level: number;
  armsLevel?: 1 | 2;  // 1 = L1 arms, 2 = L2 arms (for upkeep)
  status: UnitStatus;
  stance: ArmyStance;
  targetQ?: number;
  targetR?: number;
  nextMoveAt: number;
  /** City that recruited this unit; when unit dies, that city loses 1 population (design: pop not deducted until death). */
  originCityId?: string;
  /** When set, this unit is defending this city (stack → Defend → city). */
  defendCityId?: string;
  /** When set, retreat will execute at this timestamp (2s delay). Until then unit does not attack. */
  retreatAt?: number;
  /** When true, unit is assaulting a city (massive attack debuff for attacker). */
  assaulting?: boolean;
}

// ─── Hero ──────────────────────────────────────────────────────────

export interface Hero {
  id: string;
  name: string;
  type: HeroType;
  q: number;
  r: number;
  ownerId: string;
}

// ─── Road construction (builder-built; free, takes builder time) ───

export interface RoadConstructionSite {
  id: string;
  q: number;
  r: number;
  ownerId: string;
  bpRequired: number;
  bpAccumulated: number;
}

export const ROAD_BP_COST = 25; // ~75s with 1 builder so construction progress is visible

// ─── Construction ─────────────────────────────────────────────────

export interface ConstructionSite {
  id: string;
  type: ConstructionSiteType;
  q: number;
  r: number;
  /** City that owns the build (for buildings). Empty for field-built trebuchet. */
  cityId: string;
  ownerId: string;
  bpRequired: number;
  bpAccumulated: number;
}

// ─── Wall Sections (block enemy movement; built with stone) ───────

export interface WallSection {
  q: number;
  r: number;
  ownerId: string;
  /** When 0 or undefined, wall is broken (troops can pass). Siege units reduce hp. */
  hp?: number;
  maxHp?: number;
}

/** Default HP for a new wall section (low so it must be defended). */
export const WALL_SECTION_HP = 50;

// ─── Scout Missions ───────────────────────────────────────────────

export interface ScoutMission {
  id: string;
  targetQ: number;
  targetR: number;
  completesAt: number;   // Date.now() timestamp when scouting finishes
}

export const SCOUT_MISSION_COST = 5;
export const SCOUT_MISSION_DURATION_SEC = 30;

export const BUILDING_BP_COST: Record<BuildingType, number> = {
  city_center: 0, farm: 50, factory: 50, barracks: 100, academy: 75, market: 30, quarry: 50, mine: 50, gold_mine: 60,
};

/** BP required for builder to build a trebuchet in the field (on the hex). */
export const TREBUCHET_FIELD_BP_COST = 60;
/** Gold cost to start field trebuchet construction (same as barracks recruit). */
export const TREBUCHET_FIELD_GOLD_COST = 8;

export const CITY_BUILDING_POWER = 100;
export const BUILDER_POWER = 10;
export const BP_RATE_BASE = 30; // 50 BP available completes 50 BP of work in 30 seconds

// ─── Notifications ─────────────────────────────────────────────────

export interface GameNotification {
  id: string;
  turn: number;
  message: string;
  type: 'info' | 'warning' | 'danger' | 'success';
}

// ─── Territory ─────────────────────────────────────────────────────

export interface TerritoryInfo {
  playerId: string;
  cityId: string;
}

// ─── Game Constants ────────────────────────────────────────────────

export const TERRITORY_RADIUS = 3;
/** Rough max hexes a unit can move in one sim cycle (30s) at speed 1. Supply radius should be >= this so movement and supply are aligned. */
export const MOVEMENT_HEXES_PER_CYCLE_ESTIMATE = 24;
/** Units/builders get supply when within this hex distance of any friendly city. No roads required.
 *  >= MOVEMENT_HEXES_PER_CYCLE_ESTIMATE so one cycle of movement doesn't leave supply. */
export const SUPPLY_VICINITY_RADIUS = 24;
export const STARTING_GOLD = 150;

export const STARTING_CITY_TEMPLATE: Omit<City, 'id' | 'name' | 'q' | 'r' | 'ownerId'> = {
  population: 50,
  morale: 75,
  storage: { food: 50, goods: 20, guns: 10, gunsL2: 0, iron: 0, stone: 0 },
  storageCap: { food: 100, goods: 100, guns: 100, gunsL2: 100, iron: 50, stone: 50 },
  buildings: [],
};

export const VILLAGE_INCORPORATE_COST = 25;

export const VILLAGE_CITY_TEMPLATE: Omit<City, 'id' | 'name' | 'q' | 'r' | 'ownerId'> = {
  population: 10,
  morale: 50,
  storage: { food: 15, goods: 5, guns: 0, gunsL2: 0, iron: 0, stone: 0 },
  storageCap: { food: 50, goods: 50, guns: 50, gunsL2: 50, iron: 50, stone: 50 },
  buildings: [],
};

export const BUILDING_COLORS: Record<BuildingType, string> = {
  city_center: '#8b5cf6', // purple (administrative)
  farm:        '#4ade80', // green
  factory:     '#f59e0b', // amber/orange
  barracks:    '#ef4444', // red
  academy:     '#0ea5e9', // sky blue (civilian)
  market:      '#facc15', // gold/yellow
  quarry:      '#78716c', // stone
  mine:        '#57534e', // iron
  gold_mine:   '#e8c030', // gold
};

export const BUILDING_COSTS: Record<BuildingType, number> = {
  city_center: 0, farm: 15, factory: 25, barracks: 50, academy: 35, market: 2, quarry: 10, mine: 10, gold_mine: 20,
};

/** Iron cost for buildings that require it (e.g. gold_mine). Others are 0. */
export const BUILDING_IRON_COSTS: Partial<Record<BuildingType, number>> = {
  gold_mine: 20,
};

/** Jobs per building (flat 2 for production, 2 for barracks/academy, 1 for city_center). Use getBuildingJobs(b) for level-aware count. */
export const BUILDING_JOBS: Record<BuildingType, number> = {
  city_center: 1, farm: 2, factory: 2, barracks: 2, academy: 2, market: 2, quarry: 2, mine: 2, gold_mine: 2,
};

/** Level-aware job count (e.g. L2 farm has 3 jobs). Use when the building instance is available. */
export function getBuildingJobs(b: { type: BuildingType; level?: number }): number {
  const base = BUILDING_JOBS[b.type] ?? 0;
  if (b.type === 'farm' && (b.level ?? 1) >= 2) return 3;
  return base;
}

export const BARACKS_UPGRADE_COST = 25;
export const FACTORY_UPGRADE_COST = 15;
export const FARM_UPGRADE_COST = 20;
/** L2 farm total food per cycle (higher productivity per job than L1). */
export const FARM_L2_FOOD_PER_CYCLE = 60;
export const WALL_SECTION_STONE_COST = 5;
export const WORKERS_PER_LEVEL = 5;
export const MIN_STAFFING_RATIO = 0.4;

export type BuildingProduction = { food: number; goods: number; guns: number; stone?: number; iron?: number; gold?: number };

export const BUILDING_PRODUCTION: Record<BuildingType, BuildingProduction> = {
  city_center: { food: 0, goods: 0, guns: 0 },
  farm:        { food: 25, goods: 0, guns: 0 },
  factory:     { food: 0, goods: 0, guns: 2 },
  barracks:    { food: 0, goods: 0, guns: 0 },
  academy:     { food: 0, goods: 0, guns: 0 },
  market:      { food: 0, goods: 0, guns: 0 },
  quarry:      { food: 0, goods: 0, guns: 0, stone: 5 },
  mine:        { food: 0, goods: 0, guns: 0, iron: 2 },
  gold_mine:   { food: 0, goods: 0, guns: 0, gold: 10 },
};

// L2 factory: 1 iron -> 10 gunsL2 per cycle
export const FACTORY_L2_IRON_PER_CYCLE = 1;
export const FACTORY_L2_ARMS_PER_CYCLE = 10;

export const MARKET_GOLD_PER_CYCLE = 2;

/** Storage cap provided by city center (1 per city, required) */
export const CITY_CENTER_STORAGE = { food: 100, goods: 100, guns: 100, gunsL2: 100, iron: 50, stone: 50 };

// ─── Migration Constants ─────────────────────────────────────────
export const FRONTIER_CYCLES = 3;
export const FRONTIER_MIGRATION_BONUS = 0.25;  // +25% migration pull
export const MIGRATION_BASE_RATE = 0.5;        // scaling factor
export const EMPLOYED_MORALE_BONUS = 5;        // (unused; kept for reference)
export const UNEMPLOYMENT_MORALE_PENALTY = 10; // morale loss per cycle at 100% unemployment (scaled by rate)
/** Cap on morale loss per cycle from unemployment so it doesn't dominate the loop. */
export const UNEMPLOYMENT_MORALE_PENALTY_CAP = 5;
/** Scale for productivity term in migration pull (foodProduced / this = multiplier component). */
export const PRODUCTIVITY_NORMALIZE = 50;

export const UNIT_COSTS: Record<UnitType, { gold: number }> = {
  infantry:       { gold: 1 },
  cavalry:        { gold: 3 },
  ranged:         { gold: 2 },
  builder:        { gold: 2 },
  trebuchet:      { gold: 8 },
  battering_ram:  { gold: 6 },
};

export const UNIT_DISPLAY_NAMES: Record<UnitType, string> = {
  infantry:       'Infantry',
  cavalry:        'Cavalry',
  ranged:         'Archer',
  builder:        'Builder',
  trebuchet:      'Trebuchet',
  battering_ram:  'Battering Ram',
};

export const UNIT_BASE_STATS: Record<UnitType, {
  maxHp: number; attack: number; range: number;
  speed: number; foodUpkeep: number; gunUpkeep: number; gunL2Upkeep?: number;
  /** Siege damage vs wall sections (trebuchet 3 hex, ram melee). */
  siegeAttack?: number;
}> = {
  infantry:       { maxHp: 100, attack: 15, range: 1, speed: 1.0, foodUpkeep: 1, gunUpkeep: 0 },
  cavalry:        { maxHp: 75,  attack: 20, range: 1, speed: 1.5, foodUpkeep: 2, gunUpkeep: 0 },
  ranged:         { maxHp: 50,  attack: 12, range: 2, speed: 1.0, foodUpkeep: 1, gunUpkeep: 0 },
  builder:        { maxHp: 40,  attack: 0,  range: 0, speed: 1.0, foodUpkeep: 1, gunUpkeep: 0 },
  trebuchet:      { maxHp: 60,  attack: 5,  range: 3, speed: 0.6, foodUpkeep: 2, gunUpkeep: 0, siegeAttack: 25 },
  battering_ram:  { maxHp: 120, attack: 10, range: 1, speed: 0.5, foodUpkeep: 2, gunUpkeep: 0, siegeAttack: 40 },
};

// Level 2 unit stats (require L2 arms); siege units have no L2 variant
export const UNIT_L2_STATS: Record<UnitType, {
  maxHp: number; attack: number; range: number;
  speed: number; foodUpkeep: number; gunUpkeep: number; gunL2Upkeep: number;
  siegeAttack?: number;
}> = {
  infantry:       { maxHp: 120, attack: 18, range: 1, speed: 1.0, foodUpkeep: 1, gunUpkeep: 0, gunL2Upkeep: 1 },
  cavalry:        { maxHp: 90,  attack: 24, range: 1, speed: 1.5, foodUpkeep: 2, gunUpkeep: 0, gunL2Upkeep: 1 },
  ranged:         { maxHp: 60,  attack: 14, range: 2, speed: 1.0, foodUpkeep: 1, gunUpkeep: 0, gunL2Upkeep: 2 },
  builder:        { maxHp: 40,  attack: 0,  range: 0, speed: 1.0, foodUpkeep: 1, gunUpkeep: 0, gunL2Upkeep: 0 },
  trebuchet:      { maxHp: 60,  attack: 5,  range: 3, speed: 0.6, foodUpkeep: 2, gunUpkeep: 0, gunL2Upkeep: 0, siegeAttack: 25 },
  battering_ram:  { maxHp: 120, attack: 10, range: 1, speed: 0.5, foodUpkeep: 2, gunUpkeep: 0, gunL2Upkeep: 0, siegeAttack: 40 },
};

export const HERO_BUFFS: Record<HeroType, { label: string; desc: string }> = {
  general:     { label: 'General', desc: '+10% Attack' },
  logistician: { label: 'Logistician', desc: '-50% Food Upkeep' },
};

export const HERO_NAMES = [
  'Marcus the Bold', 'Helena Ironside', 'Kael Stormborn', 'Lyra the Wise',
  'Theron Blackwood', 'Vala of the East', 'Orion the Cunning', 'Sera Flameheart',
];

export const TERRAIN_FOOD_YIELD: Record<Biome, number> = {
  water: 0, plains: 2, forest: 1, mountain: 0, desert: 0.5,
};

// ─── Population Growth Constants ─────────────────────────────────
export const POP_BIRTH_RATE = 0.12;           // per-capita logistic birth rate (was 0.25; lower so AFK doesn't overshoot into starvation)
export const POP_NATURAL_DEATHS = 1;          // flat natural deaths per city per cycle
export const POP_CARRYING_CAPACITY_PER_FOOD = 4;  // K = foodProduced * this
/** Smoothing for expected K (0.25 ≈ 2–4 cycle adjustment); births use expected K, not instant production */
export const POP_EXPECTED_K_ALPHA = 0.25;
/** Extra deaths per cycle when city has no food in storage (starvation) */
export const STARVATION_DEATHS = 2;

export const PLAYER_COLORS = { human: '#55aaee', ai: '#ee5555', ai2: '#eebb44' };

// ─── Weather / Natural Disasters ──────────────────────────────────

export type WeatherEventType = 'typhoon' | 'drought';

export interface WeatherEvent {
  id: string;
  type: WeatherEventType;
  startCycle: number;
  duration: number;        // cycles remaining (starts at 3)
  harvestPenalty: number;   // 0.5 = 50% reduction
}

export const WEATHER_DURATION_CYCLES = 3;
export const WEATHER_HARVEST_PENALTY = 0.5;  // 50% reduction
export const WEATHER_CHANCE_PER_CYCLE = 0.03; // 3% chance each cycle (after cycle 3)
export const WEATHER_MIN_CYCLE = 3;           // no disasters in first 3 cycles
export const WEATHER_COOLDOWN_CYCLES = 5;     // min cycles between disasters

export const WEATHER_DISPLAY: Record<WeatherEventType, {
  label: string;
  icon: string;
  color: string;
  bgColor: string;
  borderColor: string;
  description: string;
}> = {
  typhoon: {
    label: 'TYPHOON',
    icon: '/sprites/meta/typhoon.png',
    color: 'text-cyan-300',
    bgColor: 'bg-cyan-950/80',
    borderColor: 'border-cyan-400/60',
    description: 'Violent storms ravage the land. Harvests reduced by 50% for 3 cycles.',
  },
  drought: {
    label: 'DROUGHT',
    icon: '/sprites/meta/drought.png',
    color: 'text-amber-300',
    bgColor: 'bg-amber-950/80',
    borderColor: 'border-amber-400/60',
    description: 'Scorching heat withers crops. Harvests reduced by 50% for 3 cycles.',
  },
};

// ─── Real-Time Constants ───────────────────────────────────────────

export const GAME_DURATION_SEC = 35 * 60;   // 35 minutes
export const CYCLE_INTERVAL_SEC = 30;        // economy cycle every 30s
export const COMBAT_TICK_MS = 1000;           // combat resolution every 1s
/** Retreat command: delay before retreat executes (design §5, 30). */
export const RETREAT_DELAY_MS = 2000;
/** Hold city center this long (ms) to capture (design §13). */
export const CITY_CAPTURE_HOLD_MS = 5000;
/** Assault: attacker damage multiplier when scaling walls (design §13). */
export const ASSAULT_ATTACK_DEBUFF = 0.4;
export const VISION_RANGE = 5;                // units reveal 5-hex radius
export const CITY_VISION_RANGE = 4;           // cities reveal 4-hex radius
export const BUILDING_VISION_RANGE = 2;       // buildings reveal 2-hex radius
export const SCOUT_VISION_RANGE = 5;          // scout towers reveal 5-hex radius
export const ROAD_SPEED_BONUS = 1.5;          // +50% speed on roads

export const CITY_NAMES = [
  'Ashenvale', 'Ironhold', 'Stonewatch', 'Thornwall', 'Ravenport',
  'Duskfall', 'Goldcrest', 'Mistwood', 'Blackthorn', 'Silverpeak',
  'Embervale', 'Frostmere', 'Oakenshire', 'Shadowfen', 'Whitecliff',
  'Deepholm', 'Sunhaven', 'Stormgate', 'Nighthaven', 'Copperfield',
];

// ─── ID Generator ──────────────────────────────────────────────────

let _nextId = 1;
export function generateId(prefix: string): string {
  return `${prefix}_${_nextId++}`;
}

// ─── Hex Math ──────────────────────────────────────────────────────

export function axialToWorld(q: number, r: number, radius: number): [number, number] {
  const x = radius * (Math.sqrt(3) * q + (Math.sqrt(3) / 2) * r);
  const z = radius * (3 / 2) * r;
  return [x, z];
}

export function worldToAxial(x: number, z: number, radius: number): [number, number] {
  const r = (2 / 3) * z / radius;
  const q = (x / (radius * Math.sqrt(3))) - r / 2;
  return hexRound(q, r);
}

export function hexRound(fq: number, fr: number): [number, number] {
  const fs = -fq - fr;
  let rq = Math.round(fq);
  let rr = Math.round(fr);
  const rs = Math.round(fs);
  const dq = Math.abs(rq - fq);
  const dr = Math.abs(rr - fr);
  const ds = Math.abs(rs - fs);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return [rq, rr];
}

export function hexNeighbors(q: number, r: number): [number, number][] {
  return [[q+1,r],[q-1,r],[q,r+1],[q,r-1],[q+1,r-1],[q-1,r+1]];
}

export function hexDistance(q1: number, r1: number, q2: number, r2: number): number {
  return (Math.abs(q1 - q2) + Math.abs(q1 + r1 - q2 - r2) + Math.abs(r1 - r2)) / 2;
}

/** All hexes at exactly distance `ring` from center (cx, cy). Ring 1 = 6 hexes, ring 2 = 12, etc. */
export function getHexRing(cx: number, cy: number, ring: number): { q: number; r: number }[] {
  if (ring <= 0) return [];
  const out: { q: number; r: number }[] = [];
  for (let dq = -ring; dq <= ring; dq++) {
    for (let dr = -ring; dr <= ring; dr++) {
      if (hexDistance(cx, cy, cx + dq, cy + dr) === ring) {
        out.push({ q: cx + dq, r: cy + dr });
      }
    }
  }
  return out;
}

export function tileKey(q: number, r: number): string {
  return `${q},${r}`;
}

export function parseTileKey(key: string): [number, number] {
  const [q, r] = key.split(',').map(Number);
  return [q, r];
}

export function stepToward(
  fromQ: number, fromR: number,
  toQ: number, toR: number,
  tiles: Map<string, Tile>,
): [number, number] {
  const neighbors = hexNeighbors(fromQ, fromR);
  let best: [number, number] = [fromQ, fromR];
  let bestDist = Infinity;
  for (const [nq, nr] of neighbors) {
    const tile = tiles.get(tileKey(nq, nr));
    if (!tile || tile.biome === 'water') continue;
    const d = hexDistance(nq, nr, toQ, toR);
    if (d < bestDist) {
      bestDist = d;
      best = [nq, nr];
    }
  }
  return best;
}
