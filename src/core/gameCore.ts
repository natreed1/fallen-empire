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
  Commander, ScrollItem, ScrollAttachment, COMMANDER_STARTING_PICK,
  SpecialRegionKind, ScrollRelicSite,
  DefenseInstallation, UnitStack, OperationalArmy,
  ensureCityBuildingHp, UNIT_HP_REGEN_FRACTION_PER_CYCLE, isNavalUnitType,
  STARTING_GOLD, VILLAGE_CITY_TEMPLATE, CITY_CENTER_STORAGE,
  BUILDING_BP_COST, BUILDING_JOBS, getBuildingJobs,
  BP_RATE_BASE,
  getUnitStats,
  SCOUT_MISSION_COST,
  SCOUT_MISSION_MOVEMENT_TICKS,
  VILLAGE_INCORPORATE_COST,
  FRONTIER_CYCLES, CITY_NAMES, PLAYER_COLORS,
  CITY_CAPTURE_HOLD_TICKS,
  MOVEMENT_TICKS_PER_ECONOMY_CYCLE,
  WALL_SECTION_STONE_COST, WALL_SECTION_HP, WALL_SECTION_BP_COST, getHexRing,
  defenseInstallationCurrentHp,
} from '../types/game';
import { generateMap, placeAncientCity, rebuildSpecialTerrainForCapitals, type ScrollRelicClusters } from '../lib/mapGenerator';
import { calculateTerritory } from '../lib/territory';
import { processEconomyTurn } from '../lib/gameLoop';
import { syncUniversityBuildingLevelsForCities } from '../lib/universityPopulation';
import {
  planAiTurn,
  placeAiStartingCityAt,
  AiParams,
  DEFAULT_AI_PARAMS,
  estimateAiFoodSurplus,
  emptyAiActions,
  type AiActions,
} from '../lib/ai';
import {
  appendStartingFarmToCity,
  appendStartingBarracksToCity,
  appendStartingAcademyToCity,
} from '../lib/kingdomSpawn';
import { getNextWallBuildHex } from '../lib/wallBuilding';
import {
  movementTick,
  combatTick,
  coastalBombardmentTick,
  upkeepTick,
  siegeTick,
  siegeDefenseInstallationsTick,
  siegeBuildingsTick,
  landUnitBuildingDamageTick,
  defenseInstallationsLandRaidTick,
  autoEmbarkLandUnitsOntoScoutShipsAtHex,
  type SupplyCacheEntry,
  landMilitaryContestsCityCapture,
  enemyIntactWallOnCityHex,
} from '../lib/military';
import { updateArmyRallyFromUnits, computeArmyReplenishment } from '../lib/armyReplenishment';
import type { MoraleState } from '../lib/combat';
import { releaseAttackWaveHolds, releaseMarchEchelonHolds } from '../lib/siege';
import { applyDeployFlagsForMoveMutable, clearPatrolFieldsMutable, marchHexDistanceAtOrder } from '../lib/garrison';
import { rollForWeatherEvent, tickWeatherEvent, getWeatherHarvestMultiplier } from '../lib/weather';
import { computeConstructionAvailableBp, fillUniversitySlotTasks } from '../lib/builders';
import { computeContestedZoneHexKeys, applyContestedZonePayout } from '../lib/contestedZone';
import { rollCommanderIdentity, createCommanderRecord, syncCommandersToAssignments, unassignCommandersWithDeadAnchors, clearInvalidCommanderAssignments } from '../lib/commanders';
import { tickScrollRelicPickup, returnScrollsForDeadCarriers } from '../lib/scrolls';
import { spawnUnitFromPendingLand, type PendingLandRecruit } from '../lib/pendingLandRecruit';
import { applyAiInstantBuilds, applyAiUpgrades, applyAiRecruitsAsPending } from '../lib/applyAiPlan';

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
  cityCaptureHold: Record<string, { attackerId: string; startedAtMovementTick: number }>;
  /** Monotonic movement ticks (advances {@link MOVEMENT_TICKS_PER_ECONOMY_CYCLE} per economy step in headless). */
  globalMovementTick: number;
  /** Simulated time in ms; advances with movement ticks for combat/movement code paths */
  simTimeMs: number;
  /** Cache: unitId -> { inSupply, q, r }; recomputed only when unit moves or cities change. */
  supplyCache?: Map<string, SupplyCacheEntry>;
  /** Contested zone hex keys (purple band between two capitals). */
  contestedZoneHexKeys: string[];
  /** Named commanders with trait bonuses; synced to assignments each cycle. */
  commanders: Commander[];
  /** Seeded relic hexes (one per special terrain flavor on the map). */
  scrollRelics: ScrollRelicSite[];
  /** Connected special-terrain patch per region (relic sits in this cluster). */
  scrollRelicClusters: ScrollRelicClusters;
  /** Per player, per region, hex keys visited while searching (humans need full cluster). */
  scrollSearchVisited: Record<string, Partial<Record<SpecialRegionKind, string[]>>>;
  /** Per-region scroll claimed by player ids. */
  scrollRegionClaimed: Record<SpecialRegionKind, string[]>;
  /** Scroll inventory per player. */
  scrollInventory: Record<string, ScrollItem[]>;
  /** Active scroll attachments to carrier units. */
  scrollAttachments: ScrollAttachment[];
  /** Coastal towers / field defense (headless uses empty; parity with live combat volleys). */
  defenseInstallations: DefenseInstallation[];
  /** Unit stacks — training templates (bot sim typically empty). */
  unitStacks: UnitStack[];
  /** Field armies (player-created; not auto map stacks). */
  operationalArmies: OperationalArmy[];
  /** Persistent morale stacks from land combat (same as live game). */
  combatMoraleState: MoraleState;
  /** Land recruits completing next cycle (parity with useGameStore pendingRecruits). */
  pendingRecruits: PendingLandRecruit[];
};

let _cityNameIdx = 0;
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
  let lastErr: Error | null = null;
  for (let bump = 0; bump < 128; bump++) {
    try {
      return initBotVsBotGameOnce(seed + bump, _paramsA, _paramsB, mapConfigOverride);
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastErr ?? new Error('initBotVsBotGame: could not place capitals after 128 seed bumps');
}

/** Two human players at opposite corners — same map as bot-vs-bot; used by multiplayer game server. */
export function initMultiplayerGame(
  seed: number,
  mapConfigOverride?: Partial<MapConfig>,
): SimState {
  const state = initBotVsBotGame(seed, DEFAULT_AI_PARAMS, DEFAULT_AI_PARAMS, mapConfigOverride);
  return {
    ...state,
    players: state.players.map((p, i) => ({
      ...p,
      name: i === 0 ? 'Player 1' : 'Player 2',
      isHuman: true,
      color: i === 0 ? PLAYER_COLORS.human : PLAYER_COLORS.ai2,
    })),
  };
}

function initBotVsBotGameOnce(
  seed: number,
  _paramsA?: AiParams,
  _paramsB?: AiParams,
  mapConfigOverride?: Partial<MapConfig>,
): SimState {
  _cityNameIdx = 0;
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

  const allTilesArr = Array.from(tiles.values());
  const { scrollRelics, scrollRelicClusters } = rebuildSpecialTerrainForCapitals(allTilesArr, tiles, config, [
    { q: ai1Q, r: ai1R },
    { q: ai2Q, r: ai2R },
  ]);

  const players: Player[] = [
    { id: AI_ID, name: 'North', color: PLAYER_COLORS.ai, gold: STARTING_GOLD, taxRate: 0.3, foodPriority: 'military', isHuman: false },
    { id: AI_ID_2, name: 'South', color: PLAYER_COLORS.ai2, gold: STARTING_GOLD, taxRate: 0.3, foodPriority: 'military', isHuman: false },
  ];

  const heroes: Hero[] = [];

  const contestedZoneHexKeys = computeContestedZoneHexKeys(tiles, ai1Q, ai1R, ai2Q, ai2R, config);

  const commanders: Commander[] = [];
  for (const city of cities) {
    for (let i = 0; i < COMMANDER_STARTING_PICK; i++) {
      const rolled = rollCommanderIdentity(config.seed ^ (city.q * 65521) ^ (city.r * 524287) ^ (i * 0xaced));
      commanders.push(createCommanderRecord(
        city.ownerId,
        rolled,
        undefined,
        city.q,
        city.r,
        { kind: 'city_defense', cityId: city.id },
      ));
    }
  }

  const scrollInventory: Record<string, ScrollItem[]> = {};
  for (const p of players) scrollInventory[p.id] = [];

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
    globalMovementTick: 0,
    simTimeMs: 0,
    contestedZoneHexKeys,
    commanders,
    scrollRelics,
    scrollRelicClusters,
    scrollSearchVisited: {},
    scrollRegionClaimed: { mexca: [], hills_lost: [], forest_secrets: [], isle_lost: [] },
    scrollInventory,
    scrollAttachments: [],
    defenseInstallations: [],
    unitStacks: [],
    operationalArmies: [],
    combatMoraleState: new Map(),
    pendingRecruits: [],
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
  const totalStarvationAbort = state.phase === 'total_starvation';
  if (totalStarvationAbort) diag.totalStarvationAbort = true;
  const totalCycles = state.cycle;
  if (totalCycles > 0) {
    if (diag._closureCyclesAi1 != null) diag.closureUptimeAi1 = diag._closureCyclesAi1 / totalCycles;
    if (diag._closureCyclesAi2 != null) diag.closureUptimeAi2 = diag._closureCyclesAi2 / totalCycles;
  }
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
  // ── New system telemetry ──
  /** Contested zone payouts won by AI1. */
  contestedZoneWinsAi1?: number;
  /** Contested zone payouts won by AI2. */
  contestedZoneWinsAi2?: number;
  /** Scrolls discovered by AI1. */
  scrollsDiscoveredAi1?: number;
  /** Scrolls discovered by AI2. */
  scrollsDiscoveredAi2?: number;
  /** Commanders assigned to field by AI1. */
  commanderFieldAssignmentsAi1?: number;
  /** Commanders assigned to field by AI2. */
  commanderFieldAssignmentsAi2?: number;
};

export type StepSimulationOptions = {
  /** When set, use these plans instead of {@link planAiTurn} (multiplayer). Keys = player ids (`player_ai`, `player_ai_2`). */
  humanPlansByPlayerId?: Record<string, AiActions>;
};

/** Single step: economy + AI actions + one movement/combat/siege/capture tick. */
export function stepSimulation(
  state: SimState,
  paramsA: AiParams,
  paramsB: AiParams,
  diagnostics?: SimDiagnostics,
  traceCallback?: (data: CycleTrace) => void,
  stepOpts?: StepSimulationOptions,
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
  const newGlobalMovementTick = state.globalMovementTick + MOVEMENT_TICKS_PER_ECONOMY_CYCLE;
  const newSimTimeMs = state.simTimeMs + MOVEMENT_TICKS_PER_ECONOMY_CYCLE * 1000;

  let pendingRecruitsAcc = state.pendingRecruits.filter(pr => pr.completesAtCycle !== newCycle);

  // ── Building HP migration + land recruits completing this cycle (matches runCycle) ──
  let citiesPrep = state.cities.map(c => ({
    ...c,
    buildings: c.buildings.map(b => ensureCityBuildingHp(b)),
  }));
  let unitsPrep = [...state.units];
  for (const pr of state.pendingRecruits.filter(p => p.completesAtCycle === newCycle)) {
    const u = spawnUnitFromPendingLand(pr, citiesPrep);
    if (u) unitsPrep.push(u);
  }

  // ── Passive HP regen + army rally/replenish ──
  unitsPrep = unitsPrep.map(u => {
    if (u.hp <= 0 || u.hp >= u.maxHp || u.aboardShipId || isNavalUnitType(u.type) || u.type === 'builder') {
      return u;
    }
    if (u.status === 'fighting') return u;
    const add = Math.max(1, Math.floor(u.maxHp * UNIT_HP_REGEN_FRACTION_PER_CYCLE));
    return { ...u, hp: Math.min(u.maxHp, u.hp + add) };
  });
  let playersPrep = state.players.map(p => ({ ...p }));
  let unitStacksState = updateArmyRallyFromUnits(state.unitStacks ?? [], unitsPrep);
  const replen = computeArmyReplenishment({
    unitStacks: unitStacksState,
    units: unitsPrep,
    cities: citiesPrep,
    players: playersPrep,
    cycle: newCycle,
    pendingRecruits: pendingRecruitsAcc,
  });
  citiesPrep = replen.cities;
  playersPrep = replen.players;
  unitStacksState = replen.unitStacks;
  for (const pr of replen.newPending) {
    pendingRecruitsAcc.push(pr as PendingLandRecruit);
  }

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
    citiesPrep, unitsPrep, playersPrep,
    state.tiles, state.territory, newCycle, harvestMultiplier,
  );
  let cities = econ.cities;
  let units = econ.units;
  let players = econ.players;

  // ── Contested zone payout (every 2nd cycle) ──
  const preContestedGold1 = players.find(p => p.id === AI_ID)?.gold ?? 0;
  const preContestedGold2 = players.find(p => p.id === AI_ID_2)?.gold ?? 0;
  const preContestedIron1 = cities.filter(c => c.ownerId === AI_ID).reduce((s, c) => s + (c.storage.iron ?? 0), 0);
  const preContestedIron2 = cities.filter(c => c.ownerId === AI_ID_2).reduce((s, c) => s + (c.storage.iron ?? 0), 0);
  const contested = applyContestedZonePayout({
    zoneKeys: state.contestedZoneHexKeys,
    newCycle,
    gameMode: 'bot_vs_bot',
    units,
    heroes: state.heroes,
    cities,
    players,
  });
  players = contested.players;
  cities = contested.cities;
  if (diagnostics) {
    const postGold1 = players.find(p => p.id === AI_ID)?.gold ?? 0;
    const postGold2 = players.find(p => p.id === AI_ID_2)?.gold ?? 0;
    const postIron1 = cities.filter(c => c.ownerId === AI_ID).reduce((s, c) => s + (c.storage.iron ?? 0), 0);
    const postIron2 = cities.filter(c => c.ownerId === AI_ID_2).reduce((s, c) => s + (c.storage.iron ?? 0), 0);
    if (postGold1 > preContestedGold1 || postIron1 > preContestedIron1) {
      diagnostics.contestedZoneWinsAi1 = (diagnostics.contestedZoneWinsAi1 ?? 0) + 1;
    }
    if (postGold2 > preContestedGold2 || postIron2 > preContestedIron2) {
      diagnostics.contestedZoneWinsAi2 = (diagnostics.contestedZoneWinsAi2 ?? 0) + 1;
    }
  }

  // ── Scroll search progress ──
  const prevScrollCount1 = (state.scrollInventory[AI_ID] ?? []).length;
  const prevScrollCount2 = (state.scrollInventory[AI_ID_2] ?? []).length;
  const scrollResult = tickScrollRelicPickup({
    newCycle,
    tiles: state.tiles,
    units,
    players,
    scrollRelics: state.scrollRelics,
    scrollRegionClaimed: state.scrollRegionClaimed,
    scrollInventory: state.scrollInventory,
    scrollRelicClusters: state.scrollRelicClusters,
    scrollSearchVisited: state.scrollSearchVisited ?? {},
  });
  let scrollRegionClaimed = scrollResult.scrollRegionClaimed;
  let scrollInventory = scrollResult.scrollInventory;
  let scrollSearchVisited = scrollResult.scrollSearchVisited;
  let scrollAttachments = [...state.scrollAttachments];
  if (diagnostics) {
    const newScrollCount1 = (scrollInventory[AI_ID] ?? []).length;
    const newScrollCount2 = (scrollInventory[AI_ID_2] ?? []).length;
    if (newScrollCount1 > prevScrollCount1) {
      diagnostics.scrollsDiscoveredAi1 = (diagnostics.scrollsDiscoveredAi1 ?? 0) + (newScrollCount1 - prevScrollCount1);
    }
    if (newScrollCount2 > prevScrollCount2) {
      diagnostics.scrollsDiscoveredAi2 = (diagnostics.scrollsDiscoveredAi2 ?? 0) + (newScrollCount2 - prevScrollCount2);
    }
  }

  // ── Upkeep (empire-pooled supply; cache avoids recomputing per-unit supply when position unchanged) ──
  const supplyCache = state.supplyCache ?? new Map<string, SupplyCacheEntry>();
  const upkeepResult = upkeepTick(units, cities, state.heroes, newCycle, state.tiles, state.territory, supplyCache);
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

  if (diagnostics) {
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

  const plans = stepOpts?.humanPlansByPlayerId
    ? aiConfigs.map(({ id }) => stepOpts.humanPlansByPlayerId![id] ?? emptyAiActions())
    : aiConfigs.map(({ id, params }) => planAiTurn(
      id, cities, units, players, state.tiles, state.territory, params, state.wallSections,
      state.contestedZoneHexKeys, state.commanders, scrollInventory, scrollAttachments,
      state.scrollRelics, state.scrollRegionClaimed,
    ));

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

  for (let cfgIdx = 0; cfgIdx < aiConfigs.length; cfgIdx++) {
    const { id: aiPlayerId } = aiConfigs[cfgIdx];
    const aiPlan = plans[cfgIdx];
    const aiPlayer = players.find(p => p.id === aiPlayerId);
    if (!aiPlayer) continue;

    const cityById = new Map(cities.map(c => [c.id, c]));

    applyAiInstantBuilds(
      aiPlan.builds.filter(b => b.type !== 'city_center'),
      {
        aiPlayerId,
        cities,
        getPlayer: () => players.find(p => p.id === aiPlayerId),
        onSpendGold: d => {
          const p = players.find(pl => pl.id === aiPlayerId);
          if (p) p.gold -= d;
        },
        onInstantBuild: diagnostics
          ? bt => {
              const early = newCycle <= 100;
              if (aiPlayerId === AI_ID) {
                diagnostics.buildsAi1![bt] = (diagnostics.buildsAi1![bt] ?? 0) + 1;
                if (early) diagnostics.buildsAi1Early![bt] = (diagnostics.buildsAi1Early![bt] ?? 0) + 1;
                else diagnostics.buildsAi1Late![bt] = (diagnostics.buildsAi1Late![bt] ?? 0) + 1;
              } else {
                diagnostics.buildsAi2![bt] = (diagnostics.buildsAi2![bt] ?? 0) + 1;
                if (early) diagnostics.buildsAi2Early![bt] = (diagnostics.buildsAi2Early![bt] ?? 0) + 1;
                else diagnostics.buildsAi2Late![bt] = (diagnostics.buildsAi2Late![bt] ?? 0) + 1;
              }
            }
          : undefined,
      },
    );

    applyAiUpgrades(aiPlan.upgrades, {
      aiPlayerId,
      cities,
      getPlayer: () => players.find(p => p.id === aiPlayerId),
      onSpendGold: d => {
        const p = players.find(pl => pl.id === aiPlayerId);
        if (p) p.gold -= d;
      },
    });

    applyAiRecruitsAsPending(aiPlan.recruits, {
      aiPlayerId,
      newCycle,
      cities,
      units,
      getPlayer: () => players.find(p => p.id === aiPlayerId),
      onSpendGold: d => {
        const p = players.find(pl => pl.id === aiPlayerId);
        if (p) p.gold -= d;
      },
      pendingRecruitsOut: pendingRecruitsAcc,
      generateId,
    });

    for (const scout of aiPlan.scouts ?? []) {
      const key = tileKey(scout.targetQ, scout.targetR);
      if (aiPlayer.gold >= SCOUT_MISSION_COST && !scoutedHexes.has(key) && !scoutMissions.some(m => m.targetQ === scout.targetQ && m.targetR === scout.targetR)) {
        aiPlayer.gold -= SCOUT_MISSION_COST;
        scoutMissions.push({
          id: generateId('scout'),
          targetQ: scout.targetQ,
          targetR: scout.targetR,
          completesAtMovementTick: state.globalMovementTick + SCOUT_MISSION_MOVEMENT_TICKS,
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
      const incSeed = state.config.seed ^ (inc.q * 524287) ^ (inc.r * 65521);
      appendStartingFarmToCity(newCity, tilesMut, incSeed ^ 0xf407);
      appendStartingBarracksToCity(newCity, tilesMut, incSeed);
      appendStartingAcademyToCity(newCity, tilesMut, incSeed ^ 0xaced);
      cities = [...cities, newCity];
      tilesMut = new Map(tilesMut);
      tilesMut.set(tileKey(inc.q, inc.r), { ...tile, hasVillage: false });
    }

    for (const mt of aiPlan.moveTargets) {
      const unit = units.find(u => u.id === mt.unitId);
      // Allow idle, moving, or starving units to receive move targets (not fighting) so headless sims stay decisive
      if (unit && unit.hp > 0 && unit.status !== 'fighting') {
        applyDeployFlagsForMoveMutable(unit, mt.toQ, mt.toR, cities);
        clearPatrolFieldsMutable(unit);
        unit.targetQ = mt.toQ;
        unit.targetR = mt.toR;
        unit.status = 'moving';
        unit.stance = 'aggressive';
        unit.marchInitialHexDistance = marchHexDistanceAtOrder(unit, mt.toQ, mt.toR);
      }
    }

    // AI wall ring builds: queue wall section projects (same pipeline as towers/other construction).
    const buildWallRings = (aiPlan as { buildWallRings?: { cityId: string; ring: 1 | 2 }[] }).buildWallRings ?? [];
    for (const wr of buildWallRings) {
      const city = cityById.get(wr.cityId);
      if (!city || city.ownerId !== aiPlayerId) continue;
      if (constructions.some(c => c.cityId === city.id && c.type === 'wall_section')) continue;
      const ownerWallKeys = new Set(wallSectionsAfterAi.filter(w => w.ownerId === aiPlayerId).map(w => tileKey(w.q, w.r)));
      const queuedWallKeys = new Set(
        constructions
          .filter(c => c.ownerId === aiPlayerId && c.type === 'wall_section')
          .map(c => tileKey(c.q, c.r)),
      );
      const next = getNextWallBuildHex(city, tilesMut, ownerWallKeys, queuedWallKeys);
      if (!next) continue;
      if (wr.ring === 2 && next.ring === 1) continue;
      const cityIdx = cities.indexOf(city);
      if (cityIdx >= 0) {
        const c0 = cities[cityIdx];
        const acad = c0.buildings.find(b => b.type === 'academy');
        cities[cityIdx] = {
          ...c0,
          universityBuilderTask: 'city_defenses',
          universityBuilderSlotTasks: fillUniversitySlotTasks(c0, acad, 'city_defenses'),
        };
      }
      constructions.push({
        id: generateId('con'),
        type: 'wall_section',
        q: next.q,
        r: next.r,
        cityId: city.id,
        ownerId: aiPlayerId,
        bpRequired: WALL_SECTION_BP_COST,
        bpAccumulated: 0,
        wallBuildRing: next.ring,
      });
    }
  }

  // ── Apply new AI actions: commander assignments, scroll attachments, university tasks ──
  let commandersMut = state.commanders.map(c => ({ ...c }));
  for (let cfgIdx = 0; cfgIdx < aiConfigs.length; cfgIdx++) {
    const { id: aiPlayerId } = aiConfigs[cfgIdx];
    const aiPlan = plans[cfgIdx];

    for (const ca of aiPlan.commanderAssignments ?? []) {
      const cmd = commandersMut.find(c => c.id === ca.commanderId && c.ownerId === aiPlayerId);
      if (cmd) {
        cmd.assignment = ca.assignment;
        if (diagnostics && ca.assignment.kind !== 'city_defense') {
          if (aiPlayerId === AI_ID) diagnostics.commanderFieldAssignmentsAi1 = (diagnostics.commanderFieldAssignmentsAi1 ?? 0) + 1;
          else diagnostics.commanderFieldAssignmentsAi2 = (diagnostics.commanderFieldAssignmentsAi2 ?? 0) + 1;
        }
      }
    }

    for (const sa of aiPlan.scrollAttachments ?? []) {
      const inv = scrollInventory[aiPlayerId] ?? [];
      const scrollItem = inv.find(s => s.id === sa.scrollId);
      if (!scrollItem) continue;
      const carrier = units.find(u => u.id === sa.carrierUnitId && u.ownerId === aiPlayerId);
      if (!carrier || carrier.hp <= 0) continue;
      const already = scrollAttachments.some(a => a.scrollId === sa.scrollId);
      if (already) continue;
      scrollAttachments.push({
        id: generateId('sa'),
        scrollId: scrollItem.id,
        kind: scrollItem.kind,
        sourceRegion: scrollItem.sourceRegion,
        carrierUnitId: carrier.id,
        ownerId: aiPlayerId,
      });
      scrollInventory[aiPlayerId] = inv.filter(s => s.id !== sa.scrollId);
    }

    for (const ut of aiPlan.universityTasks ?? []) {
      const cityIdx = cities.findIndex(c => c.id === ut.cityId && c.ownerId === aiPlayerId);
      if (cityIdx >= 0) {
        const c0 = cities[cityIdx];
        const acad = c0.buildings.find(b => b.type === 'academy');
        cities[cityIdx] = {
          ...c0,
          universityBuilderTask: ut.task,
          universityBuilderSlotTasks: fillUniversitySlotTasks(c0, acad, ut.task),
        };
      }
    }
  }

  // ── Construction tick (one cycle = 30s; same BP logic as live game) ──
  if (constructions.length > 0) {
    const remaining: ConstructionSite[] = [];
    const updatedCities = cities.map(c => ({ ...c, buildings: [...c.buildings] }));

    for (const site of constructions) {
      const availBP = computeConstructionAvailableBp(site, state.territory, cities, constructions);

      if (availBP === 0) {
        remaining.push(site);
        continue;
      }

      // One cycle = 30 seconds: gain 30 * (availBP / BP_RATE_BASE) = availBP
      const bpGain = availBP;
      const newAccum = site.bpAccumulated + bpGain;

      if (newAccum >= site.bpRequired) {
        if (site.type === 'trebuchet' || site.type === 'scout_tower' || site.type === 'city_defense') continue; // not used by AI in this path
        if (site.type === 'wall_section') {
          const exists = wallSectionsAfterAi.some(w => w.ownerId === site.ownerId && w.q === site.q && w.r === site.r);
          if (!exists) {
            wallSectionsAfterAi.push({
              q: site.q,
              r: site.r,
              ownerId: site.ownerId,
              hp: WALL_SECTION_HP,
              maxHp: WALL_SECTION_HP,
            });
          }
          continue;
        }
        const city = updatedCities.find((c) => c.id === site.cityId);
        if (city) {
          const b: CityBuilding = { type: site.type as BuildingType, q: site.q, r: site.r };
          if (['quarry', 'mine', 'gold_mine', 'barracks', 'factory', 'academy', 'siege_workshop', 'farm', 'banana_farm', 'market', 'sawmill', 'port', 'shipyard', 'fishery', 'logging_hut', 'social_bar'].includes(site.type)) b.level = 1;
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
    if (m.completesAtMovementTick <= newGlobalMovementTick) scoutedHexes.add(tileKey(m.targetQ, m.targetR));
    else stillPending.push(m);
  }
  scoutMissions = stillPending;

  // ── City capture before movement (instant only; land military + wall / defender check) ──
  let citiesToSet = cities;
  let aliveUnits = units.filter(u => u.hp > 0);
  for (const city of cities) {
    const wallBlocks = enemyIntactWallOnCityHex(wallSectionsAfterAi, city);
    const defendingLand = aliveUnits.filter(
      u => landMilitaryContestsCityCapture(u, city.q, city.r) && u.ownerId === city.ownerId,
    );
    const attackingLand = aliveUnits.filter(
      u => landMilitaryContestsCityCapture(u, city.q, city.r) && u.ownerId !== city.ownerId,
    );
    if (attackingLand.length === 0) continue;
    const instantTake =
      city.population === 0 || (defendingLand.length === 0 && !wallBlocks);
    if (!instantTake) continue;
    const newOwnerId = attackingLand[0].ownerId;
    citiesToSet = citiesToSet.map(c => (c.id === city.id ? { ...c, ownerId: newOwnerId } : c));
  }
  // Territory computed once at end of step (after capture hold) to avoid duplicate work

  // ── One movement + combat + coastal + siege tick (aligned with useGameStore RT loop) ──
  const movingUnits = units.map(u => ({ ...u }));
  const movingHeroes: Hero[] = [];
  const movingCommanders = commandersMut.map(c => ({ ...c }));
  const territoryForMovement = calculateTerritory(citiesToSet, tilesMut);
  const defenseInstallationsMut = state.defenseInstallations.map(d => ({ ...d }));
  const closingFire = movementTick(
    movingUnits,
    movingHeroes,
    tilesMut,
    wallSectionsAfterAi,
    citiesToSet,
    newSimTimeMs,
    state.players,
    scrollAttachments,
    newCycle,
    movingCommanders,
    territoryForMovement,
    defenseInstallationsMut,
  );
  autoEmbarkLandUnitsOntoScoutShipsAtHex(movingUnits, tilesMut);
  releaseAttackWaveHolds(movingUnits, citiesToSet);
  releaseMarchEchelonHolds(movingUnits, citiesToSet);
  syncCommandersToAssignments(movingCommanders, citiesToSet, movingUnits);

  const territoryForCombat = calculateTerritory(citiesToSet, tilesMut);
  const combatResult = combatTick(
    movingUnits,
    movingHeroes,
    newCycle,
    citiesToSet,
    tilesMut,
    newSimTimeMs,
    defenseInstallationsMut,
    territoryForCombat,
    scrollAttachments,
    movingCommanders,
    state.combatMoraleState,
  );

  const wallSectionsMut = wallSectionsAfterAi.map(w => ({ ...w }));
  const coastalResult = coastalBombardmentTick(
    movingUnits,
    movingHeroes,
    wallSectionsMut,
    newCycle,
    citiesToSet,
    tilesMut,
    newSimTimeMs,
    scrollAttachments,
    movingCommanders,
  );

  siegeTick(wallSectionsMut, movingUnits);
  siegeDefenseInstallationsTick(defenseInstallationsMut, movingUnits);
  const citiesSiege = citiesToSet.map(c => ({ ...c, buildings: c.buildings.map(b => ({ ...b })) }));
  siegeBuildingsTick(citiesSiege, movingUnits);
  landUnitBuildingDamageTick(citiesSiege, movingUnits);
  defenseInstallationsLandRaidTick(defenseInstallationsMut, movingUnits);
  citiesToSet = citiesSiege;

  const mergedKilledUnitIds = [
    ...new Set([...closingFire.killedUnitIds, ...combatResult.killedUnitIds, ...coastalResult.killedUnitIds]),
  ];
  const mergedKilledHeroIds = [
    ...new Set([...(combatResult.killedHeroIds ?? []), ...(coastalResult.killedHeroIds ?? [])]),
  ];

  aliveUnits = movingUnits.filter(u => u.hp > 0 && !mergedKilledUnitIds.includes(u.id));

  let commandersNext = movingCommanders;
  unassignCommandersWithDeadAnchors(commandersNext, aliveUnits);
  clearInvalidCommanderAssignments(commandersNext, citiesToSet, state.operationalArmies ?? []);
  syncCommandersToAssignments(commandersNext, citiesToSet, aliveUnits);

  // ── Return scrolls from dead carriers to inventory ──
  const killedIds = new Set(mergedKilledUnitIds);
  const scrollReturn = returnScrollsForDeadCarriers(killedIds, scrollAttachments, scrollInventory);
  scrollAttachments = scrollReturn.attachments;
  scrollInventory = scrollReturn.scrollInventory;

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

  // ── City capture hold (5s); land military only; instant when pop 0 or undefended + no enemy wall ──
  let captureHoldNext: Record<string, { attackerId: string; startedAtMovementTick: number }> = {
    ...state.cityCaptureHold,
  };
  for (const city of citiesToSet) {
    const contenders = [
      ...new Set(
        aliveUnits.filter(u => landMilitaryContestsCityCapture(u, city.q, city.r)).map(u => u.ownerId),
      ),
    ];
    if (contenders.length !== 1 || contenders[0] === city.ownerId) {
      delete captureHoldNext[city.id];
      continue;
    }
    const attackerId = contenders[0];
    const defendingLandMilitary = aliveUnits.filter(
      u => landMilitaryContestsCityCapture(u, city.q, city.r) && u.ownerId === city.ownerId,
    );
    const wallBlocks = enemyIntactWallOnCityHex(wallSectionsMut, city);
    const instantTake =
      city.population === 0 || (defendingLandMilitary.length === 0 && !wallBlocks);
    if (instantTake) {
      citiesToSet = citiesToSet.map(c => (c.id === city.id ? { ...c, ownerId: attackerId } : c));
      delete captureHoldNext[city.id];
      continue;
    }
    const existing = captureHoldNext[city.id];
    if (!existing || existing.attackerId !== attackerId) {
      captureHoldNext[city.id] = { attackerId, startedAtMovementTick: state.globalMovementTick };
    } else if (newGlobalMovementTick - existing.startedAtMovementTick >= CITY_CAPTURE_HOLD_TICKS) {
      citiesToSet = citiesToSet.map(c => (c.id === city.id ? { ...c, ownerId: attackerId } : c));
      delete captureHoldNext[city.id];
    }
  }
  citiesToSet = syncUniversityBuildingLevelsForCities(citiesToSet);
  const territory = calculateTerritory(citiesToSet, tilesMut);

  // Build city id -> owner map once for O(1) lookups (avoids O(cities²) per step)
  const newCityOwnerById = new Map<string, string>();
  for (const c of citiesToSet) newCityOwnerById.set(c.id, c.ownerId);

  if (diagnostics) {
    const killsThisStep = mergedKilledUnitIds.length;
    diagnostics.totalKills += killsThisStep;
    const unitById = new Map(units.map(u => [u.id, u]));
    for (const uid of mergedKilledUnitIds) {
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
  const supplyCacheNext = state.supplyCache != null && !citiesChanged ? state.supplyCache : undefined;

  const defenseOwnerByCity = new Map(citiesToSet.map(c => [c.id, c.ownerId]));
  const defenseInstallationsOut = defenseInstallationsMut
    .filter(d => defenseInstallationCurrentHp(d) > 0)
    .map(d => {
      const ow = defenseOwnerByCity.get(d.cityId);
      if (ow !== undefined && ow !== d.ownerId) return { ...d, ownerId: ow };
      return d;
    });

  return {
    ...state,
    tiles: tilesMut,
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
    globalMovementTick: newGlobalMovementTick,
    heroes: [],
    supplyCache: supplyCacheNext,
    contestedZoneHexKeys: state.contestedZoneHexKeys,
    commanders: commandersNext,
    scrollRelics: state.scrollRelics,
    scrollRegionClaimed,
    scrollSearchVisited,
    scrollInventory,
    scrollAttachments,
    defenseInstallations: defenseInstallationsOut,
    unitStacks: unitStacksState,
    operationalArmies: state.operationalArmies ?? [],
    combatMoraleState: combatResult.moraleState,
    pendingRecruits: pendingRecruitsAcc,
  };
}
