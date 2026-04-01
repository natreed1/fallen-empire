import { create } from 'zustand';
import {
  Tile, MapConfig, DEFAULT_MAP_CONFIG, City, Unit, Player, Hero,
  GameNotification, TerritoryInfo, GamePhase, UIMode, FoodPriority,
  BuildingType, UnitType, ArmyStance, CityBuilding, ConstructionSite, ScoutMission, ScoutTower,
  DefenseInstallation, DefenseTowerType, DefenseTowerLevel,
  DEFENSE_TOWER_MAX_PER_CITY, DEFENSE_TOWER_LEVEL_COSTS, getDefenseTowerBpCost, DEFENSE_TOWER_DISPLAY_NAME,
  WeatherEvent, WallSection, RoadConstructionSite, ROAD_BP_COST,
  tileKey, generateId, hexDistance, hexNeighbors, getHexRing, hexTouchesBiome,
  STARTING_GOLD, STARTING_CITY_TEMPLATE, VILLAGE_CITY_TEMPLATE, VILLAGE_INCORPORATE_COST,
  CITY_CENTER_STORAGE, FRONTIER_CYCLES,
  isNavalUnitType, SHIP_RECRUIT_COSTS, getShipMaxCargo,
  PLAYER_COLORS, CITY_NAMES,
  BUILDING_COSTS, UNIT_COSTS, UNIT_L2_COSTS, UNIT_L3_COSTS, UNIT_BASE_STATS, UNIT_L2_STATS, UNIT_DISPLAY_NAMES, HERO_NAMES,
  BUILDING_BP_COST, BUILDING_JOBS, getBuildingJobs, getUnitStats, CITY_BUILDING_POWER, BUILDER_POWER, BP_RATE_BASE,
  TREBUCHET_FIELD_BP_COST, TREBUCHET_FIELD_GOLD_COST, TREBUCHET_REFINED_WOOD_COST,
  DEFENDER_IRON_COST,
  SCOUT_TOWER_BP_COST, SCOUT_TOWER_GOLD_COST,
  SCOUT_MISSION_COST, SCOUT_MISSION_DURATION_SEC,
  GAME_DURATION_SEC, CYCLE_INTERVAL_SEC,
  BARACKS_UPGRADE_COST, BARACKS_L3_UPGRADE_COST, FACTORY_UPGRADE_COST, FARM_UPGRADE_COST, WALL_SECTION_STONE_COST,
  KingdomId, DEFAULT_KINGDOM_ID, TRADER_CONSTRUCTION_SPEED_MULT,
  KINGDOM_DISPLAY_NAMES, pickAiKingdom,
  CITY_CAPTURE_HOLD_MS,
  WORKERS_PER_LEVEL, BUILDING_IRON_COSTS,
  RETREAT_DELAY_MS, ASSAULT_ATTACK_DEBUFF, WALL_SECTION_HP, HERO_BASE_HP,
  AttackCityStyle,
  SpecialRegion,
  ScrollItem,
  ScrollAttachment,
  SCROLL_DISPLAY_NAME,
  Commander,
  CommanderDraftOption,
  COMMANDER_DRAFT_POOL_SIZE,
  COMMANDER_STARTING_PICK,
  COMMANDER_RECRUIT_GOLD,
} from '@/types/game';
import { renderCommanderPortraitDataUrl } from '@/lib/commanderPortrait';
import {
  rollCommanderIdentity,
  createCommanderRecord,
  syncCommandersToAssignments,
  clearInvalidCommanderAssignments,
  unassignCommandersWithDeadAnchors,
} from '@/lib/commanders';
import { generateMap, placeAncientCity } from '@/lib/mapGenerator';
import { appendStartingBarracksToCity, appendStartingAcademyToCity, findBestStartHex, findFishersStartingBuildings } from '@/lib/kingdomSpawn';
import { getCityTerritory } from '@/lib/territory';
import { computeContestedZoneHexKeys, applyContestedZonePayout } from '@/lib/contestedZone';
import { calculateTerritory, findCityForRefinedWoodSpend, maxMoveOrderDistanceForDestination, isWithinPlayerMoveOrderRange } from '@/lib/territory';
import { processEconomyTurn, computeClusterIncomeStatement } from '@/lib/gameLoop';
import { planAiTurn, placeAiStartingCity, placeAiStartingCityAt, createAiHero } from '@/lib/ai';
import { getAiParams } from '@/lib/aiParams';
import {
  movementTick,
  combatTick,
  upkeepTick,
  siegeTick,
  autoEmbarkLandUnitsOntoScoutShipsAtHex,
  landMilitaryContestsCityCapture,
  enemyIntactWallOnCityHex,
  type DefenseVolleyFx,
  type RangedShotFx,
} from '@/lib/military';
import { computeVisibleHexes } from '@/lib/vision';
import { computeTradeClusters, getCapitalCluster, computeConnectionPaths, computeConnectionPathsWithClusters } from '@/lib/logistics';
import { rollForWeatherEvent, tickWeatherEvent, weatherAnnouncement, getWeatherHarvestMultiplier } from '@/lib/weather';
import { withDeployFlags, applyDeployFlagsForMoveMutable, isLandMilitaryUnit, marchHexDistanceAtOrder } from '@/lib/garrison';
import {
  getAttackMarchParams,
  selectUnitIdsByTypeCounts,
  releaseAttackWaveHolds,
} from '@/lib/siege';
import { tickScrollRegionSearch, returnScrollsForDeadCarriers } from '@/lib/scrolls';

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
  /** Named commanders: assign to city defense or a field army (anchor unit). */
  commanders: Commander[];
  /** Pre-playing draft (pick five, then roles). Cleared when the match starts. */
  commanderDraftOptions: CommanderDraftOption[];
  commanderDraftSelectedIds: string[];
  commanderDraftAssignment: Record<string, 'capital' | 'none'>;
  constructions: ConstructionSite[];
  roadConstructions: RoadConstructionSite[];
  scoutTowers: ScoutTower[];
  defenseInstallations: DefenseInstallation[];
  scoutMissions: ScoutMission[];
  scoutedHexes: Set<string>;   // hexes that have been scouted (info revealed)
  territory: Map<string, TerritoryInfo>;
  notifications: GameNotification[];

  /** Hex keys where combat occurred during the current cycle (for ancient city: no reward if combat on that hex) */
  combatHexesThisCycle: Set<string>;
  /** Real-time stamp of last combat tick (for shot VFX). */
  lastCombatFxAtMs: number;
  lastDefenseVolleyFx: DefenseVolleyFx[];
  lastRangedShotFx: RangedShotFx[];
  rangedShooterUnitIds: string[];
  /** Purple hotspot between the two main rivals; gold or iron every 2nd cycle if one side has more troops in zone. */
  contestedZoneHexKeys: string[];

  /** Large named regions on the map (scroll discovery). */
  specialRegions: SpecialRegion[];
  /** regionId -> playerId -> cycles spent searching (with military in zone). */
  scrollSearchProgress: Record<string, Record<string, number>>;
  /** regionId -> player ids who already received that region's scroll. */
  scrollSearchClaimed: Record<string, string[]>;
  /** playerId -> scroll items not assigned to a unit. */
  scrollInventory: Record<string, ScrollItem[]>;
  /** Scrolls carried by units (bonuses apply to the whole stack at that hex). */
  scrollAttachments: ScrollAttachment[];

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

  /** Human kingdom for the current match (setup + playing). */
  selectedKingdom: KingdomId;
  setSelectedKingdom: (k: KingdomId) => void;

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
  /** When non-null, battle report modal is open for this `tileKey(q,r)`. */
  battleModalHexKey: string | null;
  /** After closing city modal, ignore map clicks briefly so the same gesture does not hit the canvas (R3F). */
  mapClickSuppressionUntilMs: number;
  /** Full city / logistics modal — opened from hex panel, not automatically on city click. */
  cityLogisticsOpen: boolean;
  /** City capture: cityId -> { attackerId, startedAt } when attacker holds center; capture after 5s */
  cityCaptureHold: Record<string, { attackerId: string; startedAt: number }>;

  /** Units/ships spawn at end of `completesAtCycle` (one economy cycle delay). */
  pendingRecruits: PendingRecruitItem[];
  /** Village incorporation resolves at end of `completesAtCycle`. */
  pendingIncorporations: PendingIncorporationItem[];

  /** Tactical panel: key = tileKey(q,r) of stack; null = tactical mode off */
  pendingTacticalOrders: Record<string, TacticalStackOrder> | null;
  /** Stacks selected in tactical panel (for batch orders from bottom bar) */
  tacticalSelectedStackKeys: string[];
  /** When set, next map click completes this order type for all these stacks */
  assigningTacticalForSelectedStacks: { orderType: TacticalAssignOrderType; stackKeys: string[] } | null;
  /** After clicking an enemy city, player configures counts / waves / style in the modal. */
  tacticalAttackCityDraft: {
    stackKeys: string[];
    cityId: string;
    cityQ: number;
    cityR: number;
    cityName: string;
  } | null;
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
  /** Human only, no rival AI — compact map recommended (e.g. generateWorld 38×38 first). */
  startSoloPlacement: () => void;
  startBotVsBot: () => void;
  /** 4-player bot observer mode (same setup as 2-bot for now; gameMode affects camera/UI). */
  startFourBotVsBot: () => void;
  /** 38×38 map + champion params (same as ?watch); use from main menu. */
  startSmallMapBotVsBot: () => void;
  setPendingCity: (q: number, r: number) => void;
  confirmCityPlacement: () => void;
  cancelCityPlacement: () => void;
  placeStartingCity: (q: number, r: number) => void;
  toggleCommanderDraftSelection: (draftId: string) => void;
  setCommanderDraftRole: (draftId: string, role: 'capital' | 'none') => void;
  confirmCommanderDraft: () => void;
  startRealTimeLoop: (opts?: { preserveTimes?: boolean }) => void;
  stopRealTimeLoop: () => void;
  /** Set sim speed (1x, 2x, 4x) for bot-vs-bot modes only; restarts tick interval. */
  setSimSpeedMultiplier: (speed: 1 | 2 | 4) => void;
  runCycle: () => void;
  recomputeVision: () => void;

  // Interaction
  selectHex: (q: number, r: number) => void;
  deselectAll: () => void;
  /** Layered Escape: cancel tactical assign → pending move → builder → split → tactical → deselect. */
  escapeFromUi: () => void;
  /** Close city logistics modal — keeps hex selection. */
  closeCityModal: () => void;
  openCityLogistics: () => void;

  // City
  buildStructure: (type: BuildingType, q: number, r: number) => void;
  buildTrebuchetInField: (q: number, r: number) => void;
  buildScoutTowerInField: (q: number, r: number) => void;
  /** Builder on hex in your city territory; pay per-level cost from player gold + city storage. */
  startCityDefenseTowerBuild: (q: number, r: number, towerType: DefenseTowerType, targetLevel: DefenseTowerLevel) => void;
  buildRoad: (q: number, r: number) => void;
  upgradeBarracks: (cityId: string, buildingQ: number, buildingR: number) => void;
  upgradeFactory: (cityId: string, buildingQ: number, buildingR: number) => void;
  upgradeFarm: (cityId: string, buildingQ: number, buildingR: number) => void;
  adjustWorkers: (cityId: string, buildingQ: number, buildingR: number, delta: number) => void;
  recruitUnit: (cityId: string, type: UnitType, armsLevel?: 1 | 2 | 3) => void;
  recruitShip: (cityId: string, shipyardQ: number, shipyardR: number, shipType: 'scout_ship' | 'warship' | 'transport_ship' | 'fisher_transport' | 'capital_ship') => void;
  boardAdjacentShip: (shipId: string) => void;
  disembarkShip: (shipId: string) => void;
  recruitHero: (cityId: string) => void;
  recruitCommander: (cityId: string) => void;
  assignCommanderToCityDefense: (commanderId: string, cityId: string) => void;
  /** Attach commander to the first land military unit at the selected hex (stack). */
  assignCommanderToFieldAtSelectedHex: (commanderId: string) => void;
  unassignCommander: (commanderId: string) => void;
  setFoodPriority: (priority: FoodPriority) => void;
  setTaxRate: (rate: number) => void;

  // Wall building (ring around city, from build menu; stone cost)
  buildWallRing: (cityId: string, ring: number) => void;

  // Builder build (Mine, Quarry, Road, Scout Tower outside territory)
  startBuilderBuild: (mode: 'mine' | 'quarry' | 'gold_mine' | 'logging_hut' | 'road') => void;
  cancelBuilderBuild: () => void;
  builderSelectDeposit: (q: number, r: number, type: 'mine' | 'quarry' | 'gold_mine' | 'logging_hut') => void;
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
  /** Open battle report; pass a hex key to focus that battle, or omit to pick the first human contested hex. */
  openBattleModal: (hexKey?: string) => void;
  closeBattleModal: () => void;
  openTacticalMode: () => void;
  cancelTacticalMode: () => void;
  setTacticalOrder: (stackKey: string, order: TacticalStackOrder | null) => void;
  startTacticalMoveForStack: (stackKey: string, orderType?: 'move' | 'intercept') => void;
  setTacticalMoveTarget: (toQ: number, toR: number) => void;
  setTacticalSelectedStackKeys: (keys: string[]) => void;
  toggleTacticalStack: (stackKey: string) => void;
  startTacticalOrderForSelected: (orderType: TacticalAssignOrderType) => void;
  setTacticalMoveTargetForSelected: (toQ: number, toR: number) => void;
  setTacticalIncorporateTargetForSelected: (toQ: number, toR: number) => void;
  setTacticalAttackCityTargetForSelected: (toQ: number, toR: number) => void;
  commitTacticalAttackCitySetup: (payload: {
    attackStyle: AttackCityStyle;
    useWaves: boolean;
    perStack: Record<string, { wave1: Partial<Record<UnitType, number>>; wave2: Partial<Record<UnitType, number>> }>;
  }) => void;
  cancelTacticalAttackCityDraft: () => void;
  beginSiegeAssaultOnCity: (cityId: string) => void;
  setTacticalDefendForSelected: (cityId: string) => void;
  setTacticalDefendTargetFromMap: (q: number, r: number) => void;
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
  /** Attach a scroll from your inventory to one of your land military units (whole stack benefits). */
  assignScrollToUnit: (scrollItemId: string, unitId: string) => void;
  /** Return a unit's scroll to inventory. */
  unassignScrollFromUnit: (unitId: string) => void;

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

export type GameMode = 'human_vs_ai' | 'human_solo' | 'bot_vs_bot' | 'bot_vs_bot_4';

/** Pending order per stack while tactical mode is open (confirmed in one batch). */
export type TacticalStackOrder =
  | { type: 'move'; toQ: number; toR: number }
  | { type: 'intercept'; toQ: number; toR: number }
  | { type: 'defend'; cityId: string }
  | { type: 'incorporate_village'; toQ: number; toR: number }
  | {
      type: 'attack_city';
      cityId: string;
      attackStyle: AttackCityStyle;
      wave1UnitIds: string[];
      wave2UnitIds: string[];
    };

export type TacticalAssignOrderType = 'move' | 'intercept' | 'incorporate_village' | 'attack_city' | 'defend_pick';

type PendingLandRecruit = {
  id: string;
  playerId: string;
  cityId: string;
  type: UnitType;
  effectiveArmsLevel: 1 | 2 | 3;
  spawnQ: number;
  spawnR: number;
  completesAtCycle: number;
};

type PendingShipRecruit = {
  id: string;
  playerId: string;
  cityId: string;
  shipType: 'scout_ship' | 'warship' | 'transport_ship' | 'fisher_transport' | 'capital_ship';
  spawnQ: number;
  spawnR: number;
  completesAtCycle: number;
};

type PendingHeroRecruit = {
  id: string;
  playerId: string;
  cityId: string;
  heroKind: 'general' | 'logistician';
  completesAtCycle: number;
};

type PendingCommanderRecruit = {
  id: string;
  playerId: string;
  cityId: string;
  commanderSeed: number;
  completesAtCycle: number;
};

type PendingRecruitItem = PendingLandRecruit | PendingShipRecruit | PendingHeroRecruit | PendingCommanderRecruit;

type PendingIncorporationItem = {
  id: string;
  playerId: string;
  q: number;
  r: number;
  completesAtCycle: number;
  alreadyPaidGold: boolean;
};

let cityNameIdx = 0;
let heroNameIdx = 0;
function nextCityName(): string {
  return CITY_NAMES[cityNameIdx++ % CITY_NAMES.length];
}
function nextHeroName(): string {
  return HERO_NAMES[heroNameIdx++ % HERO_NAMES.length];
}

function canPayDefenseLevelCost(player: Player, city: City, level: DefenseTowerLevel): boolean {
  const c = DEFENSE_TOWER_LEVEL_COSTS[level];
  if (player.gold < c.gold) return false;
  if ((c.wood ?? 0) > (city.storage.wood ?? 0)) return false;
  if ((c.stone ?? 0) > (city.storage.stone ?? 0)) return false;
  if ((c.iron ?? 0) > (city.storage.iron ?? 0)) return false;
  return true;
}

function humanStackKeysForTactical(s: { units: Unit[]; tacticalSelectedStackKeys: string[] }): string[] {
  const humanKeys = new Set<string>();
  for (const u of s.units) {
    if (u.ownerId === HUMAN_ID && u.hp > 0) humanKeys.add(tileKey(u.q, u.r));
  }
  return s.tacticalSelectedStackKeys.length > 0
    ? s.tacticalSelectedStackKeys.filter(k => humanKeys.has(k))
    : Array.from(humanKeys);
}

/** Shared merge for manual incorporate and auto-incorporate on arrival. Returns null if requirements fail. */
function incorporateVillagePatch(
  s: {
    tiles: Map<string, Tile>;
    cities: City[];
    units: Unit[];
    players: Player[];
    heroes: Hero[];
    commanders: Commander[];
    scoutTowers: ScoutTower[];
  },
  q: number,
  r: number,
  playerId: string,
  opts?: { goldAlreadyPaid?: boolean },
): {
  players: Player[];
  cities: City[];
  tiles: Map<string, Tile>;
  territory: Map<string, TerritoryInfo>;
  visibleHexes: Set<string>;
  newCity: City;
} | null {
  const goldAlreadyPaid = opts?.goldAlreadyPaid ?? false;
  const player = s.players.find(p => p.id === playerId);
  if (!player) return null;
  if (!goldAlreadyPaid && player.gold < VILLAGE_INCORPORATE_COST) return null;
  const tile = s.tiles.get(tileKey(q, r));
  if (!tile || !tile.hasVillage) return null;
  if (s.cities.some(c => c.q === q && c.r === r)) return null;
  const militaryHere = s.units.filter(
    u => u.q === q && u.r === r && u.ownerId === playerId && u.hp > 0 && u.type !== 'builder',
  );
  if (militaryHere.length === 0) return null;

  const newPlayers = goldAlreadyPaid
    ? s.players
    : s.players.map(p =>
        p.id === playerId ? { ...p, gold: p.gold - VILLAGE_INCORPORATE_COST } : p
      );
  const newCity: City = {
    id: generateId('city'),
    name: nextCityName(),
    q, r,
    ownerId: playerId,
    ...structuredClone(VILLAGE_CITY_TEMPLATE),
    frontierCity: FRONTIER_CYCLES,
  };
  newCity.buildings = [{ type: 'city_center', q, r, assignedWorkers: 0 }];
  newCity.storageCap = { ...CITY_CENTER_STORAGE };
  appendStartingBarracksToCity(newCity, s.tiles, (q * 524287) ^ (r * 65521) ^ newCity.id.charCodeAt(0));
  appendStartingAcademyToCity(newCity, s.tiles, (q * 524287) ^ (r * 65521) ^ newCity.id.charCodeAt(0) ^ 0xaced);
  const newCities = [...s.cities, newCity];
  const newTiles = new Map(s.tiles);
  newTiles.set(tileKey(q, r), { ...tile, hasVillage: false });
  const territory = calculateTerritory(newCities, newTiles);
  const visibleHexes = computeVisibleHexes(playerId, newCities, s.units, s.heroes, newTiles, s.scoutTowers ?? [], s.commanders ?? []);
  return { players: newPlayers, cities: newCities, tiles: newTiles, territory, visibleHexes, newCity };
}

function spawnUnitFromPendingLand(item: PendingLandRecruit, cities: City[]): Unit | null {
  const city = cities.find(c => c.id === item.cityId);
  if (!city) return null;
  const stats = getUnitStats({ type: item.type, armsLevel: item.effectiveArmsLevel });
  const isBuilder = item.type === 'builder';
  const u: Unit = {
    id: generateId('unit'),
    type: item.type,
    q: item.spawnQ,
    r: item.spawnR,
    ownerId: item.playerId,
    hp: stats.maxHp,
    maxHp: stats.maxHp,
    xp: 0,
    level: 0,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
    originCityId: item.cityId,
  };
  if (item.effectiveArmsLevel === 2 && item.type !== 'defender') u.armsLevel = 2;
  if (item.effectiveArmsLevel === 3 || item.type === 'defender') u.armsLevel = 3;
  if (!isBuilder && !isNavalUnitType(item.type)) {
    u.garrisonCityId = city.id;
    u.defendCityId = city.id;
  }
  return u;
}

function spawnUnitFromPendingShip(item: PendingShipRecruit, cities: City[]): Unit | null {
  if (!cities.some(c => c.id === item.cityId)) return null;
  const cap = getShipMaxCargo(item.shipType);
  const stats = getUnitStats({ type: item.shipType });
  return {
    id: generateId('unit'),
    type: item.shipType,
    q: item.spawnQ,
    r: item.spawnR,
    ownerId: item.playerId,
    hp: stats.maxHp,
    maxHp: stats.maxHp,
    xp: 0,
    level: 0,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
    originCityId: item.cityId,
    cargoUnitIds: cap > 0 ? [] : undefined,
  };
}

function canLandStackEmbarkFriendlyScoutAt(
  tiles: Map<string, Tile>,
  units: Unit[],
  toQ: number,
  toR: number,
  stack: Unit[],
  playerId: string,
): boolean {
  if (stack.length === 0 || stack.some(u => isNavalUnitType(u.type))) return false;
  const dest = tiles.get(tileKey(toQ, toR));
  if (dest?.biome !== 'water') return false;
  const ships = units.filter(
    u =>
      u.type === 'scout_ship' &&
      u.ownerId === playerId &&
      u.hp > 0 &&
      !u.aboardShipId &&
      u.q === toQ &&
      u.r === toR,
  );
  if (ships.length !== 1) return false;
  const cap = getShipMaxCargo('scout_ship');
  const n = ships[0].cargoUnitIds?.length ?? 0;
  return cap > n;
}

// ─── Store ─────────────────────────────────────────────────────────

export const useGameStore = create<GameState>((set, get) => ({
  tiles: new Map(), config: DEFAULT_MAP_CONFIG, provinceCenters: [], isGenerated: false,
  phase: 'setup', cycle: 0, gameMode: 'human_vs_ai', players: [], cities: [], units: [], heroes: [], commanders: [],
  commanderDraftOptions: [], commanderDraftSelectedIds: [], commanderDraftAssignment: {},
  constructions: [], roadConstructions: [], scoutTowers: [], defenseInstallations: [], contestedZoneHexKeys: [],
  specialRegions: [], scrollSearchProgress: {}, scrollSearchClaimed: {}, scrollInventory: {}, scrollAttachments: [],
  scoutMissions: [], scoutedHexes: new Set(),
  territory: new Map(), notifications: [],
  combatHexesThisCycle: new Set(),
  lastCombatFxAtMs: 0,
  lastDefenseVolleyFx: [],
  lastRangedShotFx: [],
  rangedShooterUnitIds: [],
  activeWeather: null, lastWeatherEndCycle: -10,
  gameEndTime: 0, nextCycleTime: 0, gameTimeRemaining: GAME_DURATION_SEC, cycleTimeRemaining: CYCLE_INTERVAL_SEC,
  simSpeedMultiplier: 1,
  selectedKingdom: DEFAULT_KINGDOM_ID,
  setSelectedKingdom: (k) => set({ selectedKingdom: k }),
  visibleHexes: new Set(), pendingCityHex: null,
  selectedHex: null, uiMode: 'normal', pendingMove: null, wallSections: [], roadPathSelection: [],
  supplyViewTab: 'normal',
  selectedClusterKey: null,
  lastClickHex: null,
  lastClickTime: 0,
  battleModalHexKey: null,
  mapClickSuppressionUntilMs: 0,
  cityLogisticsOpen: false,
  cityCaptureHold: {},
  pendingRecruits: [],
  pendingIncorporations: [],
  pendingTacticalOrders: null,
  tacticalSelectedStackKeys: [],
  assigningTacticalForSelectedStacks: null,
  assigningTacticalForStack: null,
  assigningTacticalOrderType: null,
  tacticalAttackCityDraft: null,
  splitStackPending: null,

  // ─── Map ────────────────────────────────────────────────────
  generateWorld: (ov) => {
    const config = { ...DEFAULT_MAP_CONFIG, ...ov };
    const { tiles, provinceCenters, specialRegions } = generateMap(config);
    const tileMap = new Map<string, Tile>();
    for (const t of tiles) tileMap.set(tileKey(t.q, t.r), t);
    set({
      tiles: tileMap,
      config,
      provinceCenters,
      specialRegions,
      scrollSearchProgress: {},
      scrollSearchClaimed: {},
      scrollInventory: {},
      scrollAttachments: [],
      isGenerated: true,
      phase: 'setup',
    });
  },
  getTile: (q, r) => get().tiles.get(tileKey(q, r)),

  // ─── Game Flow ──────────────────────────────────────────────
  startPlacement: () => {
    cityNameIdx = 0;
    heroNameIdx = 0;
    const kingdom = get().selectedKingdom;
    const aiKingdom = pickAiKingdom(kingdom);
    const suggested = findBestStartHex(kingdom, get().tiles, get().config);
    set({
      phase: 'place_city',
      gameMode: 'human_vs_ai',
      players: [
        { id: HUMAN_ID, name: 'You', color: PLAYER_COLORS.human, gold: STARTING_GOLD, taxRate: 0.3, foodPriority: 'civilian', isHuman: true, kingdomId: kingdom },
        { id: AI_ID, name: KINGDOM_DISPLAY_NAMES[aiKingdom], color: PLAYER_COLORS.ai, gold: STARTING_GOLD, taxRate: 0.3, foodPriority: 'military', isHuman: false, kingdomId: aiKingdom },
      ],
      cities: [], units: [], heroes: [], commanders: [],
      commanderDraftOptions: [], commanderDraftSelectedIds: [], commanderDraftAssignment: {},
      constructions: [], roadConstructions: [], scoutTowers: [], defenseInstallations: [],       scoutMissions: [], scoutedHexes: new Set(),
      territory: new Map(), cycle: 0, notifications: [], wallSections: [], cityCaptureHold: {}, pendingRecruits: [], pendingIncorporations: [],
      combatHexesThisCycle: new Set(),
      lastCombatFxAtMs: 0,
      lastDefenseVolleyFx: [],
      lastRangedShotFx: [],
      rangedShooterUnitIds: [],
      contestedZoneHexKeys: [],
      scrollSearchProgress: {},
      scrollSearchClaimed: {},
      scrollInventory: {},
      scrollAttachments: [],
      activeWeather: null, lastWeatherEndCycle: -10,
      visibleHexes: new Set(), pendingCityHex: suggested,
      battleModalHexKey: null,
    });
    if (!suggested) {
      get().addNotification('No scored start for this kingdom — click any valid land hex.', 'warning');
    }
  },

  startSoloPlacement: () => {
    cityNameIdx = 0;
    heroNameIdx = 0;
    const kingdom = get().selectedKingdom;
    const suggested = findBestStartHex(kingdom, get().tiles, get().config);
    set({
      phase: 'place_city',
      gameMode: 'human_solo',
      players: [
        { id: HUMAN_ID, name: 'You', color: PLAYER_COLORS.human, gold: STARTING_GOLD, taxRate: 0.3, foodPriority: 'civilian', isHuman: true, kingdomId: kingdom },
        /** Inert owner for solo dummy capital — never receives planAiTurn. */
        { id: AI_ID, name: 'Training target', color: PLAYER_COLORS.ai, gold: STARTING_GOLD, taxRate: 0.3, foodPriority: 'military', isHuman: false },
      ],
      cities: [], units: [], heroes: [], commanders: [],
      commanderDraftOptions: [], commanderDraftSelectedIds: [], commanderDraftAssignment: {},
      constructions: [], roadConstructions: [], scoutTowers: [], defenseInstallations: [],       scoutMissions: [], scoutedHexes: new Set(),
      territory: new Map(), cycle: 0, notifications: [], wallSections: [], cityCaptureHold: {}, pendingRecruits: [], pendingIncorporations: [],
      combatHexesThisCycle: new Set(),
      lastCombatFxAtMs: 0,
      lastDefenseVolleyFx: [],
      lastRangedShotFx: [],
      rangedShooterUnitIds: [],
      contestedZoneHexKeys: [],
      scrollSearchProgress: {},
      scrollSearchClaimed: {},
      scrollInventory: {},
      scrollAttachments: [],
      activeWeather: null, lastWeatherEndCycle: -10,
      visibleHexes: new Set(), pendingCityHex: suggested,
      battleModalHexKey: null,
    });
    if (!suggested) {
      get().addNotification('No scored start for this kingdom — click any valid land hex.', 'warning');
    }
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
    const contestedZoneHexKeys = computeContestedZoneHexKeys(tiles, ai1Q, ai1R, ai2Q, ai2R, config);
    const territory = calculateTerritory(cities, tiles);

    const heroes: Hero[] = [
      createAiHero(city1.q, city1.r, AI_ID),
      createAiHero(city2.q, city2.r, AI_ID_2),
    ];

    const allTileKeys = new Set<string>();
    tiles.forEach((_, key) => allTileKeys.add(key));

    const scrollInvBot: Record<string, ScrollItem[]> = {};
    scrollInvBot[AI_ID] = [];
    scrollInvBot[AI_ID_2] = [];

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
      commanders: [],
      commanderDraftOptions: [],
      commanderDraftSelectedIds: [],
      commanderDraftAssignment: {},
      territory,
      visibleHexes: allTileKeys,
      wallSections: [],
      cityCaptureHold: {},
      pendingRecruits: [],
      pendingIncorporations: [],
      constructions: [],
      roadConstructions: [],
      scoutTowers: [],
      defenseInstallations: [],
      combatHexesThisCycle: new Set(),
      lastCombatFxAtMs: 0,
      lastDefenseVolleyFx: [],
      lastRangedShotFx: [],
      rangedShooterUnitIds: [],
      contestedZoneHexKeys,
      specialRegions: s.specialRegions ?? [],
      scrollSearchProgress: {},
      scrollSearchClaimed: {},
      scrollInventory: scrollInvBot,
      scrollAttachments: [],
      notifications: [
        { id: generateId('n'), turn: 0, message: 'Bot vs Bot — observing both empires.', type: 'success' },
      ],
      battleModalHexKey: null,
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
    const { tiles, config, gameMode } = get();
    const tile = tiles.get(tileKey(q, r));
    if (!tile || tile.biome === 'water' || tile.biome === 'mountain') return;

    const solo = gameMode === 'human_solo';

    const humanCity: City = {
      id: generateId('city'), name: nextCityName(), q, r, ownerId: HUMAN_ID,
      ...structuredClone(STARTING_CITY_TEMPLATE),
    };
    humanCity.buildings = [{ type: 'city_center', q, r, assignedWorkers: 0 }];
    humanCity.storageCap = { ...CITY_CENTER_STORAGE };
    const aiCity = placeAiStartingCity(q, r, tiles, config, AI_ID);
    if (aiCity) aiCity.name = solo ? 'Training camp' : nextCityName();
    const cities = aiCity ? [humanCity, aiCity] : [humanCity];
    placeAncientCity(tiles, q, r, aiCity?.q, aiCity?.r);
    const contestedZoneHexKeys = aiCity
      ? computeContestedZoneHexKeys(tiles, q, r, aiCity.q, aiCity.r, config)
      : [];
    const territory = calculateTerritory(cities, tiles);

    const kingdom = get().selectedKingdom;
    let kingdomWalls: WallSection[] = [];

    if (kingdom === 'fishers') {
      const fb = findFishersStartingBuildings(humanCity, territory, tiles);
      if (fb) {
        humanCity.buildings.push(fb.port, fb.shipyard, fb.fishery, fb.banana_farm);
      }
    } else if (kingdom === 'crusaders') {
      let minePlaced = false;
      for (const [nq, nr] of hexNeighbors(q, r)) {
        const nt = tiles.get(tileKey(nq, nr));
        if (nt?.hasMineDeposit && nt.biome !== 'water' && nt.biome !== 'mountain') {
          humanCity.buildings.push({
            type: 'mine',
            q: nq,
            r: nr,
            level: 1,
            assignedWorkers: 2,
          });
          minePlaced = true;
          break;
        }
      }
      if (!minePlaced) {
        humanCity.storage.iron = (humanCity.storage.iron ?? 0) + 10;
      }
      for (const { q: wq, r: wr } of getHexRing(q, r, 1)) {
        const wt = tiles.get(tileKey(wq, wr));
        if (!wt || wt.biome === 'water') continue;
        kingdomWalls.push({
          q: wq,
          r: wr,
          ownerId: HUMAN_ID,
          hp: WALL_SECTION_HP,
          maxHp: WALL_SECTION_HP,
        });
      }
    } else if (kingdom === 'traders') {
      const tKeys = getCityTerritory(humanCity.id, territory).filter((k) => k !== tileKey(q, r));
      for (const k of tKeys) {
        const [mq, mr] = k.split(',').map(Number);
        const mt = tiles.get(k);
        if (mt && mt.biome !== 'water' && mt.biome !== 'mountain') {
          humanCity.buildings.push({
            type: 'market',
            q: mq,
            r: mr,
            level: 1,
            assignedWorkers: 2,
          });
          break;
        }
      }
    }

    appendStartingBarracksToCity(humanCity, tiles, config.seed ^ (q * 524287) ^ (r * 65521));
    appendStartingAcademyToCity(humanCity, tiles, config.seed ^ (q * 524287) ^ (r * 65521) ^ 0xaced);
    if (aiCity) {
      appendStartingBarracksToCity(aiCity, tiles, config.seed ^ (aiCity.q * 524287) ^ (aiCity.r * 65521));
      appendStartingAcademyToCity(aiCity, tiles, config.seed ^ (aiCity.q * 524287) ^ (aiCity.r * 65521) ^ 0xaced);
    }

    // Each player starts with a General hero at their capital
    const heroes: Hero[] = [
      { id: generateId('hero'), name: nextHeroName(), type: 'general', q, r, ownerId: HUMAN_ID, hp: HERO_BASE_HP, maxHp: HERO_BASE_HP },
    ];
    if (aiCity && !solo) {
      heroes.push(createAiHero(aiCity.q, aiCity.r, AI_ID));
    }

    // Human vs AI: no pre-spawned AI army. AI uses champion params (from ai-params.json) and builds up from its city on the opposite side.
    const initVisible = computeVisibleHexes(HUMAN_ID, cities, [], heroes, tiles, get().scoutTowers ?? [], []);

    const startNotifs: GameNotification[] = [
      { id: generateId('n'), turn: 0, message: `${humanCity.name} founded! The empire rises.`, type: 'success' },
    ];
    if (kingdom === 'crusaders') {
      startNotifs.push({
        id: generateId('n'),
        turn: 0,
        message: 'Crusaders: starting walls and iron mine (or stored iron if no adjacent deposit).',
        type: 'info',
      });
    }
    if (kingdom === 'fishers' && humanCity.buildings.some(b => b.type === 'port')) {
      startNotifs.push({
        id: generateId('n'),
        turn: 0,
        message: 'Fishers: port, shipyard, fishery, and banana farm are ready.',
        type: 'info',
      });
    }
    if (kingdom === 'traders' && humanCity.buildings.some(b => b.type === 'market')) {
      startNotifs.push({
        id: generateId('n'),
        turn: 0,
        message: 'Trading tribe: market built; +20% construction speed.',
        type: 'info',
      });
    }
    if (kingdom === 'mongols') {
      startNotifs.push({
        id: generateId('n'),
        turn: 0,
        message: 'Mongols: +10% land movement speed.',
        type: 'info',
      });
    }
    if ((get().specialRegions ?? []).length > 0) {
      startNotifs.push({
        id: generateId('n'),
        turn: 0,
        message:
          'Tinted zones are ancient scroll regions. Station an army in a region for 5 economy cycles to claim its scroll; assign scrolls to units in the hex panel (+10% attack, defense, or movement for that stack).',
        type: 'info',
      });
    }
    if (!solo) {
      startNotifs.push({ id: generateId('n'), turn: 0, message: `A rival empire stirs across the land.`, type: 'warning' });
      if (contestedZoneHexKeys.length > 0) {
        startNotifs.push({
          id: generateId('n'),
          turn: 0,
          message: 'Contested ground (purple): hold with more troops than your rival — every other cycle pays gold or iron.',
          type: 'info',
        });
      }
    } else {
      startNotifs.push({
        id: generateId('n'),
        turn: 0,
        message: aiCity
          ? 'Mechanics test — inert enemy capital on the far side (no AI moves or builds).'
          : 'Mechanics test — no inert target placed (map full?); no AI opponent.',
        type: 'success',
      });
      if (contestedZoneHexKeys.length > 0) {
        startNotifs.push({
          id: generateId('n'),
          turn: 0,
          message: 'Contested ground (purple): you vs training target — more troops in zone wins gold or iron every other cycle.',
          type: 'info',
        });
      }
    }

    const scrollInv: Record<string, ScrollItem[]> = {};
    for (const p of get().players) scrollInv[p.id] = [];

    const needsCommanderDraft = get().gameMode === 'human_vs_ai' || get().gameMode === 'human_solo';
    const commanderDraftOptions: CommanderDraftOption[] = [];
    if (needsCommanderDraft) {
      for (let i = 0; i < COMMANDER_DRAFT_POOL_SIZE; i++) {
        const seed = (config.seed ^ q * 1315423911 ^ r * 9737333 ^ i * 0x9e3779b9) >>> 0;
        const rolled = rollCommanderIdentity(seed);
        commanderDraftOptions.push({
          draftId: generateId('draft'),
          name: rolled.name,
          backstory: rolled.backstory,
          traitIds: rolled.traitIds,
          portraitSeed: rolled.portraitSeed,
          portraitDataUrl: renderCommanderPortraitDataUrl(rolled.portraitSeed),
        });
      }
    }

    set({
      phase: needsCommanderDraft ? 'commander_setup' : 'playing',
      cities,
      territory,
      heroes,
      commanders: [],
      commanderDraftOptions: needsCommanderDraft ? commanderDraftOptions : [],
      commanderDraftSelectedIds: [],
      commanderDraftAssignment: {},
      wallSections: kingdomWalls,
      players: get().players.map(p =>
        p.id === HUMAN_ID ? { ...p, kingdomId: get().selectedKingdom } : p,
      ),
      cityCaptureHold: {},
      pendingRecruits: [],
      pendingIncorporations: [],
      units: [],
      constructions: [],
      roadConstructions: [],
      scoutTowers: [],
      defenseInstallations: [],
      contestedZoneHexKeys,
      scrollSearchProgress: {},
      scrollSearchClaimed: {},
      scrollInventory: scrollInv,
      scrollAttachments: [],
      visibleHexes: initVisible,
      notifications: startNotifs,
      battleModalHexKey: null,
      cityLogisticsOpen: false,
    });

    if (!needsCommanderDraft) {
      get().startRealTimeLoop();
    }
  },

  toggleCommanderDraftSelection: (draftId) => {
    const s = get();
    if (s.phase !== 'commander_setup') return;
    const sel = s.commanderDraftSelectedIds;
    if (sel.includes(draftId)) {
      const { [draftId]: _removed, ...rest } = s.commanderDraftAssignment;
      void _removed;
      set({
        commanderDraftSelectedIds: sel.filter(id => id !== draftId),
        commanderDraftAssignment: rest,
      });
      return;
    }
    if (sel.length >= COMMANDER_STARTING_PICK) {
      get().addNotification(`You can only take ${COMMANDER_STARTING_PICK} commanders.`, 'warning');
      return;
    }
    set({
      commanderDraftSelectedIds: [...sel, draftId],
      commanderDraftAssignment: { ...s.commanderDraftAssignment, [draftId]: 'none' },
    });
  },

  setCommanderDraftRole: (draftId, role) => {
    const s = get();
    if (s.phase !== 'commander_setup' || !s.commanderDraftSelectedIds.includes(draftId)) return;
    set({
      commanderDraftAssignment: { ...s.commanderDraftAssignment, [draftId]: role === 'capital' ? 'capital' : 'none' },
    });
  },

  confirmCommanderDraft: () => {
    const s = get();
    if (s.phase !== 'commander_setup') return;
    const selected = s.commanderDraftSelectedIds;
    if (selected.length !== COMMANDER_STARTING_PICK) {
      get().addNotification(`Select exactly ${COMMANDER_STARTING_PICK} commanders.`, 'warning');
      return;
    }
    const humanCity = s.cities.find(c => c.ownerId === HUMAN_ID);
    if (!humanCity) return;

    const humanCmds: Commander[] = [];
    for (const draftId of selected) {
      const opt = s.commanderDraftOptions.find(o => o.draftId === draftId);
      if (!opt) continue;
      const role = s.commanderDraftAssignment[draftId] ?? 'none';
      const assign = role === 'capital' ? { kind: 'city_defense' as const, cityId: humanCity.id } : null;
      humanCmds.push(
        createCommanderRecord(
          HUMAN_ID,
          { name: opt.name, backstory: opt.backstory, traitIds: opt.traitIds, portraitSeed: opt.portraitSeed },
          opt.portraitDataUrl,
          humanCity.q,
          humanCity.r,
          assign,
        ),
      );
    }

    const aiCmds: Commander[] = [];
    const aiCity = s.cities.find(c => c.ownerId === AI_ID);
    if (aiCity) {
      for (let i = 0; i < COMMANDER_STARTING_PICK; i++) {
        const seed = (s.config.seed ^ aiCity.q * 1315423911 ^ aiCity.r * 9737333 ^ i * 0xcafebabe) >>> 0;
        const rolled = rollCommanderIdentity(seed);
        aiCmds.push(
          createCommanderRecord(
            AI_ID,
            rolled,
            renderCommanderPortraitDataUrl(rolled.portraitSeed),
            aiCity.q,
            aiCity.r,
            { kind: 'city_defense', cityId: aiCity.id },
          ),
        );
      }
    }

    const initVisible = computeVisibleHexes(
      HUMAN_ID,
      s.cities,
      s.units,
      s.heroes,
      s.tiles,
      s.scoutTowers ?? [],
      [...humanCmds, ...aiCmds],
    );

    set({
      phase: 'playing',
      commanders: [...humanCmds, ...aiCmds],
      commanderDraftOptions: [],
      commanderDraftSelectedIds: [],
      commanderDraftAssignment: {},
      visibleHexes: initVisible,
    });
    get().startRealTimeLoop();
  },

  startRealTimeLoop: (opts?: { preserveTimes?: boolean }) => {
    clearAllTimers();
    const s = get();
    const isBot = s.gameMode === 'bot_vs_bot' || s.gameMode === 'bot_vs_bot_4';
    const isSolo = s.gameMode === 'human_solo';
    const speed = isBot ? (s.simSpeedMultiplier || 1) : 1;
    const intervalMs = 1000 / speed;

    if (!opts?.preserveTimes) {
      const now = Date.now();
      const matchDurationSec = isSolo ? 86400 * 365 : GAME_DURATION_SEC;
      set({
        gameEndTime: now + (matchDurationSec * 1000) / speed,
        nextCycleTime: now + (CYCLE_INTERVAL_SEC * 1000) / speed,
        gameTimeRemaining: matchDurationSec,
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
      movementTick(
        movingUnits,
        movingHeroes,
        s.tiles,
        s.wallSections,
        s.cities,
        Date.now(),
        s.players,
        s.scrollAttachments,
      );
      autoEmbarkLandUnitsOntoScoutShipsAtHex(movingUnits, s.tiles);
      releaseAttackWaveHolds(movingUnits, s.cities);

      const movingCommanders = s.commanders.map(c => ({ ...c }));
      syncCommandersToAssignments(movingCommanders, s.cities, movingUnits);

      // -- Combat tick (pass movingHeroes so hp mutations apply; then remove killed heroes) --
      const combatResult = combatTick(
        movingUnits,
        movingHeroes,
        s.cycle,
        s.cities,
        s.tiles,
        now,
        s.defenseInstallations,
        s.territory,
        s.scrollAttachments,
        movingCommanders,
      );

      // -- Siege tick: trebuchet/ram damage walls (design §17–19) --
      const wallSectionsMut = s.wallSections.map(w => ({ ...w }));
      siegeTick(wallSectionsMut, movingUnits);

      // Accumulate combat hexes for this cycle (ancient city: no reward if combat on that hex)
      const nextCombatHexes = new Set(s.combatHexesThisCycle);
      for (const key of combatResult.combatHexKeys) nextCombatHexes.add(key);

      // Remove dead units; return scrolls from fallen carriers
      const killedSet = new Set(combatResult.killedUnitIds);
      const scrollReturn = returnScrollsForDeadCarriers(
        killedSet,
        s.scrollAttachments ?? [],
        { ...s.scrollInventory },
      );

      const aliveUnits = movingUnits.filter(u => u.hp > 0 && !combatResult.killedUnitIds.includes(u.id));
      unassignCommandersWithDeadAnchors(movingCommanders, aliveUnits);

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
          city.population === 0 ||
          (defendingLandMilitary.length === 0 && !wallBlocks);
        if (instantTake) {
          citiesFinal = citiesFinal.map(c => (c.id === city.id ? { ...c, ownerId: attackerId } : c));
          delete captureHoldNext[city.id];
          captureNotifs.push({
            id: generateId('n'),
            turn: s.cycle,
            message:
              city.population === 0
                ? `${city.name} captured (population zero)!`
                : `${city.name} captured!`,
            type: 'success',
          });
          continue;
        }
        const existing = captureHoldNext[city.id];
        if (!existing || existing.attackerId !== attackerId) {
          captureHoldNext[city.id] = { attackerId, startedAt: now };
        } else if (now - existing.startedAt >= CITY_CAPTURE_HOLD_MS) {
          citiesFinal = citiesFinal.map(c => (c.id === city.id ? { ...c, ownerId: attackerId } : c));
          delete captureHoldNext[city.id];
          captureNotifs.push({ id: generateId('n'), turn: s.cycle, message: `${city.name} captured!`, type: 'success' });
        }
      }
      clearInvalidCommanderAssignments(movingCommanders, citiesFinal);

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
      } else if (s.gameMode === 'human_solo') {
        const humanCitiesAfter = citiesFinal.filter(c => c.ownerId === HUMAN_ID);
        const dummyCitiesAfter = citiesFinal.filter(c => c.ownerId === AI_ID);
        if (humanCitiesAfter.length === 0) {
          phaseAfterCapture = 'victory';
          clearAllTimers();
          captureNotifs.push({ id: generateId('n'), turn: s.cycle, message: 'Defeat! Your empire has fallen.', type: 'danger' });
        } else if (dummyCitiesAfter.length === 0) {
          phaseAfterCapture = 'victory';
          clearAllTimers();
          captureNotifs.push({ id: generateId('n'), turn: s.cycle, message: 'Training target eliminated — victory!', type: 'success' });
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
      const ownerByCity = new Map(citiesFinal.map(c => [c.id, c.ownerId]));
      const syncedDefenses = (s.defenseInstallations ?? []).map(d => {
        const ow = ownerByCity.get(d.cityId);
        if (ow !== undefined && ow !== d.ownerId) return { ...d, ownerId: ow };
        return d;
      });
      const fxNow = Date.now();
      const hasFx =
        combatResult.defenseVolleyFx.length > 0 || combatResult.rangedShotFx.length > 0;
      set({
        units: aliveUnits,
        cities: citiesFinal,
        territory: territoryAfterCapture ?? s.territory,
        phase: phaseAfterCapture,
        wallSections: wallSectionsMut,
        cityCaptureHold: captureHoldNext,
        heroes: aliveHeroes,
        commanders: movingCommanders,
        notifications: newNotifs,
        combatHexesThisCycle: nextCombatHexes,
        defenseInstallations: syncedDefenses,
        scrollAttachments: scrollReturn.attachments,
        scrollInventory: scrollReturn.scrollInventory,
        lastCombatFxAtMs: hasFx ? fxNow : s.lastCombatFxAtMs,
        lastDefenseVolleyFx: combatResult.defenseVolleyFx,
        lastRangedShotFx: combatResult.rangedShotFx,
        rangedShooterUnitIds: [...new Set(combatResult.rangedShotFx.map(r => r.attackerId))],
      });

      // Tactical incorporate: queue one-cycle delayed incorporation when idle on target village
      {
        const st = get();
        if (st.phase === 'playing') {
          const toAdd: PendingIncorporationItem[] = [];
          for (const u of st.units) {
            if (u.ownerId !== HUMAN_ID || u.hp <= 0 || u.status !== 'idle') continue;
            if (u.type === 'builder' || isNavalUnitType(u.type)) continue;
            const iv = u.incorporateVillageAt;
            if (!iv || u.q !== iv.q || u.r !== iv.r) continue;
            if (st.pendingIncorporations.some(p => p.q === iv.q && p.r === iv.r && p.playerId === HUMAN_ID)) continue;
            toAdd.push({
              id: generateId('pinc'),
              playerId: HUMAN_ID,
              q: iv.q,
              r: iv.r,
              completesAtCycle: st.cycle + 1,
              alreadyPaidGold: false,
            });
          }
          if (toAdd.length > 0) {
            set({ pendingIncorporations: [...st.pendingIncorporations, ...toAdd] });
          }
        }
      }

      // -- Construction tick --
      {
        const st = get();
        if (st.constructions.length > 0) {
          const remaining: ConstructionSite[] = [];
          const completedNotifs: GameNotification[] = [];
          const updatedCities = st.cities.map(c => ({ ...c, buildings: [...c.buildings] }));
          const newUnitsFromField: Unit[] = [];
          const newScoutTowers: ScoutTower[] = [];
          let defenseOut = [...st.defenseInstallations];

          for (const site of st.constructions) {
            // Calculate available BP at this hex
            let availBP = 0;

            // If in territory of owning player, city provides CITY_BUILDING_POWER (buildings only; trebuchet/scout_tower/city_defense are builder-only)
            if (site.type !== 'trebuchet' && site.type !== 'scout_tower' && site.type !== 'city_defense') {
              const terr = st.territory.get(tileKey(site.q, site.r));
              if (terr && terr.playerId === site.ownerId) {
                availBP += CITY_BUILDING_POWER;
              }
            }

            // Count builder units at the hex (city_defense may also draw BP from cityDefenseBuilderBpHex)
            const bpHexes: { q: number; r: number }[] = [{ q: site.q, r: site.r }];
            if (site.type === 'city_defense' && site.cityDefenseBuilderBpHex) {
              bpHexes.push(site.cityDefenseBuilderBpHex);
            }
            const builderIds = new Set<string>();
            for (const { q: hq, r: hr } of bpHexes) {
              for (const u of st.units) {
                if (
                  u.q === hq &&
                  u.r === hr &&
                  u.ownerId === site.ownerId &&
                  u.type === 'builder' &&
                  u.hp > 0
                ) {
                  builderIds.add(u.id);
                }
              }
            }
            availBP += builderIds.size * BUILDER_POWER;

            if (availBP === 0) {
              remaining.push(site);
              continue;
            }

            // BP per second = availBP / BP_RATE_BASE (traders: faster city building)
            const humanPl = st.players.find(p => p.isHuman);
            const traderMult =
              humanPl?.kingdomId === 'traders' && site.ownerId === humanPl.id
                ? TRADER_CONSTRUCTION_SPEED_MULT
                : 1;
            const bpPerSec = (availBP / BP_RATE_BASE) * traderMult;
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
              } else if (site.type === 'city_defense' && site.defenseTowerType && site.defenseTowerTargetLevel) {
                const tt = site.defenseTowerType;
                const lvl = site.defenseTowerTargetLevel;
                const idx = defenseOut.findIndex(d => d.q === site.q && d.r === site.r && d.type === tt);
                if (idx >= 0) {
                  defenseOut[idx] = { ...defenseOut[idx], level: lvl };
                } else {
                  defenseOut.push({
                    id: generateId('def'),
                    q: site.q,
                    r: site.r,
                    ownerId: site.ownerId,
                    cityId: site.cityId,
                    type: tt,
                    level: lvl,
                  });
                }
                completedNotifs.push({
                  id: generateId('n'),
                  turn: st.cycle,
                  message: `${DEFENSE_TOWER_DISPLAY_NAME[tt]} L${lvl} ready at (${site.q}, ${site.r})!`,
                  type: 'success',
                });
              } else {
                // Building: add to city and auto-assign workers
                const city = updatedCities.find(c => c.id === site.cityId);
                if (city) {
                  const b: CityBuilding = { type: site.type as BuildingType, q: site.q, r: site.r };
                  if (['quarry', 'mine', 'gold_mine', 'barracks', 'factory', 'academy', 'farm', 'banana_farm', 'sawmill', 'port', 'shipyard', 'fishery', 'logging_hut', 'market'].includes(site.type)) b.level = 1;
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
            defenseInstallations: defenseOut,
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
            const humanPl = st.players.find(p => p.isHuman);
            const traderMultRoad =
              humanPl?.kingdomId === 'traders' && site.ownerId === humanPl.id
                ? TRADER_CONSTRUCTION_SPEED_MULT
                : 1;
            const bpPerSec = (availBP / BP_RATE_BASE) * traderMultRoad;
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
              return {
                ...u,
                targetQ: closest.site.q,
                targetR: closest.site.r,
                status: 'moving' as const,
                marchInitialHexDistance: marchHexDistanceAtOrder(u, closest.site.q, closest.site.r),
              };
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
        const st = get();
        if (st.gameMode === 'human_solo') {
          const now = Date.now();
          const extSec = 86400 * 365;
          set({
            gameEndTime: now + extSec * 1000,
            gameTimeRemaining: extSec,
            notifications: [
              ...st.notifications.slice(-8),
              { id: generateId('n'), turn: st.cycle, message: 'Sandbox: match clock reset (no time limit).', type: 'success' },
            ],
          });
        } else {
          clearAllTimers();
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

    let pendingRecruitsAcc = s.pendingRecruits.filter(pr => pr.completesAtCycle !== newCycle);
    let pendingIncorporationsAcc = s.pendingIncorporations.filter(p => p.completesAtCycle !== newCycle);
    let flushCities = s.cities;
    let flushPlayers = s.players;
    let flushTiles = s.tiles;
    let flushUnits = s.units;
    let flushVisible = s.visibleHexes;
    let flushTerritory = s.territory;
    let flushHeroes = s.heroes;
    let flushCommanders = s.commanders;
    const flushNotifs: GameNotification[] = [];

    for (const pr of s.pendingRecruits.filter(p => p.completesAtCycle === newCycle)) {
      if ('shipType' in pr) {
        const u = spawnUnitFromPendingShip(pr, flushCities);
        if (u) {
          flushUnits = [...flushUnits, u];
          if (pr.playerId === HUMAN_ID) {
            flushNotifs.push({
              id: generateId('n'),
              turn: newCycle,
              message: `${UNIT_DISPLAY_NAMES[pr.shipType]} ready.`,
              type: 'success',
            });
          }
        }
      } else if ('commanderSeed' in pr) {
        const city = flushCities.find(c => c.id === pr.cityId);
        if (city && city.ownerId === pr.playerId) {
          const rolled = rollCommanderIdentity(pr.commanderSeed);
          const portraitDataUrl = renderCommanderPortraitDataUrl(rolled.portraitSeed);
          flushCommanders = [
            ...flushCommanders,
            {
              id: generateId('cmd'),
              name: rolled.name,
              ownerId: pr.playerId,
              q: city.q,
              r: city.r,
              portraitSeed: rolled.portraitSeed,
              portraitDataUrl,
              traitIds: rolled.traitIds,
              backstory: rolled.backstory,
              assignment: null,
            },
          ];
          if (pr.playerId === HUMAN_ID) {
            flushNotifs.push({
              id: generateId('n'),
              turn: newCycle,
              message: `Commander ${rolled.name} has arrived.`,
              type: 'success',
            });
          }
        } else if (pr.playerId === HUMAN_ID) {
          flushPlayers = flushPlayers.map(p =>
            p.id === HUMAN_ID ? { ...p, gold: p.gold + COMMANDER_RECRUIT_GOLD } : p,
          );
          flushNotifs.push({
            id: generateId('n'),
            turn: newCycle,
            message: 'Commander training cancelled; gold refunded.',
            type: 'warning',
          });
        }
      } else if ('heroKind' in pr) {
        const city = flushCities.find(c => c.id === pr.cityId);
        if (city && city.ownerId === pr.playerId) {
          flushHeroes = [
            ...flushHeroes,
            {
              id: generateId('hero'),
              name: nextHeroName(),
              type: pr.heroKind,
              q: city.q,
              r: city.r,
              ownerId: pr.playerId,
              hp: HERO_BASE_HP,
              maxHp: HERO_BASE_HP,
            },
          ];
          if (pr.playerId === HUMAN_ID) {
            flushNotifs.push({
              id: generateId('n'),
              turn: newCycle,
              message: `Hero ready (${pr.heroKind}).`,
              type: 'success',
            });
          }
        } else if (pr.playerId === HUMAN_ID) {
          flushPlayers = flushPlayers.map(p =>
            p.id === HUMAN_ID ? { ...p, gold: p.gold + 80 } : p,
          );
          flushNotifs.push({
            id: generateId('n'),
            turn: newCycle,
            message: 'Hero training cancelled; gold refunded.',
            type: 'warning',
          });
        }
      } else {
        const u = spawnUnitFromPendingLand(pr, flushCities);
        if (u) {
          flushUnits = [...flushUnits, u];
          if (pr.playerId === HUMAN_ID) {
            const tier =
              pr.effectiveArmsLevel === 3 || pr.type === 'defender'
                ? 'L3 '
                : pr.effectiveArmsLevel === 2
                  ? 'L2 '
                  : '';
            flushNotifs.push({
              id: generateId('n'),
              turn: newCycle,
              message: `${tier}${UNIT_DISPLAY_NAMES[pr.type]} training complete.`,
              type: 'success',
            });
          }
        }
      }
    }

    for (const inc of s.pendingIncorporations.filter(p => p.completesAtCycle === newCycle)) {
      const patch = incorporateVillagePatch(
        {
          tiles: flushTiles,
          cities: flushCities,
          units: flushUnits,
          players: flushPlayers,
          heroes: flushHeroes,
          commanders: flushCommanders,
          scoutTowers: s.scoutTowers ?? [],
        },
        inc.q,
        inc.r,
        inc.playerId,
        { goldAlreadyPaid: inc.alreadyPaidGold },
      );
      if (!patch) {
        if (inc.alreadyPaidGold) {
          flushPlayers = flushPlayers.map(p =>
            p.id === inc.playerId ? { ...p, gold: p.gold + VILLAGE_INCORPORATE_COST } : p
          );
          flushNotifs.push({
            id: generateId('n'),
            turn: newCycle,
            message: 'Village incorporation failed; gold refunded.',
            type: 'warning',
          });
        }
        continue;
      }
      flushPlayers = patch.players;
      flushCities = patch.cities;
      flushTiles = patch.tiles;
      flushTerritory = patch.territory;
      if (inc.playerId === HUMAN_ID) flushVisible = patch.visibleHexes;
      flushUnits = flushUnits.map(u => {
        if (u.ownerId !== inc.playerId || !u.incorporateVillageAt) return u;
        if (u.incorporateVillageAt.q !== inc.q || u.incorporateVillageAt.r !== inc.r) return u;
        const { incorporateVillageAt: _i, ...rest } = u;
        return rest as Unit;
      });
      flushNotifs.push({
        id: generateId('n'),
        turn: newCycle,
        message: `${patch.newCity.name} incorporated!`,
        type: 'success',
      });
    }

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
    const econ = processEconomyTurn(flushCities, flushUnits, flushPlayers, flushTiles, flushTerritory, newCycle, harvestMultiplier);
    let cities = econ.cities;
    let units = econ.units;
    let players = econ.players;
    const notifs = [...flushNotifs, ...weatherNotifs, ...econ.notifications];

    // Military upkeep (food + guns consumption, per cluster); reuse clusters from economy
    const upkeepResult = upkeepTick(units, cities, flushHeroes, newCycle, flushTiles, flushTerritory, econ.clusters);
    notifs.push(...upkeepResult.notifications);

    // AI turn(s): for each AI player, plan and apply builds, upgrades, recruits, moves, scouts, village incorporation, wall rings
    const aiPlayerIds =
      s.gameMode === 'human_solo' ? [] : s.gameMode === 'bot_vs_bot' ? [AI_ID, AI_ID_2] : [AI_ID];
    let scoutMissions = s.scoutMissions;
    let scoutedHexes = s.scoutedHexes;
    let tilesMut = flushTiles;
    let wallSectionsMut: WallSection[] = s.wallSections.map(w => ({ ...w }));

    for (const aiPlayerId of aiPlayerIds) {
      const aiPlan = planAiTurn(aiPlayerId, cities, units, players, tilesMut, flushTerritory, getAiParams(), wallSectionsMut);
      const aiPlayer = players.find(p => p.id === aiPlayerId);
      if (!aiPlayer) continue;

      for (const build of aiPlan.builds) {
        const city = cities.find(c => c.id === build.cityId);
        if (!city || city.ownerId !== aiPlayerId) continue;
        if (aiPlayer.gold < BUILDING_COSTS[build.type]) continue;
        const ironCost = (BUILDING_IRON_COSTS[build.type] ?? 0);
        if (ironCost > 0 && (city.storage.iron ?? 0) < ironCost) continue;
        const b: CityBuilding = { type: build.type, q: build.q, r: build.r };
        if (['quarry', 'mine', 'gold_mine', 'barracks', 'factory', 'academy', 'farm', 'banana_farm', 'market'].includes(build.type)) b.level = 1;
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
        const cost = up.type === 'barracks' ? BARACKS_UPGRADE_COST : (up.type === 'farm' || up.type === 'banana_farm') ? FARM_UPGRADE_COST : FACTORY_UPGRADE_COST;
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
        const refinedWoodCost = wantL3
          ? (UNIT_L3_COSTS[rec.type].refinedWood ?? 0)
          : wantL2
            ? (UNIT_L2_COSTS[rec.type].refinedWood ?? 0)
            : (UNIT_COSTS[rec.type].refinedWood ?? 0);
        if (aiPlayer.gold < goldCost) continue;
        if (stoneCost > 0 && (city.storage.stone ?? 0) < stoneCost) continue;
        if (ironCost > 0 && (city.storage.iron ?? 0) < ironCost) continue;
        if (refinedWoodCost > 0 && (city.storage.refinedWood ?? 0) < refinedWoodCost) continue;
        const stats = getUnitStats({ type: rec.type, armsLevel: effectiveLevel as 1 | 2 | 3 });
        const gunL2Upkeep = (stats as { gunL2Upkeep?: number }).gunL2Upkeep ?? 0;
        if (gunL2Upkeep > 0) {
          const totalGunsL2 = cities.filter(c => c.ownerId === aiPlayerId).reduce((sum, c) => sum + (c.storage.gunsL2 ?? 0), 0);
          if (totalGunsL2 < gunL2Upkeep) continue;
        }
        const isBuilder = rec.type === 'builder';
        const academy = city.buildings.find(b => b.type === 'academy');
        const barracks = city.buildings.find(b => b.type === 'barracks');
        const sq = isBuilder ? (academy ? academy.q : city.q) : city.q;
        const sr = isBuilder ? (academy ? academy.r : city.r) : city.r;
        const effArms: 1 | 2 | 3 = rec.type === 'defender' ? 3 : wantL3 ? 3 : wantL2 ? 2 : 1;
        if (gunL2Upkeep > 0) {
          for (const oc of cities.filter(c => c.ownerId === aiPlayerId)) {
            if ((oc.storage.gunsL2 ?? 0) >= gunL2Upkeep) {
              oc.storage.gunsL2 = (oc.storage.gunsL2 ?? 0) - gunL2Upkeep;
              break;
            }
          }
        }
        aiPlayer.gold -= goldCost;
        if (stoneCost > 0 || ironCost > 0 || refinedWoodCost > 0) {
          const idx = cities.indexOf(city);
          if (idx >= 0) {
            const c = cities[idx];
            cities[idx] = {
              ...c,
              storage: {
                ...c.storage,
                stone: Math.max(0, (c.storage.stone ?? 0) - stoneCost),
                iron: Math.max(0, (c.storage.iron ?? 0) - ironCost),
                refinedWood: Math.max(0, (c.storage.refinedWood ?? 0) - refinedWoodCost),
              },
            };
          }
        }
        pendingRecruitsAcc.push({
          id: generateId('pr'),
          playerId: aiPlayerId,
          cityId: city.id,
          type: rec.type,
          effectiveArmsLevel: effArms,
          spawnQ: sq,
          spawnR: sr,
          completesAtCycle: newCycle + 1,
        });
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
        if (pendingIncorporationsAcc.some(p => p.q === inc.q && p.r === inc.r && p.playerId === aiPlayerId)) continue;
        pendingIncorporationsAcc.push({
          id: generateId('pinc'),
          playerId: aiPlayerId,
          q: inc.q,
          r: inc.r,
          completesAtCycle: newCycle + 1,
          alreadyPaidGold: false,
        });
      }

      for (const mt of aiPlan.moveTargets) {
        const unit = units.find(u => u.id === mt.unitId);
        if (unit && unit.hp > 0 && unit.status !== 'fighting') {
          applyDeployFlagsForMoveMutable(unit, mt.toQ, mt.toR, cities);
          unit.targetQ = mt.toQ;
          unit.targetR = mt.toR;
          unit.status = 'moving';
          unit.stance = 'aggressive';
          unit.nextMoveAt = 0;
          unit.marchInitialHexDistance = marchHexDistanceAtOrder(unit, mt.toQ, mt.toR);
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

    // City capture (discrete cycle): align with RT — land military only; wall / defenders block unless pop 0
    let citiesToSet = cities;
    for (const city of cities) {
      const wallBlocks = enemyIntactWallOnCityHex(wallSectionsMut, city);
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
        const winnerName =
          s.gameMode === 'bot_vs_bot'
            ? (winnerId === AI_ID ? 'North Empire' : 'South Empire')
            : winnerId === HUMAN_ID
              ? 'You'
              : (s.gameMode === 'human_solo' ? 'Training target' : 'Enemy');
        notifs.push({ id: generateId('n'), turn: newCycle, message: `Ancient city: +50 gold (${winnerName} held it).`, type: 'success' });
      }
    }

    const contested = applyContestedZonePayout({
      zoneKeys: s.contestedZoneHexKeys,
      newCycle,
      gameMode: s.gameMode,
      units: aliveUnits,
      heroes: flushHeroes,
      cities: citiesToSet,
      players: playersAfterAncientCity,
    });
    notifs.push(...contested.notifications);
    let citiesForSet = contested.cities;
    let playersForSet = contested.players;

    const scrollTick = tickScrollRegionSearch({
      newCycle,
      specialRegions: s.specialRegions ?? [],
      tiles: tilesMut,
      units: aliveUnits,
      players: playersForSet,
      scrollSearchProgress: s.scrollSearchProgress ?? {},
      scrollSearchClaimed: s.scrollSearchClaimed ?? {},
      scrollInventory: s.scrollInventory ?? {},
    });
    notifs.push(...scrollTick.notifications);

    // Victory check
    let phase: GamePhase = 'playing';
    if (s.gameMode === 'bot_vs_bot') {
      const ai1Cities = citiesForSet.filter(c => c.ownerId === AI_ID);
      const ai2Cities = citiesForSet.filter(c => c.ownerId === AI_ID_2);
      if (ai1Cities.length === 0) {
        phase = 'victory'; clearAllTimers();
        notifs.push({ id: generateId('n'), turn: newCycle, message: 'South Empire conquers! Victory.', type: 'success' });
      } else if (ai2Cities.length === 0) {
        phase = 'victory'; clearAllTimers();
        notifs.push({ id: generateId('n'), turn: newCycle, message: 'North Empire conquers! Victory.', type: 'success' });
      }
    } else if (s.gameMode === 'human_solo') {
      const humanCities = citiesForSet.filter(c => c.ownerId === HUMAN_ID);
      const dummyCities = citiesForSet.filter(c => c.ownerId === AI_ID);
      if (humanCities.length === 0) {
        phase = 'victory'; clearAllTimers();
        notifs.push({ id: generateId('n'), turn: newCycle, message: 'Defeat! Your empire has fallen.', type: 'danger' });
      } else if (dummyCities.length === 0) {
        phase = 'victory'; clearAllTimers();
        notifs.push({ id: generateId('n'), turn: newCycle, message: 'Training target eliminated — victory!', type: 'success' });
      }
    } else {
      const humanCities = citiesForSet.filter(c => c.ownerId === HUMAN_ID);
      const aiCities = citiesForSet.filter(c => c.ownerId === AI_ID);
      if (humanCities.length === 0) {
        phase = 'victory'; clearAllTimers();
        notifs.push({ id: generateId('n'), turn: newCycle, message: 'Defeat! Your empire has fallen.', type: 'danger' });
      } else if (aiCities.length === 0) {
        phase = 'victory'; clearAllTimers();
        notifs.push({ id: generateId('n'), turn: newCycle, message: 'Victory! You conquered the rival empire!', type: 'success' });
      }
    }

    set({
      cities: citiesForSet,
      units: aliveUnits,
      heroes: flushHeroes,
      commanders: flushCommanders,
      players: playersForSet,
      territory,
      phase,
      cycle: newCycle,
      wallSections: wallSectionsMut,
      combatHexesThisCycle: new Set(),
      lastCombatFxAtMs: 0,
      lastDefenseVolleyFx: [],
      lastRangedShotFx: [],
      rangedShooterUnitIds: [],
      activeWeather: currentWeather,
      lastWeatherEndCycle: lastWeatherEnd,
      scoutMissions,
      scoutedHexes,
      tiles: tilesMut,
      pendingRecruits: pendingRecruitsAcc,
      pendingIncorporations: pendingIncorporationsAcc,
      visibleHexes: flushVisible,
      scrollSearchProgress: scrollTick.scrollSearchProgress,
      scrollSearchClaimed: scrollTick.scrollSearchClaimed,
      scrollInventory: scrollTick.scrollInventory,
      notifications: [...s.notifications.slice(-8), ...notifs],
    });
  },

  // ─── Hex Selection ──────────────────────────────────────────

  selectHex: (q, r) => {
    const s = get();
    if (Date.now() < s.mapClickSuppressionUntilMs) return;
    const switchingHex = !s.selectedHex || s.selectedHex.q !== q || s.selectedHex.r !== r;
    if (switchingHex && s.cityLogisticsOpen) set({ cityLogisticsOpen: false });
    // Tactical: assigning destination for selected stacks (bottom-bar flow)
    if (s.assigningTacticalForSelectedStacks !== null) {
      const { orderType } = s.assigningTacticalForSelectedStacks;
      if (orderType === 'defend_pick') {
        get().setTacticalDefendTargetFromMap(q, r);
        return;
      }
      if (orderType === 'incorporate_village') {
        get().setTacticalIncorporateTargetForSelected(q, r);
        return;
      }
      if (orderType === 'attack_city') {
        get().setTacticalAttackCityTargetForSelected(q, r);
        return;
      }
      get().setTacticalMoveTargetForSelected(q, r);
      return;
    }
    // Tactical panel: assigning move/intercept destination for a single stack (legacy)
    if (s.assigningTacticalForStack !== null) {
      get().setTacticalMoveTarget(q, r);
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
    if (s.uiMode === 'build_logging_hut') { get().builderSelectDeposit(q, r, 'logging_hut'); return; }
    if (s.uiMode === 'build_road') { get().addRoadPathHex(q, r); return; }
    if (s.uiMode === 'move') {
      // Re-clicking the same hex (where units are) cancels move mode
      if (s.selectedHex && s.selectedHex.q === q && s.selectedHex.r === r) {
        set({ selectedHex: null, uiMode: 'normal', pendingMove: null, cityLogisticsOpen: false });
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
        set({ selectedHex: null, uiMode: 'normal', pendingMove: null, cityLogisticsOpen: false });
        return;
      }
      get().setPendingMove(q, r);
      return;
    }

    // Clicking an already-selected hex deselects
    if (s.selectedHex && s.selectedHex.q === q && s.selectedHex.r === r) {
      set({
        selectedHex: null,
        uiMode: 'normal',
        pendingMove: null,
        selectedClusterKey: s.supplyViewTab === 'supply' ? null : s.selectedClusterKey,
        cityLogisticsOpen: false,
      });
      return;
    }

    // Click-to-move: selected stack + click empty/valid destination → set move (smoother than using Move button)
    if (s.selectedHex && s.uiMode === 'normal') {
      const stack = s.units.filter(u => u.q === s.selectedHex!.q && u.r === s.selectedHex!.r && u.ownerId === HUMAN_ID && u.hp > 0 && !u.aboardShipId);
      const destHasFriendly = s.units.some(u => u.q === q && u.r === r && u.ownerId === HUMAN_ID && u.hp > 0);
      if (stack.length > 0 && !destHasFriendly) {
        const dist = hexDistance(s.selectedHex.q, s.selectedHex.r, q, r);
        const tile = s.tiles.get(tileKey(q, r));
        const navalStack = stack.every(u => isNavalUnitType(u.type));
        const okDest = navalStack
          ? tile?.biome === 'water'
          : (tile && tile.biome !== 'water') ||
            (!!tile &&
              tile.biome === 'water' &&
              canLandStackEmbarkFriendlyScoutAt(s.tiles, s.units, q, r, stack, HUMAN_ID));
        const maxLeg = maxMoveOrderDistanceForDestination(q, r, s.territory, HUMAN_ID);
        if (dist >= 1 && dist <= maxLeg && okDest) {
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

    const myUnits = s.units.filter(u => u.q === q && u.r === r && u.ownerId === HUMAN_ID && u.hp > 0 && !u.aboardShipId);
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

  escapeFromUi: () => {
    const s = get();
    if (s.battleModalHexKey !== null) {
      set({ battleModalHexKey: null });
      return;
    }
    if (s.assigningTacticalForSelectedStacks !== null || s.assigningTacticalForStack !== null) {
      set({
        assigningTacticalForSelectedStacks: null,
        assigningTacticalForStack: null,
        assigningTacticalOrderType: null,
      });
      return;
    }
    // City modal uses selected hex — close it before pending move / builder flows so Escape works reliably
    if (get().cityLogisticsOpen) {
      get().closeCityModal();
      return;
    }
    if (s.pendingMove !== null) {
      set({ pendingMove: null });
      return;
    }
    if (s.uiMode === 'build_mine' || s.uiMode === 'build_quarry' || s.uiMode === 'build_gold_mine' || s.uiMode === 'build_logging_hut' || s.uiMode === 'build_road') {
      get().cancelBuilderBuild();
      return;
    }
    if (s.splitStackPending !== null) {
      set({ splitStackPending: null });
      return;
    }
    if (s.pendingTacticalOrders !== null) {
      get().cancelTacticalMode();
      return;
    }
    get().deselectAll();
  },

  deselectAll: () => {
    const s = get();
    if (s.pendingTacticalOrders !== null) {
      get().cancelTacticalMode();
    }
    if (s.splitStackPending !== null) {
      set({ splitStackPending: null });
    }
    if (s.uiMode === 'build_mine' || s.uiMode === 'build_quarry' || s.uiMode === 'build_gold_mine' || s.uiMode === 'build_logging_hut' || s.uiMode === 'build_road') {
      set({ selectedHex: null, uiMode: 'normal', pendingMove: null, roadPathSelection: [], selectedClusterKey: null, cityLogisticsOpen: false });
    } else if (s.uiMode === 'defend' || s.uiMode === 'intercept') {
      set({ selectedHex: null, uiMode: 'normal', pendingMove: null, cityLogisticsOpen: false });
    } else {
      set({ selectedHex: null, uiMode: 'normal', pendingMove: null, selectedClusterKey: null, cityLogisticsOpen: false });
    }
  },

  closeCityModal: () => {
    set({
      cityLogisticsOpen: false,
      mapClickSuppressionUntilMs: Date.now() + 520,
    });
  },

  openCityLogistics: () => {
    const s = get();
    if (!s.selectedHex) return;
    const city = s.getCityAt(s.selectedHex.q, s.selectedHex.r);
    if (!city) return;
    const observer = s.gameMode === 'bot_vs_bot' || s.gameMode === 'bot_vs_bot_4';
    if (!observer && city.ownerId !== HUMAN_ID) return;
    set({ cityLogisticsOpen: true });
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
    if (s.defenseInstallations.some(d => d.q === q && d.r === r)) {
      get().addNotification('A city defense occupies this hex.', 'warning');
      return;
    }

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
    } else if (type === 'logging_hut') {
      if (tile.biome !== 'forest') {
        get().addNotification('Logging hut must be built on forest!', 'warning'); return;
      }
      if (city.population < 10) { get().addNotification('Need 10 population at city for logging hut!', 'warning'); return; }
      const unitsHere = s.units.filter(u => u.q === q && u.r === r && u.ownerId === HUMAN_ID && u.hp > 0);
      if (unitsHere.length === 0) { get().addNotification('Units must be present on the deposit to build!', 'warning'); return; }
    } else if (type === 'fishery' || type === 'port' || type === 'shipyard') {
      if (!hexTouchesBiome(s.tiles, q, r, 'water')) {
        get().addNotification(`${type} must be adjacent to water!`, 'warning'); return;
      }
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
    if (s.defenseInstallations.some(d => d.q === q && d.r === r)) {
      get().addNotification('A city defense occupies this hex.', 'warning');
      return;
    }
    const buildersAtHex = s.units.filter(
      u => u.q === q && u.r === r && u.ownerId === HUMAN_ID && u.type === 'builder' && u.hp > 0
    );
    if (buildersAtHex.length === 0) {
      get().addNotification('Need a Builder on this hex to build trebuchet!', 'warning');
      return;
    }
    const rwCity = findCityForRefinedWoodSpend(q, r, HUMAN_ID, TREBUCHET_REFINED_WOOD_COST, s.cities, s.territory);
    if (!rwCity) {
      get().addNotification(`Need ${TREBUCHET_REFINED_WOOD_COST} refined wood (sawmill) to build trebuchet!`, 'warning');
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
      cities: s.cities.map(c =>
        c.id === rwCity.id
          ? {
              ...c,
              storage: {
                ...c.storage,
                refinedWood: Math.max(0, (c.storage.refinedWood ?? 0) - TREBUCHET_REFINED_WOOD_COST),
              },
            }
          : c,
      ),
      constructions: [...s.constructions, site],
    });
    get().addNotification(
      `Trebuchet construction started (${TREBUCHET_FIELD_GOLD_COST}g, ${TREBUCHET_REFINED_WOOD_COST} ref., ${TREBUCHET_FIELD_BP_COST} BP). Builder builds on this hex.`,
      'info',
    );
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
    if (s.defenseInstallations.some(d => d.q === q && d.r === r)) {
      get().addNotification('A city defense occupies this hex.', 'warning');
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

  startCityDefenseTowerBuild: (q, r, towerType, targetLevel) => {
    const s = get();
    const player = s.players.find(p => p.id === HUMAN_ID);
    if (!player) return;

    // Always build on the hex passed from the UI (selected tile), not a pending move destination.
    const siteQ = q;
    const siteR = r;

    const tile = s.tiles.get(tileKey(siteQ, siteR));
    if (!tile || tile.biome === 'water' || tile.biome === 'mountain') return;
    if (s.cities.some(c => c.q === siteQ && c.r === siteR)) {
      get().addNotification('Cannot build defenses on the city center hex.', 'warning');
      return;
    }
    if (s.constructions.some(cs => cs.q === siteQ && cs.r === siteR)) {
      get().addNotification('Already under construction here!', 'warning');
      return;
    }
    const buildersAtHex = s.units.filter(
      u =>
        u.q === siteQ &&
        u.r === siteR &&
        u.ownerId === HUMAN_ID &&
        u.type === 'builder' &&
        u.hp > 0,
    );
    if (buildersAtHex.length === 0) {
      get().addNotification('Need a Builder on this hex.', 'warning');
      return;
    }
    const hexKey = tileKey(siteQ, siteR);
    const terr = s.territory.get(hexKey);
    if (!terr || terr.playerId !== HUMAN_ID) {
      get().addNotification('City defenses must be built inside your territory.', 'warning');
      return;
    }
    const payCity = s.cities.find(c => c.id === terr.cityId);
    if (!payCity || payCity.ownerId !== HUMAN_ID) {
      get().addNotification('No city owns this territory tile.', 'warning');
      return;
    }
    if (s.cities.some(c => c.buildings.some(b => tileKey(b.q, b.r) === hexKey))) {
      get().addNotification('This hex already has a building.', 'warning');
      return;
    }
    if (s.scoutTowers.some(t => t.q === siteQ && t.r === siteR)) {
      get().addNotification('Scout tower occupies this hex.', 'warning');
      return;
    }
    const atHex = s.defenseInstallations.filter(d => d.q === siteQ && d.r === siteR);
    if (atHex.some(d => d.type !== towerType)) {
      get().addNotification('Another defense type is already on this hex.', 'warning');
      return;
    }
    const existing = atHex.find(d => d.type === towerType);
    if (existing) {
      if (existing.level >= 5) {
        get().addNotification('This defense is already max level.', 'info');
        return;
      }
      if (targetLevel !== existing.level + 1) {
        get().addNotification(`Upgrade one level at a time (next: L${existing.level + 1}).`, 'warning');
        return;
      }
    } else {
      const count = s.defenseInstallations.filter(d => d.cityId === terr.cityId && d.type === towerType).length;
      if (count >= DEFENSE_TOWER_MAX_PER_CITY[towerType]) {
        get().addNotification(
          `Max ${DEFENSE_TOWER_MAX_PER_CITY[towerType]} ${DEFENSE_TOWER_DISPLAY_NAME[towerType]} per city.`,
          'warning',
        );
        return;
      }
    }
    if (!canPayDefenseLevelCost(player, payCity, targetLevel)) {
      get().addNotification('Not enough gold or city resources for this level.', 'warning');
      return;
    }
    const cost = DEFENSE_TOWER_LEVEL_COSTS[targetLevel];
    const bpRequired = getDefenseTowerBpCost(towerType, targetLevel);
    const site: ConstructionSite = {
      id: generateId('con'),
      type: 'city_defense',
      q: siteQ,
      r: siteR,
      cityId: terr.cityId,
      ownerId: HUMAN_ID,
      bpRequired,
      bpAccumulated: 0,
      defenseTowerType: towerType,
      defenseTowerTargetLevel: targetLevel,
    };
    const nextGold = player.gold - cost.gold;
    const nextCityStorage = {
      ...payCity.storage,
      wood: Math.max(0, (payCity.storage.wood ?? 0) - (cost.wood ?? 0)),
      stone: Math.max(0, (payCity.storage.stone ?? 0) - (cost.stone ?? 0)),
      iron: Math.max(0, (payCity.storage.iron ?? 0) - (cost.iron ?? 0)),
    };
    set({
      players: s.players.map(p => (p.id === HUMAN_ID ? { ...p, gold: nextGold } : p)),
      cities: s.cities.map(c => (c.id === payCity.id ? { ...c, storage: nextCityStorage } : c)),
      constructions: [...s.constructions, site],
    });
    get().addNotification(
      `${DEFENSE_TOWER_DISPLAY_NAME[towerType]} L${targetLevel} construction started (${bpRequired} BP, builder on this hex).`,
      'info',
    );
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
    const building = city.buildings.find(b => b.type === 'barracks' && b.q === buildingQ && b.r === buildingR);
    if (!building) return;
    const lvl = building.level ?? 1;
    if (lvl >= 3) {
      get().addNotification('Barracks is at max level (L3).', 'info'); return;
    }
    const cost = lvl === 1 ? BARACKS_UPGRADE_COST : BARACKS_L3_UPGRADE_COST;
    if (player.gold < cost) {
      get().addNotification(`Need ${cost} gold!`, 'warning'); return;
    }
    const newLevel = lvl === 1 ? 2 : 3;
    const newCities = s.cities.map(c => {
      if (c.id !== cityId) return c;
      return {
        ...c,
        buildings: c.buildings.map(b =>
          b.type === 'barracks' && b.q === buildingQ && b.r === buildingR ? { ...b, level: newLevel } : b
        ),
      };
    });
    set({
      players: s.players.map(p => p.id === HUMAN_ID ? { ...p, gold: p.gold - cost } : { ...p }),
      cities: newCities,
    });
    get().addNotification(
      newLevel === 2
        ? 'Barracks upgraded to L2! Can recruit L2 units.'
        : 'Barracks upgraded to L3! Crusaders can recruit Crusader Knights.',
      'success',
    );
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
    const building = city.buildings.find(
      b => (b.type === 'farm' || b.type === 'banana_farm') && b.q === buildingQ && b.r === buildingR,
    );
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
          (b.type === 'farm' || b.type === 'banana_farm') && b.q === buildingQ && b.r === buildingR
            ? { ...b, level: 2 }
            : b
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

    if (isNavalUnitType(type)) {
      get().addNotification('Build ships at a Shipyard (Ships panel).', 'info'); return;
    }

    const isBuilder = type === 'builder';
    const barracks = city.buildings.find(b => b.type === 'barracks');
    const academy = city.buildings.find(b => b.type === 'academy');
    const barracksLvl = barracks ? (barracks.level ?? 1) : 1;
    // Defender is always L3; other units use requested armsLevel (1/2/3)
    let effectiveLevel: 1 | 2 | 3 = type === 'defender' ? 3 : (armsLevel ?? 1);
    if (type === 'crusader_knight') effectiveLevel = 3;
    const wantL2 = effectiveLevel === 2;
    const wantL3 = effectiveLevel === 3;

    if (type === 'horse_archer' && player.kingdomId !== 'mongols') {
      get().addNotification('Horse Archers are exclusive to the Mongols.', 'warning'); return;
    }
    if (type === 'crusader_knight') {
      if (player.kingdomId !== 'crusaders') {
        get().addNotification('Crusader Knights are exclusive to the Crusaders.', 'warning'); return;
      }
      if (barracksLvl < 3) {
        get().addNotification('Upgrade barracks to L3 to recruit Crusader Knights!', 'warning'); return;
      }
    }

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
    const refinedWoodCost = wantL3
      ? (UNIT_L3_COSTS[type].refinedWood ?? 0)
      : wantL2
        ? (UNIT_L2_COSTS[type].refinedWood ?? 0)
        : (UNIT_COSTS[type].refinedWood ?? 0);

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
    if (refinedWoodCost > 0) {
      const rw = city.storage.refinedWood ?? 0;
      if (rw < refinedWoodCost) {
        get().addNotification(`Need ${refinedWoodCost} refined wood to recruit ${UNIT_DISPLAY_NAMES[type]}! (Build a sawmill.)`, 'warning'); return;
      }
    }

    const playerCities = s.cities.filter(c => c.ownerId === player.id);
    const totalPop = playerCities.reduce((sum, c) => sum + c.population, 0);
    const livingTroops = s.units.filter(u => u.ownerId === player.id && u.hp > 0).length;
    const pendingLand = s.pendingRecruits.filter(
      pr => 'effectiveArmsLevel' in pr && pr.playerId === player.id,
    ).length;
    if (livingTroops + pendingLand >= totalPop) {
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

    const spawnQ = isBuilder ? (academy ? academy.q : city.q) : city.q;
    const spawnR = isBuilder ? (academy ? academy.r : city.r) : city.r;
    const effArms: 1 | 2 | 3 =
      type === 'defender' || type === 'crusader_knight' ? 3 : wantL3 ? 3 : wantL2 ? 2 : 1;

    let updatedCities = s.cities;
    if (stoneCost > 0 || ironCost > 0 || refinedWoodCost > 0) {
      updatedCities = s.cities.map(c => {
        if (c.id !== cityId) return c;
        const stone = Math.max(0, (c.storage.stone ?? 0) - stoneCost);
        const iron = Math.max(0, (c.storage.iron ?? 0) - ironCost);
        const refinedWood = Math.max(0, (c.storage.refinedWood ?? 0) - refinedWoodCost);
        return { ...c, storage: { ...c.storage, stone, iron, refinedWood } };
      });
    }

    const prItem: PendingLandRecruit = {
      id: generateId('pr'),
      playerId: HUMAN_ID,
      cityId,
      type,
      effectiveArmsLevel: effArms,
      spawnQ,
      spawnR,
      completesAtCycle: s.cycle + 1,
    };

    set({
      players: s.players.map(p => p.id === player.id ? { ...p, gold: p.gold - goldCost } : p),
      cities: updatedCities,
      pendingRecruits: [...s.pendingRecruits, prItem],
    });
    const tierLabel = wantL3 ? 'L3 ' : wantL2 ? 'L2 ' : '';
    const rwPart = refinedWoodCost > 0 ? `, ${refinedWoodCost} ref.` : '';
    const costStr =
      ironCost > 0
        ? (goldCost > 0 ? `${goldCost}g, ${ironCost} iron${rwPart}` : `${ironCost} iron${rwPart}`)
        : stoneCost > 0
          ? `${goldCost}g, ${stoneCost} stone${rwPart}`
          : refinedWoodCost > 0
            ? `${goldCost}g${rwPart}`
            : `${goldCost}g`;
    get().addNotification(`Training ${tierLabel}${UNIT_DISPLAY_NAMES[type]} — ready next cycle. (${costStr})`, 'info');
  },

  recruitShip: (cityId, shipyardQ, shipyardR, shipType) => {
    const s = get();
    const player = s.players.find(p => p.isHuman);
    const city = s.cities.find(c => c.id === cityId && c.ownerId === HUMAN_ID);
    if (!player || !city) return;
    if (shipType === 'fisher_transport' && player.kingdomId !== 'fishers') {
      get().addNotification('Fisher boats are exclusive to the Fishers kingdom.', 'warning'); return;
    }
    const yard = city.buildings.some(b => b.type === 'shipyard' && b.q === shipyardQ && b.r === shipyardR);
    if (!yard) {
      get().addNotification('No shipyard at that location.', 'warning'); return;
    }
    const costs = SHIP_RECRUIT_COSTS[shipType];
    if (player.gold < costs.gold) {
      get().addNotification(`Need ${costs.gold} gold for this ship.`, 'warning'); return;
    }
    if ((costs.wood ?? 0) > 0 && (city.storage.wood ?? 0) < (costs.wood ?? 0)) {
      get().addNotification(`Need ${costs.wood} wood (logging huts).`, 'warning'); return;
    }
    if ((costs.refinedWood ?? 0) > 0 && (city.storage.refinedWood ?? 0) < (costs.refinedWood ?? 0)) {
      get().addNotification(`Need ${costs.refinedWood} refined wood (sawmill).`, 'warning'); return;
    }
    const neighbors = hexNeighbors(shipyardQ, shipyardR);
    let spawn: [number, number] | null = null;
    for (const [nq, nr] of neighbors) {
      const t = s.tiles.get(tileKey(nq, nr));
      if (t?.biome !== 'water') continue;
      const blocked = s.units.some(u => !u.aboardShipId && u.q === nq && u.r === nr && u.hp > 0);
      if (!blocked) {
        spawn = [nq, nr];
        break;
      }
    }
    if (!spawn) {
      get().addNotification('No free water hex next to the shipyard.', 'warning'); return;
    }
    const woodCost = costs.wood ?? 0;
    const rwCost = costs.refinedWood ?? 0;
    const shipItem: PendingShipRecruit = {
      id: generateId('pr'),
      playerId: HUMAN_ID,
      cityId,
      shipType,
      spawnQ: spawn[0],
      spawnR: spawn[1],
      completesAtCycle: s.cycle + 1,
    };
    set({
      players: s.players.map(p => (p.id === HUMAN_ID ? { ...p, gold: p.gold - costs.gold } : p)),
      cities: s.cities.map(c =>
        c.id === cityId
          ? {
              ...c,
              storage: {
                ...c.storage,
                wood: Math.max(0, (c.storage.wood ?? 0) - woodCost),
                refinedWood: Math.max(0, (c.storage.refinedWood ?? 0) - rwCost),
              },
            }
          : c,
      ),
      pendingRecruits: [...s.pendingRecruits, shipItem],
    });
    get().addNotification(`${UNIT_DISPLAY_NAMES[shipType]} will launch next cycle.`, 'info');
  },

  boardAdjacentShip: (shipId) => {
    const s = get();
    const ship = s.units.find(u => u.id === shipId && u.ownerId === HUMAN_ID && u.hp > 0);
    if (!ship || !isNavalUnitType(ship.type)) return;
    const cap = getShipMaxCargo(ship.type);
    if (cap <= 0) {
      get().addNotification('This ship cannot carry troops.', 'info'); return;
    }
    const cargo = [...(ship.cargoUnitIds ?? [])];
    let room = cap - cargo.length;
    if (room <= 0) {
      get().addNotification('Ship is full.', 'warning'); return;
    }
    const newUnits = s.units.map(u => {
      if (u.id === shipId) return u;
      if (room <= 0) return u;
      if (u.aboardShipId || isNavalUnitType(u.type)) return u;
      if (u.ownerId !== HUMAN_ID || u.hp <= 0) return u;
      if (hexDistance(u.q, u.r, ship.q, ship.r) !== 1) return u;
      if (s.tiles.get(tileKey(u.q, u.r))?.biome === 'water') return u;
      room -= 1;
      cargo.push(u.id);
      return {
        ...u,
        aboardShipId: ship.id,
        q: ship.q,
        r: ship.r,
        targetQ: undefined,
        targetR: undefined,
        status: 'idle' as const,
      };
    });
    set({
      units: newUnits.map(u =>
        u.id === shipId ? { ...u, cargoUnitIds: cargo } : u,
      ),
    });
    get().addNotification(`Troops boarded (${cargo.length} on ship).`, 'success');
  },

  disembarkShip: (shipId) => {
    const s = get();
    const ship = s.units.find(u => u.id === shipId && u.ownerId === HUMAN_ID && u.hp > 0);
    if (!ship || !ship.cargoUnitIds?.length) {
      get().addNotification('No cargo to unload.', 'info'); return;
    }
    const landNeighbor = hexNeighbors(ship.q, ship.r).find(([lq, lr]) => {
      const t = s.tiles.get(tileKey(lq, lr));
      return t && t.biome !== 'water' && t.biome !== 'mountain';
    });
    if (!landNeighbor) {
      get().addNotification('No adjacent land to disembark.', 'warning'); return;
    }
    const [lq, lr] = landNeighbor;
    const cargoIds = new Set(ship.cargoUnitIds);
    set({
      units: s.units.map(u => {
        if (u.id === shipId) return { ...u, cargoUnitIds: [] };
        if (!cargoIds.has(u.id) || u.aboardShipId !== ship.id) return u;
        return {
          ...u,
          aboardShipId: undefined,
          q: lq,
          r: lr,
          status: 'idle' as const,
        };
      }),
    });
    get().addNotification('Troops disembarked.', 'success');
  },

  // ─── Recruit Hero ──────────────────────────────────────────

  recruitHero: (cityId) => {
    const s = get();
    const player = s.players.find(p => p.id === HUMAN_ID);
    const city = s.cities.find(c => c.id === cityId);
    if (!player || !city) return;

    // Heroes use barracks slots only (commanders are separate).
    const playerBarracks = s.cities
      .filter(c => c.ownerId === HUMAN_ID)
      .reduce((sum, c) => sum + c.buildings.filter(b => b.type === 'barracks').length, 0);
    const pendingHeroSlots = s.pendingRecruits.filter(
      pr => 'heroKind' in pr && pr.playerId === HUMAN_ID,
    ).length;
    const playerHeroes = s.heroes.filter(h => h.ownerId === HUMAN_ID).length;
    if (playerHeroes + pendingHeroSlots >= playerBarracks) {
      get().addNotification('Need more Barracks for another hero!', 'warning');
      return;
    }

    const heroCost = 80;
    if (player.gold < heroCost) {
      get().addNotification(`Need ${heroCost} gold for a hero!`, 'warning');
      return;
    }

    const heroTypes: Array<'general' | 'logistician'> = ['general', 'logistician'];
    const pick = heroTypes[(playerHeroes + pendingHeroSlots) % heroTypes.length];

    set({
      players: s.players.map(p => (p.id === HUMAN_ID ? { ...p, gold: p.gold - heroCost } : { ...p })),
      pendingRecruits: [
        ...s.pendingRecruits,
        {
          id: generateId('pr'),
          playerId: HUMAN_ID,
          cityId,
          heroKind: pick,
          completesAtCycle: s.cycle + 1,
        },
      ],
    });
    get().addNotification(`Hero training (${pick}) — ready next economy cycle.`, 'info');
  },

  recruitCommander: (cityId) => {
    const s = get();
    const player = s.players.find(p => p.id === HUMAN_ID);
    const city = s.cities.find(c => c.id === cityId);
    if (!player || !city) return;

    if (player.gold < COMMANDER_RECRUIT_GOLD) {
      get().addNotification(`Need ${COMMANDER_RECRUIT_GOLD} gold to train a commander!`, 'warning');
      return;
    }

    const commanderSeed = (Date.now() ^ (Math.floor(Math.random() * 0x7fffffff) << 3)) >>> 0;
    set({
      players: s.players.map(p => (p.id === HUMAN_ID ? { ...p, gold: p.gold - COMMANDER_RECRUIT_GOLD } : { ...p })),
      pendingRecruits: [
        ...s.pendingRecruits,
        {
          id: generateId('pr'),
          playerId: HUMAN_ID,
          cityId,
          commanderSeed,
          completesAtCycle: s.cycle + 1,
        },
      ],
    });
    get().addNotification('Commander training — ready next economy cycle.', 'info');
  },

  assignCommanderToCityDefense: (commanderId, cityId) => {
    const s = get();
    const cmd = s.commanders.find(c => c.id === commanderId && c.ownerId === HUMAN_ID);
    const city = s.cities.find(c => c.id === cityId && c.ownerId === HUMAN_ID);
    if (!cmd || !city) {
      get().addNotification('Invalid commander or city.', 'warning');
      return;
    }
    set({
      commanders: s.commanders.map(c =>
        c.id === commanderId
          ? { ...c, assignment: { kind: 'city_defense' as const, cityId }, q: city.q, r: city.r }
          : c,
      ),
    });
    get().addNotification(`${cmd.name} assigned to defend ${city.name}.`, 'success');
  },

  assignCommanderToFieldAtSelectedHex: (commanderId) => {
    const s = get();
    const sel = s.selectedHex;
    if (!sel) {
      get().addNotification('Select a hex with your troops first.', 'warning');
      return;
    }
    const cmd = s.commanders.find(c => c.id === commanderId && c.ownerId === HUMAN_ID);
    if (!cmd) return;
    const stack = s.units.filter(
      u =>
        u.q === sel.q &&
        u.r === sel.r &&
        u.ownerId === HUMAN_ID &&
        u.hp > 0 &&
        !u.aboardShipId &&
        u.type !== 'builder' &&
        !isNavalUnitType(u.type),
    );
    const anchor = stack[0];
    if (!anchor) {
      get().addNotification('No land army on this hex to attach the commander to.', 'warning');
      return;
    }
    set({
      commanders: s.commanders.map(c =>
        c.id === commanderId
          ? {
              ...c,
              assignment: { kind: 'field' as const, anchorUnitId: anchor.id },
              q: anchor.q,
              r: anchor.r,
            }
          : c,
      ),
    });
    get().addNotification(`${cmd.name} leads the stack (anchor unit).`, 'success');
  },

  unassignCommander: (commanderId) => {
    const s = get();
    set({
      commanders: s.commanders.map(c => (c.id === commanderId && c.ownerId === HUMAN_ID ? { ...c, assignment: null } : c)),
    });
    get().addNotification('Commander assignment cleared.', 'info');
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
    const uiMode = mode === 'mine' ? 'build_mine' : mode === 'quarry' ? 'build_quarry' : mode === 'gold_mine' ? 'build_gold_mine' : mode === 'logging_hut' ? 'build_logging_hut' : 'build_road';
    set({ uiMode, roadPathSelection: [] });
    if (mode === 'mine') get().addNotification('Click a highlighted mine deposit to build.', 'info');
    else if (mode === 'quarry') get().addNotification('Click a highlighted quarry deposit to build.', 'info');
    else if (mode === 'gold_mine') get().addNotification('Click a highlighted gold deposit to build.', 'info');
    else if (mode === 'logging_hut') get().addNotification('Click a forest hex to build a logging hut.', 'info');
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
    if (type !== 'gold_mine' && type !== 'logging_hut' && tile.biome === 'mountain') return;
    const validSite = type === 'mine' ? tile.hasMineDeposit : type === 'quarry' ? tile.hasQuarryDeposit : type === 'logging_hut' ? tile.biome === 'forest' : tile.hasGoldMineDeposit;
    const typeLabel = type === 'mine' ? 'Mine' : type === 'quarry' ? 'Quarry' : type === 'logging_hut' ? 'Logging hut' : 'Gold mine';
    if (!validSite) {
      const msg = type === 'logging_hut' ? 'Logging hut must be built on forest!' : `${typeLabel} must be built on a deposit!`;
      get().addNotification(msg, 'warning'); return;
    }
    const hexKey = tileKey(q, r);
    if (s.cities.some(c => c.buildings.some(b => tileKey(b.q, b.r) === hexKey))) {
      get().addNotification('Already a building there!', 'warning'); return;
    }
    if (s.constructions.some(cs => cs.q === q && cs.r === r)) {
      get().addNotification('Already under construction!', 'warning'); return;
    }
    const player = s.players.find(p => p.id === HUMAN_ID);
    const bType = type === 'logging_hut' ? 'logging_hut' : type;
    if (!player || player.gold < BUILDING_COSTS[bType]) {
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
    const ironCost = type === 'gold_mine' ? (BUILDING_IRON_COSTS.gold_mine ?? 0) : 0;
    if (ironCost > 0 && (city.storage.iron ?? 0) < ironCost) {
      get().addNotification(`Need ${ironCost} iron at nearest city for Gold mine!`, 'warning'); return;
    }
    const builders = s.units.filter(
      u => u.q === s.selectedHex!.q && u.r === s.selectedHex!.r && u.ownerId === HUMAN_ID && u.type === 'builder' && u.hp > 0
    );
    if (builders.length === 0) { get().addNotification('Need a Builder!', 'warning'); return; }
    const builder = builders[0];
    const site: ConstructionSite = {
      id: generateId('con'), type: bType, q, r, cityId, ownerId: HUMAN_ID,
      bpRequired: BUILDING_BP_COST[bType], bpAccumulated: 0,
    };
    const newUnits = s.units.map(u =>
      u.id === builder.id
        ? {
            ...u,
            targetQ: q,
            targetR: r,
            status: 'moving' as const,
            marchInitialHexDistance: marchHexDistanceAtOrder(u, q, r),
          }
        : u
    );
    const updatedCities = s.cities.map(c =>
      c.id === cityId && ironCost > 0
        ? { ...c, storage: { ...c.storage, iron: Math.max(0, (c.storage.iron ?? 0) - ironCost) } }
        : c
    );
    set({
      constructions: [...s.constructions, site],
      cities: updatedCities,
      players: s.players.map(p => p.id === HUMAN_ID ? { ...p, gold: p.gold - BUILDING_COSTS[bType] } : p),
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
        return {
          ...u,
          targetQ: site.q,
          targetR: site.r,
          status: 'moving' as const,
          marchInitialHexDistance: marchHexDistanceAtOrder(u, site.q, site.r),
        };
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
    const maxLeg = maxMoveOrderDistanceForDestination(toQ, toR, s.territory, HUMAN_ID);
    if (dist === 0 || dist > maxLeg) {
      if (dist > maxLeg) get().addNotification(`Too far! Max ${maxLeg} hexes for this destination.`, 'warning');
      return;
    }
    const stack = s.units.filter(
      u => u.q === fromQ && u.r === fromR && u.ownerId === HUMAN_ID && u.hp > 0 && !u.aboardShipId,
    );
    if (stack.length === 0) return;
    const naval = stack.some(u => isNavalUnitType(u.type));
    if (naval && !stack.every(u => isNavalUnitType(u.type))) {
      get().addNotification('Cannot mix ships and land units in one move order.', 'warning'); return;
    }
    const destTile = s.tiles.get(tileKey(toQ, toR));
    if (!destTile) {
      get().addNotification('Cannot move there!', 'warning');
      return;
    }
    if (naval) {
      if (destTile.biome !== 'water') {
        get().addNotification('Ships can only move on water.', 'warning'); return;
      }
    } else if (destTile.biome === 'water') {
      if (!canLandStackEmbarkFriendlyScoutAt(s.tiles, s.units, toQ, toR, stack, HUMAN_ID)) {
        get().addNotification('Land units cannot enter water (need a friendly scout ship with room at destination).', 'warning'); return;
      }
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
      u => u.q === fromQ && u.r === fromR && u.ownerId === HUMAN_ID && u.hp > 0 && !u.aboardShipId,
    );
    if (readyUnits.length === 0) {
      set({ uiMode: 'normal', selectedHex: null }); return;
    }

    const dist = hexDistance(fromQ, fromR, toQ, toR);
    if (dist === 0) { set({ uiMode: 'normal', selectedHex: null }); return; }
    const maxLeg = maxMoveOrderDistanceForDestination(toQ, toR, s.territory, HUMAN_ID);
    if (dist > maxLeg) {
      get().addNotification(`Too far! Max ${maxLeg} hexes for this destination.`, 'warning');
      set({ uiMode: 'normal', selectedHex: null });
      return;
    }

    const naval = readyUnits.some(u => isNavalUnitType(u.type));
    if (naval && !readyUnits.every(u => isNavalUnitType(u.type))) {
      get().addNotification('Cannot mix ships and land units.', 'warning');
      set({ uiMode: 'normal', selectedHex: null }); return;
    }

    const destTile = s.tiles.get(tileKey(toQ, toR));
    if (!destTile) {
      get().addNotification('Cannot move there!', 'warning');
      set({ uiMode: 'normal', selectedHex: null }); return;
    }
    if (naval) {
      if (destTile.biome !== 'water') {
        get().addNotification('Ships can only move on water.', 'warning');
        set({ uiMode: 'normal', selectedHex: null }); return;
      }
    } else if (destTile.biome === 'water') {
      if (!canLandStackEmbarkFriendlyScoutAt(s.tiles, s.units, toQ, toR, readyUnits, HUMAN_ID)) {
        get().addNotification('Land units cannot enter water (need a friendly scout ship with room at destination).', 'warning');
        set({ uiMode: 'normal', selectedHex: null }); return;
      }
    }

    // Set target for all selected units — movement tick will advance them
    const newUnits = s.units.map(u => {
      if (u.q === fromQ && u.r === fromR && u.ownerId === HUMAN_ID && u.hp > 0 && !u.aboardShipId) {
        const deployed = withDeployFlags(u, toQ, toR, s.cities);
        return {
          ...deployed,
          targetQ: toQ,
          targetR: toR,
          status: 'moving' as const,
          marchInitialHexDistance: marchHexDistanceAtOrder(u, toQ, toR),
        };
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
    const newUnits = s.units.map(u => {
      if (u.q !== q || u.r !== r || u.ownerId !== HUMAN_ID || u.hp <= 0) return u;
      const deployed = withDeployFlags(u, city.q, city.r, s.cities);
      return {
        ...deployed,
        defendCityId: cityId,
        targetQ: city.q,
        targetR: city.r,
        status: 'moving' as const,
        marchInitialHexDistance: marchHexDistanceAtOrder(u, city.q, city.r),
      };
    });
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

  openBattleModal: (hexKey?: string) => {
    const s = get();
    if (hexKey) {
      set({ battleModalHexKey: hexKey });
      return;
    }
    const byHex: Record<string, import('@/types/game').Unit[]> = {};
    for (const u of s.units) {
      if (u.hp <= 0 || u.aboardShipId) continue;
      const k = tileKey(u.q, u.r);
      if (!byHex[k]) byHex[k] = [];
      byHex[k].push(u);
    }
    const keys: string[] = [];
    for (const [k, arr] of Object.entries(byHex)) {
      if (new Set(arr.map(u => u.ownerId)).size < 2) continue;
      if (arr.some(u => u.ownerId === HUMAN_ID)) keys.push(k);
    }
    if (keys.length === 0) return;
    set({ battleModalHexKey: keys[0] });
  },

  closeBattleModal: () => set({ battleModalHexKey: null }),

  openTacticalMode: () => {
    set({
      pendingTacticalOrders: {},
      tacticalSelectedStackKeys: [],
      assigningTacticalForSelectedStacks: null,
      assigningTacticalForStack: null,
      assigningTacticalOrderType: null,
      tacticalAttackCityDraft: null,
    });
  },

  cancelTacticalMode: () => {
    set({
      pendingTacticalOrders: null,
      tacticalSelectedStackKeys: [],
      assigningTacticalForSelectedStacks: null,
      assigningTacticalForStack: null,
      assigningTacticalOrderType: null,
      tacticalAttackCityDraft: null,
    });
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
    const stackKeys = humanStackKeysForTactical(s);
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
    if (orderType !== 'move' && orderType !== 'intercept') return;
    const tile = s.tiles.get(tileKey(toQ, toR));
    if (!tile) return;
    const maxLeg = maxMoveOrderDistanceForDestination(toQ, toR, s.territory, HUMAN_ID);
    const next = { ...s.pendingTacticalOrders };
    let any = false;
    for (const stackKey of stackKeys) {
      const [fromQ, fromR] = stackKey.split(',').map(Number);
      const dist = hexDistance(fromQ, fromR, toQ, toR);
      if (dist > maxLeg || dist === 0) continue;
      const stackUnits = s.units.filter(
        u => u.q === fromQ && u.r === fromR && u.ownerId === HUMAN_ID && u.hp > 0 && !u.aboardShipId,
      );
      if (tile.biome === 'water') {
        if (!canLandStackEmbarkFriendlyScoutAt(s.tiles, s.units, toQ, toR, stackUnits, HUMAN_ID)) continue;
      } else {
        if (stackUnits.some(u => isNavalUnitType(u.type))) continue;
      }
      next[stackKey] = { type: orderType, toQ, toR };
      any = true;
    }
    if (!any) {
      get().addNotification(
        tile.biome === 'water'
          ? `No land stack in range with a valid scout-ship embark at (${toQ}, ${toR}), or max ${maxLeg} hexes exceeded.`
          : `No stack in range (max ${maxLeg} hexes for this destination).`,
        'warning',
      );
      return;
    }
    set({ pendingTacticalOrders: next, assigningTacticalForSelectedStacks: null });
    get().addNotification(`${stackKeys.length} stack(s) → (${toQ}, ${toR}). Confirm when ready.`, 'info');
  },

  setTacticalIncorporateTargetForSelected: (toQ, toR) => {
    const s = get();
    const pending = s.assigningTacticalForSelectedStacks;
    if (!pending || pending.orderType !== 'incorporate_village' || s.pendingTacticalOrders === null) return;
    const tile = s.tiles.get(tileKey(toQ, toR));
    if (!tile || tile.biome === 'water') {
      get().addNotification('Invalid hex (water).', 'warning');
      return;
    }
    if (!tile.hasVillage) {
      get().addNotification('Choose a hex with a neutral village.', 'warning');
      return;
    }
    if (s.cities.some(c => c.q === toQ && c.r === toR)) {
      get().addNotification('That hex already has a city.', 'warning');
      return;
    }
    const maxLeg = maxMoveOrderDistanceForDestination(toQ, toR, s.territory, HUMAN_ID);
    const { stackKeys } = pending;
    const next = { ...s.pendingTacticalOrders };
    let any = false;
    for (const stackKey of stackKeys) {
      const [fromQ, fromR] = stackKey.split(',').map(Number);
      const dist = hexDistance(fromQ, fromR, toQ, toR);
      if (dist <= maxLeg && dist > 0) {
        next[stackKey] = { type: 'incorporate_village', toQ, toR };
        any = true;
      }
    }
    if (!any) {
      get().addNotification(`No stack in range (max ${maxLeg} hexes for this destination).`, 'warning');
      return;
    }
    set({ pendingTacticalOrders: next, assigningTacticalForSelectedStacks: null });
    get().addNotification('Incorporate orders set — click Confirm orders.', 'info');
  },

  setTacticalAttackCityTargetForSelected: (toQ, toR) => {
    const s = get();
    const pending = s.assigningTacticalForSelectedStacks;
    if (!pending || pending.orderType !== 'attack_city' || s.pendingTacticalOrders === null) return;
    const city = s.cities.find(c => c.q === toQ && c.r === toR);
    if (!city) {
      get().addNotification('No city at this hex — click an enemy city center.', 'warning');
      return;
    }
    if (city.ownerId === HUMAN_ID) {
      get().addNotification('That is your city. Pick an enemy city.', 'warning');
      return;
    }
    const maxLeg = maxMoveOrderDistanceForDestination(toQ, toR, s.territory, HUMAN_ID);
    const { stackKeys } = pending;
    const inRange = stackKeys.filter(sk => {
      const [fromQ, fromR] = sk.split(',').map(Number);
      const dist = hexDistance(fromQ, fromR, toQ, toR);
      return dist <= maxLeg && dist > 0;
    });
    if (inRange.length === 0) {
      get().addNotification(`No stack in range (max ${maxLeg} hexes for this destination).`, 'warning');
      return;
    }
    set({
      tacticalAttackCityDraft: {
        stackKeys: inRange,
        cityId: city.id,
        cityQ: city.q,
        cityR: city.r,
        cityName: city.name,
      },
      assigningTacticalForSelectedStacks: null,
    });
    get().addNotification(`Configure attack on ${city.name}…`, 'info');
  },

  commitTacticalAttackCitySetup: (payload) => {
    const s = get();
    const draft = s.tacticalAttackCityDraft;
    if (!draft || s.pendingTacticalOrders === null) return;
    const city = s.cities.find(c => c.id === draft.cityId);
    if (!city) {
      set({ tacticalAttackCityDraft: null });
      return;
    }
    const next = { ...s.pendingTacticalOrders };
    let placed = 0;
    for (const stackKey of draft.stackKeys) {
      const [fromQ, fromR] = stackKey.split(',').map(Number);
      const dist = hexDistance(fromQ, fromR, city.q, city.r);
      const maxLeg = maxMoveOrderDistanceForDestination(city.q, city.r, s.territory, HUMAN_ID);
      if (dist > maxLeg || dist === 0) continue;
      const form = payload.perStack[stackKey];
      if (!form) continue;
      const stackUnits = s.units.filter(
        u => u.q === fromQ && u.r === fromR && u.ownerId === HUMAN_ID && u.hp > 0,
      );
      let w1ids: string[];
      let w2ids: string[];
      if (payload.useWaves) {
        w1ids = selectUnitIdsByTypeCounts(stackUnits, form.wave1);
        const used = new Set(w1ids);
        w2ids = selectUnitIdsByTypeCounts(stackUnits, form.wave2, used);
        if (w1ids.length === 0 && w2ids.length === 0) continue;
        if (w2ids.length > 0 && w1ids.length === 0) {
          get().addNotification('Wave 1 cannot be empty if wave 2 has units.', 'warning');
          return;
        }
      } else {
        w1ids = selectUnitIdsByTypeCounts(stackUnits, form.wave1);
        w2ids = [];
        if (w1ids.length === 0) continue;
      }
      next[stackKey] = {
        type: 'attack_city',
        cityId: draft.cityId,
        attackStyle: payload.attackStyle,
        wave1UnitIds: w1ids,
        wave2UnitIds: w2ids,
      };
      placed++;
    }
    if (placed === 0) {
      get().addNotification('No valid stacks or units for this attack.', 'warning');
      return;
    }
    set({ pendingTacticalOrders: next, tacticalAttackCityDraft: null });
    get().addNotification(`Attack plan set for ${city.name} — Confirm orders.`, 'info');
  },

  cancelTacticalAttackCityDraft: () => set({ tacticalAttackCityDraft: null }),

  beginSiegeAssaultOnCity: (cityId) => {
    const s = get();
    const city = s.cities.find(c => c.id === cityId);
    if (!city) return;
    set({
      units: s.units.map(u => {
        if (u.ownerId !== HUMAN_ID || u.hp <= 0 || u.siegingCityId !== cityId) return u;
        const deployed = withDeployFlags(u, city.q, city.r, s.cities);
        const nextU: Unit = {
          ...deployed,
          targetQ: city.q,
          targetR: city.r,
          status: 'moving',
          assaulting: true,
          marchInitialHexDistance: marchHexDistanceAtOrder(u, city.q, city.r),
        };
        delete nextU.siegingCityId;
        if (nextU.incorporateVillageAt) delete nextU.incorporateVillageAt;
        return nextU;
      }),
    });
    get().addNotification(`Assault on ${city.name}!`, 'danger');
  },

  setTacticalDefendForSelected: (cityId) => {
    const s = get();
    if (s.pendingTacticalOrders === null) return;
    const stackKeys = humanStackKeysForTactical(s);
    if (stackKeys.length === 0) return;
    const city = s.cities.find(c => c.id === cityId && c.ownerId === HUMAN_ID);
    if (!city) return;
    const next = { ...s.pendingTacticalOrders };
    let placed = 0;
    for (const k of stackKeys) {
      const [fromQ, fromR] = k.split(',').map(Number);
      const dist = hexDistance(fromQ, fromR, city.q, city.r);
      if (dist > 0 && isWithinPlayerMoveOrderRange(fromQ, fromR, city.q, city.r, s.territory, HUMAN_ID)) {
        next[k] = { type: 'defend', cityId };
        placed++;
      }
    }
    if (placed === 0) {
      get().addNotification('No selected stack is in range of that city.', 'warning');
      return;
    }
    set({ pendingTacticalOrders: next });
    get().addNotification(`${placed} stack(s) set to defend. Confirm when ready.`, 'info');
  },

  setTacticalDefendTargetFromMap: (q, r) => {
    const s = get();
    const pending = s.assigningTacticalForSelectedStacks;
    if (!pending || pending.orderType !== 'defend_pick' || s.pendingTacticalOrders === null) return;
    const city = s.cities.find(c => c.q === q && c.r === r && c.ownerId === HUMAN_ID);
    if (!city) {
      get().addNotification('Click your city center hex to defend.', 'warning');
      return;
    }
    const { stackKeys } = pending;
    const next = { ...s.pendingTacticalOrders };
    let any = false;
    for (const stackKey of stackKeys) {
      const [fromQ, fromR] = stackKey.split(',').map(Number);
      if (isWithinPlayerMoveOrderRange(fromQ, fromR, city.q, city.r, s.territory, HUMAN_ID)) {
        next[stackKey] = { type: 'defend', cityId: city.id };
        any = true;
      }
    }
    if (!any) {
      get().addNotification('No stack is in range of that city for this move leg.', 'warning');
      return;
    }
    set({ pendingTacticalOrders: next, assigningTacticalForSelectedStacks: null });
    get().addNotification(`Defend ${city.name} — Confirm orders.`, 'info');
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
    const maxLeg = maxMoveOrderDistanceForDestination(toQ, toR, s.territory, HUMAN_ID);
    if (dist > maxLeg || dist === 0) {
      if (dist > maxLeg) get().addNotification(`Too far! Max ${maxLeg} hexes for this destination.`, 'warning');
      set({ assigningTacticalForStack: null, assigningTacticalOrderType: null });
      return;
    }
    const stack = s.units.filter(
      u => u.q === fromQ && u.r === fromR && u.ownerId === HUMAN_ID && u.hp > 0 && !u.aboardShipId,
    );
    const destTile = s.tiles.get(tileKey(toQ, toR));
    if (!destTile) {
      set({ assigningTacticalForStack: null, assigningTacticalOrderType: null });
      return;
    }
    const naval = stack.some(u => isNavalUnitType(u.type));
    if (naval && !stack.every(u => isNavalUnitType(u.type))) {
      set({ assigningTacticalForStack: null, assigningTacticalOrderType: null });
      return;
    }
    if (naval) {
      if (destTile.biome !== 'water') {
        get().addNotification('Ships can only move on water.', 'warning');
        set({ assigningTacticalForStack: null, assigningTacticalOrderType: null });
        return;
      }
    } else if (destTile.biome === 'water') {
      if (!canLandStackEmbarkFriendlyScoutAt(s.tiles, s.units, toQ, toR, stack, HUMAN_ID)) {
        get().addNotification('Need a friendly scout ship with cargo at that water hex.', 'warning');
        set({ assigningTacticalForStack: null, assigningTacticalOrderType: null });
        return;
      }
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
        const dDef = hexDistance(fromQ, fromR, city.q, city.r);
        if (dDef === 0 || !isWithinPlayerMoveOrderRange(fromQ, fromR, city.q, city.r, s.territory, HUMAN_ID)) continue;
        units = units.map(u => {
          if (u.q !== fromQ || u.r !== fromR || u.ownerId !== HUMAN_ID || u.hp <= 0) return u;
          const deployed = withDeployFlags(u, city.q, city.r, s.cities);
          return {
            ...deployed,
            defendCityId: city.id,
            targetQ: city.q,
            targetR: city.r,
            status: 'moving' as const,
            marchInitialHexDistance: marchHexDistanceAtOrder(u, city.q, city.r),
          };
        });
        notifs.push(`Stack at (${fromQ},${fromR}) defending ${city.name}`);
      } else if (order.type === 'incorporate_village' && order.toQ !== undefined && order.toR !== undefined) {
        const toQ = order.toQ;
        const toR = order.toR;
        const tile = s.tiles.get(tileKey(toQ, toR));
        if (!tile || tile.biome === 'water' || !tile.hasVillage) continue;
        if (s.cities.some(c => c.q === toQ && c.r === toR)) continue;
        const dist = hexDistance(fromQ, fromR, toQ, toR);
        if (dist === 0 || !isWithinPlayerMoveOrderRange(fromQ, fromR, toQ, toR, s.territory, HUMAN_ID)) continue;
        units = units.map(u => {
          if (u.q !== fromQ || u.r !== fromR || u.ownerId !== HUMAN_ID || u.hp <= 0) return u;
          if (!isLandMilitaryUnit(u)) return u;
          const deployed = withDeployFlags(u, toQ, toR, s.cities);
          return {
            ...deployed,
            targetQ: toQ,
            targetR: toR,
            status: 'moving' as const,
            incorporateVillageAt: { q: toQ, r: toR },
            assaulting: false,
            marchInitialHexDistance: marchHexDistanceAtOrder(u, toQ, toR),
          };
        });
        notifs.push(`Stack at (${fromQ},${fromR}) → incorporate village (${toQ},${toR})`);
      } else if (order.type === 'attack_city' && order.cityId) {
        const city = s.cities.find(c => c.id === order.cityId);
        if (!city || city.ownerId === HUMAN_ID) continue;
        const toQ = city.q;
        const toR = city.r;
        const dist = hexDistance(fromQ, fromR, toQ, toR);
        if (dist === 0 || !isWithinPlayerMoveOrderRange(fromQ, fromR, toQ, toR, s.territory, HUMAN_ID)) continue;
        const w1 = new Set(order.wave1UnitIds ?? []);
        const w2 = new Set(order.wave2UnitIds ?? []);
        const participate = new Set([...w1, ...w2]);
        const march = getAttackMarchParams(order.attackStyle, city, fromQ, fromR, s.tiles);
        units = units.map(u => {
          if (u.q !== fromQ || u.r !== fromR || u.ownerId !== HUMAN_ID || u.hp <= 0) return u;
          if (u.type === 'builder' || u.aboardShipId || isNavalUnitType(u.type)) return u;
          if (!participate.has(u.id)) {
            if (!u.assaulting && !u.siegingCityId && !u.attackWaveHold) return u;
            const cleared: Unit = { ...u };
            delete cleared.assaulting;
            delete cleared.siegingCityId;
            delete cleared.attackWaveHold;
            return cleared;
          }
          if (w2.has(u.id)) {
            const deployed = withDeployFlags(u, march.targetQ, march.targetR, s.cities);
            const next: Unit = {
              ...deployed,
              status: 'idle' as const,
              targetQ: undefined,
              targetR: undefined,
              assaulting: false,
              attackWaveHold: {
                waitForUnitIds: [...w1],
                cityId: city.id,
                rallyQ: march.rallyQ,
                rallyR: march.rallyR,
                centerQ: march.centerQ,
                centerR: march.centerR,
                attackStyle: order.attackStyle,
              },
            };
            delete next.siegingCityId;
            if (next.incorporateVillageAt) delete next.incorporateVillageAt;
            return next;
          }
          const deployed = withDeployFlags(u, march.targetQ, march.targetR, s.cities);
          const next: Unit = {
            ...deployed,
            targetQ: march.targetQ,
            targetR: march.targetR,
            status: 'moving' as const,
            assaulting: march.assaulting,
            marchInitialHexDistance: marchHexDistanceAtOrder(u, march.targetQ, march.targetR),
          };
          if (march.siegingCityId) next.siegingCityId = march.siegingCityId;
          else delete next.siegingCityId;
          if (next.incorporateVillageAt) delete next.incorporateVillageAt;
          return next;
        });
        notifs.push(`Stack at (${fromQ},${fromR}) → attack ${city.name}`);
      } else if ((order.type === 'move' || order.type === 'intercept') && order.toQ !== undefined && order.toR !== undefined) {
        const toQ = order.toQ;
        const toR = order.toR;
        const tile = s.tiles.get(tileKey(toQ, toR));
        if (!tile) continue;
        const dist = hexDistance(fromQ, fromR, toQ, toR);
        if (dist === 0 || !isWithinPlayerMoveOrderRange(fromQ, fromR, toQ, toR, s.territory, HUMAN_ID)) continue;
        const marchStack = stackUnits.filter(u => !u.aboardShipId);
        if (tile.biome === 'water') {
          if (!canLandStackEmbarkFriendlyScoutAt(s.tiles, units, toQ, toR, marchStack, HUMAN_ID)) continue;
        } else if (marchStack.some(u => isNavalUnitType(u.type))) continue;
        units = units.map(u => {
          if (u.q !== fromQ || u.r !== fromR || u.ownerId !== HUMAN_ID || u.hp <= 0) return u;
          const deployed = withDeployFlags(u, toQ, toR, s.cities);
          return {
            ...deployed,
            targetQ: toQ,
            targetR: toR,
            status: 'moving' as const,
            assaulting: false,
            marchInitialHexDistance: marchHexDistanceAtOrder(u, toQ, toR),
          };
        });
        notifs.push(`Stack at (${fromQ},${fromR}) → (${toQ},${toR})`);
      }
    }
    set({
      units,
      pendingTacticalOrders: null,
      tacticalSelectedStackKeys: [],
      assigningTacticalForSelectedStacks: null,
      assigningTacticalForStack: null,
      assigningTacticalOrderType: null,
      tacticalAttackCityDraft: null,
    });
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
    const newUnits = s.units.map(u => {
      if (!ids.has(u.id)) return u;
      const moved: Unit = { ...u, q: toQ, r: toR, targetQ: undefined, targetR: undefined, status: 'idle' as const };
      delete moved.marchInitialHexDistance;
      delete moved.moveLegMs;
      return isLandMilitaryUnit(moved)
        ? { ...moved, garrisonCityId: undefined, defendCityId: undefined }
        : moved;
    });
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

    const tile = s.tiles.get(tileKey(q, r));
    if (!tile || !tile.hasVillage) {
      get().addNotification('No village here!', 'warning');
      return;
    }

    const militaryHere = s.units.filter(
      u => u.q === q && u.r === r && u.ownerId === HUMAN_ID && u.hp > 0 && u.type !== 'builder'
    );
    if (militaryHere.length === 0) {
      get().addNotification('Need military units at this village!', 'warning');
      return;
    }

    if (player.gold < VILLAGE_INCORPORATE_COST) {
      get().addNotification(`Need ${VILLAGE_INCORPORATE_COST} gold to incorporate village!`, 'warning');
      return;
    }

    if (s.cities.some(c => c.q === q && c.r === r)) {
      get().addNotification('Already a city here!', 'warning');
      return;
    }

    if (s.pendingIncorporations.some(p => p.q === q && p.r === r && p.playerId === HUMAN_ID)) {
      get().addNotification('Incorporation already queued for this village.', 'info');
      return;
    }

    const playersAfterGold = s.players.map(p =>
      p.id === HUMAN_ID ? { ...p, gold: p.gold - VILLAGE_INCORPORATE_COST } : p
    );
    const item: PendingIncorporationItem = {
      id: generateId('pinc'),
      playerId: HUMAN_ID,
      q,
      r,
      completesAtCycle: s.cycle + 1,
      alreadyPaidGold: true,
    };
    set({
      players: playersAfterGold,
      pendingIncorporations: [...s.pendingIncorporations, item],
    });
    get().addNotification(
      `Incorporating village — completes next economy cycle (${VILLAGE_INCORPORATE_COST} gold spent).`,
      'info',
    );
  },

  assignScrollToUnit: (scrollItemId, unitId) => {
    const s = get();
    const human = s.players.find(p => p.isHuman);
    if (!human) return;
    const inv = [...(s.scrollInventory[human.id] ?? [])];
    const idx = inv.findIndex(x => x.id === scrollItemId);
    if (idx < 0) return;
    const unit = s.units.find(u => u.id === unitId);
    if (!unit || unit.ownerId !== human.id || unit.hp <= 0) return;
    if (unit.type === 'builder' || isNavalUnitType(unit.type)) {
      get().addNotification('Only land armies can carry scrolls.', 'warning');
      return;
    }
    if (s.scrollAttachments.some(a => a.carrierUnitId === unitId)) {
      get().addNotification('That unit already carries a scroll.', 'warning');
      return;
    }
    const scroll = inv[idx];
    inv.splice(idx, 1);
    const att: ScrollAttachment = {
      id: generateId('satt'),
      scrollId: scroll.id,
      kind: scroll.kind,
      carrierUnitId: unitId,
      ownerId: human.id,
    };
    set({
      scrollInventory: { ...s.scrollInventory, [human.id]: inv },
      scrollAttachments: [...s.scrollAttachments, att],
    });
    get().addNotification(`${SCROLL_DISPLAY_NAME[scroll.kind]} assigned to ${UNIT_DISPLAY_NAMES[unit.type]}.`, 'success');
  },

  unassignScrollFromUnit: (unitId) => {
    const s = get();
    const human = s.players.find(p => p.isHuman);
    if (!human) return;
    const att = s.scrollAttachments.find(a => a.carrierUnitId === unitId && a.ownerId === human.id);
    if (!att) return;
    const unit = s.units.find(u => u.id === unitId);
    if (!unit || unit.ownerId !== human.id) return;
    const item: ScrollItem = { id: att.scrollId, kind: att.kind };
    set({
      scrollAttachments: s.scrollAttachments.filter(a => a.id !== att.id),
      scrollInventory: {
        ...s.scrollInventory,
        [human.id]: [...(s.scrollInventory[human.id] ?? []), item],
      },
    });
    get().addNotification(`${SCROLL_DISPLAY_NAME[item.kind]} returned to inventory.`, 'info');
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
  getUnitsAt: (q, r) => get().units.filter(u => u.q === q && u.r === r && !u.aboardShipId),
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
    return s.selectedHex
      ? s.units.filter(u => u.q === s.selectedHex!.q && u.r === s.selectedHex!.r && u.ownerId === HUMAN_ID && !u.aboardShipId)
      : [];
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
    const jobTypes: BuildingType[] = ['farm', 'banana_farm', 'factory', 'market', 'quarry', 'mine', 'gold_mine', 'city_center', 'barracks', 'academy', 'sawmill', 'port', 'shipyard', 'fishery', 'logging_hut'];
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
      || get().constructions.some(cs => tileKey(cs.q, cs.r) === key)
      || get().defenseInstallations.some(d => tileKey(d.q, d.r) === key);
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
      const newVisible = computeVisibleHexes(HUMAN_ID, s.cities, s.units, s.heroes, s.tiles, s.scoutTowers ?? [], s.commanders ?? []);
      set({ visibleHexes: newVisible });
    }
  },
}));
