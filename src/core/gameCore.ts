/**
 * Headless game core for fast simulations (no UI, no timers).
 * One step = one economy cycle + one movement/combat/siege/capture tick.
 * Used by scripts/train-ai.ts to run many bot-vs-bot matches and evolve AI params.
 */

import * as path from 'path';
import * as fs from 'fs';
import {
  MapConfig, DEFAULT_MAP_CONFIG, GamePhase, tileKey, generateId, hexDistance,
  City, Unit, Player, Hero, Tile, TerritoryInfo,
  CityBuilding, ScoutMission, WallSection, ScoutTower, WeatherEvent,
  ConstructionSite, BuildingType,
  STARTING_GOLD, VILLAGE_CITY_TEMPLATE, CITY_CENTER_STORAGE,
  BUILDING_COSTS, BUILDING_IRON_COSTS, BUILDING_BP_COST, BUILDING_JOBS, getBuildingJobs,
  CITY_BUILDING_POWER, BUILDER_POWER, BP_RATE_BASE,
  WORKERS_PER_LEVEL,
  BARACKS_UPGRADE_COST, FACTORY_UPGRADE_COST, FARM_UPGRADE_COST,
  UNIT_COSTS, UNIT_L2_COSTS, UNIT_L3_COSTS, getUnitStats,
  SCOUT_MISSION_COST, SCOUT_MISSION_DURATION_SEC, VILLAGE_INCORPORATE_COST,
  DEFENDER_IRON_COST,
  FRONTIER_CYCLES, CITY_NAMES, PLAYER_COLORS,
  CITY_CAPTURE_HOLD_MS,
  WALL_SECTION_STONE_COST, WALL_SECTION_HP, getHexRing,
  SUPPLY_QUALITY_THRESHOLD,
} from '../types/game';
import { generateMap, placeAncientCity } from '../lib/mapGenerator';
import { calculateTerritory } from '../lib/territory';
import { processEconomyTurn } from '../lib/gameLoop';
import { planAiTurn, placeAiStartingCityAt, createAiHero, AiParams, DEFAULT_AI_PARAMS, estimateAiFoodSurplus } from '../lib/ai';
import { movementTick, combatTick, upkeepTick, siegeTick, type SupplyCacheEntry } from '../lib/military';
import { computeSupplyCostMaps, type SupplyCostMap } from '../lib/logistics';
import { rollForWeatherEvent, tickWeatherEvent, getWeatherHarvestMultiplier } from '../lib/weather';

export type { AiParams };
export { DEFAULT_AI_PARAMS };

const AI_ID = 'player_ai';
const AI_ID_2 = 'player_ai_2';

/** Signature for cache invalidation: recompute supply cost maps when cities or unit layout change. */
function makeLogisticsSignature(cities: City[], units: Unit[]): string {
  const cityPart = cities.length + '_' + [...cities].map(c => c.id + ':' + c.ownerId).sort().join(',');
  const unitPart = [...units].filter(u => u.hp > 0).map(u => tileKey(u.q, u.r)).sort().join(',');
  return cityPart + '|' + unitPart;
}

export type SimState = {
  config: MapConfig;
  tiles: Map<string, Tile>;
  cities: City[];
  units: Unit[];
  players: Player[];
  heroes: Hero[];
  territory: Map<string, TerritoryInfo>;
  cycle: number;
  phase: GamePhase;
  activeWeather: WeatherEvent | null;
  lastWeatherEndCycle: number;
  scoutMissions: ScoutMission[];
  scoutedHexes: Set<string>;
  scoutTowers: ScoutTower[];
  wallSections: WallSection[];
  /** Construction sites (buildings in progress); AI uses these instead of instant builds. */
  constructions: ConstructionSite[];
  cityCaptureHold: Record<string, { attackerId: string; startedAt: number }>;
  /** Simulated time in ms; advances 30s per cycle for capture hold & scout completion */
  simTimeMs: number;
  /** Cache: unitId -> { clusterKey, supplyQuality, q, r }; recomputed when unit moves. */
  supplyCache?: Map<string, SupplyCacheEntry>;
  /** Precomputed supply cost maps per player; invalidated when cities or unit positions change. */
  supplyCostMaps?: Map<string, SupplyCostMap>;
  /** Signature used to avoid recomputing supply cost maps when nothing relevant changed. */
  logisticsSignature?: string;
};

let _cityNameIdx = 0;
let _heroNameIdx = 0;
function nextCityName(): string {
  return CITY_NAMES[_cityNameIdx++ % CITY_NAMES.length];
}

/** Create initial bot-vs-bot state: map with two AI capitals at corners. */
export function initBotVsBotGame(
  seed: number,
  _paramsA?: AiParams,
  _paramsB?: AiParams,
  mapConfigOverride?: Partial<MapConfig>,
): SimState {
  _cityNameIdx = 0;
  _heroNameIdx = 0;
  const config: MapConfig = { ...DEFAULT_MAP_CONFIG, ...mapConfigOverride, seed };
  const { tiles: tilesArray } = generateMap(config);
  const tiles = new Map<string, Tile>();
  for (const t of tilesArray) tiles.set(tileKey(t.q, t.r), t);

  const w = config.width;
  const h = config.height;
  const tryFind = (centerQ: number, centerR: number): [number, number] | null => {
    for (let d = 0; d <= Math.min(w, h) / 2; d++) {
      for (let dq = -d; dq <= d; dq++) {
        for (let dr = -d; dr <= d; dr++) {
          if (Math.abs(dq) !== d && Math.abs(dr) !== d) continue;
          const q = centerQ + dq;
          const r = centerR + dr;
          if (q < 0 || q >= w || r < 0 || r >= h) continue;
          const t = tiles.get(tileKey(q, r));
          if (t && t.biome !== 'water' && t.biome !== 'mountain') return [q, r];
        }
      }
    }
    return null;
  };

  const corner1 = tryFind(Math.min(12, Math.floor(w * 0.15)), Math.min(12, Math.floor(h * 0.15)));
  const corner2 = tryFind(Math.max(w - 13, Math.floor(w * 0.85)), Math.max(h - 13, Math.floor(h * 0.85)));
  if (!corner1 || !corner2) throw new Error('Could not find valid start positions');

  const [ai1Q, ai1R] = corner1;
  const [ai2Q, ai2R] = corner2;
  const city1 = placeAiStartingCityAt(AI_ID, ai1Q, ai1R, tiles);
  const city2 = placeAiStartingCityAt(AI_ID_2, ai2Q, ai2R, tiles);
  if (!city1 || !city2) throw new Error('Could not place both AI capitals');

  city1.name = nextCityName();
  city2.name = nextCityName();
  const cities = [city1, city2];
  placeAncientCity(tiles, ai1Q, ai1R, ai2Q, ai2R);
  const territory = calculateTerritory(cities, tiles);

  const players: Player[] = [
    { id: AI_ID, name: 'North', color: PLAYER_COLORS.ai, gold: STARTING_GOLD, taxRate: 0.3, foodPriority: 'military', isHuman: false },
    { id: AI_ID_2, name: 'South', color: PLAYER_COLORS.ai2, gold: STARTING_GOLD, taxRate: 0.3, foodPriority: 'military', isHuman: false },
  ];

  const heroes: Hero[] = [
    createAiHero(city1.q, city1.r, AI_ID),
    createAiHero(city2.q, city2.r, AI_ID_2),
  ];

  return {
    config,
    tiles,
    cities,
    units: [],
    players,
    heroes,
    territory,
    cycle: 0,
    phase: 'playing',
    activeWeather: null,
    lastWeatherEndCycle: -10,
    scoutMissions: [],
    scoutedHexes: new Set(),
    scoutTowers: [],
    wallSections: [],
    constructions: [],
    cityCaptureHold: {},
    simTimeMs: 0,
  };
}

/** Result of a finished simulation: winner (or null if timeout) and scores. */
export type SimResult = {
  winner: 'ai1' | 'ai2' | null;
  cycle: number;
  ai1Cities: number;
  ai2Cities: number;
  ai1Pop: number;
  ai2Pop: number;
};

/** Per-cycle trace snapshot for starvation/debug instrumentation. */
export type CycleTrace = {
  cycle: number;
  ai1Pop: number;
  ai2Pop: number;
  ai1FoodStorage: number;
  ai2FoodStorage: number;
  ai1FoodIncome: number;
  ai2FoodIncome: number;
  civDemandAi1: number;
  civDemandAi2: number;
  militaryDemandAi1: number;
  militaryDemandAi2: number;
  recruitsAi1: number;
  recruitsAi2: number;
  unitStatusAi1: { idle: number; moving: number; fighting: number; starving: number };
  unitStatusAi2: { idle: number; moving: number; fighting: number; starving: number };
};

/** Options for faster training (smaller map, shorter games). */
export type RunSimulationOptions = {
  maxCycles?: number;
  mapConfigOverride?: Partial<MapConfig>;
  /** If set, per-cycle trace is written to this path (JSON array of CycleTrace). */
  tracePath?: string;
  /** 'minimal' = collect only totalKills, killsByAi1/2, totalStarvationAbort (faster). Omit = 'full'. */
  diagnosticsLevel?: 'full' | 'minimal';
};

/** Run one full simulation until victory or maxCycles. Returns result. */
export function runSimulation(
  paramsA: AiParams,
  paramsB: AiParams,
  seed: number,
  maxCycles: number = 500,
  options?: RunSimulationOptions,
): SimResult {
  const maxC = options?.maxCycles ?? maxCycles;
  const mapOverride = options?.mapConfigOverride;
  let state = initBotVsBotGame(seed, paramsA, paramsB, mapOverride);
  while (state.phase === 'playing' && state.cycle < maxC) {
    state = stepSimulation(state, paramsA, paramsB);
  }

  const ai1Cities = state.cities.filter(c => c.ownerId === AI_ID);
  const ai2Cities = state.cities.filter(c => c.ownerId === AI_ID_2);
  const ai1Pop = ai1Cities.reduce((a, c) => a + c.population, 0);
  const ai2Pop = ai2Cities.reduce((a, c) => a + c.population, 0);

  let winner: 'ai1' | 'ai2' | null = null;
  if (state.phase === 'victory') {
    if (ai1Cities.length === 0) winner = 'ai2';
    else if (ai2Cities.length === 0) winner = 'ai1';
  }
  // No winner on timeout: only conquest (one side loses all cities) counts.

  return {
    winner,
    cycle: state.cycle,
    ai1Cities: ai1Cities.length,
    ai2Cities: ai2Cities.length,
    ai1Pop,
    ai2Pop,
  };
}

export type RunSimulationDiagnostics = SimDiagnostics & {
  unitsAtEnd: number;
};

/** Run simulation and return result plus diagnostics (kills, owner flips, units at end). */
export function runSimulationWithDiagnostics(
  paramsA: AiParams,
  paramsB: AiParams,
  seed: number,
  maxCycles: number = 500,
  options?: RunSimulationOptions,
): SimResult & { diagnostics: RunSimulationDiagnostics } {
  const diag: SimDiagnostics = {
    totalKills: 0,
    killsByAi1: 0,
    killsByAi2: 0,
    hadOwnerFlip: false,
    buildsAi1: {},
    buildsAi2: {},
    buildsAi1Early: {},
    buildsAi2Early: {},
    buildsAi1Late: {},
    buildsAi2Late: {},
  };
  const maxC = options?.maxCycles ?? maxCycles;
  const mapOverride = options?.mapConfigOverride;
  const tracePath = options?.tracePath;
  const diagnosticsLevel = options?.diagnosticsLevel ?? 'full';
  const trace: CycleTrace[] = [];
  const traceCallback = tracePath
    ? (data: CycleTrace) => trace.push(data)
    : undefined;

  let state = initBotVsBotGame(seed, paramsA, paramsB, mapOverride);
  while (state.phase === 'playing' && state.cycle < maxC) {
    state = stepSimulation(state, paramsA, paramsB, diag, traceCallback, { diagnosticsLevel });
  }

  const ai1Cities = state.cities.filter(c => c.ownerId === AI_ID);
  const ai2Cities = state.cities.filter(c => c.ownerId === AI_ID_2);
  const ai1Pop = ai1Cities.reduce((a, c) => a + c.population, 0);
  const ai2Pop = ai2Cities.reduce((a, c) => a + c.population, 0);
  diag.finalAi1Pop = ai1Pop;
  diag.finalAi2Pop = ai2Pop;

  if (tracePath && trace.length > 0) {
    const outPath = path.isAbsolute(tracePath) ? tracePath : path.join(process.cwd(), tracePath);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(trace, null, 0), 'utf8');
  }

  let winner: 'ai1' | 'ai2' | null = null;
  if (state.phase === 'victory') {
    if (ai1Cities.length === 0) winner = 'ai2';
    else if (ai2Cities.length === 0) winner = 'ai1';
  }
  const unitsAtEnd = state.units.filter(u => u.hp > 0).length;
  const totalStarvationAbort = state.phase === 'total_starvation';
  if (totalStarvationAbort) diag.totalStarvationAbort = true;
  const totalCycles = state.cycle;
  if (totalCycles > 0) {
    if (diag._closureCyclesAi1 != null) diag.closureUptimeAi1 = diag._closureCyclesAi1 / totalCycles;
    if (diag._closureCyclesAi2 != null) diag.closureUptimeAi2 = diag._closureCyclesAi2 / totalCycles;
  }
  if ((diag._totalMoveTargetsAi1 ?? 0) > 0) diag.localConsolidationActionShareAi1 = (diag._totalVillageMoveTargetsAi1 ?? 0) / diag._totalMoveTargetsAi1!;
  if ((diag._totalMoveTargetsAi2 ?? 0) > 0) diag.localConsolidationActionShareAi2 = (diag._totalVillageMoveTargetsAi2 ?? 0) / diag._totalMoveTargetsAi2!;
  return {
    winner,
    cycle: state.cycle,
    ai1Cities: ai1Cities.length,
    ai2Cities: ai2Cities.length,
    ai1Pop,
    ai2Pop,
    diagnostics: { ...diag, unitsAtEnd, totalStarvationAbort },
  };
}

/** Optional diagnostics accumulated during a simulation run (for diag-sim-health / audit-strategy-flow). */
export type SimDiagnostics = {
  totalKills: number;
  /** Kills scored by AI1 (units belonging to AI2 that died). */
  killsByAi1?: number;
  /** Kills scored by AI2 (units belonging to AI1 that died). */
  killsByAi2?: number;
  hadOwnerFlip: boolean;
  /** First cycle when any combat kill occurred (set when diagnostics provided). */
  firstCombatCycle?: number;
  /** First cycle when any city changed owner (set when diagnostics provided). */
  firstOwnerFlipCycle?: number;
  /** First cycle when any unit was starving. */
  firstCycleAnyStarvation?: number;
  /** First cycle when one side had all military units starving (if ever). */
  firstCycleAllStarving?: number;
  /** First cycle when AI1 had zero total food in cities. */
  firstCycleFoodZeroAi1?: number;
  /** First cycle when AI2 had zero total food in cities. */
  firstCycleFoodZeroAi2?: number;
  /** True when game aborted: both sides irrecoverable (all military starving + zero food). Both AIs get massive penalty. */
  totalStarvationAbort?: boolean;
  /** Unit status counts (last cycle) for instrumentation. */
  unitStatusCountsAi1?: { idle: number; moving: number; fighting: number; starving: number };
  unitStatusCountsAi2?: { idle: number; moving: number; fighting: number; starving: number };
  /** Final-cycle population per side (for collapse metrics). */
  finalAi1Pop?: number;
  finalAi2Pop?: number;
  /** Builds completed per type per side (farm, market, mine, quarry, barracks, factory, academy, gold_mine). */
  buildsAi1?: Record<string, number>;
  buildsAi2?: Record<string, number>;
  /** Builds in early game (cycle <= 100). */
  buildsAi1Early?: Record<string, number>;
  buildsAi2Early?: Record<string, number>;
  /** Builds in late game (cycle > 100). */
  buildsAi1Late?: Record<string, number>;
  buildsAi2Late?: Record<string, number>;
  // ── Ring/siege/supply telemetry (per game, optional) ──
  /** Ring completion ratio (built/target segments) for AI1 key city, max over cycles. */
  ringCompletionRatioAi1?: number;
  /** Ring completion ratio for AI2 key city, max over cycles. */
  ringCompletionRatioAi2?: number;
  /** Whether AI1 ever had ring closed (any owned city). */
  isRingClosedAi1?: boolean;
  /** Whether AI2 ever had ring closed. */
  isRingClosedAi2?: boolean;
  /** Cycles to first closure (AI1). */
  timeToClosureAi1?: number;
  /** Cycles to first closure (AI2). */
  timeToClosureAi2?: number;
  /** Cycles when ring was closed (AI1); closureUptimeAi1 = this / totalCycles at end. */
  _closureCyclesAi1?: number;
  /** Cycles when ring was closed (AI2). */
  _closureCyclesAi2?: number;
  /** Fraction of cycles ring was closed (AI1), set at end of run. */
  closureUptimeAi1?: number;
  /** Fraction of cycles ring was closed (AI2), set at end of run. */
  closureUptimeAi2?: number;
  /** Breach count (intact→broken transitions) AI1. */
  breachCountAi1?: number;
  /** Breach count AI2. */
  breachCountAi2?: number;
  /** Cycles with any military starving (AI1). */
  supplyStressCyclesAi1?: number;
  /** Cycles with any military starving (AI2). */
  supplyStressCyclesAi2?: number;
  /** Avg distance military to nearest friendly city, final (AI1). */
  avgMilitaryDistanceToAnchorAi1?: number;
  /** Avg distance military to nearest friendly city, final (AI2). */
  avgMilitaryDistanceToAnchorAi2?: number;
  /** Cycles when all military were starving (AI1). */
  allStarvingCyclesAi1?: number;
  /** Cycles when all military were starving (AI2). */
  allStarvingCyclesAi2?: number;
  // ── Logistics / consolidation telemetry ──
  /** Cumulative unit-cycles with degraded route (0 < supplyQuality < threshold) AI1. */
  interdictedUnitCyclesAi1?: number;
  interdictedUnitCyclesAi2?: number;
  /** Cumulative unit-cycles unsupplied (supplyQuality < threshold) AI1. */
  unsuppliedUnitCyclesAi1?: number;
  unsuppliedUnitCyclesAi2?: number;
  /** Cycles when AI had at least one city not in capital cluster (disconnected outpost). */
  disconnectedOutpostCyclesAi1?: number;
  disconnectedOutpostCyclesAi2?: number;
  /** Avg expansion depth (hex dist from capital) of owned cities, last cycle. */
  avgExpansionDepthAi1?: number;
  avgExpansionDepthAi2?: number;
  /** Total move orders toward village hexes (for share). */
  _totalVillageMoveTargetsAi1?: number;
  _totalVillageMoveTargetsAi2?: number;
  _totalMoveTargetsAi1?: number;
  _totalMoveTargetsAi2?: number;
  /** Fraction of move orders that were local consolidation (village) targets, set at end. */
  localConsolidationActionShareAi1?: number;
  localConsolidationActionShareAi2?: number;
};

/** Options for stepSimulation (e.g. minimal diagnostics to reduce cost). */
export type StepSimulationOptions = { diagnosticsLevel?: 'full' | 'minimal' };

/** Single step: economy + AI actions + one movement/combat/siege/capture tick. */
export function stepSimulation(
  state: SimState,
  paramsA: AiParams,
  paramsB: AiParams,
  diagnostics?: SimDiagnostics,
  traceCallback?: (data: CycleTrace) => void,
  stepOptions?: StepSimulationOptions,
): SimState {
  if (state.phase !== 'playing') return state;

  const diagFull = stepOptions?.diagnosticsLevel !== 'minimal';
  if (diagnostics && diagFull) {
    diagnostics.buildsAi1 ??= {};
    diagnostics.buildsAi2 ??= {};
    diagnostics.buildsAi1Early ??= {};
    diagnostics.buildsAi2Early ??= {};
    diagnostics.buildsAi1Late ??= {};
    diagnostics.buildsAi2Late ??= {};
  }

  const newCycle = state.cycle + 1;
  const newSimTimeMs = state.simTimeMs + 30_000;

  // ── Weather ──
  let currentWeather = state.activeWeather;
  let lastWeatherEnd = state.lastWeatherEndCycle;
  if (currentWeather) {
    const tick = tickWeatherEvent(currentWeather, newCycle);
    currentWeather = tick.event;
    if (tick.endedCycle !== null) lastWeatherEnd = tick.endedCycle;
  }
  if (!currentWeather) {
    const newEvent = rollForWeatherEvent(newCycle, currentWeather, lastWeatherEnd);
    if (newEvent) currentWeather = newEvent;
  }
  const harvestMultiplier = getWeatherHarvestMultiplier(currentWeather);

  // ── Economy ──
  const econ = processEconomyTurn(
    state.cities, state.units, state.players,
    state.tiles, state.territory, newCycle, harvestMultiplier,
  );
  let cities = econ.cities;
  let units = econ.units;
  let players = econ.players;

  // ── Supply cost maps: reuse when signature unchanged (city ownership/count + unit positions) ──
  const logisticsSignature = makeLogisticsSignature(cities, units);
  let supplyCostMaps = state.logisticsSignature === logisticsSignature ? state.supplyCostMaps : undefined;
  if (!supplyCostMaps && econ.clusters) {
    supplyCostMaps = computeSupplyCostMaps(cities, econ.clusters, state.tiles, units);
  }

  // ── Upkeep (reuse clusters + supply cost maps; supply cache avoids recomputing when position unchanged) ──
  const supplyCache = state.supplyCache ?? new Map<string, SupplyCacheEntry>();
  const upkeepResult = upkeepTick(
    units, cities, state.heroes, newCycle, state.tiles, state.territory,
    econ.clusters, supplyCache, supplyCostMaps,
  );
  units = units.filter(u => u.hp > 0);

  const countStatus = (list: Unit[]) => {
    let idle = 0, moving = 0, fighting = 0, starving = 0;
    for (const u of list) {
      if (u.status === 'idle') idle++;
      else if (u.status === 'moving') moving++;
      else if (u.status === 'fighting') fighting++;
      else if (u.status === 'starving') starving++;
    }
    return { idle, moving, fighting, starving };
  };

  const ai1Cities = cities.filter(c => c.ownerId === AI_ID);
  const ai2Cities = cities.filter(c => c.ownerId === AI_ID_2);
  const ai1Units = units.filter(u => u.ownerId === AI_ID);
  const ai2Units = units.filter(u => u.ownerId === AI_ID_2);
  const ai1Military = ai1Units.filter(u => u.type !== 'builder');
  const ai2Military = ai2Units.filter(u => u.type !== 'builder');
  const allStarving1 = ai1Military.length > 0 && ai1Military.every(u => u.status === 'starving');
  const allStarving2 = ai2Military.length > 0 && ai2Military.every(u => u.status === 'starving');
  const foodAi1 = ai1Cities.reduce((s, c) => s + c.storage.food, 0);
  const foodAi2 = ai2Cities.reduce((s, c) => s + c.storage.food, 0);

  const minDistToCities = (q: number, r: number, cityList: City[]): number => {
    let min = Infinity;
    for (const c of cityList) {
      const d = hexDistance(q, r, c.q, c.r);
      if (d < min) min = d;
    }
    return min;
  };

  if (diagnostics && diagFull) {
    const anyStarving = units.some(u => u.status === 'starving');
    if (anyStarving && diagnostics.firstCycleAnyStarvation == null) diagnostics.firstCycleAnyStarvation = newCycle;
    if ((allStarving1 || allStarving2) && diagnostics.firstCycleAllStarving == null) diagnostics.firstCycleAllStarving = newCycle;
    if (foodAi1 <= 0 && diagnostics.firstCycleFoodZeroAi1 == null) diagnostics.firstCycleFoodZeroAi1 = newCycle;
    if (foodAi2 <= 0 && diagnostics.firstCycleFoodZeroAi2 == null) diagnostics.firstCycleFoodZeroAi2 = newCycle;
    diagnostics.unitStatusCountsAi1 = countStatus(ai1Units);
    diagnostics.unitStatusCountsAi2 = countStatus(ai2Units);
    // Supply stress / all-starving cycles
    if (ai1Military.some(u => u.status === 'starving')) diagnostics.supplyStressCyclesAi1 = (diagnostics.supplyStressCyclesAi1 ?? 0) + 1;
    if (ai2Military.some(u => u.status === 'starving')) diagnostics.supplyStressCyclesAi2 = (diagnostics.supplyStressCyclesAi2 ?? 0) + 1;
    if (allStarving1) diagnostics.allStarvingCyclesAi1 = (diagnostics.allStarvingCyclesAi1 ?? 0) + 1;
    if (allStarving2) diagnostics.allStarvingCyclesAi2 = (diagnostics.allStarvingCyclesAi2 ?? 0) + 1;
    // Avg military distance to nearest friendly city (anchor)
    if (ai1Cities.length > 0 && ai1Military.length > 0) {
      let sum = 0;
      for (const u of ai1Military) sum += minDistToCities(u.q, u.r, ai1Cities);
      diagnostics.avgMilitaryDistanceToAnchorAi1 = sum / ai1Military.length;
    }
    if (ai2Cities.length > 0 && ai2Military.length > 0) {
      let sum = 0;
      for (const u of ai2Military) sum += minDistToCities(u.q, u.r, ai2Cities);
      diagnostics.avgMilitaryDistanceToAnchorAi2 = sum / ai2Military.length;
    }
    // Ring completion (key city = first city per side): ring 1 target vs built
    const wallByKey = new Map(state.wallSections.map(w => [tileKey(w.q, w.r), w]));
    for (const [side, ownerId, sideCities] of [['Ai1', AI_ID, ai1Cities], ['Ai2', AI_ID_2, ai2Cities]] as const) {
      const keyCity = sideCities[0];
      if (!keyCity) continue;
      const ring1Hexes = getHexRing(keyCity.q, keyCity.r, 1);
      let built = 0;
      let target = 0;
      for (const { q, r } of ring1Hexes) {
        const t = state.tiles.get(tileKey(q, r));
        if (t && t.biome !== 'water') target++;
        const w = wallByKey.get(tileKey(q, r));
        if (w && w.ownerId === ownerId && (w.hp ?? 0) > 0) built++;
      }
      const ratio = target > 0 ? built / target : 0;
      const closed = target > 0 && built === target;
      if (side === 'Ai1') {
        diagnostics.ringCompletionRatioAi1 = Math.max(diagnostics.ringCompletionRatioAi1 ?? 0, ratio);
        if (closed) diagnostics.isRingClosedAi1 = true;
        if (closed && diagnostics.timeToClosureAi1 == null) diagnostics.timeToClosureAi1 = newCycle;
        if (closed) diagnostics._closureCyclesAi1 = (diagnostics._closureCyclesAi1 ?? 0) + 1;
      } else {
        diagnostics.ringCompletionRatioAi2 = Math.max(diagnostics.ringCompletionRatioAi2 ?? 0, ratio);
        if (closed) diagnostics.isRingClosedAi2 = true;
        if (closed && diagnostics.timeToClosureAi2 == null) diagnostics.timeToClosureAi2 = newCycle;
        if (closed) diagnostics._closureCyclesAi2 = (diagnostics._closureCyclesAi2 ?? 0) + 1;
      }
    }
    // Logistics: interdicted / unsupplied unit-cycles from supply cache (filled by upkeepTick)
    for (const u of ai1Military) {
      const ent = supplyCache.get(u.id);
      if (ent) {
        if (ent.supplyQuality < SUPPLY_QUALITY_THRESHOLD) {
          diagnostics.unsuppliedUnitCyclesAi1 = (diagnostics.unsuppliedUnitCyclesAi1 ?? 0) + 1;
          if (ent.supplyQuality > 0) diagnostics.interdictedUnitCyclesAi1 = (diagnostics.interdictedUnitCyclesAi1 ?? 0) + 1;
        }
      }
    }
    for (const u of ai2Military) {
      const ent = supplyCache.get(u.id);
      if (ent) {
        if (ent.supplyQuality < SUPPLY_QUALITY_THRESHOLD) {
          diagnostics.unsuppliedUnitCyclesAi2 = (diagnostics.unsuppliedUnitCyclesAi2 ?? 0) + 1;
          if (ent.supplyQuality > 0) diagnostics.interdictedUnitCyclesAi2 = (diagnostics.interdictedUnitCyclesAi2 ?? 0) + 1;
        }
      }
    }
    // Disconnected outpost: cities not in capital cluster
    const clusters = econ.clusters;
    const ai1Clusters = clusters?.get(AI_ID) ?? [];
    const ai2Clusters = clusters?.get(AI_ID_2) ?? [];
    const capCluster1 = ai1Cities[0] ? ai1Clusters.find(cl => cl.cityIds.includes(ai1Cities[0].id)) : undefined;
    const capCluster2 = ai2Cities[0] ? ai2Clusters.find(cl => cl.cityIds.includes(ai2Cities[0].id)) : undefined;
    const capitalIds1 = new Set(capCluster1?.cityIds ?? []);
    const capitalIds2 = new Set(capCluster2?.cityIds ?? []);
    if (ai1Cities.some(c => !capitalIds1.has(c.id))) diagnostics.disconnectedOutpostCyclesAi1 = (diagnostics.disconnectedOutpostCyclesAi1 ?? 0) + 1;
    if (ai2Cities.some(c => !capitalIds2.has(c.id))) diagnostics.disconnectedOutpostCyclesAi2 = (diagnostics.disconnectedOutpostCyclesAi2 ?? 0) + 1;
    // Avg expansion depth (hex dist from capital)
    if (ai1Cities.length > 1) {
      const cap = ai1Cities[0];
      let sum = 0;
      for (const c of ai1Cities) if (c.id !== cap.id) sum += hexDistance(cap.q, cap.r, c.q, c.r);
      diagnostics.avgExpansionDepthAi1 = sum / (ai1Cities.length - 1);
    }
    if (ai2Cities.length > 1) {
      const cap = ai2Cities[0];
      let sum = 0;
      for (const c of ai2Cities) if (c.id !== cap.id) sum += hexDistance(cap.q, cap.r, c.q, c.r);
      diagnostics.avgExpansionDepthAi2 = sum / (ai2Cities.length - 1);
    }
  }

  // ── AI turns: compute both plans first (for trace), then apply ──
  let scoutMissions = [...state.scoutMissions];
  let scoutedHexes = new Set(state.scoutedHexes);
  let tilesMut = state.tiles;
  let constructions = [...state.constructions];
  let wallSectionsAfterAi: WallSection[] = state.wallSections.map(w => ({ ...w }));

  const aiConfigs: { id: string; params: AiParams }[] = [
    { id: AI_ID, params: paramsA },
    { id: AI_ID_2, params: paramsB },
  ];

  const plans = aiConfigs.map(({ id, params }) => planAiTurn(id, cities, units, players, state.tiles, state.territory, params, state.wallSections));

  if (diagnostics && diagFull) {
    const p1 = plans[0].moveTargets;
    const p2 = plans[1].moveTargets;
    diagnostics._totalMoveTargetsAi1 = (diagnostics._totalMoveTargetsAi1 ?? 0) + p1.length;
    diagnostics._totalMoveTargetsAi2 = (diagnostics._totalMoveTargetsAi2 ?? 0) + p2.length;
    let v1 = 0, v2 = 0;
    for (const mt of p1) { if (state.tiles.get(tileKey(mt.toQ, mt.toR))?.hasVillage) v1++; }
    for (const mt of p2) { if (state.tiles.get(tileKey(mt.toQ, mt.toR))?.hasVillage) v2++; }
    diagnostics._totalVillageMoveTargetsAi1 = (diagnostics._totalVillageMoveTargetsAi1 ?? 0) + v1;
    diagnostics._totalVillageMoveTargetsAi2 = (diagnostics._totalVillageMoveTargetsAi2 ?? 0) + v2;
  }

  if (traceCallback) {
    const ai1Pop = ai1Cities.reduce((s, c) => s + c.population, 0);
    const ai2Pop = ai2Cities.reduce((s, c) => s + c.population, 0);
    const ai1FoodStorage = ai1Cities.reduce((s, c) => s + c.storage.food, 0);
    const ai2FoodStorage = ai2Cities.reduce((s, c) => s + c.storage.food, 0);
    const food1 = estimateAiFoodSurplus(AI_ID, cities, units, state.tiles, state.territory, harvestMultiplier);
    const food2 = estimateAiFoodSurplus(AI_ID_2, cities, units, state.tiles, state.territory, harvestMultiplier);
    traceCallback({
      cycle: newCycle,
      ai1Pop,
      ai2Pop,
      ai1FoodStorage,
      ai2FoodStorage,
      ai1FoodIncome: food1.foodIncome,
      ai2FoodIncome: food2.foodIncome,
      civDemandAi1: food1.civDemand,
      civDemandAi2: food2.civDemand,
      militaryDemandAi1: food1.militaryDemand,
      militaryDemandAi2: food2.militaryDemand,
      recruitsAi1: plans[0].recruits.length,
      recruitsAi2: plans[1].recruits.length,
      unitStatusAi1: countStatus(ai1Units),
      unitStatusAi2: countStatus(ai2Units),
    });
  }

  const unitById = new Map(units.map(u => [u.id, u]));

  for (let cfgIdx = 0; cfgIdx < aiConfigs.length; cfgIdx++) {
    const { id: aiPlayerId } = aiConfigs[cfgIdx];
    const aiPlan = plans[cfgIdx];
    const aiPlayer = players.find(p => p.id === aiPlayerId);
    if (!aiPlayer) continue;

    const cityById = new Map(cities.map(c => [c.id, c]));
    const occupiedTileKeys = new Set<string>();
    for (const c of cities) {
      for (const b of c.buildings) occupiedTileKeys.add(tileKey(b.q, b.r));
    }
    for (const cs of constructions) occupiedTileKeys.add(tileKey(cs.q, cs.r));

    for (const build of aiPlan.builds) {
      if (build.type === 'city_center') continue;
      const city = cityById.get(build.cityId);
      if (!city || city.ownerId !== aiPlayerId) continue;
      if (aiPlayer.gold < BUILDING_COSTS[build.type]) continue;
      const ironCost = BUILDING_IRON_COSTS[build.type] ?? 0;
      if (ironCost > 0 && (city.storage.iron ?? 0) < ironCost) continue;
      // Only start construction in own territory (city provides BP; outside territory would need builders)
      const terr = state.territory.get(tileKey(build.q, build.r));
      if (!terr || terr.playerId !== aiPlayerId) continue;
      if (occupiedTileKeys.has(tileKey(build.q, build.r))) continue;

      const bpRequired = BUILDING_BP_COST[build.type];
      const site: ConstructionSite = {
        id: generateId('con'),
        type: build.type as BuildingType,
        q: build.q,
        r: build.r,
        cityId: city.id,
        ownerId: aiPlayerId,
        bpRequired,
        bpAccumulated: 0,
      };
      constructions.push(site);
      occupiedTileKeys.add(tileKey(build.q, build.r));
      aiPlayer.gold -= BUILDING_COSTS[build.type];
      if (ironCost > 0) {
        const cityIdx = cities.indexOf(city);
        if (cityIdx >= 0) {
          const c = cities[cityIdx];
          cities[cityIdx] = {
            ...c,
            storage: { ...c.storage, iron: Math.max(0, (c.storage.iron ?? 0) - ironCost) },
          };
        }
      }

      if (diagnostics && diagFull) {
        const key = build.type;
        const early = newCycle <= 100;
        if (aiPlayerId === AI_ID) {
          diagnostics.buildsAi1![key] = (diagnostics.buildsAi1![key] ?? 0) + 1;
          if (early) diagnostics.buildsAi1Early![key] = (diagnostics.buildsAi1Early![key] ?? 0) + 1;
          else diagnostics.buildsAi1Late![key] = (diagnostics.buildsAi1Late![key] ?? 0) + 1;
        } else {
          diagnostics.buildsAi2![key] = (diagnostics.buildsAi2![key] ?? 0) + 1;
          if (early) diagnostics.buildsAi2Early![key] = (diagnostics.buildsAi2Early![key] ?? 0) + 1;
          else diagnostics.buildsAi2Late![key] = (diagnostics.buildsAi2Late![key] ?? 0) + 1;
        }
      }
    }

    for (const up of aiPlan.upgrades ?? []) {
      const city = cityById.get(up.cityId);
      if (!city || city.ownerId !== aiPlayerId || !aiPlayer) continue;
      const cost = up.type === 'barracks' ? BARACKS_UPGRADE_COST : up.type === 'farm' ? FARM_UPGRADE_COST : FACTORY_UPGRADE_COST;
      if (aiPlayer.gold < cost) continue;
      const building = city.buildings.find(b => b.type === up.type && b.q === up.buildingQ && b.r === up.buildingR);
      if (!building || (building.level ?? 1) >= 2) continue;
      building.level = 2;
      aiPlayer.gold -= cost;
    }

    const aiRecruitCities = cities.filter(c => c.ownerId === aiPlayerId);
    const aiTotalPopForRecruit = aiRecruitCities.reduce((s, c) => s + c.population, 0);
    let aiTroopCount = units.filter(u => u.ownerId === aiPlayerId && u.hp > 0).length;
    for (const rec of aiPlan.recruits) {
      const city = cityById.get(rec.cityId);
      if (!city || city.ownerId !== aiPlayerId || city.population <= 0 || aiTroopCount >= aiTotalPopForRecruit) continue;
      const effectiveLevel = rec.type === 'defender' ? 3 : (rec.armsLevel ?? 1);
      const wantL2 = effectiveLevel === 2;
      const wantL3 = effectiveLevel === 3;
      const goldCost = wantL3 ? UNIT_L3_COSTS[rec.type].gold : wantL2 ? UNIT_L2_COSTS[rec.type].gold : UNIT_COSTS[rec.type].gold;
      const stoneCost = wantL2 ? (UNIT_L2_COSTS[rec.type].stone ?? 0) : 0;
      const ironCost = wantL3 ? (UNIT_L3_COSTS[rec.type].iron ?? 0) : 0;
      if (aiPlayer.gold < goldCost) continue;
      if (stoneCost > 0 && (city.storage.stone ?? 0) < stoneCost) continue;
      if (ironCost > 0 && (city.storage.iron ?? 0) < ironCost) continue;
      if (rec.type === 'defender' || wantL2 || wantL3) {
        const barracks = city.buildings.find(b => b.type === 'barracks');
        if ((barracks?.level ?? 1) < 2) continue;
      }
      const stats = getUnitStats({ type: rec.type, armsLevel: effectiveLevel as 1 | 2 | 3 });
      const gunL2Upkeep = (stats as { gunL2Upkeep?: number }).gunL2Upkeep ?? 0;
      if (gunL2Upkeep > 0) {
        const totalGunsL2 = cities.filter(c => c.ownerId === aiPlayerId).reduce((sum, c) => sum + (c.storage.gunsL2 ?? 0), 0);
        if (totalGunsL2 < gunL2Upkeep) continue;
      }
      const isBuilder = rec.type === 'builder';
      const academy = city.buildings.find(b => b.type === 'academy');
      const barracks = city.buildings.find(b => b.type === 'barracks');
      const spawnB = isBuilder ? academy : barracks;
      const sq = spawnB ? spawnB.q : city.q;
      const sr = spawnB ? spawnB.r : city.r;
      const newUnit: Unit = {
        id: generateId('unit'), type: rec.type,
        q: sq, r: sr, ownerId: aiPlayerId,
        hp: stats.maxHp, maxHp: stats.maxHp,
        xp: 0, level: 0,
        status: 'idle', stance: 'aggressive',
        nextMoveAt: 0,
        originCityId: city.id,
      };
      if (wantL2) newUnit.armsLevel = 2;
      if (wantL3 || rec.type === 'defender') newUnit.armsLevel = 3;
      if (gunL2Upkeep > 0) {
        for (const oc of cities.filter(c => c.ownerId === aiPlayerId)) {
          if ((oc.storage.gunsL2 ?? 0) >= gunL2Upkeep) {
            oc.storage.gunsL2 = (oc.storage.gunsL2 ?? 0) - gunL2Upkeep;
            break;
          }
        }
      }
      aiPlayer.gold -= goldCost;
      if (stoneCost > 0 || ironCost > 0) {
        const cityIdx = cities.indexOf(city);
        if (cityIdx >= 0) {
          const c = cities[cityIdx];
          cities[cityIdx] = {
            ...c,
            storage: {
              ...c.storage,
              stone: Math.max(0, (c.storage.stone ?? 0) - stoneCost),
              iron: Math.max(0, (c.storage.iron ?? 0) - ironCost),
            },
          };
        }
      }
      units.push(newUnit);
      aiTroopCount += 1;
    }

    for (const scout of aiPlan.scouts ?? []) {
      const key = tileKey(scout.targetQ, scout.targetR);
      if (aiPlayer.gold >= SCOUT_MISSION_COST && !scoutedHexes.has(key) && !scoutMissions.some(m => m.targetQ === scout.targetQ && m.targetR === scout.targetR)) {
        aiPlayer.gold -= SCOUT_MISSION_COST;
        scoutMissions.push({
          id: generateId('scout'),
          targetQ: scout.targetQ,
          targetR: scout.targetR,
          completesAt: newSimTimeMs + SCOUT_MISSION_DURATION_SEC * 1000,
        });
      }
    }

    for (const inc of aiPlan.incorporateVillages ?? []) {
      const tile = tilesMut.get(tileKey(inc.q, inc.r));
      if (!tile || !tile.hasVillage || aiPlayer.gold < VILLAGE_INCORPORATE_COST) continue;
      if (cities.some(c => c.q === inc.q && c.r === inc.r)) continue;
      const militaryHere = units.filter(u => u.ownerId === aiPlayerId && u.hp > 0 && u.type !== 'builder' && u.q === inc.q && u.r === inc.r);
      if (militaryHere.length === 0) continue;
      aiPlayer.gold -= VILLAGE_INCORPORATE_COST;
      const newCity: City = {
        id: generateId('city'),
        name: nextCityName(),
        q: inc.q, r: inc.r,
        ownerId: aiPlayerId,
        ...structuredClone(VILLAGE_CITY_TEMPLATE),
        frontierCity: FRONTIER_CYCLES,
      };
      newCity.buildings = [{ type: 'city_center', q: inc.q, r: inc.r, assignedWorkers: 0 }];
      newCity.storageCap = { ...CITY_CENTER_STORAGE };
      cities = [...cities, newCity];
      tilesMut = new Map(tilesMut);
      tilesMut.set(tileKey(inc.q, inc.r), { ...tile, hasVillage: false });
    }

    for (const mt of aiPlan.moveTargets) {
      const unit = unitById.get(mt.unitId);
      // Allow idle, moving, or starving units to receive move targets (not fighting) so headless sims stay decisive
      if (unit && unit.hp > 0 && unit.status !== 'fighting') {
        unit.targetQ = mt.toQ;
        unit.targetR = mt.toR;
        unit.status = 'moving';
        unit.stance = 'aggressive';
      }
    }

    // AI wall ring builds: deduct stone from city, add sections for valid ring hexes that don't already have owner's wall
    const buildWallRings = (aiPlan as { buildWallRings?: { cityId: string; ring: 1 | 2 }[] }).buildWallRings ?? [];
    for (const wr of buildWallRings) {
      const city = cityById.get(wr.cityId);
      if (!city || city.ownerId !== aiPlayerId) continue;
      const ringHexes = getHexRing(city.q, city.r, wr.ring);
      const ownerWallKeys = new Set(wallSectionsAfterAi.filter(w => w.ownerId === aiPlayerId).map(w => tileKey(w.q, w.r)));
      const validHexes: { q: number; r: number }[] = [];
      for (const { q, r } of ringHexes) {
        const tile = tilesMut.get(tileKey(q, r));
        if (!tile || tile.biome === 'water') continue;
        if (ownerWallKeys.has(tileKey(q, r))) continue;
        validHexes.push({ q, r });
      }
      if (validHexes.length === 0) continue;
      const totalCost = validHexes.length * WALL_SECTION_STONE_COST;
      const cityStone = city.storage.stone ?? 0;
      if (cityStone < totalCost) continue;
      const cityIdx = cities.indexOf(city);
      if (cityIdx >= 0) {
        cities[cityIdx] = {
          ...cities[cityIdx],
          storage: { ...cities[cityIdx].storage, stone: Math.max(0, cityStone - totalCost) },
        };
      }
      for (const { q, r } of validHexes) {
        wallSectionsAfterAi.push({
          q, r, ownerId: aiPlayerId, hp: WALL_SECTION_HP, maxHp: WALL_SECTION_HP,
        });
      }
    }
  }

  // ── Construction tick (one cycle = 30s; same BP logic as live game) ──
  if (constructions.length > 0) {
    const remaining: ConstructionSite[] = [];
    const updatedCities = cities.map(c => ({ ...c, buildings: [...c.buildings] }));

    for (const site of constructions) {
      let availBP = 0;
      if (site.type !== 'trebuchet' && site.type !== 'scout_tower') {
        const terr = state.territory.get(tileKey(site.q, site.r));
        if (terr && terr.playerId === site.ownerId) availBP += CITY_BUILDING_POWER;
      }
      const builders = units.filter(
        (u) => u.q === site.q && u.r === site.r && u.ownerId === site.ownerId && u.type === 'builder' && u.hp > 0
      );
      availBP += builders.length * BUILDER_POWER;

      if (availBP === 0) {
        remaining.push(site);
        continue;
      }

      // One cycle = 30 seconds: gain 30 * (availBP / BP_RATE_BASE) = availBP
      const bpGain = availBP;
      const newAccum = site.bpAccumulated + bpGain;

      if (newAccum >= site.bpRequired) {
        if (site.type === 'trebuchet' || site.type === 'scout_tower') continue; // not used by AI in this path
        const city = updatedCities.find((c) => c.id === site.cityId);
        if (city) {
          const b: CityBuilding = { type: site.type as BuildingType, q: site.q, r: site.r };
          if (['quarry', 'mine', 'gold_mine', 'barracks', 'factory', 'academy', 'farm', 'market'].includes(site.type)) b.level = 1;
          const jobs = BUILDING_JOBS[site.type as BuildingType] ?? 0;
          if (jobs > 0) {
            const totalEmployed = city.buildings.reduce((s, x) => s + ((x as CityBuilding).assignedWorkers ?? 0), 0);
            const available = city.population - totalEmployed;
            b.assignedWorkers = Math.min(jobs, Math.max(0, available));
          }
          city.buildings.push(b);
        }
      } else {
        remaining.push({ ...site, bpAccumulated: newAccum });
      }
    }

    constructions = remaining;
    cities = updatedCities;
  }

  // Complete scout missions that have passed
  const stillPending: ScoutMission[] = [];
  for (const m of scoutMissions) {
    if (m.completesAt <= newSimTimeMs) scoutedHexes.add(tileKey(m.targetQ, m.targetR));
    else stillPending.push(m);
  }
  scoutMissions = stillPending;

  // ── City capture (instant when no defenders; runCycle-style) ──
  let citiesToSet = cities;
  let aliveUnits = units.filter(u => u.hp > 0);
  for (const city of cities) {
    const defenders = aliveUnits.filter(u => u.ownerId === city.ownerId && u.hp > 0 && u.q === city.q && u.r === city.r);
    if (defenders.length > 0) continue;
    const attackers = aliveUnits.filter(u => u.ownerId !== city.ownerId && u.hp > 0 && u.type !== 'builder' && u.q === city.q && u.r === city.r);
    if (attackers.length === 0) continue;
    const newOwnerId = attackers[0].ownerId;
    citiesToSet = citiesToSet.map(c => c.id === city.id ? { ...c, ownerId: newOwnerId } : c);
  }
  // Territory computed once at end of step (after capture hold) to avoid duplicate work

  // ── One movement + combat + siege tick (use sim time so headless runs advance correctly) ──
  const movingUnits = units.map(u => ({ ...u }));
  const movingHeroes = state.heroes.map(h => ({ ...h }));
  movementTick(movingUnits, movingHeroes, state.tiles, wallSectionsAfterAi, citiesToSet, newSimTimeMs);
  const combatResult = combatTick(movingUnits, movingHeroes, newCycle, citiesToSet, state.tiles, newSimTimeMs);
  const wallSectionsMut = wallSectionsAfterAi.map(w => ({ ...w }));
  siegeTick(wallSectionsMut, movingUnits);

  aliveUnits = movingUnits.filter(u => u.hp > 0 && !combatResult.killedUnitIds.includes(u.id));

  const killedIds = new Set(combatResult.killedUnitIds);
  const popDeductByCityId: Record<string, number> = {};
  for (const u of units) {
    if (killedIds.has(u.id) && u.originCityId) {
      popDeductByCityId[u.originCityId] = (popDeductByCityId[u.originCityId] ?? 0) + 1;
    }
  }
  citiesToSet = Object.keys(popDeductByCityId).length === 0
    ? citiesToSet
    : citiesToSet.map(c => {
        const deduct = popDeductByCityId[c.id] ?? 0;
        return deduct > 0 ? { ...c, population: Math.max(0, c.population - deduct) } : c;
      });

  for (const u of aliveUnits) {
    if (u.status === 'fighting') {
      const hasNearbyEnemy = aliveUnits.some(
        e => e.ownerId !== u.ownerId && e.hp > 0 && hexDistance(u.q, u.r, e.q, e.r) <= getUnitStats(u).range
      );
      if (!hasNearbyEnemy) u.status = 'idle';
    }
  }

  // ── City capture hold (5s) ──
  let captureHoldNext: Record<string, { attackerId: string; startedAt: number }> = { ...state.cityCaptureHold };
  for (const city of citiesToSet) {
    const onCenter = aliveUnits.filter(u => u.q === city.q && u.r === city.r && u.hp > 0);
    const owners = [...new Set(onCenter.map(u => u.ownerId))];
    if (owners.length === 1 && owners[0] !== city.ownerId) {
      const attackerId = owners[0];
      if (city.population === 0) {
        citiesToSet = citiesToSet.map(c => c.id === city.id ? { ...c, ownerId: attackerId } : c);
        delete captureHoldNext[city.id];
      } else {
        const existing = captureHoldNext[city.id];
        if (!existing || existing.attackerId !== attackerId) {
          captureHoldNext[city.id] = { attackerId, startedAt: newSimTimeMs };
        } else if (newSimTimeMs - existing.startedAt >= CITY_CAPTURE_HOLD_MS) {
          citiesToSet = citiesToSet.map(c => c.id === city.id ? { ...c, ownerId: attackerId } : c);
          delete captureHoldNext[city.id];
        }
      }
    } else {
      delete captureHoldNext[city.id];
    }
  }
  const territory = calculateTerritory(citiesToSet, tilesMut);

  // Build city id -> owner map once for O(1) lookups (avoids O(cities²) per step)
  const newCityOwnerById = new Map<string, string>();
  for (const c of citiesToSet) newCityOwnerById.set(c.id, c.ownerId);

  if (diagnostics) {
    const killsThisStep = combatResult.killedUnitIds.length;
    diagnostics.totalKills += killsThisStep;
    const unitById = new Map(units.map(u => [u.id, u]));
    for (const uid of combatResult.killedUnitIds) {
      const u = unitById.get(uid);
      if (u?.ownerId === AI_ID) diagnostics.killsByAi2 = (diagnostics.killsByAi2 ?? 0) + 1;
      else if (u?.ownerId === AI_ID_2) diagnostics.killsByAi1 = (diagnostics.killsByAi1 ?? 0) + 1;
    }
    const hadFlip = state.cities.some(c => newCityOwnerById.get(c.id) !== c.ownerId);
    if (hadFlip) {
      diagnostics.hadOwnerFlip = true;
      if (diagnostics.firstOwnerFlipCycle == null) diagnostics.firstOwnerFlipCycle = newCycle;
    }
    if (killsThisStep > 0 && diagnostics.firstCombatCycle == null) diagnostics.firstCombatCycle = newCycle;
  }

  // ── Victory / total-starvation abort ──
  let phase: GamePhase = 'playing';
  const finalAi1Cities = citiesToSet.filter(c => c.ownerId === AI_ID);
  const finalAi2Cities = citiesToSet.filter(c => c.ownerId === AI_ID_2);
  const finalAi1Military = aliveUnits.filter(u => u.ownerId === AI_ID && u.type !== 'builder');
  const finalAi2Military = aliveUnits.filter(u => u.ownerId === AI_ID_2 && u.type !== 'builder');
  const finalAllStarving1 = finalAi1Military.length > 0 && finalAi1Military.every(u => u.status === 'starving');
  const finalAllStarving2 = finalAi2Military.length > 0 && finalAi2Military.every(u => u.status === 'starving');
  const finalFoodAi1 = finalAi1Cities.reduce((s, c) => s + c.storage.food, 0);
  const finalFoodAi2 = finalAi2Cities.reduce((s, c) => s + c.storage.food, 0);
  if (finalAllStarving1 && finalAllStarving2 && finalFoodAi1 <= 0 && finalFoodAi2 <= 0) {
    phase = 'total_starvation';
    if (diagnostics) diagnostics.totalStarvationAbort = true;
  } else if (finalAi1Cities.length === 0 || finalAi2Cities.length === 0) {
    phase = 'victory';
  }

  // Invalidate supply cache when city ownership or count changed (capture/new city) so next step recomputes
  const citiesChanged =
    state.cities.length !== citiesToSet.length ||
    state.cities.some(c => newCityOwnerById.get(c.id) !== c.ownerId);
  const supplyCacheNext = !citiesChanged ? supplyCache : undefined;
  // Invalidate supply cost maps when cities changed; keep logistics signature for next step
  const supplyCostMapsNext = !citiesChanged ? supplyCostMaps : undefined;
  const logisticsSignatureNext = logisticsSignature;

  return {
    ...state,
    cities: citiesToSet,
    units: aliveUnits,
    players,
    territory,
    cycle: newCycle,
    phase,
    activeWeather: currentWeather,
    lastWeatherEndCycle: lastWeatherEnd,
    scoutMissions,
    scoutedHexes,
    scoutTowers: state.scoutTowers,
    wallSections: wallSectionsMut,
    constructions,
    cityCaptureHold: captureHoldNext,
    simTimeMs: newSimTimeMs,
    heroes: movingHeroes.filter(h => !(combatResult.killedHeroIds ?? []).includes(h.id)),
    supplyCache: supplyCacheNext,
    supplyCostMaps: supplyCostMapsNext,
    logisticsSignature: logisticsSignatureNext,
  };
}
