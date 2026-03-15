import { create } from 'zustand';
import {
  Tile, MapConfig, DEFAULT_MAP_CONFIG, City, Unit, Player, Hero,
  GameNotification, TerritoryInfo, GamePhase, UIMode, FoodPriority,
  BuildingType, UnitType, ArmyStance, CityBuilding,   ConstructionSite, ScoutMission, ScoutTower,
  WeatherEvent, WallSection, RoadConstructionSite, ROAD_BP_COST,
  tileKey, generateId, hexDistance, getHexRing,
  STARTING_GOLD, STARTING_CITY_TEMPLATE, VILLAGE_CITY_TEMPLATE, VILLAGE_INCORPORATE_COST,
  CITY_CENTER_STORAGE, FRONTIER_CYCLES,
  PLAYER_COLORS, CITY_NAMES,
  BUILDING_COSTS, UNIT_COSTS, UNIT_L2_COSTS, UNIT_L3_COSTS, UNIT_BASE_STATS, UNIT_L2_STATS, UNIT_DISPLAY_NAMES, HERO_NAMES,
  BUILDING_BP_COST, BUILDING_JOBS, getBuildingJobs, getUnitStats, CITY_BUILDING_POWER, BUILDER_POWER, BP_RATE_BASE,
  TREBUCHET_FIELD_BP_COST, TREBUCHET_FIELD_GOLD_COST,
  DEFENDER_IRON_COST,
  SCOUT_TOWER_BP_COST, SCOUT_TOWER_GOLD_COST,
  SCOUT_MISSION_COST, SCOUT_MISSION_DURATION_SEC,
  GAME_DURATION_SEC, CYCLE_INTERVAL_SEC,
  BARACKS_UPGRADE_COST, FACTORY_UPGRADE_COST, FARM_UPGRADE_COST, WALL_SECTION_STONE_COST,
  CITY_CAPTURE_HOLD_MS,
  WORKERS_PER_LEVEL, BUILDING_IRON_COSTS,
  RETREAT_DELAY_MS, ASSAULT_ATTACK_DEBUFF, WALL_SECTION_HP, HERO_BASE_HP,
} from '@/types/game';
import { generateMap, placeAncientCity } from '@/lib/mapGenerator';
import { calculateTerritory } from '@/lib/territory';
import { processEconomyTurn, computeClusterIncomeStatement } from '@/lib/gameLoop';
import { planAiTurn, placeAiStartingCity, placeAiStartingCityAt, createAiHero } from '@/lib/ai';
import { getAiParams } from '@/lib/aiParams';
import { movementTick, combatTick, upkeepTick, siegeTick } from '@/lib/military';
import { computeVisibleHexes } from '@/lib/vision';
import { computeTradeClusters, getCapitalCluster, computeConnectionPaths, computeConnectionPathsWithClusters } from '@/lib/logistics';
import { rollForWeatherEvent, tickWeatherEvent, weatherAnnouncement, getWeatherHarvestMultiplier } from '@/lib/weather';

// ─── Module-level timers ────────────────────────────────────────────

let _tickInterval: ReturnType<typeof setInterval> | null = null;
let _combatInterval: ReturnType<typeof setInterval> | null = null;

function clearAllTimers() {
  if (_tickInterval) { clearInterval(_tickInterval); _tickInterval = null; }
  if (_combatInterval) { clearInterval(_combatInterval); _combatInterval = null; }
}

// ─── State Interface ───────────────────────────────────────────────

interface GameState {
  tiles: Map<string, Tile>;
  config: MapConfig;
  provinceCenters: Tile[];
  isGenerated: boolean;

  phase: GamePhase;
  cycle: number;
  gameMode: GameMode;
  players: Player[];
  cities: City[];
  units: Unit[];
  heroes: Hero[];
  constructions: ConstructionSite[];
  roadConstructions: RoadConstructionSite[];
  scoutTowers: ScoutTower[];
  scoutMissions: ScoutMission[];
  scoutedHexes: Set<string>;   // hexes that have been scouted (info revealed)
  territory: Map<string, TerritoryInfo>;
  notifications: GameNotification[];

  /** Hex keys where combat occurred during the current cycle (for ancient city: no reward if combat on that hex) */
  combatHexesThisCycle: Set<string>;

  // Weather / natural disasters
  activeWeather: WeatherEvent | null;
  lastWeatherEndCycle: number;

  // Real-time timers
  gameEndTime: number;
  nextCycleTime: number;
  gameTimeRemaining: number;
  cycleTimeRemaining: number;
  /** Simulation speed in AI-vs-AI modes only (1, 2, or 4). */
  simSpeedMultiplier: 1 | 2 | 4;

  // Two-tier vision: visibleHexes = active vision (enemy units only shown here)
  visibleHexes: Set<string>;
  pendingCityHex: { q: number; r: number } | null;

  // UI
  selectedHex: { q: number; r: number } | null;
  uiMode: UIMode;
  pendingMove: { toQ: number; toR: number } | null;
  wallSections: WallSection[];
  roadPathSelection: { q: number; r: number }[];  // hexes selected for road drag
  supplyViewTab: 'normal' | 'supply';
  selectedClusterKey: string | null;
  lastClickHex: { q: number; r: number } | null;
  lastClickTime: number;
  /** City capture: cityId -> { attackerId, startedAt } when attacker holds center; capture after 5s */
  cityCaptureHold: Record<string, { attackerId: string; startedAt: number }>;

  /** Tactical panel: key = tileKey(q,r) of stack; null = tactical mode off */
  pendingTacticalOrders: Record<string, { type: 'move' | 'defend' | 'intercept'; toQ?: number; toR?: number; cityId?: string }> | null;
  /** Stacks selected in tactical panel (for batch orders from bottom bar) */
  tacticalSelectedStackKeys: string[];
  /** When set, next map click sets move/intercept destination for all these stacks */
  assigningTacticalForSelectedStacks: { orderType: 'move' | 'intercept'; stackKeys: string[] } | null;
  /** When set, next valid hex click sets this stack's move/intercept destination (legacy single-stack) */
  assigningTacticalForStack: string | null;
  /** Type of order when assigning destination (move vs intercept) */
  assigningTacticalOrderType: 'move' | 'intercept' | null;
  /** Split stack: from hex + count to move; next adjacent hex click completes split */
  splitStackPending: { fromQ: number; fromR: number; count: number } | null;

  // Map
  generateWorld: (config?: Partial<MapConfig>) => void;
  getTile: (q: number, r: number) => Tile | undefined;

  // Game flow
  startPlacement: () => void;
  startBotVsBot: () => void;
  /** 4-player bot observer mode (same setup as 2-bot for now; gameMode affects camera/UI). */
  startFourBotVsBot: () => void;
  /** 38×38 map + champion params (same as ?watch); use from main menu. */
  startSmallMapBotVsBot: () => void;
  setPendingCity: (q: number, r: number) => void;
  confirmCityPlacement: () => void;
  cancelCityPlacement: () => void;
  placeStartingCity: (q: number, r: number) => void;
  startRealTimeLoop: (opts?: { preserveTimes?: boolean }) => void;
  stopRealTimeLoop: () => void;
  /** Set sim speed (1x, 2x, 4x) for bot-vs-bot modes only; restarts tick interval. */
  setSimSpeedMultiplier: (speed: 1 | 2 | 4) => void;
  runCycle: () => void;
  recomputeVision: () => void;

  // Interaction
  selectHex: (q: number, r: number) => void;
  deselectAll: () => void;

  // City
  buildStructure: (type: BuildingType, q: number, r: number) => void;
  buildTrebuchetInField: (q: number, r: number) => void;
  buildScoutTowerInField: (q: number, r: number) => void;
  buildRoad: (q: number, r: number) => void;
  upgradeBarracks: (cityId: string, buildingQ: number, buildingR: number) => void;
  upgradeFactory: (cityId: string, buildingQ: number, buildingR: number) => void;
  upgradeFarm: (cityId: string, buildingQ: number, buildingR: number) => void;
  adjustWorkers: (cityId: string, buildingQ: number, buildingR: number, delta: number) => void;
  recruitUnit: (cityId: string, type: UnitType, armsLevel?: 1 | 2 | 3) => void;
  recruitHero: (cityId: string) => void;
  setFoodPriority: (priority: FoodPriority) => void;
  setTaxRate: (rate: number) => void;

  // Wall building (ring around city, from build menu; stone cost)
  buildWallRing: (cityId: string, ring: number) => void;

  // Builder build (Mine, Quarry, Road, Scout Tower outside territory)
  startBuilderBuild: (mode: 'mine' | 'quarry' | 'gold_mine' | 'road') => void;
  cancelBuilderBuild: () => void;
  builderSelectDeposit: (q: number, r: number, type: 'mine' | 'quarry' | 'gold_mine') => void;
  addRoadPathHex: (q: number, r: number) => void;
  confirmRoadPath: () => void;
  setSupplyViewTab: (tab: 'normal' | 'supply') => void;
  setSelectedClusterKey: (key: string | null) => void;

  // Unit
  setPendingMove: (toQ: number, toR: number) => void;
  confirmMove: () => void;
  cancelMove: () => void;
  moveSelectedUnits: (toQ: number, toR: number) => void;
  setStance: (stance: ArmyStance) => void;
  startDefendMode: () => void;
  startInterceptMode: () => void;
  setDefendCity: (cityId: string) => void;
  setRetreat: () => void;
  setRetreatStack: (q: number, r: number) => void;
  openTacticalMode: () => void;
  cancelTacticalMode: () => void;
  setTacticalOrder: (stackKey: string, order: { type: 'move' | 'defend' | 'intercept'; toQ?: number; toR?: number; cityId?: string } | null) => void;
  startTacticalMoveForStack: (stackKey: string, orderType?: 'move' | 'intercept') => void;
  setTacticalMoveTarget: (toQ: number, toR: number) => void;
  setTacticalSelectedStackKeys: (keys: string[]) => void;
  toggleTacticalStack: (stackKey: string) => void;
  startTacticalOrderForSelected: (orderType: 'move' | 'intercept') => void;
  setTacticalMoveTargetForSelected: (toQ: number, toR: number) => void;
  setTacticalDefendForSelected: (cityId: string) => void;
  clearTacticalOrdersForSelected: () => void;
  confirmTacticalOrders: () => void;
  disbandSelectedUnits: () => void;
  setSiegeAssault: (assault: boolean) => void;
  startSplitStack: (count: number) => void;
  cancelSplitStack: () => void;
  splitStackToHex: (toQ: number, toR: number) => void;
  burnCity: (cityId: string) => void;
  captureCity: (cityId: string) => void;
  incorporateVillage: (q: number, r: number) => void;
  sendScout: (q: number, r: number) => void;

  // Notifications
  addNotification: (message: string, type: GameNotification['type']) => void;

  // Helpers
  getHumanPlayer: () => Player | undefined;
  getCityAt: (q: number, r: number) => City | undefined;
  getUnitsAt: (q: number, r: number) => Unit[];
  getHeroAt: (q: number, r: number) => Hero | undefined;
  getSelectedCity: () => City | undefined;
  /** City at selected hex (any owner); used for observer mode and city modal. */
  getSelectedCityForDisplay: () => City | undefined;
  getSelectedUnits: () => Unit[];
  getEnemyCityAt: (q: number, r: number) => City | undefined;
  getBarracksCityAt: (q: number, r: number) => City | undefined;
  getFactoryAt: (q: number, r: number) => { city: City; building: CityBuilding } | undefined;
  getAcademyAt: (q: number, r: number) => { city: City; building: CityBuilding } | undefined;
  getQuarryMineAt: (q: number, r: number) => { city: City; building: CityBuilding } | undefined;
  getJobBuildingAt: (q: number, r: number) => { city: City; building: CityBuilding } | undefined;
  isInPlayerTerritory: (q: number, r: number) => boolean;
  hasBuildingAt: (q: number, r: number) => boolean;
  hasConstructionAt: (q: number, r: number) => boolean;
  hasRoadConstructionAt: (q: number, r: number) => boolean;
  getConstructionAt: (q: number, r: number) => ConstructionSite | undefined;
  isHexVisible: (q: number, r: number) => boolean;
  isHexScouted: (q: number, r: number) => boolean;
  getScoutMissionAt: (q: number, r: number) => ScoutMission | undefined;
  getSupplyConnectionPaths: () => Map<string, { q: number; r: number }[][]>;
  getSupplyClustersWithPaths: () => import('@/lib/logistics').ClusterWithPaths[];
  getSupplyClustersWithHealth: () => { clusterKey: string; cluster: import('@/lib/logistics').TradeCluster; paths: { q: number; r: number }[][]; foodSurplus: boolean }[];
  getClusterForHex: (q: number, r: number) => string | null;
  getClusterIncomeStatement: (clusterKey: string) => import('@/lib/gameLoop').ClusterIncomeStatement | null;
}

const HUMAN_ID = 'player_human';
const AI_ID = 'player_ai';
const AI_ID_2 = 'player_ai_2';

export type GameMode = 'human_vs_ai' | 'bot_vs_bot' | 'bot_vs_bot_4';
let cityNameIdx = 0;
let heroNameIdx = 0;
function nextCityName(): string {
  return CITY_NAMES[cityNameIdx++ % CITY_NAMES.length];
}
function nextHeroName(): string {
  return HERO_NAMES[heroNameIdx++ % HERO_NAMES.length];
}

// ─── Store ─────────────────────────────────────────────────────────

export const useGameStore = create<GameState>((set, get) => ({
  tiles: new Map(), config: DEFAULT_MAP_CONFIG, provinceCenters: [], isGenerated: false,
  phase: 'setup', cycle: 0, gameMode: 'human_vs_ai', players: [], cities: [], units: [], heroes: [],   constructions: [], roadConstructions: [], scoutTowers: [],
  scoutMissions: [], scoutedHexes: new Set(),
  territory: new Map(), notifications: [],
  combatHexesThisCycle: new Set(),
  activeWeather: null, lastWeatherEndCycle: -10,
  gameEndTime: 0, nextCycleTime: 0, gameTimeRemaining: GAME_DURATION_SEC, cycleTimeRemaining: CYCLE_INTERVAL_SEC,
  simSpeedMultiplier: 1,
  visibleHexes: new Set(), pendingCityHex: null,
  selectedHex: null, uiMode: 'normal', pendingMove: null, wallSections: [], roadPathSelection: [],
  supplyViewTab: 'normal',
  selectedClusterKey: null,
  lastClickHex: null,
  lastClickTime: 0,
  cityCaptureHold: {},
  pendingTacticalOrders: null,
  tacticalSelectedStackKeys: [],
  assigningTacticalForSelectedStacks: null,
  assigningTacticalForStack: null,
  assigningTacticalOrderType: null,
  splitStackPending: null,

  // ─── Map ────────────────────────────────────────────────────
  generateWorld: (ov) => {
    const config = { ...DEFAULT_MAP_CONFIG, ...ov };
    const { tiles, provinceCenters } = generateMap(config);
    const tileMap = new Map<string, Tile>();
    for (const t of tiles) tileMap.set(tileKey(t.q, t.r), t);
    set({ tiles: tileMap, config, provinceCenters, isGenerated: true, phase: 'setup' });
  },
  getTile: (q, r) => get().tiles.get(tileKey(q, r)),

  // ─── Game Flow ──────────────────────────────────────────────
  startPlacement: () => {
    cityNameIdx = 0;
    heroNameIdx = 0;
    set({
      phase: 'place_city',
      gameMode: 'human_vs_ai',
      players: [
        { id: HUMAN_ID, name: 'You', color: PLAYER_COLORS.human, gold: STARTING_GOLD, taxRate: 0.3, foodPriority: 'civilian', isHuman: true },
        { id: AI_ID, name: 'Rival Empire', color: PLAYER_COLORS.ai, gold: STARTING_GOLD, taxRate: 0.3, foodPriority: 'military', isHuman: false },
      ],
      cities: [], units: [], heroes: [], constructions: [], roadConstructions: [], scoutTowers: [], scoutMissions: [], scoutedHexes: new Set(),
      territory: new Map(), cycle: 0, notifications: [], wallSections: [], cityCaptureHold: {},
      combatHexesThisCycle: new Set(),
      activeWeather: null, lastWeatherEndCycle: -10,
      visibleHexes: new Set(), pendingCityHex: null,
    });
  },

  startBotVsBot: () => {
    const s = get();
    if (!s.isGenerated) {
      get().generateWorld();
    }
    cityNameIdx = 0;
    heroNameIdx = 0;
    const { tiles, config } = get();
    const w = config.width;
    const h = config.height;
    if (!tiles || tiles.size === 0) {
      get().addNotification('Generate a map first (click Play then place city, or refresh).', 'warning');
      return;
    }
    // Find valid land tiles near corners (spiral out if default is water/mountain)
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
    if (!corner1 || !corner2) {
      get().addNotification('Could not find valid start positions. Try again.', 'danger');
      return;
    }
    const [ai1Q, ai1R] = corner1;
    const [ai2Q, ai2R] = corner2;
    const city1 = placeAiStartingCityAt(AI_ID, ai1Q, ai1R, tiles);
    const city2 = placeAiStartingCityAt(AI_ID_2, ai2Q, ai2R, tiles);
    if (!city1 || !city2) {
      get().addNotification('Could not place both AI capitals. Try again.', 'danger');
      return;
    }
    city1.name = nextCityName();
    city2.name = nextCityName();

    const cities = [city1, city2];
    placeAncientCity(tiles, ai1Q, ai1R, ai2Q, ai2R);
    const territory = calculateTerritory(cities, tiles);

    const heroes: Hero[] = [
      createAiHero(city1.q, city1.r, AI_ID),
      createAiHero(city2.q, city2.r, AI_ID_2),
    ];

    const allTileKeys = new Set<string>();
    tiles.forEach((_, key) => allTileKeys.add(key));

    set({
      phase: 'playing',
      gameMode: 'bot_vs_bot',
      players: [
        { id: AI_ID, name: 'North Empire', color: PLAYER_COLORS.ai, gold: STARTING_GOLD, taxRate: 0.3, foodPriority: 'military', isHuman: false },
        { id: AI_ID_2, name: 'South Empire', color: PLAYER_COLORS.ai2, gold: STARTING_GOLD, taxRate: 0.3, foodPriority: 'military', isHuman: false },
      ],
      cities,
      units: [],
      heroes,
      territory,
      visibleHexes: allTileKeys,
      wallSections: [],
      cityCaptureHold: {},
      combatHexesThisCycle: new Set(),
      notifications: [
        { id: generateId('n'), turn: 0, message: 'Bot vs Bot — observing both empires.', type: 'success' },
      ],
    });
    get().startRealTimeLoop();
    // Run first economy cycle immediately so AIs build (barracks, farms, etc.) from the start
    get().runCycle();
  },

  startFourBotVsBot: () => {
    get().startBotVsBot();
    set({ gameMode: 'bot_vs_bot_4' });
  },

  startSmallMapBotVsBot: () => {
    const TRAIN_MAP_SIZE = 38;
    get().generateWorld({ width: TRAIN_MAP_SIZE, height: TRAIN_MAP_SIZE });
    get().startBotVsBot();
  },

  setPendingCity: (q, r) => {
    const { tiles } = get();
    const tile = tiles.get(tileKey(q, r));
    if (!tile || tile.biome === 'water' || tile.biome === 'mountain') return;
    set({ pendingCityHex: { q, r } });
  },

  confirmCityPlacement: () => {
    const { pendingCityHex } = get();
    if (!pendingCityHex) return;
    get().placeStartingCity(pendingCityHex.q, pendingCityHex.r);
    set({ pendingCityHex: null });
  },

  cancelCityPlacement: () => {
    set({ pendingCityHex: null });
  },

  placeStartingCity: (q, r) => {
    const { tiles, config } = get();
    const tile = tiles.get(tileKey(q, r));
    if (!tile || tile.biome === 'water' || tile.biome === 'mountain') return;

    const humanCity: City = {
      id: generateId('city'), name: nextCityName(), q, r, ownerId: HUMAN_ID,
      ...structuredClone(STARTING_CITY_TEMPLATE),
    };
    humanCity.buildings = [{ type: 'city_center', q, r, assignedWorkers: 0 }];
    humanCity.storageCap = { ...CITY_CENTER_STORAGE };
    const aiCity = placeAiStartingCity(q, r, tiles, config, AI_ID);
    if (aiCity) aiCity.name = nextCityName();
    const cities = aiCity ? [humanCity, aiCity] : [humanCity];
    placeAncientCity(tiles, q, r, aiCity?.q, aiCity?.r);
    const territory = calculateTerritory(cities, tiles);

    // Each player starts with a General hero at their capital
    const heroes: Hero[] = [
      { id: generateId('hero'), name: nextHeroName(), type: 'general', q, r, ownerId: HUMAN_ID, hp: HERO_BASE_HP, maxHp: HERO_BASE_HP },
    ];
    if (aiCity) {
      heroes.push(createAiHero(aiCity.q, aiCity.r, AI_ID));
    }

    // Human vs AI: no pre-spawned AI army. AI uses champion params (from ai-params.json) and builds up from its city on the opposite side.
    const initVisible = computeVisibleHexes(HUMAN_ID, cities, [], heroes, tiles, get().scoutTowers ?? []);

    set({
      phase: 'playing', cities, territory, heroes, wallSections: [], cityCaptureHold: {},
      units: [],
      visibleHexes: initVisible,
      notifications: [
        { id: generateId('n'), turn: 0, message: `${humanCity.name} founded! The empire rises.`, type: 'success' },
        { id: generateId('n'), turn: 0, message: `A rival empire stirs across the land.`, type: 'warning' },
      ],
    });

    get().startRealTimeLoop();
  },

  startRealTimeLoop: (opts?: { preserveTimes?: boolean }) => {
    clearAllTimers();
    const s = get();
    const isBot = s.gameMode === 'bot_vs_bot' || s.gameMode === 'bot_vs_bot_4';
    const speed = isBot ? (s.simSpeedMultiplier || 1) : 1;
    const intervalMs = 1000 / speed;

    if (!opts?.preserveTimes) {
      const now = Date.now();
      set({
        gameEndTime: now + (GAME_DURATION_SEC * 1000) / speed,
        nextCycleTime: now + (CYCLE_INTERVAL_SEC * 1000) / speed,
        gameTimeRemaining: GAME_DURATION_SEC,
        cycleTimeRemaining: CYCLE_INTERVAL_SEC,
      });
    }

    // Tick: timers + movement + combat (interval = 1000/speed in bot mode)
    _tickInterval = setInterval(() => {
      const s = get();
      if (s.phase !== 'playing') { clearAllTimers(); return; }

      const now = Date.now();
      const gameRem = Math.max(0, Math.ceil((s.gameEndTime - now) / 1000));
      const cycleRem = Math.max(0, Math.ceil((s.nextCycleTime - now) / 1000));
      set({ gameTimeRemaining: gameRem, cycleTimeRemaining: cycleRem });

      // -- Movement tick --
      const movingUnits = s.units.map(u => ({ ...u }));
      const movingHeroes = s.heroes.map(h => ({ ...h }));
      movementTick(movingUnits, movingHeroes, s.tiles, s.wallSections, s.cities);

      // -- Combat tick (pass movingHeroes so hp mutations apply; then remove killed heroes) --
      const combatResult = combatTick(movingUnits, movingHeroes, s.cycle, s.cities, s.tiles, now);

      // -- Siege tick: trebuchet/ram damage walls (design §17–19) --
      const wallSectionsMut = s.wallSections.map(w => ({ ...w }));
      siegeTick(wallSectionsMut, movingUnits);

      // Accumulate combat hexes for this cycle (ancient city: no reward if combat on that hex)
      const nextCombatHexes = new Set(s.combatHexesThisCycle);
      for (const key of combatResult.combatHexKeys) nextCombatHexes.add(key);

      // Remove dead units
      const aliveUnits = movingUnits.filter(u => u.hp > 0 && !combatResult.killedUnitIds.includes(u.id));

      // Population: when a unit dies, its origin city loses 1 population (design doc §22)
      const killedIds = new Set(combatResult.killedUnitIds);
      const popDeductByCityId: Record<string, number> = {};
      for (const u of s.units) {
        if (killedIds.has(u.id) && u.originCityId) {
          popDeductByCityId[u.originCityId] = (popDeductByCityId[u.originCityId] ?? 0) + 1;
        }
      }
      const updatedCities =
        Object.keys(popDeductByCityId).length === 0
          ? s.cities
          : s.cities.map(c => {
              const deduct = popDeductByCityId[c.id] ?? 0;
              return deduct > 0 ? { ...c, population: Math.max(0, c.population - deduct) } : c;
            });

      // Reset fighters to idle if no enemies nearby
      for (const u of aliveUnits) {
        if (u.status === 'fighting') {
          const hasNearbyEnemy = aliveUnits.some(
            e => e.ownerId !== u.ownerId && e.hp > 0 && hexDistance(u.q, u.r, e.q, e.r) <= getUnitStats(u).range
          );
          if (!hasNearbyEnemy) u.status = 'idle';
        }
      }

      // -- City capture hold: attacker holds center 5s to capture (design §13, 35); pop=0 = easy take
      let citiesFinal = updatedCities;
      let captureHoldNext: Record<string, { attackerId: string; startedAt: number }> = { ...s.cityCaptureHold };
      const captureNotifs: GameNotification[] = [];
      for (const city of citiesFinal) {
        const onCenter = aliveUnits.filter(u => u.q === city.q && u.r === city.r && u.hp > 0);
        const owners = [...new Set(onCenter.map(u => u.ownerId))];
        if (owners.length === 1 && owners[0] !== city.ownerId) {
          const attackerId = owners[0];
          if (city.population === 0) {
            citiesFinal = citiesFinal.map(c => c.id === city.id ? { ...c, ownerId: attackerId } : c);
            delete captureHoldNext[city.id];
            captureNotifs.push({ id: generateId('n'), turn: s.cycle, message: `${city.name} captured (population zero)!`, type: 'success' });
          } else {
            const existing = captureHoldNext[city.id];
            if (!existing || existing.attackerId !== attackerId) {
              captureHoldNext[city.id] = { attackerId, startedAt: now };
            } else if (now - existing.startedAt >= CITY_CAPTURE_HOLD_MS) {
              citiesFinal = citiesFinal.map(c => c.id === city.id ? { ...c, ownerId: attackerId } : c);
              delete captureHoldNext[city.id];
              captureNotifs.push({ id: generateId('n'), turn: s.cycle, message: `${city.name} captured!`, type: 'success' });
            }
          }
        } else {
          delete captureHoldNext[city.id];
        }
      }
      const territoryAfterCapture = citiesFinal !== updatedCities ? calculateTerritory(citiesFinal, s.tiles) : undefined;
      let phaseAfterCapture: GamePhase = s.phase;
      if (s.gameMode === 'bot_vs_bot') {
        const ai1Cities = citiesFinal.filter(c => c.ownerId === AI_ID);
        const ai2Cities = citiesFinal.filter(c => c.ownerId === AI_ID_2);
        if (ai1Cities.length === 0) {
          phaseAfterCapture = 'victory';
          clearAllTimers();
          captureNotifs.push({ id: generateId('n'), turn: s.cycle, message: 'South Empire conquers!', type: 'success' });
        } else if (ai2Cities.length === 0) {
          phaseAfterCapture = 'victory';
          clearAllTimers();
          captureNotifs.push({ id: generateId('n'), turn: s.cycle, message: 'North Empire conquers!', type: 'success' });
        }
      } else {
        const humanCitiesAfter = citiesFinal.filter(c => c.ownerId === HUMAN_ID);
        const aiCitiesAfter = citiesFinal.filter(c => c.ownerId === AI_ID);
        if (humanCitiesAfter.length === 0) {
          phaseAfterCapture = 'victory';
          clearAllTimers();
          captureNotifs.push({ id: generateId('n'), turn: s.cycle, message: 'Defeat! Your empire has fallen.', type: 'danger' });
        } else if (aiCitiesAfter.length === 0) {
          phaseAfterCapture = 'victory';
          clearAllTimers();
          captureNotifs.push({ id: generateId('n'), turn: s.cycle, message: 'Victory! You conquered the rival empire!', type: 'success' });
        }
      }

      const newNotifs = combatResult.notifications.length > 0 || captureNotifs.length > 0
        ? [...s.notifications.slice(-8), ...combatResult.notifications, ...captureNotifs]
        : s.notifications;

      const aliveHeroes = movingHeroes.filter(h => !(combatResult.killedHeroIds ?? []).includes(h.id));
      set({
        units: aliveUnits,
        cities: citiesFinal,
        territory: territoryAfterCapture ?? s.territory,
        phase: phaseAfterCapture,
        wallSections: wallSectionsMut,
        cityCaptureHold: captureHoldNext,
        heroes: aliveHeroes,
        notifications: newNotifs,
        combatHexesThisCycle: nextCombatHexes,
      });

      // -- Construction tick --
      {
        const st = get();
        if (st.constructions.length > 0) {
          const remaining: ConstructionSite[] = [];
          const completedNotifs: GameNotification[] = [];
          const updatedCities = st.cities.map(c => ({ ...c, buildings: [...c.buildings] }));
          const newUnitsFromField: Unit[] = [];
          const newScoutTowers: ScoutTower[] = [];

          for (const site of st.constructions) {
            // Calculate available BP at this hex
            let availBP = 0;

            // If in territory of owning player, city provides CITY_BUILDING_POWER (buildings only; trebuchet/scout_tower are builder-only)
            if (site.type !== 'trebuchet' && site.type !== 'scout_tower') {
              const terr = st.territory.get(tileKey(site.q, site.r));
              if (terr && terr.playerId === site.ownerId) {
                availBP += CITY_BUILDING_POWER;
              }
            }

            // Count builder units at the hex
            const builders = st.units.filter(
              u => u.q === site.q && u.r === site.r && u.ownerId === site.ownerId && u.type === 'builder' && u.hp > 0
            );
            availBP += builders.length * BUILDER_POWER;

            if (availBP === 0) {
              remaining.push(site);
              continue;
            }

            // BP per second = availBP / BP_RATE_BASE
            const bpPerSec = availBP / BP_RATE_BASE;
            const newAccum = site.bpAccumulated + bpPerSec;

            if (newAccum >= site.bpRequired) {
              if (site.type === 'trebuchet') {
                // Field-built trebuchet: spawn unit at (q, r)
                const stats = UNIT_BASE_STATS.trebuchet;
                const ownerCities = st.cities.filter(c => c.ownerId === site.ownerId);
                let originCityId = '';
                if (ownerCities.length > 0) {
                  const nearest = ownerCities.reduce((best, c) =>
                    hexDistance(c.q, c.r, site.q, site.r) < hexDistance(best.q, best.r, site.q, site.r) ? c : best
                  );
                  originCityId = nearest.id;
                }
                newUnitsFromField.push({
                  id: generateId('unit'), type: 'trebuchet', q: site.q, r: site.r, ownerId: site.ownerId,
                  hp: stats.maxHp, maxHp: stats.maxHp,
                  xp: 0, level: 0,
                  status: 'idle' as const, stance: 'aggressive' as const,
                  nextMoveAt: 0,
                  originCityId,
                });
                completedNotifs.push({
                  id: generateId('n'), turn: st.cycle,
                  message: `Trebuchet completed at (${site.q}, ${site.r})!`,
                  type: 'success',
                });
              } else if (site.type === 'scout_tower') {
                newScoutTowers.push({
                  id: generateId('scout_tower'),
                  q: site.q,
                  r: site.r,
                  ownerId: site.ownerId,
                });
                completedNotifs.push({
                  id: generateId('n'), turn: st.cycle,
                  message: `Scout tower completed at (${site.q}, ${site.r})!`,
                  type: 'success',
                });
              } else {
                // Building: add to city and auto-assign workers
                const city = updatedCities.find(c => c.id === site.cityId);
                if (city) {
                  const b: CityBuilding = { type: site.type as BuildingType, q: site.q, r: site.r };
                  if (['quarry', 'mine', 'gold_mine', 'barracks', 'factory', 'academy', 'farm'].includes(site.type)) b.level = 1;
                  const jobs = BUILDING_JOBS[site.type as BuildingType] ?? 0;
                  if (jobs > 0) {
                    const totalEmployed = city.buildings.reduce((s, x) => s + ((x as CityBuilding).assignedWorkers ?? 0), 0);
                    const available = city.population - totalEmployed;
                    b.assignedWorkers = Math.min(jobs, Math.max(0, available));
                  }
                  city.buildings.push(b);
                }
                completedNotifs.push({
                  id: generateId('n'), turn: st.cycle,
                  message: `${site.type.charAt(0).toUpperCase() + site.type.slice(1)} completed at (${site.q}, ${site.r})!`,
                  type: 'success',
                });
              }
            } else {
              remaining.push({ ...site, bpAccumulated: newAccum });
            }
          }

          // Always write back — BP accumulation needs to persist each tick
          const allNotifs = completedNotifs.length > 0
            ? [...st.notifications.slice(-8), ...completedNotifs]
            : st.notifications;
          set({
            constructions: remaining,
            cities: updatedCities,
            units: newUnitsFromField.length > 0 ? [...st.units, ...newUnitsFromField] : st.units,
            scoutTowers: newScoutTowers.length > 0 ? [...st.scoutTowers, ...newScoutTowers] : st.scoutTowers,
            notifications: allNotifs,
          });
        }
      }

      // -- Road construction tick --
      {
        const st = get();
        if (st.roadConstructions.length > 0) {
          const remaining: RoadConstructionSite[] = [];
          const completedNotifs: GameNotification[] = [];
          const completedHexes: [number, number][] = [];
          let tilesUpdated = false;
          const newTiles = new Map(st.tiles);

          for (const site of st.roadConstructions) {
            const builders = st.units.filter(
              u => u.q === site.q && u.r === site.r && u.ownerId === site.ownerId && u.type === 'builder' && u.hp > 0
            );
            const availBP = builders.length * BUILDER_POWER;
            if (availBP === 0) {
              remaining.push(site);
              continue;
            }
            const bpPerSec = availBP / BP_RATE_BASE;
            const newAccum = site.bpAccumulated + bpPerSec;
            if (newAccum >= site.bpRequired) {
              const key = tileKey(site.q, site.r);
              const t = newTiles.get(key);
              if (t) {
                newTiles.set(key, { ...t, hasRoad: true });
                tilesUpdated = true;
              }
              completedHexes.push([site.q, site.r]);
              completedNotifs.push({
                id: generateId('n'), turn: st.cycle,
                message: `Road completed at (${site.q}, ${site.r})!`,
                type: 'success',
              });
            } else {
              remaining.push({ ...site, bpAccumulated: newAccum });
            }
          }

          // Reassign builders that just finished to the next road site so path-building continues
          let newUnits = st.units;
          if (completedHexes.length > 0 && remaining.length > 0) {
            newUnits = st.units.map(u => {
              if (u.type !== 'builder' || u.ownerId !== HUMAN_ID || u.hp <= 0) return u;
              const onCompletedHex = completedHexes.some(([q, r]) => u.q === q && u.r === r);
              if (!onCompletedHex) return u;
              const closest = remaining.reduce((best, site) => {
                const d = hexDistance(u.q, u.r, site.q, site.r);
                return d < best.d ? { site, d } : best;
              }, { site: remaining[0], d: hexDistance(u.q, u.r, remaining[0].q, remaining[0].r) });
              return { ...u, targetQ: closest.site.q, targetR: closest.site.r, status: 'moving' as const };
            });
          }

          // Always write back so BP accumulation persists each tick (otherwise progress never saves)
          const allNotifs = completedNotifs.length > 0
            ? [...st.notifications.slice(-8), ...completedNotifs]
            : st.notifications;
          set({ roadConstructions: remaining, tiles: newTiles, units: newUnits, notifications: allNotifs });
        }
      }

      // -- Scout mission tick --
      {
        const st = get();
        if (st.scoutMissions.length > 0) {
          const nowMs = Date.now();
          const remaining: ScoutMission[] = [];
          const newScouted = new Set(st.scoutedHexes);
          const scoutNotifs: GameNotification[] = [];

          for (const mission of st.scoutMissions) {
            if (nowMs >= mission.completesAt) {
              newScouted.add(tileKey(mission.targetQ, mission.targetR));
              scoutNotifs.push({
                id: generateId('n'), turn: st.cycle,
                message: `Scout report: intel on (${mission.targetQ}, ${mission.targetR}) received!`,
                type: 'success',
              });
            } else {
              remaining.push(mission);
            }
          }

          if (remaining.length !== st.scoutMissions.length) {
            set({
              scoutMissions: remaining,
              scoutedHexes: newScouted,
              notifications: scoutNotifs.length > 0
                ? [...st.notifications.slice(-8), ...scoutNotifs]
                : st.notifications,
            });
          }
        }
      }

      // Recompute vision
      get().recomputeVision();

      // Run economy cycle?
      if (now >= s.nextCycleTime) {
        get().runCycle();
        const speedForCycle = (s.gameMode === 'bot_vs_bot' || s.gameMode === 'bot_vs_bot_4') ? (s.simSpeedMultiplier || 1) : 1;
        set({ nextCycleTime: now + (CYCLE_INTERVAL_SEC * 1000) / speedForCycle });
      }

      // Game over?
      if (gameRem <= 0) {
        clearAllTimers();
        const st = get();
        if (st.gameMode === 'bot_vs_bot') {
          const ai1Cities = st.cities.filter(c => c.ownerId === AI_ID);
          const ai2Cities = st.cities.filter(c => c.ownerId === AI_ID_2);
          const ai1Pop = ai1Cities.reduce((a, c) => a + c.population, 0);
          const ai2Pop = ai2Cities.reduce((a, c) => a + c.population, 0);
          const ai1Wins = ai1Cities.length > ai2Cities.length ||
            (ai1Cities.length === ai2Cities.length && ai1Pop >= ai2Pop);
          const msg = ai1Wins
            ? `Time's up! North Empire wins (${ai1Cities.length} cities, ${ai1Pop} pop).`
            : `Time's up! South Empire wins (${ai2Cities.length} cities, ${ai2Pop} pop).`;
          set({
            phase: 'victory',
            notifications: [...st.notifications.slice(-8), { id: generateId('n'), turn: st.cycle, message: msg, type: 'success' }],
          });
        } else {
          const humanCities = st.cities.filter(c => c.ownerId === HUMAN_ID);
          const aiCities = st.cities.filter(c => c.ownerId === AI_ID);
          const humanPop = humanCities.reduce((a, c) => a + c.population, 0);
          const aiPop = aiCities.reduce((a, c) => a + c.population, 0);
          const humanWins = humanCities.length > aiCities.length ||
            (humanCities.length === aiCities.length && humanPop >= aiPop);
          const msg = humanWins
            ? 'Time\'s up! You control more territory. Victory!'
            : 'Time\'s up! The rival empire dominates. Defeat.';
          set({
            phase: 'victory',
            notifications: [...st.notifications.slice(-8), { id: generateId('n'), turn: st.cycle, message: msg, type: humanWins ? 'success' : 'danger' }],
          });
        }
      }
    }, intervalMs);
  },

  setSimSpeedMultiplier: (speed: 1 | 2 | 4) => {
    const s = get();
    if (s.phase !== 'playing' || (s.gameMode !== 'bot_vs_bot' && s.gameMode !== 'bot_vs_bot_4')) return;
    const now = Date.now();
    const curSpeed = s.simSpeedMultiplier || 1;
    const gameRemSec = Math.max(0, (s.gameEndTime - now) / 1000) * curSpeed;
    const cycleRemSec = Math.max(0, (s.nextCycleTime - now) / 1000) * curSpeed;
    set({
      simSpeedMultiplier: speed,
      gameEndTime: now + (gameRemSec * 1000) / speed,
      nextCycleTime: now + (cycleRemSec * 1000) / speed,
    });
    clearAllTimers();
    get().startRealTimeLoop({ preserveTimes: true });
  },

  stopRealTimeLoop: () => clearAllTimers(),

  runCycle: () => {
    const s = get();
    if (s.phase !== 'playing') return;
    const newCycle = s.cycle + 1;

    // ── Weather System ──
    let currentWeather = s.activeWeather;
    let lastWeatherEnd = s.lastWeatherEndCycle;
    const weatherNotifs: GameNotification[] = [];

    // Tick existing weather (decrement duration)
    if (currentWeather) {
      const tick = tickWeatherEvent(currentWeather, newCycle);
      currentWeather = tick.event;
      if (tick.endedCycle !== null) lastWeatherEnd = tick.endedCycle;
      weatherNotifs.push(...tick.notifications);
    }

    // Roll for new weather event
    if (!currentWeather) {
      const newEvent = rollForWeatherEvent(newCycle, currentWeather, lastWeatherEnd);
      if (newEvent) {
        currentWeather = newEvent;
        weatherNotifs.push(weatherAnnouncement(newEvent));
      }
    }

    // Calculate harvest multiplier based on active weather
    const harvestMultiplier = getWeatherHarvestMultiplier(currentWeather);

    // Economy for all (with weather multiplier)
    const econ = processEconomyTurn(s.cities, s.units, s.players, s.tiles, s.territory, newCycle, harvestMultiplier);
    let cities = econ.cities;
    const units = econ.units;
    let players = econ.players;
    const notifs = [...weatherNotifs, ...econ.notifications];

    // Military upkeep (food + guns consumption, per cluster); reuse clusters from economy
    const upkeepResult = upkeepTick(units, cities, s.heroes, newCycle, s.tiles, s.territory, econ.clusters);
    notifs.push(...upkeepResult.notifications);

    // AI turn(s): for each AI player, plan and apply builds, upgrades, recruits, moves, scouts, village incorporation, wall rings
    const aiPlayerIds = s.gameMode === 'bot_vs_bot' ? [AI_ID, AI_ID_2] : [AI_ID];
    let scoutMissions = s.scoutMissions;
    let scoutedHexes = s.scoutedHexes;
    let tilesMut = s.tiles;
    let wallSectionsMut: WallSection[] = s.wallSections.map(w => ({ ...w }));

    for (const aiPlayerId of aiPlayerIds) {
      const aiPlan = planAiTurn(aiPlayerId, cities, units, players, s.tiles, s.territory, getAiParams(), wallSectionsMut);
      const aiPlayer = players.find(p => p.id === aiPlayerId);
      if (!aiPlayer) continue;

      for (const build of aiPlan.builds) {
        const city = cities.find(c => c.id === build.cityId);
        if (!city || city.ownerId !== aiPlayerId) continue;
        if (aiPlayer.gold < BUILDING_COSTS[build.type]) continue;
        const ironCost = (BUILDING_IRON_COSTS[build.type] ?? 0);
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
        const effectiveLevel = rec.type === 'defender' ? 3 : (rec.armsLevel ?? 1);
        const wantL2 = effectiveLevel === 2;
        const wantL3 = effectiveLevel === 3;
        const goldCost = wantL3 ? UNIT_L3_COSTS[rec.type].gold : wantL2 ? UNIT_L2_COSTS[rec.type].gold : UNIT_COSTS[rec.type].gold;
        const stoneCost = wantL2 ? (UNIT_L2_COSTS[rec.type].stone ?? 0) : 0;
        const ironCost = wantL3 ? (UNIT_L3_COSTS[rec.type].iron ?? 0) : 0;
        if (aiPlayer.gold < goldCost) continue;
        if (stoneCost > 0 && (city.storage.stone ?? 0) < stoneCost) continue;
        if (ironCost > 0 && (city.storage.iron ?? 0) < ironCost) continue;
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
          const idx = cities.indexOf(city);
          if (idx >= 0) {
            const c = cities[idx];
            cities[idx] = {
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
          scoutMissions = [...scoutMissions, {
            id: generateId('scout'),
            targetQ: scout.targetQ,
            targetR: scout.targetR,
            completesAt: Date.now() + SCOUT_MISSION_DURATION_SEC * 1000,
          }];
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
        notifs.push({ id: generateId('n'), turn: newCycle, message: `${newCity.name} incorporated!`, type: 'success' });
      }

      for (const mt of aiPlan.moveTargets) {
        const unit = units.find(u => u.id === mt.unitId);
        if (unit && unit.hp > 0 && unit.status !== 'fighting') {
          unit.targetQ = mt.toQ;
          unit.targetR = mt.toR;
          unit.status = 'moving';
          unit.stance = 'aggressive';
          unit.nextMoveAt = 0;
        }
      }

      // AI wall ring builds
      const buildWallRings = (aiPlan as { buildWallRings?: { cityId: string; ring: 1 | 2 }[] }).buildWallRings ?? [];
      for (const wr of buildWallRings) {
        const city = cities.find(c => c.id === wr.cityId);
        if (!city || city.ownerId !== aiPlayerId) continue;
        const ringHexes = getHexRing(city.q, city.r, wr.ring);
        const ownerWallKeys = new Set(wallSectionsMut.filter(w => w.ownerId === aiPlayerId).map(w => tileKey(w.q, w.r)));
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
          wallSectionsMut.push({
            q, r, ownerId: aiPlayerId, hp: WALL_SECTION_HP, maxHp: WALL_SECTION_HP,
          });
        }
      }
    }

    let aliveUnits = units.filter(u => u.hp > 0);

    // City capture: any city with enemy military on hex and no defenders flips to attacker
    let citiesToSet = cities;
    for (const city of cities) {
      const defenders = aliveUnits.filter(u => u.ownerId === city.ownerId && u.hp > 0 && u.q === city.q && u.r === city.r);
      if (defenders.length > 0) continue;
      const attackers = aliveUnits.filter(u => u.ownerId !== city.ownerId && u.hp > 0 && u.type !== 'builder' && u.q === city.q && u.r === city.r);
      if (attackers.length === 0) continue;
      const newOwnerId = attackers[0].ownerId;
      citiesToSet = citiesToSet.map(c => c.id === city.id ? { ...c, ownerId: newOwnerId } : c);
      notifs.push({ id: generateId('n'), turn: newCycle, message: `${city.name} captured!`, type: 'danger' });
    }
    const territory = calculateTerritory(citiesToSet, tilesMut);

    // Ancient city reward (first 5 cycles)
    let playersAfterAncientCity = players;
    const ancientCityTile = Array.from(tilesMut.values()).find((t) => t.hasAncientCity);
    if (ancientCityTile && s.cycle <= 5 && !s.combatHexesThisCycle.has(tileKey(ancientCityTile.q, ancientCityTile.r))) {
      const unitsOnHex = aliveUnits.filter((u) => u.q === ancientCityTile.q && u.r === ancientCityTile.r);
      const ownerIds = [...new Set(unitsOnHex.map((u) => u.ownerId))];
      if (ownerIds.length === 1) {
        const winnerId = ownerIds[0];
        playersAfterAncientCity = players.map((p) =>
          p.id === winnerId ? { ...p, gold: p.gold + 50 } : p
        );
        const winnerName = s.gameMode === 'bot_vs_bot' ? (winnerId === AI_ID ? 'North Empire' : 'South Empire') : (winnerId === HUMAN_ID ? 'You' : 'Enemy');
        notifs.push({ id: generateId('n'), turn: newCycle, message: `Ancient city: +50 gold (${winnerName} held it).`, type: 'success' });
      }
    }

    // Victory check
    let phase: GamePhase = 'playing';
    if (s.gameMode === 'bot_vs_bot') {
      const ai1Cities = citiesToSet.filter(c => c.ownerId === AI_ID);
      const ai2Cities = citiesToSet.filter(c => c.ownerId === AI_ID_2);
      if (ai1Cities.length === 0) {
        phase = 'victory'; clearAllTimers();
        notifs.push({ id: generateId('n'), turn: newCycle, message: 'South Empire conquers! Victory.', type: 'success' });
      } else if (ai2Cities.length === 0) {
        phase = 'victory'; clearAllTimers();
        notifs.push({ id: generateId('n'), turn: newCycle, message: 'North Empire conquers! Victory.', type: 'success' });
      }
    } else {
      const humanCities = citiesToSet.filter(c => c.ownerId === HUMAN_ID);
      const aiCities = citiesToSet.filter(c => c.ownerId === AI_ID);
      if (humanCities.length === 0) {
        phase = 'victory'; clearAllTimers();
        notifs.push({ id: generateId('n'), turn: newCycle, message: 'Defeat! Your empire has fallen.', type: 'danger' });
      } else if (aiCities.length === 0) {
        phase = 'victory'; clearAllTimers();
        notifs.push({ id: generateId('n'), turn: newCycle, message: 'Victory! You conquered the rival empire!', type: 'success' });
      }
    }

    set({
      cities: citiesToSet, units: aliveUnits, players: playersAfterAncientCity, territory, phase,
      cycle: newCycle,
      wallSections: wallSectionsMut,
      combatHexesThisCycle: new Set(),
      activeWeather: currentWeather,
      lastWeatherEndCycle: lastWeatherEnd,
      scoutMissions,
      scoutedHexes,
      tiles: tilesMut,
      notifications: [...s.notifications.slice(-8), ...notifs],
    });
  },

  // ─── Hex Selection ──────────────────────────────────────────

  selectHex: (q, r) => {
    const s = get();
    // Tactical: assigning move/intercept destination for selected stacks (bottom-bar flow)
    if (s.assigningTacticalForSelectedStacks !== null) {
      const tile = s.tiles.get(tileKey(q, r));
      if (tile && tile.biome !== 'water') {
        get().setTacticalMoveTargetForSelected(q, r);
      } else {
        get().addNotification('Invalid destination (water). Click land.', 'warning');
      }
      return;
    }
    // Tactical panel: assigning move/intercept destination for a single stack (legacy)
    if (s.assigningTacticalForStack !== null) {
      const tile = s.tiles.get(tileKey(q, r));
      if (tile && tile.biome !== 'water') {
        get().setTacticalMoveTarget(q, r);
      } else {
        get().addNotification('Invalid destination (water). Click land.', 'warning');
      }
      return;
    }
    // Split stack: click adjacent land hex to place the split-off units
    if (s.splitStackPending !== null) {
      const { fromQ, fromR, count } = s.splitStackPending;
      const dist = hexDistance(fromQ, fromR, q, r);
      const isSame = fromQ === q && fromR === r;
      const tile = s.tiles.get(tileKey(q, r));
      if (!isSame && dist === 1 && tile && tile.biome !== 'water') {
        get().splitStackToHex(q, r);
      } else if (isSame) {
        get().cancelSplitStack();
      } else {
        get().addNotification('Click an adjacent land hex to place the split stack.', 'warning');
      }
      return;
    }
    if (s.phase === 'place_city') { get().setPendingCity(q, r); return; }
    if (s.uiMode === 'build_mine') { get().builderSelectDeposit(q, r, 'mine'); return; }
    if (s.uiMode === 'build_quarry') { get().builderSelectDeposit(q, r, 'quarry'); return; }
    if (s.uiMode === 'build_gold_mine') { get().builderSelectDeposit(q, r, 'gold_mine'); return; }
    if (s.uiMode === 'build_road') { get().addRoadPathHex(q, r); return; }
    if (s.uiMode === 'move') {
      // Re-clicking the same hex (where units are) cancels move mode
      if (s.selectedHex && s.selectedHex.q === q && s.selectedHex.r === r) {
        set({ selectedHex: null, uiMode: 'normal', pendingMove: null });
        return;
      }
      get().setPendingMove(q, r);
      return;
    }
    if (s.uiMode === 'defend') {
      const city = s.cities.find(c => c.q === q && c.r === r && c.ownerId === HUMAN_ID);
      if (city) get().setDefendCity(city.id);
      else get().addNotification('Click a friendly city to defend!', 'warning');
      return;
    }
    if (s.uiMode === 'intercept') {
      if (s.selectedHex && s.selectedHex.q === q && s.selectedHex.r === r) {
        set({ selectedHex: null, uiMode: 'normal', pendingMove: null });
        return;
      }
      get().setPendingMove(q, r);
      return;
    }

    // Clicking an already-selected hex deselects
    if (s.selectedHex && s.selectedHex.q === q && s.selectedHex.r === r) {
      set({ selectedHex: null, uiMode: 'normal', pendingMove: null, selectedClusterKey: s.supplyViewTab === 'supply' ? null : s.selectedClusterKey });
      return;
    }

    // Click-to-move: selected stack + click empty/valid destination → set move (smoother than using Move button)
    if (s.selectedHex && s.uiMode === 'normal') {
      const stack = s.units.filter(u => u.q === s.selectedHex!.q && u.r === s.selectedHex!.r && u.ownerId === HUMAN_ID && u.hp > 0);
      const destHasFriendly = s.units.some(u => u.q === q && u.r === r && u.ownerId === HUMAN_ID && u.hp > 0);
      if (stack.length > 0 && !destHasFriendly) {
        const dist = hexDistance(s.selectedHex.q, s.selectedHex.r, q, r);
        const tile = s.tiles.get(tileKey(q, r));
        if (dist >= 1 && dist <= 10 && tile && tile.biome !== 'water') {
          get().setPendingMove(q, r);
          return;
        }
      }
    }

    // In supply view: resolve cluster from road or city hex, show cluster panel
    if (s.supplyViewTab === 'supply') {
      const clusterKey = s.getClusterForHex(q, r);
      set({ selectedHex: { q, r }, uiMode: 'normal', pendingMove: null, selectedClusterKey: clusterKey });
      return;
    }

    const myUnits = s.units.filter(u => u.q === q && u.r === r && u.ownerId === HUMAN_ID && u.hp > 0);
    const hasCity = !!s.getCityAt(q, r);
    const hasBuilding = s.hasBuildingAt(q, r);
    const hasBoth = myUnits.length > 0 && (hasCity || hasBuilding);
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const DOUBLE_CLICK_MS = 400;
    const isDoubleClick = hasBoth && s.lastClickHex?.q === q && s.lastClickHex?.r === r && (now - s.lastClickTime) < DOUBLE_CLICK_MS;

    if (hasBoth) {
      set({
        lastClickHex: { q, r },
        lastClickTime: now,
        selectedHex: { q, r },
        uiMode: isDoubleClick ? 'move' : 'normal',
        pendingMove: null,
      });
      return;
    }
    set({ lastClickHex: { q, r }, lastClickTime: now });
    if (myUnits.length > 0) {
      set({ selectedHex: { q, r }, uiMode: 'move', pendingMove: null });
      return;
    }
    set({ selectedHex: { q, r }, uiMode: 'normal', pendingMove: null });
  },

  deselectAll: () => {
    const s = get();
    if (s.pendingTacticalOrders !== null) {
      get().cancelTacticalMode();
    }
    if (s.splitStackPending !== null) {
      set({ splitStackPending: null });
    }
    if (s.uiMode === 'build_mine' || s.uiMode === 'build_quarry' || s.uiMode === 'build_gold_mine' || s.uiMode === 'build_road') {
      set({ selectedHex: null, uiMode: 'normal', pendingMove: null, roadPathSelection: [], selectedClusterKey: null });
    } else if (s.uiMode === 'defend' || s.uiMode === 'intercept') {
      set({ selectedHex: null, uiMode: 'normal', pendingMove: null });
    } else {
      set({ selectedHex: null, uiMode: 'normal', pendingMove: null, selectedClusterKey: null });
    }
  },

  // ─── Building (with construction BP system) ────────────────

  buildStructure: (type, q, r) => {
    const s = get();
    const player = s.players.find(p => p.id === HUMAN_ID);
    if (!player) return;
    if (player.gold < BUILDING_COSTS[type]) { get().addNotification('Not enough gold!', 'warning'); return; }

    const tile = s.tiles.get(tileKey(q, r));
    if (!tile || tile.biome === 'water' || tile.biome === 'mountain') return;
    if (s.cities.some(c => c.q === q && c.r === r)) return;
    if (s.constructions.some(cs => cs.q === q && cs.r === r)) {
      get().addNotification('Already under construction!', 'warning'); return;
    }

    // Check if hex already has a building
    const hexKey = tileKey(q, r);
    if (s.cities.some(c => c.buildings.some(b => tileKey(b.q, b.r) === hexKey))) return;

    const inTerritory = s.territory.get(hexKey);
    const isPlayerTerritory = inTerritory && inTerritory.playerId === HUMAN_ID;

    // Outside territory: require builder units at the hex
    if (!isPlayerTerritory) {
      const buildersAtHex = s.units.filter(
        u => u.q === q && u.r === r && u.ownerId === HUMAN_ID && u.type === 'builder' && u.hp > 0
      );
      if (buildersAtHex.length === 0) {
        get().addNotification('Need Builder units here to build outside territory!', 'warning');
        return;
      }
    }

    // Find nearest owned city to assign the building to
    let cityId: string | undefined;
    if (isPlayerTerritory) {
      cityId = inTerritory.cityId;
    } else {
      let bestDist = Infinity;
      for (const c of s.cities) {
        if (c.ownerId !== HUMAN_ID) continue;
        const d = hexDistance(c.q, c.r, q, r);
        if (d < bestDist) { bestDist = d; cityId = c.id; }
      }
    }
    if (!cityId) { get().addNotification('No city to assign building!', 'warning'); return; }

    const city = s.cities.find(c => c.id === cityId)!;
    if (type === 'quarry') {
      if (!tile.hasQuarryDeposit) { get().addNotification('Quarry must be built on a quarry deposit!', 'warning'); return; }
      if (city.population < 10) { get().addNotification('Need 10 population at city for quarry!', 'warning'); return; }
      const unitsHere = s.units.filter(u => u.q === q && u.r === r && u.ownerId === HUMAN_ID && u.hp > 0);
      if (unitsHere.length === 0) { get().addNotification('Units must be present on the deposit to build!', 'warning'); return; }
    } else if (type === 'mine') {
      if (!tile.hasMineDeposit) { get().addNotification('Mine must be built on a mine deposit!', 'warning'); return; }
      if (city.population < 10) { get().addNotification('Need 10 population at city for mine!', 'warning'); return; }
      const unitsHere = s.units.filter(u => u.q === q && u.r === r && u.ownerId === HUMAN_ID && u.hp > 0);
      if (unitsHere.length === 0) { get().addNotification('Units must be present on the deposit to build!', 'warning'); return; }
    }
    if (type === 'city_center') return; // city center comes with city

    const bpRequired = BUILDING_BP_COST[type];
    const site: ConstructionSite = {
      id: generateId('con'), type, q, r, cityId, ownerId: HUMAN_ID,
      bpRequired, bpAccumulated: 0,
    };

    set({
      players: s.players.map(p => p.id === HUMAN_ID ? { ...p, gold: p.gold - BUILDING_COSTS[type] } : { ...p }),
      constructions: [...s.constructions, site],
    });

    const inTerr = isPlayerTerritory ? ' (city power)' : ' (builders)';
    get().addNotification(`Construction started: ${type} (${BUILDING_COSTS[type]}g)${inTerr}`, 'info');
  },

  buildTrebuchetInField: (q, r) => {
    const s = get();
    const player = s.players.find(p => p.id === HUMAN_ID);
    if (!player || player.gold < TREBUCHET_FIELD_GOLD_COST) {
      get().addNotification(`Need ${TREBUCHET_FIELD_GOLD_COST} gold to build trebuchet!`, 'warning');
      return;
    }
    const tile = s.tiles.get(tileKey(q, r));
    if (!tile || tile.biome === 'water' || tile.biome === 'mountain') return;
    if (s.cities.some(c => c.q === q && c.r === r)) {
      get().addNotification('Cannot build trebuchet on a city!', 'warning');
      return;
    }
    if (s.constructions.some(cs => cs.q === q && cs.r === r)) {
      get().addNotification('Already under construction here!', 'warning');
      return;
    }
    const buildersAtHex = s.units.filter(
      u => u.q === q && u.r === r && u.ownerId === HUMAN_ID && u.type === 'builder' && u.hp > 0
    );
    if (buildersAtHex.length === 0) {
      get().addNotification('Need a Builder on this hex to build trebuchet!', 'warning');
      return;
    }
    const site: ConstructionSite = {
      id: generateId('con'),
      type: 'trebuchet',
      q,
      r,
      cityId: '',
      ownerId: HUMAN_ID,
      bpRequired: TREBUCHET_FIELD_BP_COST,
      bpAccumulated: 0,
    };
    set({
      players: s.players.map(p => p.id === HUMAN_ID ? { ...p, gold: p.gold - TREBUCHET_FIELD_GOLD_COST } : p),
      constructions: [...s.constructions, site],
    });
    get().addNotification(`Trebuchet construction started (${TREBUCHET_FIELD_GOLD_COST}g, ${TREBUCHET_FIELD_BP_COST} BP). Builder builds on this hex.`, 'info');
  },

  buildScoutTowerInField: (q: number, r: number) => {
    const s = get();
    const player = s.players.find(p => p.id === HUMAN_ID);
    if (!player || player.gold < SCOUT_TOWER_GOLD_COST) {
      get().addNotification(`Need ${SCOUT_TOWER_GOLD_COST} gold to build scout tower!`, 'warning');
      return;
    }
    const tile = s.tiles.get(tileKey(q, r));
    if (!tile || tile.biome === 'water' || tile.biome === 'mountain') return;
    if (s.cities.some(c => c.q === q && c.r === r)) {
      get().addNotification('Cannot build scout tower on a city!', 'warning');
      return;
    }
    if (s.constructions.some(cs => cs.q === q && cs.r === r)) {
      get().addNotification('Already under construction here!', 'warning');
      return;
    }
    if (s.scoutTowers.some(t => t.q === q && t.r === r)) {
      get().addNotification('Scout tower already here!', 'warning');
      return;
    }
    const buildersAtHex = s.units.filter(
      u => u.q === q && u.r === r && u.ownerId === HUMAN_ID && u.type === 'builder' && u.hp > 0
    );
    if (buildersAtHex.length === 0) {
      get().addNotification('Need a Builder on this hex to build scout tower!', 'warning');
      return;
    }
    const site: ConstructionSite = {
      id: generateId('con'),
      type: 'scout_tower',
      q,
      r,
      cityId: '',
      ownerId: HUMAN_ID,
      bpRequired: SCOUT_TOWER_BP_COST,
      bpAccumulated: 0,
    };
    set({
      players: s.players.map(p => p.id === HUMAN_ID ? { ...p, gold: p.gold - SCOUT_TOWER_GOLD_COST } : p),
      constructions: [...s.constructions, site],
    });
    get().addNotification(`Scout tower construction started (${SCOUT_TOWER_GOLD_COST}g, ${SCOUT_TOWER_BP_COST} BP).`, 'info');
  },

  buildRoad: (q, r) => {
    const s = get();
    const tile = s.tiles.get(tileKey(q, r));
    if (!tile || tile.biome === 'water') return;  // allow roads on mountains for mine connectivity
    if (tile.hasRoad) { get().addNotification('Road already here!', 'info'); return; }
    if (s.roadConstructions.some(rc => rc.q === q && rc.r === r)) return;
    const buildersAtHex = s.units.filter(u => u.q === q && u.r === r && u.ownerId === HUMAN_ID && u.type === 'builder' && u.hp > 0);
    if (buildersAtHex.length === 0) { get().addNotification('Need Builder here to build road!', 'warning'); return; }
    const site: RoadConstructionSite = { id: generateId('road'), q, r, ownerId: HUMAN_ID, bpRequired: ROAD_BP_COST, bpAccumulated: 0 };
    set({ roadConstructions: [...s.roadConstructions, site] });
    get().addNotification(`Road construction started (${ROAD_BP_COST} BP, free)`, 'info');
  },

  // ─── Upgrade Barracks ─────────────────────────────────────────

  upgradeBarracks: (cityId, buildingQ, buildingR) => {
    const s = get();
    const player = s.players.find(p => p.id === HUMAN_ID);
    const city = s.cities.find(c => c.id === cityId);
    if (!player || !city) return;
    if (player.gold < BARACKS_UPGRADE_COST) {
      get().addNotification(`Need ${BARACKS_UPGRADE_COST} gold!`, 'warning'); return;
    }
    const building = city.buildings.find(b => b.type === 'barracks' && b.q === buildingQ && b.r === buildingR);
    if (!building) return;
    const lvl = building.level ?? 1;
    if (lvl >= 2) {
      get().addNotification('Barracks already upgraded!', 'info'); return;
    }
    const newCities = s.cities.map(c => {
      if (c.id !== cityId) return c;
      return {
        ...c,
        buildings: c.buildings.map(b =>
          b.type === 'barracks' && b.q === buildingQ && b.r === buildingR ? { ...b, level: 2 } : b
        ),
      };
    });
    set({
      players: s.players.map(p => p.id === HUMAN_ID ? { ...p, gold: p.gold - BARACKS_UPGRADE_COST } : { ...p }),
      cities: newCities,
    });
    get().addNotification('Barracks upgraded! Can recruit L2 units.', 'success');
  },

  // ─── Upgrade Factory ─────────────────────────────────────────

  upgradeFactory: (cityId, buildingQ, buildingR) => {
    const s = get();
    const player = s.players.find(p => p.id === HUMAN_ID);
    const city = s.cities.find(c => c.id === cityId);
    if (!player || !city) return;
    if (player.gold < FACTORY_UPGRADE_COST) {
      get().addNotification(`Need ${FACTORY_UPGRADE_COST} gold!`, 'warning'); return;
    }
    const building = city.buildings.find(b => b.type === 'factory' && b.q === buildingQ && b.r === buildingR);
    if (!building) return;
    const lvl = building.level ?? 1;
    if (lvl >= 2) {
      get().addNotification('Factory already upgraded!', 'info'); return;
    }
    const newCities = s.cities.map(c => {
      if (c.id !== cityId) return c;
      return {
        ...c,
        buildings: c.buildings.map(b =>
          b.type === 'factory' && b.q === buildingQ && b.r === buildingR ? { ...b, level: 2 } : b
        ),
      };
    });
    set({
      players: s.players.map(p => p.id === HUMAN_ID ? { ...p, gold: p.gold - FACTORY_UPGRADE_COST } : { ...p }),
      cities: newCities,
    });
    get().addNotification('Factory upgraded! Produces L2 arms (1 iron -> 10/cycle).', 'success');
  },

  // ─── Upgrade Farm ─────────────────────────────────────────

  upgradeFarm: (cityId, buildingQ, buildingR) => {
    const s = get();
    const player = s.players.find(p => p.id === HUMAN_ID);
    const city = s.cities.find(c => c.id === cityId);
    if (!player || !city) return;
    if (player.gold < FARM_UPGRADE_COST) {
      get().addNotification(`Need ${FARM_UPGRADE_COST} gold!`, 'warning'); return;
    }
    const building = city.buildings.find(b => b.type === 'farm' && b.q === buildingQ && b.r === buildingR);
    if (!building) return;
    const lvl = building.level ?? 1;
    if (lvl >= 2) {
      get().addNotification('Farm already upgraded!', 'info'); return;
    }
    const newCities = s.cities.map(c => {
      if (c.id !== cityId) return c;
      return {
        ...c,
        buildings: c.buildings.map(b =>
          b.type === 'farm' && b.q === buildingQ && b.r === buildingR ? { ...b, level: 2 } : b
        ),
      };
    });
    set({
      players: s.players.map(p => p.id === HUMAN_ID ? { ...p, gold: p.gold - FARM_UPGRADE_COST } : { ...p }),
      cities: newCities,
    });
    get().addNotification('Farm upgraded! +50 grain/cycle (L2).', 'success');
  },

  adjustWorkers: (cityId, buildingQ, buildingR, delta) => {
    const s = get();
    const city = s.cities.find(c => c.id === cityId);
    if (!city) return;
    const building = city.buildings.find(b => b.q === buildingQ && b.r === buildingR && getBuildingJobs(b) > 0);
    if (!building) return;
    const maxW = getBuildingJobs(building);
    const assigned = building.assignedWorkers ?? 0;
    const totalEmployed = city.buildings.reduce((sum, b) => sum + ((b as CityBuilding).assignedWorkers ?? 0), 0);
    const available = city.population - totalEmployed; // workers don't reduce population; employable = pop - employed
    if (delta > 0) {
      const toAdd = Math.min(delta, maxW - assigned, available);
      if (toAdd <= 0) {
        if (assigned >= maxW) get().addNotification('Building at max workers!', 'info');
        else if (available <= 0) get().addNotification('No unassigned population to assign!', 'warning');
        return;
      }
      const newCities = s.cities.map(c => {
        if (c.id !== cityId) return c;
        return {
          ...c,
          buildings: c.buildings.map(b =>
            b.q === buildingQ && b.r === buildingR ? { ...b, assignedWorkers: (b.assignedWorkers ?? 0) + toAdd } : b
          ),
        };
      });
      set({ cities: newCities });
      get().addNotification(`Assigned ${toAdd} worker${toAdd > 1 ? 's' : ''} to ${building.type}`, 'info');
    } else {
      const toRecall = Math.min(-delta, assigned);
      if (toRecall <= 0) return;
      const newCities = s.cities.map(c => {
        if (c.id !== cityId) return c;
        return {
          ...c,
          buildings: c.buildings.map(b =>
            b.q === buildingQ && b.r === buildingR ? { ...b, assignedWorkers: Math.max(0, (b.assignedWorkers ?? 0) - toRecall) } : b
          ),
        };
      });
      set({ cities: newCities });
      get().addNotification(`Recalled ${toRecall} worker${toRecall > 1 ? 's' : ''} to city`, 'info');
    }
  },

  // ─── Recruit Unit (from Barracks hex — gold cost + pop draft) ─

  recruitUnit: (cityId, type, armsLevel) => {
    const s = get();
    const player = s.players.find(p => p.isHuman);
    const city = s.cities.find(c => c.id === cityId);
    if (!player || !city) return;

    const isBuilder = type === 'builder';
    const barracks = city.buildings.find(b => b.type === 'barracks');
    const academy = city.buildings.find(b => b.type === 'academy');
    const barracksLvl = barracks ? (barracks.level ?? 1) : 1;
    // Defender is always L3; other units use requested armsLevel (1/2/3)
    const effectiveLevel = type === 'defender' ? 3 : (armsLevel ?? 1);
    const wantL2 = effectiveLevel === 2;
    const wantL3 = effectiveLevel === 3;

    if (isBuilder) {
      if (!academy) {
        get().addNotification('Build an Academy to recruit Builders!', 'warning'); return;
      }
    } else {
      if (!barracks) {
        get().addNotification('Build a Barracks to recruit military units!', 'warning'); return;
      }
      if (type === 'defender' && barracksLvl < 2) {
        get().addNotification('Upgrade barracks to L2 to recruit Defenders!', 'warning'); return;
      }
      if ((wantL2 || wantL3) && type !== 'defender' && barracksLvl < 2) {
        get().addNotification('Upgrade barracks first to recruit L2/L3 units!', 'warning'); return;
      }
    }
    if (wantL2 && type === 'builder') {
      get().addNotification('Builders have no L2 variant.', 'info'); return;
    }
    if (wantL3 && type === 'builder') {
      get().addNotification('Builders have no L3 variant.', 'info'); return;
    }

    // Resolve cost by tier: L1 = UNIT_COSTS, L2 = UNIT_L2_COSTS (gold+stone), L3/defender = UNIT_L3_COSTS (gold+iron; defender iron only)
    const goldCost = wantL3 ? UNIT_L3_COSTS[type].gold : wantL2 ? UNIT_L2_COSTS[type].gold : UNIT_COSTS[type].gold;
    const stoneCost = wantL2 ? (UNIT_L2_COSTS[type].stone ?? 0) : 0;
    const ironCost = wantL3 ? (UNIT_L3_COSTS[type].iron ?? 0) : 0;

    if (player.gold < goldCost) {
      get().addNotification(`Need ${goldCost} gold!`, 'warning'); return;
    }
    if (stoneCost > 0) {
      const cityStone = city.storage.stone ?? 0;
      if (cityStone < stoneCost) {
        get().addNotification(`Need ${stoneCost} stone to recruit L2 ${UNIT_DISPLAY_NAMES[type]}! (Build a quarry.)`, 'warning'); return;
      }
    }
    if (ironCost > 0) {
      const cityIron = city.storage.iron ?? 0;
      if (cityIron < ironCost) {
        get().addNotification(`Need ${ironCost} iron to recruit ${type === 'defender' ? 'Defender' : 'L3 ' + UNIT_DISPLAY_NAMES[type]}! (Build a mine.)`, 'warning'); return;
      }
    }

    const playerCities = s.cities.filter(c => c.ownerId === player.id);
    const totalPop = playerCities.reduce((sum, c) => sum + c.population, 0);
    const livingTroops = s.units.filter(u => u.ownerId === player.id && u.hp > 0).length;
    if (livingTroops >= totalPop) {
      get().addNotification('Troop limit: need more population to recruit (1 troop per population).', 'warning'); return;
    }

    const stats = getUnitStats({ type, armsLevel: effectiveLevel as 1 | 2 | 3 });
    const gunL2Upkeep = (stats as { gunL2Upkeep?: number }).gunL2Upkeep ?? 0;
    if (gunL2Upkeep > 0) {
      const totalGunsL2 = s.cities.filter(c => c.ownerId === HUMAN_ID).reduce((sum, c) => sum + (c.storage.gunsL2 ?? 0), 0);
      if (totalGunsL2 < gunL2Upkeep) {
        get().addNotification('Need L2 arms to recruit this unit! Build upgraded factory.', 'warning'); return;
      }
    }

    const spawnQ = isBuilder ? (academy ? academy.q : city.q) : (barracks ? barracks.q : city.q);
    const spawnR = isBuilder ? (academy ? academy.r : city.r) : (barracks ? barracks.r : city.r);

    const newUnit: Unit = {
      id: generateId('unit'), type, q: spawnQ, r: spawnR, ownerId: HUMAN_ID,
      hp: stats.maxHp, maxHp: stats.maxHp,
      xp: 0, level: 0,
      status: 'idle' as const, stance: 'aggressive' as const,
      nextMoveAt: 0,
      originCityId: cityId,
    };
    if (wantL2) newUnit.armsLevel = 2;
    if (wantL3 || type === 'defender') newUnit.armsLevel = 3;

    let updatedCities = s.cities;
    if (stoneCost > 0 || ironCost > 0) {
      updatedCities = s.cities.map(c => {
        if (c.id !== cityId) return c;
        const stone = Math.max(0, (c.storage.stone ?? 0) - stoneCost);
        const iron = Math.max(0, (c.storage.iron ?? 0) - ironCost);
        return { ...c, storage: { ...c.storage, stone, iron } };
      });
    }

    set({
      players: s.players.map(p => p.id === player.id ? { ...p, gold: p.gold - goldCost } : p),
      cities: updatedCities,
      units: [...s.units, newUnit],
    });
    const tierLabel = wantL3 ? 'L3 ' : wantL2 ? 'L2 ' : '';
    const costStr = ironCost > 0 ? (goldCost > 0 ? `${goldCost}g, ${ironCost} iron` : `${ironCost} iron`) : stoneCost > 0 ? `${goldCost}g, ${stoneCost} stone` : `${goldCost}g`;
    get().addNotification(`Recruited ${tierLabel}${UNIT_DISPLAY_NAMES[type]} (${costStr})`, 'success');
  },

  // ─── Recruit Hero ──────────────────────────────────────────

  recruitHero: (cityId) => {
    const s = get();
    const player = s.players.find(p => p.id === HUMAN_ID);
    const city = s.cities.find(c => c.id === cityId);
    if (!player || !city) return;

    // Check if player already has max heroes (1 per barracks across all cities)
    const playerBarracks = s.cities
      .filter(c => c.ownerId === HUMAN_ID)
      .reduce((sum, c) => sum + c.buildings.filter(b => b.type === 'barracks').length, 0);
    const playerHeroes = s.heroes.filter(h => h.ownerId === HUMAN_ID).length;
    if (playerHeroes >= playerBarracks) {
      get().addNotification('Need more Barracks for another hero!', 'warning');
      return;
    }

    const heroCost = 80;
    if (player.gold < heroCost) {
      get().addNotification(`Need ${heroCost} gold for a hero!`, 'warning');
      return;
    }

    const heroTypes: Array<'general' | 'logistician'> = ['general', 'logistician'];
    const pick = heroTypes[s.heroes.filter(h => h.ownerId === HUMAN_ID).length % heroTypes.length];

    set({
      players: s.players.map(p => p.id === HUMAN_ID ? { ...p, gold: p.gold - heroCost } : { ...p }),
      heroes: [...s.heroes, {
        id: generateId('hero'), name: nextHeroName(), type: pick,
        q: city.q, r: city.r, ownerId: HUMAN_ID,
        hp: HERO_BASE_HP, maxHp: HERO_BASE_HP,
      }],
    });
    get().addNotification(`Hero "${HERO_NAMES[(heroNameIdx - 1) % HERO_NAMES.length]}" recruited! (${pick})`, 'success');
  },

  setFoodPriority: (p) => set({ players: get().players.map(pl => pl.id === HUMAN_ID ? { ...pl, foodPriority: p } : pl) }),
  setTaxRate: (r) => set({ players: get().players.map(p => p.id === HUMAN_ID ? { ...p, taxRate: r } : p) }),

  startBuilderBuild: (mode) => {
    const s = get();
    if (!s.selectedHex) return;
    const buildersHere = s.units.filter(
      u => u.q === s.selectedHex!.q && u.r === s.selectedHex!.r && u.ownerId === HUMAN_ID && u.type === 'builder' && u.hp > 0
    );
    if (buildersHere.length === 0) {
      get().addNotification('Select a hex with a Builder first!', 'warning'); return;
    }
    const uiMode = mode === 'mine' ? 'build_mine' : mode === 'quarry' ? 'build_quarry' : mode === 'gold_mine' ? 'build_gold_mine' : 'build_road';
    set({ uiMode, roadPathSelection: [] });
    if (mode === 'mine') get().addNotification('Click a highlighted mine deposit to build.', 'info');
    else if (mode === 'quarry') get().addNotification('Click a highlighted quarry deposit to build.', 'info');
    else if (mode === 'gold_mine') get().addNotification('Click a highlighted gold deposit to build.', 'info');
    else get().addNotification('Click hexes to select road path, then Confirm when done.', 'info');
  },

  cancelBuilderBuild: () => {
    set({ uiMode: 'normal', roadPathSelection: [] });
  },

  buildWallRing: (cityId, ring) => {
    const s = get();
    const city = s.cities.find(c => c.id === cityId);
    if (!city || city.ownerId !== HUMAN_ID) return;
    const ringHexes = getHexRing(city.q, city.r, ring);
    const validHexes: { q: number; r: number }[] = [];
    for (const { q, r } of ringHexes) {
      const tile = s.tiles.get(tileKey(q, r));
      if (!tile || tile.biome === 'water') continue;
      if (s.wallSections.some(w => tileKey(w.q, w.r) === tileKey(q, r) && w.ownerId === HUMAN_ID)) continue;
      validHexes.push({ q, r });
    }
    if (validHexes.length === 0) {
      get().addNotification(`No valid hexes for wall ring ${ring} around ${city.name}.`, 'warning');
      return;
    }
    const totalCost = validHexes.length * WALL_SECTION_STONE_COST;
    const humanCities = s.cities.filter(c => c.ownerId === HUMAN_ID);
    const totalStone = humanCities.reduce((sum, c) => sum + (c.storage.stone ?? 0), 0);
    if (totalStone < totalCost) {
      get().addNotification(`Need ${totalCost - totalStone} more stone (${totalCost} for ${validHexes.length} sections).`, 'warning');
      return;
    }
    const newSections: WallSection[] = validHexes.map(({ q, r }) => ({
      q, r, ownerId: HUMAN_ID, hp: WALL_SECTION_HP, maxHp: WALL_SECTION_HP,
    }));
    let toDeduct = totalCost;
    const updatedCities = s.cities.map(c => {
      if (c.ownerId !== HUMAN_ID || toDeduct <= 0) return c;
      const have = c.storage.stone ?? 0;
      const take = Math.min(have, toDeduct);
      toDeduct -= take;
      return { ...c, storage: { ...c.storage, stone: Math.max(0, have - take) } };
    });
    set({ wallSections: [...s.wallSections, ...newSections], cities: updatedCities });
    get().addNotification(`Built wall ring ${ring} around ${city.name} (${newSections.length} sections).`, 'success');
  },

  builderSelectDeposit: (q, r, type) => {
    const s = get();
    if (!s.selectedHex) return;
    const tile = s.tiles.get(tileKey(q, r));
    if (!tile || tile.biome === 'water') return;
    if (type !== 'gold_mine' && tile.biome === 'mountain') return;
    const hasDeposit = type === 'mine' ? tile.hasMineDeposit : type === 'quarry' ? tile.hasQuarryDeposit : tile.hasGoldMineDeposit;
    const typeLabel = type === 'mine' ? 'Mine' : type === 'quarry' ? 'Quarry' : 'Gold mine';
    if (!hasDeposit) {
      get().addNotification(`${typeLabel} must be built on a deposit!`, 'warning'); return;
    }
    const hexKey = tileKey(q, r);
    if (s.cities.some(c => c.buildings.some(b => tileKey(b.q, b.r) === hexKey))) {
      get().addNotification('Already a building there!', 'warning'); return;
    }
    if (s.constructions.some(cs => cs.q === q && cs.r === r)) {
      get().addNotification('Already under construction!', 'warning'); return;
    }
    const player = s.players.find(p => p.id === HUMAN_ID);
    if (!player || player.gold < BUILDING_COSTS[type]) {
      get().addNotification('Not enough gold!', 'warning'); return;
    }
    let cityId: string | undefined;
    let bestDist = Infinity;
    for (const c of s.cities) {
      if (c.ownerId !== HUMAN_ID) continue;
      const d = hexDistance(c.q, c.r, q, r);
      if (d < bestDist) { bestDist = d; cityId = c.id; }
    }
    if (!cityId) { get().addNotification('No city to assign building!', 'warning'); return; }
    const city = s.cities.find(c => c.id === cityId)!;
    if (city.population < 10) {
      get().addNotification('Need 10 population at nearest city!', 'warning'); return;
    }
    const ironCost = BUILDING_IRON_COSTS[type] ?? 0;
    if (ironCost > 0 && (city.storage.iron ?? 0) < ironCost) {
      get().addNotification(`Need ${ironCost} iron at nearest city for Gold mine!`, 'warning'); return;
    }
    const builders = s.units.filter(
      u => u.q === s.selectedHex!.q && u.r === s.selectedHex!.r && u.ownerId === HUMAN_ID && u.type === 'builder' && u.hp > 0
    );
    if (builders.length === 0) { get().addNotification('Need a Builder!', 'warning'); return; }
    const builder = builders[0];
    const site: ConstructionSite = {
      id: generateId('con'), type, q, r, cityId, ownerId: HUMAN_ID,
      bpRequired: BUILDING_BP_COST[type], bpAccumulated: 0,
    };
    const newUnits = s.units.map(u =>
      u.id === builder.id ? { ...u, targetQ: q, targetR: r, status: 'moving' as const } : u
    );
    const updatedCities = s.cities.map(c =>
      c.id === cityId && ironCost > 0
        ? { ...c, storage: { ...c.storage, iron: Math.max(0, (c.storage.iron ?? 0) - ironCost) } }
        : c
    );
    set({
      constructions: [...s.constructions, site],
      cities: updatedCities,
      players: s.players.map(p => p.id === HUMAN_ID ? { ...p, gold: p.gold - BUILDING_COSTS[type] } : p),
      units: newUnits,
      uiMode: 'normal',
    });
    get().addNotification(`${typeLabel} construction started! Builder en route.`, 'success');
  },

  addRoadPathHex: (q, r) => {
    const s = get();
    if (s.uiMode !== 'build_road') return;
    const tile = s.tiles.get(tileKey(q, r));
    if (!tile || tile.biome === 'water') return;  // allow roads on mountains for mine connectivity
    if (tile.hasRoad) return;
    if (s.roadConstructions.some(rc => rc.q === q && rc.r === r)) return;
    const key = tileKey(q, r);
    const idx = s.roadPathSelection.findIndex(h => tileKey(h.q, h.r) === key);
    if (idx >= 0) {
      const sel = [...s.roadPathSelection];
      sel.splice(idx, 1);
      set({ roadPathSelection: sel });
    } else {
      set({ roadPathSelection: [...s.roadPathSelection, { q, r }] });
    }
  },

  confirmRoadPath: () => {
    const s = get();
    if (s.uiMode !== 'build_road' || s.roadPathSelection.length === 0) {
      set({ uiMode: 'normal', roadPathSelection: [] }); return;
    }
    const newSites: RoadConstructionSite[] = [];
    for (const { q, r } of s.roadPathSelection) {
      const tile = s.tiles.get(tileKey(q, r));
      if (!tile || tile.biome === 'water') continue;  // allow roads on mountains for mine connectivity
      if (tile.hasRoad) continue;
      if (s.roadConstructions.some(rc => rc.q === q && rc.r === r)) continue;
      newSites.push({ id: generateId('road'), q, r, ownerId: HUMAN_ID, bpRequired: ROAD_BP_COST, bpAccumulated: 0 });
    }
    if (newSites.length === 0) {
      set({ uiMode: 'normal', roadPathSelection: [] }); return;
    }
    // Use builders at selected hex, or any human builders on the map (so path mode works without strict selection)
    const buildersAtSelected = s.selectedHex
      ? s.units.filter(
          u => u.q === s.selectedHex!.q && u.r === s.selectedHex!.r && u.ownerId === HUMAN_ID && u.type === 'builder' && u.hp > 0
        )
      : [];
    const builders = buildersAtSelected.length > 0
      ? buildersAtSelected
      : s.units.filter(u => u.ownerId === HUMAN_ID && u.type === 'builder' && u.hp > 0);
    // Order sites by distance from first builder / center of selection so builders reach them in sensible order
    const fromQ = builders[0]?.q ?? s.roadPathSelection[0]?.q ?? 0;
    const fromR = builders[0]?.r ?? s.roadPathSelection[0]?.r ?? 0;
    newSites.sort((a, b) =>
      hexDistance(fromQ, fromR, a.q, a.r) - hexDistance(fromQ, fromR, b.q, b.r)
    );
    let newUnits = s.units;
    if (builders.length > 0 && newSites.length > 0) {
      // Send builders to road sites — distribute (builder i -> site i % n); when one completes they auto-reassign to next
      newUnits = s.units.map(u => {
        const idx = builders.findIndex(b => b.id === u.id);
        if (idx < 0) return u;
        const site = newSites[idx % newSites.length];
        return { ...u, targetQ: site.q, targetR: site.r, status: 'moving' as const };
      });
    }
    set({
      roadConstructions: [...s.roadConstructions, ...newSites],
      units: newUnits,
      uiMode: 'normal',
      roadPathSelection: [],
    });
    get().addNotification(`Road construction started for ${newSites.length} hex(es). Builder en route.`, 'success');
  },
  setSupplyViewTab: (tab) => set({ supplyViewTab: tab, selectedClusterKey: tab === 'normal' ? null : get().selectedClusterKey }),
  setSelectedClusterKey: (key) => set({ selectedClusterKey: key }),

  // ─── Unit Movement (set target — movement tick advances them) ─

  setPendingMove: (toQ, toR) => {
    const s = get();
    if (!s.selectedHex) { set({ uiMode: 'normal' }); return; }

    const { q: fromQ, r: fromR } = s.selectedHex;
    const dist = hexDistance(fromQ, fromR, toQ, toR);
    if (dist === 0 || dist > 10) {
      if (dist > 10) get().addNotification('Too far! Max 10 hexes per move order.', 'warning');
      return;
    }
    const destTile = s.tiles.get(tileKey(toQ, toR));
    if (!destTile || destTile.biome === 'water') {
      get().addNotification('Cannot move there!', 'warning');
      return;
    }
    set({ pendingMove: { toQ, toR } });
  },

  confirmMove: () => {
    const s = get();
    if (!s.pendingMove) return;
    get().moveSelectedUnits(s.pendingMove.toQ, s.pendingMove.toR);
    set({ pendingMove: null });
  },

  cancelMove: () => {
    set({ pendingMove: null });
  },

  moveSelectedUnits: (toQ, toR) => {
    const s = get();
    if (!s.selectedHex) { set({ uiMode: 'normal' }); return; }

    const { q: fromQ, r: fromR } = s.selectedHex;
    const readyUnits = s.units.filter(
      u => u.q === fromQ && u.r === fromR && u.ownerId === HUMAN_ID && u.hp > 0
    );
    if (readyUnits.length === 0) {
      set({ uiMode: 'normal', selectedHex: null }); return;
    }

    const dist = hexDistance(fromQ, fromR, toQ, toR);
    if (dist === 0) { set({ uiMode: 'normal', selectedHex: null }); return; }

    const destTile = s.tiles.get(tileKey(toQ, toR));
    if (!destTile || destTile.biome === 'water') {
      get().addNotification('Cannot move there!', 'warning');
      set({ uiMode: 'normal', selectedHex: null }); return;
    }

    // Set target for all selected units — movement tick will advance them
    const newUnits = s.units.map(u => {
      if (u.q === fromQ && u.r === fromR && u.ownerId === HUMAN_ID && u.hp > 0) {
        return { ...u, targetQ: toQ, targetR: toR, status: 'moving' as const };
      }
      return u;
    });

    // Also move heroes at the same hex
    const newHeroes = s.heroes.map(h => {
      if (h.q === fromQ && h.r === fromR && h.ownerId === HUMAN_ID) {
        return { ...h }; // Heroes follow their army via a separate mechanism
      }
      return h;
    });

    set({ units: newUnits, heroes: newHeroes, selectedHex: null, uiMode: 'normal' });
    get().addNotification(`Army moving to (${toQ}, ${toR})`, 'info');
  },

  // ─── Stance ─────────────────────────────────────────────────

  setStance: (stance) => {
    const s = get();
    if (!s.selectedHex) return;
    const { q, r } = s.selectedHex;
    set({
      units: s.units.map(u =>
        u.q === q && u.r === r && u.ownerId === HUMAN_ID ? { ...u, stance } : u
      ),
    });
    get().addNotification(`Stance set to ${stance}`, 'info');
  },

  startDefendMode: () => set({ uiMode: 'defend' }),
  startInterceptMode: () => set({ uiMode: 'intercept' }),

  setDefendCity: (cityId) => {
    const s = get();
    if (!s.selectedHex) return;
    const city = s.cities.find(c => c.id === cityId && c.ownerId === HUMAN_ID);
    if (!city) { get().addNotification('Select a friendly city to defend!', 'warning'); return; }
    const { q, r } = s.selectedHex;
    const newUnits = s.units.map(u =>
      u.q === q && u.r === r && u.ownerId === HUMAN_ID && u.hp > 0
        ? { ...u, defendCityId: cityId, targetQ: city.q, targetR: city.r, status: 'moving' as const }
        : u
    );
    set({ units: newUnits, uiMode: 'normal' });
    get().addNotification(`Stack defending ${city.name}`, 'info');
  },

  setRetreat: () => {
    const s = get();
    if (!s.selectedHex) return;
    const { q, r } = s.selectedHex;
    const at = Date.now() + RETREAT_DELAY_MS;
    set({
      units: s.units.map(u =>
        u.q === q && u.r === r && u.ownerId === HUMAN_ID && u.hp > 0 ? { ...u, retreatAt: at } : u
      ),
    });
    get().addNotification('Retreat ordered (2s delay)', 'warning');
  },

  setRetreatStack: (q, r) => {
    const s = get();
    const at = Date.now() + RETREAT_DELAY_MS;
    set({
      units: s.units.map(u =>
        u.q === q && u.r === r && u.ownerId === HUMAN_ID && u.hp > 0 ? { ...u, retreatAt: at } : u
      ),
    });
    get().addNotification('Retreat ordered (2s delay)', 'warning');
  },

  openTacticalMode: () => {
    set({ pendingTacticalOrders: {}, tacticalSelectedStackKeys: [], assigningTacticalForSelectedStacks: null, assigningTacticalForStack: null, assigningTacticalOrderType: null });
  },

  cancelTacticalMode: () => {
    set({ pendingTacticalOrders: null, tacticalSelectedStackKeys: [], assigningTacticalForSelectedStacks: null, assigningTacticalForStack: null, assigningTacticalOrderType: null });
  },

  setTacticalOrder: (stackKey, order) => {
    const s = get();
    if (s.pendingTacticalOrders === null) return;
    const next = { ...s.pendingTacticalOrders };
    if (order === null) delete next[stackKey];
    else next[stackKey] = order;
    set({ pendingTacticalOrders: next });
  },

  startTacticalMoveForStack: (stackKey, orderType = 'move') => {
    set({ assigningTacticalForStack: stackKey, assigningTacticalOrderType: orderType });
  },

  setTacticalSelectedStackKeys: (keys) => {
    set({ tacticalSelectedStackKeys: keys });
  },

  toggleTacticalStack: (stackKey) => {
    const s = get();
    const next = s.tacticalSelectedStackKeys.includes(stackKey)
      ? s.tacticalSelectedStackKeys.filter(k => k !== stackKey)
      : [...s.tacticalSelectedStackKeys, stackKey];
    set({ tacticalSelectedStackKeys: next });
  },

  startTacticalOrderForSelected: (orderType) => {
    const s = get();
    if (s.pendingTacticalOrders === null) return;
    const humanKeys = new Set<string>();
    for (const u of s.units) {
      if (u.ownerId === HUMAN_ID && u.hp > 0) humanKeys.add(tileKey(u.q, u.r));
    }
    const stackKeys = s.tacticalSelectedStackKeys.length > 0
      ? s.tacticalSelectedStackKeys.filter(k => humanKeys.has(k))
      : Array.from(humanKeys);
    if (stackKeys.length === 0) {
      get().addNotification('Select at least one army in the list, or use orders to assign to all.', 'warning');
      return;
    }
    set({ assigningTacticalForSelectedStacks: { orderType, stackKeys }, assigningTacticalForStack: null, assigningTacticalOrderType: null });
  },

  setTacticalMoveTargetForSelected: (toQ, toR) => {
    const s = get();
    const pending = s.assigningTacticalForSelectedStacks;
    if (!pending || s.pendingTacticalOrders === null) return;
    const { orderType, stackKeys } = pending;
    const tile = s.tiles.get(tileKey(toQ, toR));
    if (!tile || tile.biome === 'water') return;
    const next = { ...s.pendingTacticalOrders };
    for (const stackKey of stackKeys) {
      const [fromQ, fromR] = stackKey.split(',').map(Number);
      const dist = hexDistance(fromQ, fromR, toQ, toR);
      if (dist <= 10 && dist > 0) next[stackKey] = { type: orderType, toQ, toR };
    }
    set({ pendingTacticalOrders: next, assigningTacticalForSelectedStacks: null });
    get().addNotification(`${stackKeys.length} stack(s) → (${toQ}, ${toR}). Confirm when ready.`, 'info');
  },

  setTacticalDefendForSelected: (cityId) => {
    const s = get();
    if (s.pendingTacticalOrders === null) return;
    const humanKeys = new Set<string>();
    for (const u of s.units) {
      if (u.ownerId === HUMAN_ID && u.hp > 0) humanKeys.add(tileKey(u.q, u.r));
    }
    const stackKeys = s.tacticalSelectedStackKeys.length > 0
      ? s.tacticalSelectedStackKeys.filter(k => humanKeys.has(k))
      : Array.from(humanKeys);
    if (stackKeys.length === 0) return;
    const next = { ...s.pendingTacticalOrders };
    for (const k of stackKeys) next[k] = { type: 'defend', cityId };
    set({ pendingTacticalOrders: next });
    get().addNotification(`${stackKeys.length} stack(s) set to defend. Confirm when ready.`, 'info');
  },

  clearTacticalOrdersForSelected: () => {
    const s = get();
    if (s.pendingTacticalOrders === null) return;
    const humanKeys = new Set(s.tacticalSelectedStackKeys);
    if (humanKeys.size === 0) return;
    const next = { ...s.pendingTacticalOrders };
    for (const k of humanKeys) delete next[k];
    set({ pendingTacticalOrders: next });
  },

  setTacticalMoveTarget: (toQ, toR) => {
    const s = get();
    const stackKey = s.assigningTacticalForStack;
    const orderType = s.assigningTacticalOrderType ?? 'move';
    if (stackKey === null || s.pendingTacticalOrders === null) return;
    const [fromQ, fromR] = stackKey.split(',').map(Number);
    const dist = hexDistance(fromQ, fromR, toQ, toR);
    if (dist > 10) {
      get().addNotification('Too far! Max 10 hexes per move order.', 'warning');
      set({ assigningTacticalForStack: null, assigningTacticalOrderType: null });
      return;
    }
    const next = { ...s.pendingTacticalOrders, [stackKey]: { type: orderType, toQ, toR } };
    set({ pendingTacticalOrders: next, assigningTacticalForStack: null, assigningTacticalOrderType: null });
  },

  confirmTacticalOrders: () => {
    const s = get();
    if (s.pendingTacticalOrders === null) return;
    const orders = s.pendingTacticalOrders;
    let units = s.units;
    const notifs: string[] = [];
    for (const stackKey of Object.keys(orders)) {
      const order = orders[stackKey];
      if (!order) continue;
      const [fromQ, fromR] = stackKey.split(',').map(Number);
      const stackUnits = units.filter(u => u.q === fromQ && u.r === fromR && u.ownerId === HUMAN_ID && u.hp > 0);
      if (stackUnits.length === 0) continue;
      if (order.type === 'defend' && order.cityId) {
        const city = s.cities.find(c => c.id === order.cityId && c.ownerId === HUMAN_ID);
        if (!city) continue;
        units = units.map(u =>
          u.q === fromQ && u.r === fromR && u.ownerId === HUMAN_ID && u.hp > 0
            ? { ...u, defendCityId: city.id, targetQ: city.q, targetR: city.r, status: 'moving' as const }
            : u
        );
        notifs.push(`Stack at (${fromQ},${fromR}) defending ${city.name}`);
      } else if ((order.type === 'move' || order.type === 'intercept') && order.toQ !== undefined && order.toR !== undefined) {
        const tile = s.tiles.get(tileKey(order.toQ, order.toR));
        if (!tile || tile.biome === 'water') continue;
        const dist = hexDistance(fromQ, fromR, order.toQ, order.toR);
        if (dist > 10 || dist === 0) continue;
        units = units.map(u =>
          u.q === fromQ && u.r === fromR && u.ownerId === HUMAN_ID && u.hp > 0
            ? { ...u, targetQ: order.toQ, targetR: order.toR, status: 'moving' as const }
            : u
        );
        notifs.push(`Stack at (${fromQ},${fromR}) → (${order.toQ},${order.toR})`);
      }
    }
    set({ units, pendingTacticalOrders: null, tacticalSelectedStackKeys: [], assigningTacticalForSelectedStacks: null, assigningTacticalForStack: null, assigningTacticalOrderType: null });
    if (notifs.length > 0) get().addNotification(`Orders: ${notifs.join('; ')}`, 'info');
  },

  disbandSelectedUnits: () => {
    const s = get();
    if (!s.selectedHex) return;
    const { q, r } = s.selectedHex;
    const toRemove = s.units.filter(u => u.q === q && u.r === r && u.ownerId === HUMAN_ID && u.hp > 0);
    if (toRemove.length === 0) return;
    const popByCity: Record<string, number> = {};
    for (const u of toRemove) {
      if (u.originCityId) popByCity[u.originCityId] = (popByCity[u.originCityId] ?? 0) + 1;
    }
    const ids = new Set(toRemove.map(u => u.id));
    const newUnits = s.units.filter(u => !ids.has(u.id));
    const newCities = Object.keys(popByCity).length === 0 ? s.cities : s.cities.map(c => {
      const add = popByCity[c.id] ?? 0;
      return add > 0 ? { ...c, population: c.population + add } : c;
    });
    set({ units: newUnits, cities: newCities, selectedHex: null, uiMode: 'normal' });
    get().addNotification(`Disbanded ${toRemove.length} unit(s); population returned.`, 'info');
  },

  startSplitStack: (count) => {
    const s = get();
    if (!s.selectedHex) return;
    const { q: fromQ, r: fromR } = s.selectedHex;
    const stack = s.units.filter(u => u.q === fromQ && u.r === fromR && u.ownerId === HUMAN_ID && u.hp > 0);
    const n = Math.max(1, Math.min(count, stack.length - 1));
    if (n >= stack.length) {
      get().addNotification('Split must leave at least one unit in the stack.', 'warning');
      return;
    }
    set({ splitStackPending: { fromQ, fromR, count: n } });
    get().addNotification(`Splitting ${n} unit(s). Click an adjacent hex to place them.`, 'info');
  },

  cancelSplitStack: () => {
    set({ splitStackPending: null });
  },

  splitStackToHex: (toQ, toR) => {
    const s = get();
    const pending = s.splitStackPending;
    if (!pending) return;
    const { fromQ, fromR, count } = pending;
    const stack = s.units.filter(u => u.q === fromQ && u.r === fromR && u.ownerId === HUMAN_ID && u.hp > 0);
    const toMove = stack.slice(0, count);
    const ids = new Set(toMove.map(u => u.id));
    const newUnits = s.units.map(u =>
      ids.has(u.id)
        ? { ...u, q: toQ, r: toR, targetQ: undefined, targetR: undefined, status: 'idle' as const }
        : u
    );
    set({ units: newUnits, splitStackPending: null });
    get().addNotification(`Split ${count} unit(s) to (${toQ}, ${toR}).`, 'info');
  },

  setSiegeAssault: (assault) => {
    const s = get();
    if (!s.selectedHex) return;
    const { q, r } = s.selectedHex;
    set({
      units: s.units.map(u =>
        u.q === q && u.r === r && u.ownerId === HUMAN_ID && u.hp > 0 ? { ...u, assaulting: assault } : u
      ),
    });
    get().addNotification(assault ? 'Siege: Assault mode (attack debuff)' : 'Siege: Assault cancelled', 'info');
  },

  // ─── Burn / Capture City ──────────────────────────────────

  burnCity: (cityId) => {
    const s = get();
    const city = s.cities.find(c => c.id === cityId);
    if (!city) return;

    // Verify player has units on city's hex
    const hasArmy = s.units.some(u => u.q === city.q && u.r === city.r && u.ownerId === HUMAN_ID && u.hp > 0);
    if (!hasArmy) { get().addNotification('Need an army on the city!', 'warning'); return; }

    set({
      cities: s.cities.map(c => c.id !== cityId ? c : { ...c, population: Math.max(1, Math.floor(c.population / 2)) }),
    });
    get().addNotification(`${city.name} burned! Population halved.`, 'danger');
  },

  captureCity: (cityId) => {
    const s = get();
    const city = s.cities.find(c => c.id === cityId);
    if (!city) return;

    const hasArmy = s.units.some(u => u.q === city.q && u.r === city.r && u.ownerId === HUMAN_ID && u.hp > 0);
    if (!hasArmy) { get().addNotification('Need an army on the city!', 'warning'); return; }

    const newCities = s.cities.map(c => c.id !== cityId ? c : { ...c, ownerId: HUMAN_ID });
    const territory = calculateTerritory(newCities, s.tiles);

    // Check victory
    const aiCities = newCities.filter(c => c.ownerId === AI_ID);
    let phase: GamePhase = s.phase;
    const newNotifs = [...s.notifications];
    if (aiCities.length === 0) {
      phase = 'victory'; clearAllTimers();
      newNotifs.push({ id: generateId('n'), turn: s.cycle, message: 'Victory! You conquered the rival empire!', type: 'success' });
    } else {
      newNotifs.push({ id: generateId('n'), turn: s.cycle, message: `${city.name} captured!`, type: 'success' });
    }

    set({ cities: newCities, territory, phase, notifications: newNotifs.slice(-12) });
  },

  incorporateVillage: (q, r) => {
    const s = get();
    const player = s.players.find(p => p.id === HUMAN_ID);
    if (!player) return;

    // Verify tile is a village
    const tile = s.tiles.get(tileKey(q, r));
    if (!tile || !tile.hasVillage) {
      get().addNotification('No village here!', 'warning');
      return;
    }

    // Must have military units present (not builders)
    const militaryHere = s.units.filter(
      u => u.q === q && u.r === r && u.ownerId === HUMAN_ID && u.hp > 0 && u.type !== 'builder'
    );
    if (militaryHere.length === 0) {
      get().addNotification('Need military units at this village!', 'warning');
      return;
    }

    // Check gold
    if (player.gold < VILLAGE_INCORPORATE_COST) {
      get().addNotification(`Need ${VILLAGE_INCORPORATE_COST} gold to incorporate village!`, 'warning');
      return;
    }

    // Check no city already at this hex
    if (s.cities.some(c => c.q === q && c.r === r)) {
      get().addNotification('Already a city here!', 'warning');
      return;
    }

    // Deduct gold
    const newPlayers = s.players.map(p =>
      p.id === HUMAN_ID ? { ...p, gold: p.gold - VILLAGE_INCORPORATE_COST } : p
    );

    // Create a new small city from the village (frontier city for 3 cycles)
    const newCity: City = {
      id: generateId('city'),
      name: nextCityName(),
      q, r,
      ownerId: HUMAN_ID,
      ...structuredClone(VILLAGE_CITY_TEMPLATE),
      frontierCity: FRONTIER_CYCLES,
    };
    newCity.buildings = [{ type: 'city_center', q, r, assignedWorkers: 0 }];
    newCity.storageCap = { ...CITY_CENTER_STORAGE };

    const newCities = [...s.cities, newCity];

    // Remove the village flag from the tile
    const newTiles = new Map(s.tiles);
    newTiles.set(tileKey(q, r), { ...tile, hasVillage: false });

    // Recalculate territory and vision
    const territory = calculateTerritory(newCities, newTiles);
    const visibleHexes = computeVisibleHexes(HUMAN_ID, newCities, s.units, s.heroes, newTiles, s.scoutTowers ?? []);

    set({
      players: newPlayers,
      cities: newCities,
      tiles: newTiles,
      territory,
      visibleHexes,
      notifications: [
        ...s.notifications.slice(-8),
        {
          id: generateId('n'),
          turn: s.cycle,
          message: `Village incorporated as ${newCity.name}! (Pop 10, +${VILLAGE_INCORPORATE_COST}g)`,
          type: 'success',
        },
      ],
    });
  },

  sendScout: (q, r) => {
    const s = get();
    const player = s.players.find(p => p.id === HUMAN_ID);
    if (!player) return;

    if (player.gold < SCOUT_MISSION_COST) {
      get().addNotification(`Need ${SCOUT_MISSION_COST} gold to send a scout!`, 'warning');
      return;
    }

    const key = tileKey(q, r);
    if (s.scoutedHexes.has(key)) {
      get().addNotification('This hex has already been scouted!', 'warning');
      return;
    }
    if (s.scoutMissions.some(m => m.targetQ === q && m.targetR === r)) {
      get().addNotification('A scout is already en route!', 'warning');
      return;
    }

    const newPlayers = s.players.map(p =>
      p.id === HUMAN_ID ? { ...p, gold: p.gold - SCOUT_MISSION_COST } : p
    );

    const mission: ScoutMission = {
      id: generateId('scout'),
      targetQ: q,
      targetR: r,
      completesAt: Date.now() + SCOUT_MISSION_DURATION_SEC * 1000,
    };

    set({
      players: newPlayers,
      scoutMissions: [...s.scoutMissions, mission],
      notifications: [
        ...s.notifications.slice(-8),
        { id: generateId('n'), turn: s.cycle, message: `Scout dispatched to (${q}, ${r}) — ${SCOUT_MISSION_DURATION_SEC}s`, type: 'info' },
      ],
    });
  },

  // ─── Notifications ──────────────────────────────────────────

  addNotification: (message, type) => {
    const s = get();
    set({ notifications: [...s.notifications.slice(-11), { id: generateId('n'), turn: s.cycle, message, type }] });
  },

  // ─── Helpers ────────────────────────────────────────────────

  getHumanPlayer: () => get().players.find(p => p.id === HUMAN_ID),
  getCityAt: (q, r) => get().cities.find(c => c.q === q && c.r === r),
  getUnitsAt: (q, r) => get().units.filter(u => u.q === q && u.r === r),
  getHeroAt: (q, r) => get().heroes.find(h => h.q === q && h.r === r),
  getSelectedCity: () => {
    const s = get();
    return s.selectedHex ? s.cities.find(c => c.q === s.selectedHex!.q && c.r === s.selectedHex!.r && c.ownerId === HUMAN_ID) : undefined;
  },
  getSelectedCityForDisplay: () => {
    const s = get();
    return s.selectedHex ? s.cities.find(c => c.q === s.selectedHex!.q && c.r === s.selectedHex!.r) : undefined;
  },
  getSelectedUnits: () => {
    const s = get();
    return s.selectedHex ? s.units.filter(u => u.q === s.selectedHex!.q && u.r === s.selectedHex!.r && u.ownerId === HUMAN_ID) : [];
  },
  getEnemyCityAt: (q, r) => {
    return get().cities.find(c => c.q === q && c.r === r && c.ownerId !== HUMAN_ID);
  },
  getBarracksCityAt: (q, r) => {
    const key = tileKey(q, r);
    for (const city of get().cities) {
      if (city.ownerId !== HUMAN_ID) continue;
      if (city.buildings.some(b => b.type === 'barracks' && tileKey(b.q, b.r) === key)) {
        return city;
      }
    }
    return undefined;
  },
  getFactoryAt: (q, r) => {
    const key = tileKey(q, r);
    for (const city of get().cities) {
      if (city.ownerId !== HUMAN_ID) continue;
      const building = city.buildings.find(b => b.type === 'factory' && tileKey(b.q, b.r) === key);
      if (building) return { city, building };
    }
    return undefined;
  },
  getAcademyAt: (q, r) => {
    const key = tileKey(q, r);
    for (const city of get().cities) {
      if (city.ownerId !== HUMAN_ID) continue;
      const building = city.buildings.find(b => b.type === 'academy' && tileKey(b.q, b.r) === key);
      if (building) return { city, building };
    }
    return undefined;
  },
  getQuarryMineAt: (q, r) => {
    const key = tileKey(q, r);
    for (const city of get().cities) {
      if (city.ownerId !== HUMAN_ID) continue;
      const building = city.buildings.find(b => (b.type === 'quarry' || b.type === 'mine' || b.type === 'gold_mine') && tileKey(b.q, b.r) === key);
      if (building) return { city, building };
    }
    return undefined;
  },
  getJobBuildingAt: (q, r) => {
    const key = tileKey(q, r);
    const jobTypes: BuildingType[] = ['farm', 'factory', 'market', 'quarry', 'mine', 'gold_mine', 'city_center', 'barracks', 'academy'];
    for (const city of get().cities) {
      if (city.ownerId !== HUMAN_ID) continue;
      const building = city.buildings.find(b => jobTypes.includes(b.type) && tileKey(b.q, b.r) === key);
      if (building && getBuildingJobs(building) > 0) return { city, building };
    }
    return undefined;
  },
  isInPlayerTerritory: (q, r) => {
    const info = get().territory.get(tileKey(q, r));
    return !!info && info.playerId === HUMAN_ID;
  },
  hasBuildingAt: (q, r) => {
    const key = tileKey(q, r);
    return get().cities.some(c => c.buildings.some(b => tileKey(b.q, b.r) === key))
      || get().constructions.some(cs => tileKey(cs.q, cs.r) === key);
  },
  hasConstructionAt: (q, r) => {
    const key = tileKey(q, r);
    return get().constructions.some(cs => tileKey(cs.q, cs.r) === key);
  },
  hasRoadConstructionAt: (q, r) => {
    return get().roadConstructions.some(rc => rc.q === q && rc.r === r);
  },
  getConstructionAt: (q, r) => {
    const key = tileKey(q, r);
    return get().constructions.find(cs => tileKey(cs.q, cs.r) === key);
  },
  isHexVisible: (q, r) => get().visibleHexes.has(tileKey(q, r)),
  isHexScouted: (q, r) => get().scoutedHexes.has(tileKey(q, r)),
  getScoutMissionAt: (q, r) => get().scoutMissions.find(m => m.targetQ === q && m.targetR === r),
  getSupplyConnectionPaths: () => {
    const s = get();
    const clusters = computeTradeClusters(s.cities, s.tiles, s.units, s.territory);
    return computeConnectionPaths(clusters, s.tiles, s.units);
  },
  getSupplyClustersWithPaths: () => {
    const s = get();
    const clusters = computeTradeClusters(s.cities, s.tiles, s.units, s.territory);
    const withClusters = computeConnectionPathsWithClusters(clusters, s.tiles, s.units);
    return withClusters.get(HUMAN_ID) ?? [];
  },
  getSupplyClustersWithHealth: () => {
    const s = get();
    const entries = s.getSupplyClustersWithPaths();
    return entries.map(e => {
      const stmt = s.getClusterIncomeStatement(e.clusterKey);
      return { ...e, foodSurplus: stmt?.foodSurplus ?? true };
    });
  },
  getClusterForHex: (q, r) => {
    const s = get();
    const entries = s.getSupplyClustersWithPaths();
    const city = s.cities.find(c => c.q === q && c.r === r && c.ownerId === HUMAN_ID);
    if (city) {
      const found = entries.find(e => e.cluster.cityIds.includes(city.id));
      return found?.clusterKey ?? null;
    }
    for (const { clusterKey, paths } of entries) {
      for (const path of paths) {
        if (path.some(h => h.q === q && h.r === r)) return clusterKey;
      }
    }
    return null;
  },
  getClusterIncomeStatement: (clusterKey) => {
    const s = get();
    const entries = s.getSupplyClustersWithPaths();
    const entry = entries.find(e => e.clusterKey === clusterKey);
    if (!entry) return null;
    const harvestMult = getWeatherHarvestMultiplier(s.activeWeather);
    return computeClusterIncomeStatement(
      entry.cluster, s.cities, s.units, s.tiles, s.territory, s.heroes, HUMAN_ID, harvestMult
    );
  },

  // ─── Vision ──────────────────────────────────────────────
  recomputeVision: () => {
    const s = get();
    if (s.gameMode === 'bot_vs_bot') {
      const allKeys = new Set<string>();
      s.tiles.forEach((_, key) => allKeys.add(key));
      set({ visibleHexes: allKeys });
    } else {
      const newVisible = computeVisibleHexes(HUMAN_ID, s.cities, s.units, s.heroes, s.tiles, s.scoutTowers ?? []);
      set({ visibleHexes: newVisible });
    }
  },
}));
