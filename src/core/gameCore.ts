/**
 * Headless game core for fast simulations (no UI, no timers).
 * One step = one economy cycle + one movement/combat/siege/capture tick.
 * Used by scripts/train-ai.ts to run many bot-vs-bot matches and evolve AI params.
 */

import {
  MapConfig, DEFAULT_MAP_CONFIG, GamePhase, tileKey, generateId, hexDistance,
  City, Unit, Player, Hero, Tile, TerritoryInfo,
  CityBuilding, ScoutMission, WallSection, WeatherEvent,
  STARTING_GOLD, VILLAGE_CITY_TEMPLATE, CITY_CENTER_STORAGE,
  BUILDING_COSTS, BUILDING_IRON_COSTS, WORKERS_PER_LEVEL,
  BARACKS_UPGRADE_COST, FACTORY_UPGRADE_COST, FARM_UPGRADE_COST,
  UNIT_COSTS, UNIT_L2_STATS, UNIT_BASE_STATS,
  SCOUT_MISSION_COST, SCOUT_MISSION_DURATION_SEC, VILLAGE_INCORPORATE_COST,
  FRONTIER_CYCLES, CITY_NAMES, PLAYER_COLORS,
  CITY_CAPTURE_HOLD_MS,
} from '../types/game';
import { generateMap, placeAncientCity } from '../lib/mapGenerator';
import { calculateTerritory } from '../lib/territory';
import { processEconomyTurn } from '../lib/gameLoop';
import { planAiTurn, placeAiStartingCityAt, createAiHero, AiParams, DEFAULT_AI_PARAMS } from '../lib/ai';
import { movementTick, combatTick, upkeepTick, siegeTick } from '../lib/military';
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
  wallSections: WallSection[];
  cityCaptureHold: Record<string, { attackerId: string; startedAt: number }>;
  /** Simulated time in ms; advances 30s per cycle for capture hold & scout completion */
  simTimeMs: number;
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
    wallSections: [],
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

/** Options for faster training (smaller map, shorter games). */
export type RunSimulationOptions = {
  maxCycles?: number;
  mapConfigOverride?: Partial<MapConfig>;
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
  if (winner === null && state.cycle >= maxC) {
    winner = ai1Pop > ai2Pop ? 'ai1' : ai2Pop > ai1Pop ? 'ai2' : null;
  }

  return {
    winner,
    cycle: state.cycle,
    ai1Cities: ai1Cities.length,
    ai2Cities: ai2Cities.length,
    ai1Pop,
    ai2Pop,
  };
}

/** Single step: economy + AI actions + one movement/combat/siege/capture tick. */
export function stepSimulation(
  state: SimState,
  paramsA: AiParams,
  paramsB: AiParams,
): SimState {
  if (state.phase !== 'playing') return state;

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

  // ── Upkeep ──
  const upkeepResult = upkeepTick(units, cities, state.heroes, newCycle, state.tiles, state.territory);
  units = units.filter(u => u.hp > 0);

  // ── AI turns (apply plans with per-player params) ──
  let scoutMissions = [...state.scoutMissions];
  let scoutedHexes = new Set(state.scoutedHexes);
  let tilesMut = state.tiles;

  const aiConfigs: { id: string; params: AiParams }[] = [
    { id: AI_ID, params: paramsA },
    { id: AI_ID_2, params: paramsB },
  ];

  for (const { id: aiPlayerId, params } of aiConfigs) {
    const aiPlan = planAiTurn(aiPlayerId, cities, units, players, state.tiles, state.territory, params);
    const aiPlayer = players.find(p => p.id === aiPlayerId);
    if (!aiPlayer) continue;

    for (const build of aiPlan.builds) {
      const city = cities.find(c => c.id === build.cityId);
      if (!city || city.ownerId !== aiPlayerId) continue;
      if (aiPlayer.gold < BUILDING_COSTS[build.type]) continue;
      const ironCost = BUILDING_IRON_COSTS[build.type] ?? 0;
      if (ironCost > 0 && (city.storage.iron ?? 0) < ironCost) continue;
      const b: CityBuilding = { type: build.type, q: build.q, r: build.r };
      if (['quarry', 'mine', 'gold_mine', 'barracks', 'factory', 'academy', 'farm', 'market'].includes(build.type)) b.level = 1;
      if (build.type === 'quarry' || build.type === 'mine' || build.type === 'gold_mine') {
        const toAssign = Math.min(WORKERS_PER_LEVEL, Math.max(0, city.population - 1));
        b.assignedWorkers = toAssign;
        city.population -= toAssign;
      }
      city.buildings.push(b);
      aiPlayer.gold -= BUILDING_COSTS[build.type];
      if (ironCost > 0) city.storage.iron = (city.storage.iron ?? 0) - ironCost;
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
      const cost = UNIT_COSTS[rec.type];
      if (aiPlayer.gold < cost.gold) continue;
      const wantL2 = rec.armsLevel === 2;
      const stats = wantL2 ? UNIT_L2_STATS[rec.type] : UNIT_BASE_STATS[rec.type];
      const gunL2Upkeep = wantL2 ? (UNIT_L2_STATS[rec.type] as { gunL2Upkeep?: number }).gunL2Upkeep ?? 0 : 0;
      if (wantL2 && gunL2Upkeep > 0) {
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
      if (wantL2 && gunL2Upkeep > 0) {
        for (const oc of cities.filter(c => c.ownerId === aiPlayerId)) {
          if ((oc.storage.gunsL2 ?? 0) >= gunL2Upkeep) {
            oc.storage.gunsL2 = (oc.storage.gunsL2 ?? 0) - gunL2Upkeep;
            break;
          }
        }
      }
      units.push(newUnit);
      aiPlayer.gold -= cost.gold;
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
      if (unit && unit.hp > 0 && unit.status === 'idle') {
        unit.targetQ = mt.toQ;
        unit.targetR = mt.toR;
        unit.status = 'moving';
        unit.stance = 'aggressive';
      }
    }
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
  let territory = calculateTerritory(citiesToSet, tilesMut);

  // ── One movement + combat + siege tick ──
  const movingUnits = units.map(u => ({ ...u }));
  const movingHeroes = state.heroes.map(h => ({ ...h }));
  movementTick(movingUnits, movingHeroes, state.tiles, state.wallSections, citiesToSet);
  const combatResult = combatTick(movingUnits, movingHeroes, newCycle, citiesToSet);
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
        e => e.ownerId !== u.ownerId && e.hp > 0 && hexDistance(u.q, u.r, e.q, e.r) <= UNIT_BASE_STATS[u.type].range
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
  territory = calculateTerritory(citiesToSet, tilesMut);

  // ── Victory ──
  let phase: GamePhase = 'playing';
  const ai1Cities = citiesToSet.filter(c => c.ownerId === AI_ID);
  const ai2Cities = citiesToSet.filter(c => c.ownerId === AI_ID_2);
  if (ai1Cities.length === 0 || ai2Cities.length === 0) phase = 'victory';

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
    wallSections: wallSectionsMut,
    cityCaptureHold: captureHoldNext,
    simTimeMs: newSimTimeMs,
    heroes: movingHeroes,
  };
}
