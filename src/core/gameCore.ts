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
} from '../types/game';
import { generateMap, placeAncientCity } from '../lib/mapGenerator';
import { calculateTerritory } from '../lib/territory';
import { processEconomyTurn } from '../lib/gameLoop';
import { planAiTurn, placeAiStartingCityAt, createAiHero, AiParams, DEFAULT_AI_PARAMS, estimateAiFoodSurplus } from '../lib/ai';
import { movementTick, combatTick, upkeepTick, siegeTick, type SupplyCacheEntry } from '../lib/military';
import { rollForWeatherEvent, tickWeatherEvent, getWeatherHarvestMultiplier } from '../lib/weather';

export type { AiParams };
export { DEFAULT_AI_PARAMS };

const AI_ID = 'player_ai';
const AI_ID_2 = 'player_ai_2';

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
  /** Cache: unitId -> { clusterKey, q, r }; recomputed only when unit moves or cities change. */
  supplyCache?: Map<string, SupplyCacheEntry>;
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
  const trace: CycleTrace[] = [];
  const traceCallback = tracePath
    ? (data: CycleTrace) => trace.push(data)
    : undefined;

  let state = initBotVsBotGame(seed, paramsA, paramsB, mapOverride);
  while (state.phase === 'playing' && state.cycle < maxC) {
    state = stepSimulation(state, paramsA, paramsB, diag, traceCallback);
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
  return {
    winner,
    cycle: state.cycle,
    ai1Cities: ai1Cities.length,
    ai2Cities: ai2Cities.length,
    ai1Pop,
    ai2Pop,
    diagnostics: { ...diag, unitsAtEnd },
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
};

/** Single step: economy + AI actions + one movement/combat/siege/capture tick. */
export function stepSimulation(
  state: SimState,
  paramsA: AiParams,
  paramsB: AiParams,
  diagnostics?: SimDiagnostics,
  traceCallback?: (data: CycleTrace) => void,
): SimState {
  if (state.phase !== 'playing') return state;

  if (diagnostics) {
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

  // ── Upkeep (reuse clusters from economy; supply cache avoids recomputing per-unit supply when position unchanged) ──
  const supplyCache = state.supplyCache ?? new Map<string, SupplyCacheEntry>();
  const upkeepResult = upkeepTick(
    units, cities, state.heroes, newCycle, state.tiles, state.territory,
    econ.clusters, supplyCache,
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

  if (diagnostics) {
    const anyStarving = units.some(u => u.status === 'starving');
    if (anyStarving && diagnostics.firstCycleAnyStarvation == null) diagnostics.firstCycleAnyStarvation = newCycle;
    const ai1Military = units.filter(u => u.ownerId === AI_ID && u.type !== 'builder');
    const ai2Military = units.filter(u => u.ownerId === AI_ID_2 && u.type !== 'builder');
    const allStarving1 = ai1Military.length > 0 && ai1Military.every(u => u.status === 'starving');
    const allStarving2 = ai2Military.length > 0 && ai2Military.every(u => u.status === 'starving');
    if ((allStarving1 || allStarving2) && diagnostics.firstCycleAllStarving == null) diagnostics.firstCycleAllStarving = newCycle;
    const foodAi1 = cities.filter(c => c.ownerId === AI_ID).reduce((s, c) => s + c.storage.food, 0);
    const foodAi2 = cities.filter(c => c.ownerId === AI_ID_2).reduce((s, c) => s + c.storage.food, 0);
    if (foodAi1 <= 0 && diagnostics.firstCycleFoodZeroAi1 == null) diagnostics.firstCycleFoodZeroAi1 = newCycle;
    if (foodAi2 <= 0 && diagnostics.firstCycleFoodZeroAi2 == null) diagnostics.firstCycleFoodZeroAi2 = newCycle;
    const ai1Units = units.filter(u => u.ownerId === AI_ID);
    const ai2Units = units.filter(u => u.ownerId === AI_ID_2);
    diagnostics.unitStatusCountsAi1 = countStatus(ai1Units);
    diagnostics.unitStatusCountsAi2 = countStatus(ai2Units);
  }

  // ── AI turns: compute both plans first (for trace), then apply ──
  let scoutMissions = [...state.scoutMissions];
  let scoutedHexes = new Set(state.scoutedHexes);
  let tilesMut = state.tiles;
  let constructions = [...state.constructions];

  const aiConfigs: { id: string; params: AiParams }[] = [
    { id: AI_ID, params: paramsA },
    { id: AI_ID_2, params: paramsB },
  ];

  const plans = aiConfigs.map(({ id, params }) => planAiTurn(id, cities, units, players, state.tiles, state.territory, params));

  if (traceCallback) {
    const ai1CitiesFiltered = cities.filter(c => c.ownerId === AI_ID);
    const ai2CitiesFiltered = cities.filter(c => c.ownerId === AI_ID_2);
    const ai1Pop = ai1CitiesFiltered.reduce((s, c) => s + c.population, 0);
    const ai2Pop = ai2CitiesFiltered.reduce((s, c) => s + c.population, 0);
    const ai1FoodStorage = ai1CitiesFiltered.reduce((s, c) => s + c.storage.food, 0);
    const ai2FoodStorage = ai2CitiesFiltered.reduce((s, c) => s + c.storage.food, 0);
    const food1 = estimateAiFoodSurplus(AI_ID, cities, units, state.tiles, state.territory, harvestMultiplier);
    const food2 = estimateAiFoodSurplus(AI_ID_2, cities, units, state.tiles, state.territory, harvestMultiplier);
    const ai1Units = units.filter(u => u.ownerId === AI_ID);
    const ai2Units = units.filter(u => u.ownerId === AI_ID_2);
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

  for (let cfgIdx = 0; cfgIdx < aiConfigs.length; cfgIdx++) {
    const { id: aiPlayerId } = aiConfigs[cfgIdx];
    const aiPlan = plans[cfgIdx];
    const aiPlayer = players.find(p => p.id === aiPlayerId);
    if (!aiPlayer) continue;

    for (const build of aiPlan.builds) {
      if (build.type === 'city_center') continue;
      const city = cities.find(c => c.id === build.cityId);
      if (!city || city.ownerId !== aiPlayerId) continue;
      if (aiPlayer.gold < BUILDING_COSTS[build.type]) continue;
      const ironCost = BUILDING_IRON_COSTS[build.type] ?? 0;
      if (ironCost > 0 && (city.storage.iron ?? 0) < ironCost) continue;
      // Only start construction in own territory (city provides BP; outside territory would need builders)
      const terr = state.territory.get(tileKey(build.q, build.r));
      if (!terr || terr.playerId !== aiPlayerId) continue;
      if (cities.some(c => c.buildings.some(b => b.q === build.q && b.r === build.r))) continue;
      if (constructions.some(cs => cs.q === build.q && cs.r === build.r)) continue;

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

      if (diagnostics) {
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
      const city = cities.find(c => c.id === up.cityId);
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
      const city = cities.find(c => c.id === rec.cityId);
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
      const unit = units.find(u => u.id === mt.unitId);
      // Allow idle, moving, or starving units to receive move targets (not fighting) so headless sims stay decisive
      if (unit && unit.hp > 0 && unit.status !== 'fighting') {
        unit.targetQ = mt.toQ;
        unit.targetR = mt.toR;
        unit.status = 'moving';
        unit.stance = 'aggressive';
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
  movementTick(movingUnits, movingHeroes, state.tiles, state.wallSections, citiesToSet, newSimTimeMs);
  const combatResult = combatTick(movingUnits, movingHeroes, newCycle, citiesToSet, newSimTimeMs);
  const wallSectionsMut = state.wallSections.map(w => ({ ...w }));
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

  if (diagnostics) {
    const killsThisStep = combatResult.killedUnitIds.length;
    diagnostics.totalKills += killsThisStep;
    for (const uid of combatResult.killedUnitIds) {
      const u = units.find(unit => unit.id === uid);
      if (u?.ownerId === AI_ID) diagnostics.killsByAi2 = (diagnostics.killsByAi2 ?? 0) + 1;
      else if (u?.ownerId === AI_ID_2) diagnostics.killsByAi1 = (diagnostics.killsByAi1 ?? 0) + 1;
    }
    const hadFlip = state.cities.some(
      c => citiesToSet.find(n => n.id === c.id)?.ownerId !== c.ownerId,
    );
    if (hadFlip) {
      diagnostics.hadOwnerFlip = true;
      if (diagnostics.firstOwnerFlipCycle == null) diagnostics.firstOwnerFlipCycle = newCycle;
    }
    if (killsThisStep > 0 && diagnostics.firstCombatCycle == null) diagnostics.firstCombatCycle = newCycle;
  }

  // ── Victory ──
  let phase: GamePhase = 'playing';
  const ai1Cities = citiesToSet.filter(c => c.ownerId === AI_ID);
  const ai2Cities = citiesToSet.filter(c => c.ownerId === AI_ID_2);
  if (ai1Cities.length === 0 || ai2Cities.length === 0) phase = 'victory';

  // Invalidate supply cache when city ownership or count changed (capture/new city) so next step recomputes
  const citiesChanged =
    state.cities.length !== citiesToSet.length ||
    state.cities.some(c => citiesToSet.find(n => n.id === c.id)?.ownerId !== c.ownerId);
  const supplyCacheNext = state.supplyCache != null && !citiesChanged ? state.supplyCache : undefined;

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
  };
}
