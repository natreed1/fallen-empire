import { create } from 'zustand';
import {
  Tile, MapConfig, DEFAULT_MAP_CONFIG, City, Unit, Player, Hero,
  GameNotification, TerritoryInfo, GamePhase, UIMode, FoodPriority,
  BuildingType, UnitType, ArmyStance, CityBuilding, ConstructionSite, ScoutMission, ScoutTower,
  DefenseInstallation, DefenseTowerType, DefenseTowerLevel,
  DEFENSE_TOWER_MAX_PER_CITY, DEFENSE_TOWER_LEVEL_COSTS, getDefenseTowerBpCost, DEFENSE_TOWER_DISPLAY_NAME,
  WeatherEvent, WallSection, RoadConstructionSite, ROAD_BP_COST,
  tileKey, parseTileKey, generateId, hexDistance, hexNeighbors, getHexRing, hexTouchesBiome,
  STARTING_GOLD, STARTING_CITY_TEMPLATE, VILLAGE_CITY_TEMPLATE, VILLAGE_INCORPORATE_COST,
  EMPTY_MAP_QUADRANTS, MAP_QUADRANT_LABELS,
  TRADE_MAP_QUADRANT_GOLD, TRADE_MAP_FULL_ATLAS_GOLD, TRADE_RESOURCE_PACK_GOLD, TRADE_MORALE_FESTIVAL_GOLD,
  TRADE_MORALE_FESTIVAL_DELTA, TRADE_ROYAL_SURVEY_GOLD,
  SOCIAL_BAR_UPGRADE_COSTS,
  type MapQuadrantId,
  type ScrollKind,
  CITY_CENTER_STORAGE, FRONTIER_CYCLES,
  isNavalUnitType, SHIP_RECRUIT_COSTS, getShipMaxCargo,
  PLAYER_COLORS, CITY_NAMES,
  BUILDING_COSTS, UNIT_COSTS, UNIT_L2_COSTS, UNIT_L3_COSTS, UNIT_BASE_STATS, UNIT_L2_STATS, UNIT_DISPLAY_NAMES,
  getUnitDisplayName,
  migrateLegacyArcherDoctrine,
  cityHasL3Barracks,
  ARMS_TIER_LABELS,
  type RangedVariant,
  BUILDING_BP_COST, BUILDING_JOBS, getBuildingJobs, getUnitStats, BP_RATE_BASE,
  TREBUCHET_FIELD_BP_COST, TREBUCHET_FIELD_GOLD_COST, TREBUCHET_REFINED_WOOD_COST,
  DEFENDER_IRON_COST,
  SCOUT_TOWER_BP_COST, SCOUT_TOWER_GOLD_COST,
  SCOUT_MISSION_COST, SCOUT_MISSION_DURATION_SEC,
  GAME_DURATION_SEC, CYCLE_INTERVAL_SEC,
  BARACKS_UPGRADE_COST, BARACKS_L3_UPGRADE_COST, FACTORY_UPGRADE_COST, FARM_UPGRADE_COST, RESOURCE_MINE_UPGRADE_COST, WALL_SECTION_STONE_COST,
  WALL_BUILDER_STONE_PER_CYCLE_PER_SLOT,
  UNIVERSITY_UPGRADE_COSTS,
  BUILDER_TASK_LABELS,
  type BuilderTask,
  KingdomId, DEFAULT_KINGDOM_ID, TRADER_CONSTRUCTION_SPEED_MULT,
  KINGDOM_DISPLAY_NAMES, pickAiKingdom, pickOpponentKingdoms, pickKingdomsForSpectateBots,
  AI_PLAYER_IDS, aiPlayerColorBySlot,
  CITY_CAPTURE_HOLD_MS,
  GARRISON_PATROL_RADIUS_MIN, GARRISON_PATROL_RADIUS_MAX,
  TERRITORY_RADIUS,
  WORKERS_PER_LEVEL, BUILDING_IRON_COSTS,
  RETREAT_DELAY_MS, ASSAULT_ATTACK_DEBUFF, WALL_SECTION_HP, WALL_SECTION_BP_COST,
  AttackCityStyle,
  SpecialRegion,
  SpecialRegionKind,
  ScrollRelicSite,
  ScrollItem,
  ScrollAttachment,
  SCROLL_DISPLAY_NAME,
  scrollItemDisplayName,
  emptyScrollRegionClaimed,
  Commander,
  CommanderDraftOption,
  COMMANDER_STARTING_PICK,
  COMMANDER_RECRUIT_GOLD,
  type AbilityId,
  ABILITY_DEFS,
  getAbilityForUnit,
  type MajorEngagementDoctrine,
  type UnitStack,
  type OperationalArmy,
  type ArmyMarchSpreadMode,
  type ArmyCompositionEntry,
  ensureCityBuildingHp,
  isCityBuildingOperational,
  UNIT_HP_REGEN_FRACTION_PER_CYCLE,
  PATROL_DEFAULT_RADIUS,
  RUINS_REPAIR_GOLD_RATIO,
  defaultCityBuildingMaxHp,
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
import {
  appendStartingBarracksToCity,
  appendStartingAcademyToCity,
  findRandomStartHexWithFallback,
  findFishersStartingBuildings,
  isCapitalStartHex,
  clearVillageForCapitalTile,
} from '@/lib/kingdomSpawn';
import { getCityTerritory } from '@/lib/territory';
import { computeContestedZoneHexKeys, applyContestedZonePayout } from '@/lib/contestedZone';
import { calculateTerritory, findCityForRefinedWoodSpend, maxMoveOrderDistanceForDestination, isWithinPlayerMoveOrderRange } from '@/lib/territory';
import { processEconomyTurn, computeEmpireIncomeStatement } from '@/lib/gameLoop';
import {
  planAiTurn,
  placeAiStartingCity,
  placeAiStartingCityAt,
  placeAiStartingCitiesSequential,
  placeManyAiCapitalsApart,
} from '@/lib/ai';
import { getAiParams } from '@/lib/aiParams';
import {
  movementTick,
  combatTick,
  type CombatTickMajorEngagementOptions,
  coastalBombardmentTick,
  upkeepTick,
  siegeTick,
  siegeBuildingsTick,
  landUnitBuildingDamageTick,
  autoEmbarkLandUnitsOntoScoutShipsAtHex,
  landMilitaryContestsCityCapture,
  enemyIntactWallOnCityHex,
  type DefenseVolleyFx,
  type RangedShotFx,
} from '@/lib/military';
import { computeArmyReplenishment, updateArmyRallyFromUnits, mergeCompositionEntry } from '@/lib/armyReplenishment';
import { computeVisibleHexes } from '@/lib/vision';
import { rollForWeatherEvent, tickWeatherEvent, weatherAnnouncement, getWeatherHarvestMultiplier } from '@/lib/weather';
import {
  withDeployFlags,
  applyDeployFlagsForMoveMutable,
  withoutPatrolFields,
  clearPatrolFieldsMutable,
  isLandMilitaryUnit,
  marchHexDistanceAtOrder,
} from '@/lib/garrison';
import {
  getAttackMarchParams,
  selectUnitIdsByTypeCounts,
  releaseAttackWaveHolds,
  releaseMarchEchelonHolds,
  unitIdsMatchingTypes,
  TACTICAL_FILTER_LAND_TYPES,
} from '@/lib/siege';
import { tickScrollRelicPickup, returnScrollsForDeadCarriers } from '@/lib/scrolls';
import {
  computeConstructionAvailableBp,
  computeRoadAvailableBp,
  getUniversityBuilderSlots,
  getUniversitySlotTasks,
  fillUniversitySlotTasks,
  cityUniversityHasSlotTask,
} from '@/lib/builders';
import { getNextWallBuildHex, countDefensesTaskSlots } from '@/lib/wallBuilding';
import { planHumanBuilderAutomation } from '@/lib/builderAutomation';
import { pruneEndedMajorEngagements } from '@/lib/majorEngagement';
import type { SiegeTacticId } from '@/lib/siegeTactics';
import {
  buildWaveGroupsFromTactic,
  mergeUnassignedUnitIdsIntoFirstWave,
  splitOversizedWaves,
  firstWaveMaxFromWidth,
  targetWaveCountFromDepth,
} from '@/lib/siegeTactics';
import { assignSpatialFormationTargets } from '@/lib/formationPlacement';

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
  /** Unit stacks (training templates + auto-replenish + rally). */
  unitStacks: UnitStack[];
  /** Player-created armies only (units use `armyId`; not auto-listed from map stacks). */
  operationalArmies: OperationalArmy[];
  /** When assigning city defense from tactical bar: auto_engage vs stagnant. */
  tacticalCityDefenseMode: 'auto_engage' | 'stagnant';
  setTacticalCityDefenseMode: (mode: 'auto_engage' | 'stagnant') => void;
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
  /** Per-stack morale tracked across combat ticks */
  combatMoraleState: import('@/lib/combat').MoraleState;
  /** Recent kill events for UI kill feed */
  combatKillFeed: import('@/lib/military').CombatKillEvent[];
  /** Purple hotspot between the two main rivals; gold or iron every 2nd cycle if one side has more troops in zone. */
  contestedZoneHexKeys: string[];

  /** Metadata for scroll terrain flavors (names/tints); actual tiles use Tile.specialTerrainKind). */
  specialRegions: SpecialRegion[];
  /** Seeded relic sites (one per special terrain flavor on the map). */
  scrollRelics: ScrollRelicSite[];
  /** Per named region, player ids who claimed that region's relic scroll. */
  scrollRegionClaimed: Record<SpecialRegionKind, string[]>;
  /** playerId -> scroll items not assigned to a unit. */
  scrollInventory: Record<string, ScrollItem[]>;
  /** Scrolls carried by units (bonuses apply to the whole stack at that hex). */
  scrollAttachments: ScrollAttachment[];
  /** Lore modal after picking up a regional relic (human only). */
  scrollRelicPickupModal: { regionKind: SpecialRegionKind; kind: ScrollKind } | null;
  clearScrollRelicPickupModal: () => void;

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

  /** Current enemy/unit line-of-sight (units, buildings, owned-territory +2 ring, map quadrants). */
  visibleHexes: Set<string>;
  /** Terrain once seen stays revealed; updated by merging each recompute + scouts + incorporate. */
  exploredHexes: Set<string>;
  pendingCityHex: { q: number; r: number } | null;

  // UI
  selectedHex: { q: number; r: number } | null;
  uiMode: UIMode;
  pendingMove: { toQ: number; toR: number } | null;
  pendingDefenseBuild: { towerType: DefenseTowerType; level: DefenseTowerLevel; cityId: string } | null;
  /** Set at each economy runCycle: city paid wall builder stone upkeep this cycle (BP for walls gated if false). */
  wallEconomyStonePaidByCity: Record<string, boolean>;
  wallSections: WallSection[];
  roadPathSelection: { q: number; r: number }[];  // hexes selected for road drag
  supplyViewTab: 'normal' | 'supply';
  /** Territory on the map: tinted hex fill vs dashed outline on borders. */
  territoryDisplayStyle: 'fill' | 'dashed';
  selectedClusterKey: string | null;
  lastClickHex: { q: number; r: number } | null;
  lastClickTime: number;
  /** When non-null, battle report modal is open for this `tileKey(q,r)`. */
  battleModalHexKey: string | null;
  /** Per-hex per-player major engagement doctrine (same-hex land battles meeting army threshold). */
  majorEngagementStrategyByHex: Record<string, Record<string, MajorEngagementDoctrine>>;
  /** After closing city modal, ignore map clicks briefly so the same gesture does not hit the canvas (R3F). */
  mapClickSuppressionUntilMs: number;
  /** Full city / logistics modal — opened from hex panel, not automatically on city click. */
  cityLogisticsOpen: boolean;
  /** City capture: cityId -> { attackerId, startedAt } when attacker holds center; capture after 5s */
  cityCaptureHold: Record<string, { attackerId: string; startedAt: number }>;
  /** Human: show L3 archer doctrine modal for this city id. */
  archerDoctrineModalCityId: string | null;

  /** Units/ships spawn at end of `completesAtCycle` (one economy cycle delay). */
  pendingRecruits: PendingRecruitItem[];
  /** Village incorporation resolves at end of `completesAtCycle`. */
  pendingIncorporations: PendingIncorporationItem[];

  /** Tactical panel: key = tileKey(q,r) of stack; null = tactical mode off */
  pendingTacticalOrders: Record<string, TacticalStackOrder> | null;
  /** Stacks selected in tactical panel (highlighted hex groups; used when order scope is “selected”) */
  tacticalSelectedStackKeys: string[];
  /** Who receives orders from the bottom bar: all human hexes, only selected hexes, or one field army’s hexes. */
  tacticalOrderScope: 'all' | 'selected' | 'army';
  /** When `tacticalOrderScope` is `army`, which operational army id. */
  tacticalOrderScopeArmyId: string | null;
  /** When not `all`, pending orders only include these land unit types (per hex stack). */
  tacticalIncludedUnitTypes: 'all' | UnitType[];
  /** Per map stack (`tileKey`): orders apply only to this unit type until toggled off (Field command). */
  tacticalStackUnitTypeFocus: Record<string, UnitType>;
  /** Default spatial formation for land tactical moves / intercept (sessionStorage). Attack-city tactic waves use siege helpers separately. */
  defaultMarchFormation: {
    enabled: boolean;
    preset: SiegeTacticId;
    width: number;
    depth: number;
  };
  setDefaultMarchFormation: (
    patch: Partial<{ enabled: boolean; preset: SiegeTacticId; width: number; depth: number }>,
  ) => void;
  /** When set, next map click completes this order type for all these stacks */
  assigningTacticalForSelectedStacks: { orderType: TacticalAssignOrderType; stackKeys: string[] } | null;
  /** Hex keys being painted for patrol (land); cleared when patrol order completes. */
  tacticalPatrolPaintHexKeys: string[];
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
  /** Split stack: from hex + count to move; next adjacent hex click completes split. If unitIds set, those exact units move (count should match). */
  splitStackPending: { fromQ: number; fromR: number; count: number; unitIds?: string[] } | null;

  // Map
  generateWorld: (config?: Partial<MapConfig>) => void;
  getTile: (q: number, r: number) => Tile | undefined;

  // Game flow
  startPlacement: (opts?: { opponentCount?: number }) => void;
  /** Spectate: same opponent count as Play (N) → N+1 AI empires (matches 1 human + N AI slots). */
  startSpectateMatch: (opts: { opponentCount: number }) => void;
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
  /** Territory hex; pay per-level cost from player gold + city storage; BP from territory city building power only (not University workforce). */
  startCityDefenseTowerBuild: (
    q: number,
    r: number,
    towerType: DefenseTowerType,
    targetLevel: DefenseTowerLevel,
    /** When set (e.g. from University placement mode), use this city for payment / caps even if territory overlap assigned the hex to another of your cities. */
    placementCityId?: string,
  ) => void;
  buildRoad: (q: number, r: number) => void;
  upgradeBarracks: (cityId: string, buildingQ: number, buildingR: number) => void;
  upgradeFactory: (cityId: string, buildingQ: number, buildingR: number) => void;
  upgradeFarm: (cityId: string, buildingQ: number, buildingR: number) => void;
  /** Quarry, iron mine, or gold mine L1 → L2. */
  upgradeResourceMine: (cityId: string, buildingQ: number, buildingR: number) => void;
  upgradeSocialBar: (cityId: string, buildingQ: number, buildingR: number) => void;
  buyTradeMapQuadrant: (quadrant: MapQuadrantId) => void;
  buyTradeMapFullAtlas: () => void;
  buyTradeResourcePack: (key: keyof typeof TRADE_RESOURCE_PACK_GOLD) => void;
  buyTradeMoraleFestival: () => void;
  buyTradeRoyalSurvey: () => void;
  /** University (academy) L2–L5 — more builder workforce slots. */
  upgradeUniversity: (cityId: string, academyQ: number, academyR: number) => void;
  setUniversityBuilderTask: (cityId: string, task: BuilderTask) => void;
  /** Assign one workforce slot to a task (drag-drop); other slots unchanged. */
  setUniversityBuilderSlotTask: (cityId: string, slotIndex: number, task: BuilderTask) => void;
  adjustWorkers: (cityId: string, buildingQ: number, buildingR: number, delta: number) => void;
  recruitUnit: (
    cityId: string,
    type: UnitType,
    armsLevel?: 1 | 2 | 3,
    stackOpts?:
      | { stackMode: 'new'; name?: string; rangedVariant?: RangedVariant }
      | { stackMode: 'existing'; stackId: string; rangedVariant?: RangedVariant },
  ) => void;
  /** One-time per city: L3 iron archer line (Marksman vs Longbowman). */
  setCityArcherDoctrineL3: (cityId: string, doctrine: RangedVariant) => void;
  migrateLegacyArcherDoctrineIfNeeded: () => void;
  /** Queue one recruit per template row (affordable rows) into the unit stack. */
  trainAllStackTemplate: (cityId: string, stackId: string) => void;
  updateStackComposition: (stackId: string, composition: ArmyCompositionEntry[]) => void;
  setStackAutoReplenish: (stackId: string, enabled: boolean) => void;
  setStackName: (stackId: string, name: string) => void;
  createArmy: (name?: string) => void;
  addStackToArmy: (armyId: string, stackId: string) => void;
  removeStackFromArmy: (armyId: string, stackId: string) => void;
  /** Select all map hexes where this army has units (for issuing orders to the whole army). */
  selectStacksForArmy: (armyId: string) => void;
  deleteArmy: (armyId: string) => void;
  /** Set `armyId` on land units in the currently selected map stacks. */
  attachSelectedStacksToArmy: (armyId: string) => void;
  /** Set `armyId` on land units at one map hex (same rules as attach selected). */
  attachHexStackToArmy: (armyId: string, q: number, r: number) => void;
  /** Clear `armyId` for land units of this army at this hex (map attachment only). */
  detachHexStackFromArmy: (armyId: string, q: number, r: number) => void;
  /** Per army: inherit session default march formation, always spread (≥2 military), or always stacked. */
  setArmyMarchSpread: (armyId: string, mode: ArmyMarchSpreadMode) => void;
  assignCommanderToArmy: (commanderId: string, armyId: string) => void;
  toggleTacticalPatrolPaintHex: (q: number, r: number) => void;
  /** Paint mode: add hex to patrol zone without toggling off (for drag-painting). */
  addTacticalPatrolPaintHex: (q: number, r: number) => void;
  clearTacticalPatrolPaint: () => void;
  finishTacticalPatrolFromPaint: () => void;
  startTacticalPatrolCenterOnly: () => void;
  repairCityBuilding: (cityId: string, buildingQ: number, buildingR: number) => void;
  recruitShip: (cityId: string, shipyardQ: number, shipyardR: number, shipType: 'scout_ship' | 'warship' | 'transport_ship' | 'fisher_transport' | 'capital_ship') => void;
  boardAdjacentShip: (shipId: string) => void;
  disembarkShip: (shipId: string) => void;
  recruitCommander: (cityId: string) => void;
  recruitCommanderInstant: () => void;
  assignCommanderToCityDefense: (commanderId: string, cityId: string) => void;
  /** Attach commander to the first land military unit at the selected hex (stack). */
  assignCommanderToFieldAtSelectedHex: (commanderId: string) => void;
  /** Attach commander to the land army at (q,r) (first unit = anchor). Works from Army panel without hex selection. */
  assignCommanderToFieldStack: (commanderId: string, q: number, r: number) => void;
  unassignCommander: (commanderId: string) => void;
  setFoodPriority: (priority: FoodPriority) => void;
  setTaxRate: (rate: number) => void;

  // Wall building: one section at a time, inner ring then outer; stone per economy cycle per Defenses slot
  buildWallRing: (cityId: string, ring: number) => void;
  queueNextWallSection: (cityId: string, opts?: { silent?: boolean }) => void;

  // Defense placement from University panel
  startDefensePlacement: (towerType: DefenseTowerType, level: DefenseTowerLevel, cityId: string) => void;
  cancelDefensePlacement: () => void;

  // Builder build (Mine, Quarry, Road, Scout Tower outside territory)
  startBuilderBuild: (mode: 'mine' | 'quarry' | 'gold_mine' | 'logging_hut' | 'road') => void;
  cancelBuilderBuild: () => void;
  builderSelectDeposit: (q: number, r: number, type: 'mine' | 'quarry' | 'gold_mine' | 'logging_hut') => void;
  addRoadPathHex: (q: number, r: number) => void;
  confirmRoadPath: () => void;
  setSupplyViewTab: (tab: 'normal' | 'supply') => void;
  setTerritoryDisplayStyle: (style: 'fill' | 'dashed') => void;
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
  setMajorEngagementDoctrine: (hexKey: string, doctrine: MajorEngagementDoctrine) => void;
  openTacticalMode: () => void;
  cancelTacticalMode: () => void;
  setTacticalOrder: (stackKey: string, order: TacticalStackOrder | null) => void;
  startTacticalMoveForStack: (stackKey: string, orderType?: 'move' | 'intercept') => void;
  setTacticalMoveTarget: (toQ: number, toR: number) => void;
  setTacticalSelectedStackKeys: (keys: string[]) => void;
  toggleTacticalStack: (stackKey: string) => void;
  setTacticalOrderScope: (scope: 'all' | 'selected' | 'army', armyId?: string | null) => void;
  setTacticalIncludedUnitTypes: (types: 'all' | UnitType[]) => void;
  toggleTacticalIncludedUnitType: (type: UnitType) => void;
  /** Toggle per-hex unit-type scope for tactical orders; same type again clears. */
  toggleTacticalStackUnitTypeFocus: (stackKey: string, unitType: UnitType) => void;
  startTacticalOrderForSelected: (orderType: TacticalAssignOrderType) => void;
  setTacticalMoveTargetForSelected: (toQ: number, toR: number) => void;
  setTacticalIncorporateTargetForSelected: (toQ: number, toR: number) => void;
  setTacticalAttackCityTargetForSelected: (toQ: number, toR: number) => void;
  setTacticalAttackBuildingTargetForSelected: (toQ: number, toR: number) => void;
  commitTacticalAttackCitySetup: (
    payload:
      | {
          attackStyle: AttackCityStyle;
          mode: 'tactic';
          tacticPreset: SiegeTacticId;
          width: number;
          depth: number;
        }
      | {
          attackStyle: AttackCityStyle;
          mode: 'manual';
          useWaves: boolean;
          perStack: Record<
            string,
            { wave1: Partial<Record<UnitType, number>>; wave2: Partial<Record<UnitType, number>> }
          >;
        },
  ) => void;
  cancelTacticalAttackCityDraft: () => void;
  beginSiegeAssaultOnCity: (cityId: string) => void;
  setTacticalDefendForSelected: (cityId: string) => void;
  setTacticalDefendTargetFromMap: (q: number, r: number) => void;
  setTacticalCityDefenseTargetFromMap: (q: number, r: number) => void;
  setTacticalPatrolTargetFromMap: (q: number, r: number) => void;
  clearTacticalOrdersForSelected: () => void;
  confirmTacticalOrders: () => void;
  disbandSelectedUnits: () => void;
  setSiegeAssault: (assault: boolean) => void;
  activateAbility: (unitType: import('@/types/game').UnitType) => void;
  startSplitStack: (count: number, fromQ?: number, fromR?: number) => void;
  /** Move all units of this type to an adjacent hex (next click). Mixed stacks only; single-type stacks move all but one. */
  startSplitStackByUnitType: (unitType: UnitType, fromQ?: number, fromR?: number) => void;
  cancelSplitStack: () => void;
  splitStackToHex: (toQ: number, toR: number) => void;
  burnCity: (cityId: string) => void;
  captureCity: (cityId: string) => void;
  /** Garrison bow units shoot enemies in this city's territory within patrol radius (combat tick). */
  setCityGarrisonPatrol: (cityId: string, enabled: boolean) => void;
  setCityGarrisonPatrolRadius: (cityId: string, radius: number) => void;
  incorporateVillage: (q: number, r: number) => void;
  sendScout: (q: number, r: number) => void;
  /** Attach a scroll from your inventory to one of your land military units (whole stack benefits). */
  assignScrollToUnit: (scrollItemId: string, unitId: string) => void;
  /** Attach a scroll from inventory to an operational army (uses a carrier unit in that army). */
  assignScrollToArmy: (scrollItemId: string, armyId: string) => void;
  /** Return a unit's scroll to inventory. */
  unassignScrollFromUnit: (unitId: string) => void;

  // Notifications
  addNotification: (message: string, type: GameNotification['type']) => void;

  // Helpers
  getHumanPlayer: () => Player | undefined;
  getCityAt: (q: number, r: number) => City | undefined;
  getUnitsAt: (q: number, r: number) => Unit[];
  getSelectedCity: () => City | undefined;
  /** City at selected hex (any owner); used for observer mode and city modal. */
  getSelectedCityForDisplay: () => City | undefined;
  getSelectedUnits: () => Unit[];
  getEnemyCityAt: (q: number, r: number) => City | undefined;
  getBarracksCityAt: (q: number, r: number) => City | undefined;
  getSiegeWorkshopCityAt: (q: number, r: number) => City | undefined;
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
  /** @deprecated No connection paths — empire pool only */
  getSupplyConnectionPaths: () => Map<string, { q: number; r: number }[][]>;
  getSupplyClustersWithPaths: () => {
    clusterKey: string;
    cluster: { cityIds: string[]; cities: import('@/types/game').City[] };
    paths: { q: number; r: number }[][];
  }[];
  getSupplyClustersWithHealth: () => { clusterKey: string; cluster: { cityIds: string[]; cities: import('@/types/game').City[] }; paths: { q: number; r: number }[][]; foodSurplus: boolean }[];
  /** Human supply view: 'empire' when hex is yours, else null */
  getClusterForHex: (q: number, r: number) => string | null;
  getEmpireIncomeStatement: () => import('@/lib/gameLoop').EmpireIncomeStatement | null;
  /** @deprecated Use getEmpireIncomeStatement */
  getClusterIncomeStatement: (clusterKey: string) => import('@/lib/gameLoop').EmpireIncomeStatement | null;
}

const HUMAN_ID = 'player_human';
const AI_ID = 'player_ai';
const AI_ID_2 = 'player_ai_2';

export type GameMode = 'human_vs_ai' | 'human_solo' | 'bot_vs_bot' | 'bot_vs_bot_4' | 'spectate';

/** When set on an order, only these units receive the order on confirm; omitted = whole stack (legacy). */
type TacticalParticipation = { participatingUnitIds?: string[] };

/** Pending order per stack while tactical mode is open (confirmed in one batch). */
export type TacticalStackOrder =
  | ({ type: 'move'; toQ: number; toR: number } & TacticalParticipation)
  | ({ type: 'intercept'; toQ: number; toR: number } & TacticalParticipation)
  | ({ type: 'defend'; cityId: string } & TacticalParticipation)
  | ({ type: 'city_defense'; cityId: string; mode: 'auto_engage' | 'stagnant' } & TacticalParticipation)
  | ({ type: 'patrol'; centerQ: number; centerR: number; radius: number; hexKeys?: string[] } & TacticalParticipation)
  | ({ type: 'incorporate_village'; toQ: number; toR: number } & TacticalParticipation)
  | {
      type: 'attack_city';
      cityId: string;
      attackStyle: AttackCityStyle;
      /** First group marches immediately; each following group waits for the prior at the rally hex. */
      waveGroups: string[][];
      tacticPreset?: SiegeTacticId;
      tacticWidth?: number;
      tacticDepth?: number;
    }
  | ({ type: 'attack_building'; cityId: string; buildingQ: number; buildingR: number } & TacticalParticipation);

export type TacticalAssignOrderType =
  | 'move'
  | 'intercept'
  | 'incorporate_village'
  | 'attack_city'
  | 'attack_building_pick'
  | 'defend_pick'
  | 'city_defense_pick'
  | 'patrol_pick'
  | 'patrol_paint';

type PendingLandRecruit = {
  id: string;
  playerId: string;
  cityId: string;
  type: UnitType;
  effectiveArmsLevel: 1 | 2 | 3;
  rangedVariant?: RangedVariant;
  spawnQ: number;
  spawnR: number;
  completesAtCycle: number;
  stackId?: string;
  moveToRallyAfterSpawn?: { q: number; r: number };
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

type PendingCommanderRecruit = {
  id: string;
  playerId: string;
  cityId: string;
  commanderSeed: number;
  completesAtCycle: number;
};

type PendingRecruitItem = PendingLandRecruit | PendingShipRecruit | PendingCommanderRecruit;

type PendingIncorporationItem = {
  id: string;
  playerId: string;
  q: number;
  r: number;
  completesAtCycle: number;
  alreadyPaidGold: boolean;
};

let cityNameIdx = 0;
function nextCityName(): string {
  return CITY_NAMES[cityNameIdx++ % CITY_NAMES.length];
}

function canPayDefenseLevelCost(player: Player, city: City, level: DefenseTowerLevel): boolean {
  const c = DEFENSE_TOWER_LEVEL_COSTS[level];
  if (player.gold < c.gold) return false;
  if ((c.wood ?? 0) > (city.storage.wood ?? 0)) return false;
  if ((c.stone ?? 0) > (city.storage.stone ?? 0)) return false;
  if ((c.iron ?? 0) > (city.storage.iron ?? 0)) return false;
  return true;
}

/** Wall sections only — university workforce on the Walls task. */
function getWallProjectBlockedReason(city: City): string | null {
  const academy = city.buildings.find(b => b.type === 'academy');
  if (!academy) return 'Need a University in the territory city to run wall projects.';
  if (!cityUniversityHasSlotTask(city, 'city_defenses')) {
    return `Assign at least one University builder to Walls to build wall sections.`;
  }
  return null;
}

function humanStackKeysForTactical(s: {
  units: Unit[];
  tacticalSelectedStackKeys: string[];
  tacticalOrderScope: 'all' | 'selected' | 'army';
  tacticalOrderScopeArmyId: string | null;
}): string[] {
  const allHumanKeys = new Set<string>();
  for (const u of s.units) {
    if (u.ownerId === HUMAN_ID && u.hp > 0) allHumanKeys.add(tileKey(u.q, u.r));
  }

  if (s.tacticalOrderScope === 'army' && s.tacticalOrderScopeArmyId) {
    const aid = s.tacticalOrderScopeArmyId;
    const keys = new Set<string>();
    for (const u of s.units) {
      if (u.ownerId !== HUMAN_ID || u.hp <= 0) continue;
      if (u.armyId !== aid) continue;
      if (u.aboardShipId || u.type === 'builder') continue;
      if (isNavalUnitType(u.type)) continue;
      keys.add(tileKey(u.q, u.r));
    }
    return Array.from(keys);
  }

  if (s.tacticalOrderScope === 'selected') {
    if (s.tacticalSelectedStackKeys.length === 0) return [];
    return s.tacticalSelectedStackKeys.filter(k => allHumanKeys.has(k));
  }

  return Array.from(allHumanKeys);
}

function resolveParticipatingUnitIds(
  stackUnits: Unit[],
  tacticalIncludedUnitTypes: 'all' | UnitType[],
): string[] | undefined {
  if (tacticalIncludedUnitTypes === 'all') return undefined;
  const ids = unitIdsMatchingTypes(stackUnits, tacticalIncludedUnitTypes);
  return ids.length > 0 ? ids : undefined;
}

/** Like `resolveParticipatingUnitIds`, but narrows to one unit type on this hex when focus is set. */
function resolveParticipatingUnitIdsForTactical(
  stackUnits: Unit[],
  stackKey: string,
  tacticalIncludedUnitTypes: 'all' | UnitType[],
  tacticalStackUnitTypeFocus: Record<string, UnitType>,
): string[] | undefined {
  const focusType = tacticalStackUnitTypeFocus[stackKey];
  if (focusType === undefined) {
    return resolveParticipatingUnitIds(stackUnits, tacticalIncludedUnitTypes);
  }
  const subset = stackUnits.filter(u => u.type === focusType);
  if (subset.length === 0) return [];
  if (tacticalIncludedUnitTypes === 'all') {
    return subset.map(u => u.id);
  }
  const ids = unitIdsMatchingTypes(subset, tacticalIncludedUnitTypes);
  return ids.length > 0 ? ids : [];
}

function orderAppliesToUnit(order: TacticalStackOrder, u: Unit): boolean {
  if (order.type === 'attack_city') {
    return order.waveGroups.some(g => g.includes(u.id));
  }
  const ids = order.participatingUnitIds;
  if (ids === undefined) return true;
  return ids.includes(u.id);
}

function loadDefaultMarchFormation(): {
  enabled: boolean;
  preset: SiegeTacticId;
  width: number;
  depth: number;
} {
  const defaults = { enabled: false, preset: 'classic_four' as SiegeTacticId, width: 3, depth: 3 };
  if (typeof window === 'undefined') {
    return defaults;
  }
  try {
    const raw = sessionStorage.getItem('fe-default-march-formation');
    if (!raw) return { ...defaults };
    const j = JSON.parse(raw) as Partial<{
      enabled: boolean;
      preset: SiegeTacticId;
      width: number;
      depth: number;
    }>;
    const preset =
      j.preset && ['classic_four', 'boxed', 'winged'].includes(j.preset) ? j.preset : 'classic_four';
    return {
      enabled: typeof j.enabled === 'boolean' ? j.enabled : false,
      preset,
      width: typeof j.width === 'number' ? Math.max(1, Math.min(5, Math.round(j.width))) : 3,
      depth: typeof j.depth === 'number' ? Math.max(1, Math.min(5, Math.round(j.depth))) : 3,
    };
  } catch {
    return { ...defaults };
  }
}

function persistDefaultMarchFormation(d: ReturnType<typeof loadDefaultMarchFormation>) {
  try {
    sessionStorage.setItem('fe-default-march-formation', JSON.stringify(d));
  } catch {
    /* ignore */
  }
}

type MarchFormationDfResolved = {
  enabled: boolean;
  preset: SiegeTacticId;
  width: number;
  depth: number;
};

/** When every land-military unit in the march shares one army, honor its spread/stack override. */
function resolveMarchFormationDfForMarching(
  marching: Unit[],
  defaultDf: MarchFormationDfResolved,
  armies: OperationalArmy[] | undefined,
): MarchFormationDfResolved {
  const landMil = marching.filter(u => isLandMilitaryUnit(u) && u.hp > 0);
  const aids = new Set(landMil.map(u => u.armyId).filter((id): id is string => Boolean(id)));
  if (aids.size !== 1) return defaultDf;
  const aid = [...aids][0]!;
  const army = armies?.find(a => a.id === aid);
  const mode = army?.marchSpread ?? 'inherit';
  if (mode === 'spread') return { ...defaultDf, enabled: true };
  if (mode === 'stack') return { ...defaultDf, enabled: false };
  return defaultDf;
}

/**
 * Spatial formation march: military units spread around the destination; builders stay on the anchor hex.
 * Returns null when disabled, naval mixed in, or fewer than two land military units marching.
 */
function applyEchelonForLandMove(
  units: Unit[],
  fromQ: number,
  fromR: number,
  toQ: number,
  toR: number,
  marching: Unit[],
  cities: City[],
  tiles: Map<string, Tile>,
  territory: Map<string, TerritoryInfo>,
  df: MarchFormationDfResolved,
): Unit[] | null {
  if (!df.enabled) return null;
  if (marching.some(u => isNavalUnitType(u.type))) return null;
  const marchIds = new Set(marching.map(u => u.id));
  const militaryMarch = marching.filter(u => u.hp > 0 && isLandMilitaryUnit(u));
  const builderMarch = marching.filter(u => u.hp > 0 && u.type === 'builder');
  if (militaryMarch.length < 2) return null;

  const { assignments } = assignSpatialFormationTargets(
    toQ,
    toR,
    fromQ,
    fromR,
    militaryMarch,
    df.preset,
    df.width,
    df.depth,
    tiles,
    territory,
    HUMAN_ID,
  );
  for (const b of builderMarch) {
    assignments.set(b.id, { q: toQ, r: toR });
  }

  return units.map(u => {
    if (u.q !== fromQ || u.r !== fromR || u.ownerId !== HUMAN_ID || u.hp <= 0) return u;
    if (!marchIds.has(u.id)) return u;
    const pos = assignments.get(u.id);
    if (!pos) return u;
    const deployed = withoutPatrolFields(withDeployFlags(u, pos.q, pos.r, cities));
    const next: Unit = {
      ...deployed,
      targetQ: pos.q,
      targetR: pos.r,
      status: 'moving' as const,
      assaulting: false,
      marchInitialHexDistance: marchHexDistanceAtOrder(u, pos.q, pos.r),
      retaliateUnitId: undefined,
      retaliateDefenseId: undefined,
      attackBuildingTarget: undefined,
    };
    delete next.marchEchelonHold;
    delete next.attackWaveHold;
    return next;
  });
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
  const pl = newPlayers.find(p => p.id === playerId);
  const visibleHexes = computeVisibleHexes(
    playerId,
    newCities,
    s.units,
    s.heroes,
    newTiles,
    s.scoutTowers ?? [],
    s.commanders ?? [],
    pl?.mapQuadrantsRevealed,
    territory,
  );
  return { players: newPlayers, cities: newCities, tiles: newTiles, territory, visibleHexes, newCity };
}

function spawnUnitFromPendingLand(item: PendingLandRecruit, cities: City[]): Unit | null {
  if (item.type === 'builder') return null;
  const city = cities.find(c => c.id === item.cityId);
  if (!city) return null;
  const rv =
    item.type === 'ranged' && item.effectiveArmsLevel === 3
      ? (item.rangedVariant ?? 'marksman')
      : undefined;
  const stats = getUnitStats({
    type: item.type,
    armsLevel: item.effectiveArmsLevel,
    rangedVariant: rv,
  });
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
  if (item.type === 'ranged' && item.effectiveArmsLevel === 3) {
    u.rangedVariant = rv;
  }
  if (item.stackId) u.stackId = item.stackId;
  if (item.moveToRallyAfterSpawn) {
    const rq = item.moveToRallyAfterSpawn.q;
    const rr = item.moveToRallyAfterSpawn.r;
    u.targetQ = rq;
    u.targetR = rr;
    u.status = 'moving';
    u.marchInitialHexDistance = marchHexDistanceAtOrder(u, rq, rr);
  } else if (!isNavalUnitType(item.type)) {
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
  phase: 'setup', cycle: 0, gameMode: 'human_vs_ai', players: [], cities: [], units: [], heroes: [], commanders: [], unitStacks: [], operationalArmies: [],
  tacticalCityDefenseMode: 'auto_engage',
  commanderDraftOptions: [], commanderDraftSelectedIds: [], commanderDraftAssignment: {},
  constructions: [], roadConstructions: [], scoutTowers: [], defenseInstallations: [], contestedZoneHexKeys: [],
  specialRegions: [], scrollRelics: [], scrollRegionClaimed: emptyScrollRegionClaimed(), scrollInventory: {}, scrollAttachments: [],
  scrollRelicPickupModal: null,
  scoutMissions: [], scoutedHexes: new Set(),
  territory: new Map(), notifications: [],
  combatHexesThisCycle: new Set(),
  lastCombatFxAtMs: 0,
  lastDefenseVolleyFx: [],
  lastRangedShotFx: [],
  rangedShooterUnitIds: [],
  combatMoraleState: new Map(),
  combatKillFeed: [],
  activeWeather: null, lastWeatherEndCycle: -10,
  gameEndTime: 0, nextCycleTime: 0, gameTimeRemaining: GAME_DURATION_SEC, cycleTimeRemaining: CYCLE_INTERVAL_SEC,
  simSpeedMultiplier: 1,
  selectedKingdom: DEFAULT_KINGDOM_ID,
  setSelectedKingdom: (k) => set({ selectedKingdom: k }),
  setTacticalCityDefenseMode: (mode) => set({ tacticalCityDefenseMode: mode }),
  visibleHexes: new Set(), exploredHexes: new Set(), pendingCityHex: null,
  selectedHex: null, uiMode: 'normal', pendingMove: null, pendingDefenseBuild: null, wallEconomyStonePaidByCity: {}, wallSections: [], roadPathSelection: [],
  supplyViewTab: 'normal',
  territoryDisplayStyle: 'fill',
  setTerritoryDisplayStyle: (style) => set({ territoryDisplayStyle: style }),
  selectedClusterKey: null,
  lastClickHex: null,
  lastClickTime: 0,
  battleModalHexKey: null,
  majorEngagementStrategyByHex: {},
  mapClickSuppressionUntilMs: 0,
  cityLogisticsOpen: false,
  cityCaptureHold: {},
  archerDoctrineModalCityId: null,
  pendingRecruits: [],
  pendingIncorporations: [],
  pendingTacticalOrders: null,
  tacticalSelectedStackKeys: [],
  tacticalOrderScope: 'all',
  tacticalOrderScopeArmyId: null,
  tacticalIncludedUnitTypes: 'all',
  tacticalStackUnitTypeFocus: {},
  defaultMarchFormation: loadDefaultMarchFormation(),
  setDefaultMarchFormation: patch => {
    const cur = get().defaultMarchFormation;
    const next = {
      ...cur,
      ...patch,
      width:
        patch.width !== undefined
          ? Math.max(1, Math.min(5, Math.round(patch.width)))
          : cur.width,
      depth:
        patch.depth !== undefined
          ? Math.max(1, Math.min(5, Math.round(patch.depth)))
          : cur.depth,
    };
    if (patch.preset !== undefined && !['classic_four', 'boxed', 'winged'].includes(patch.preset)) {
      next.preset = cur.preset;
    }
    persistDefaultMarchFormation(next);
    set({ defaultMarchFormation: next });
  },
  assigningTacticalForSelectedStacks: null,
  assigningTacticalForStack: null,
  assigningTacticalOrderType: null,
  tacticalAttackCityDraft: null,
  splitStackPending: null,
  tacticalPatrolPaintHexKeys: [],

  // ─── Map ────────────────────────────────────────────────────
  generateWorld: (ov) => {
    const config = { ...DEFAULT_MAP_CONFIG, ...ov };
    const { tiles, provinceCenters, specialRegions, scrollRelics } = generateMap(config);
    const tileMap = new Map<string, Tile>();
    for (const t of tiles) tileMap.set(tileKey(t.q, t.r), t);
    set({
      tiles: tileMap,
      config,
      provinceCenters,
      specialRegions,
      scrollRelics,
      scrollRegionClaimed: emptyScrollRegionClaimed(),
      scrollInventory: {},
      scrollAttachments: [],
      scrollRelicPickupModal: null,
      isGenerated: true,
      phase: 'setup',
    });
  },
  getTile: (q, r) => get().tiles.get(tileKey(q, r)),

  // ─── Game Flow ──────────────────────────────────────────────
  startPlacement: (opts) => {
    cityNameIdx = 0;
    const kingdom = get().selectedKingdom;
    const tiles = get().tiles;
    const config = get().config;
    const startHex = findRandomStartHexWithFallback(kingdom, tiles, config);
    if (!startHex) {
      get().addNotification('Could not find any valid capital location on this map. Regenerate the world or try another size.', 'danger');
      return;
    }
    const opponentCount = Math.min(5, Math.max(1, opts?.opponentCount ?? 1));
    const aiKingdoms = pickOpponentKingdoms(kingdom, opponentCount);
    const aiIds = AI_PLAYER_IDS.slice(0, opponentCount) as string[];
    const aiPlayers: Player[] = aiIds.map((id, i) => ({
      id,
      name: KINGDOM_DISPLAY_NAMES[aiKingdoms[i]!],
      color: aiPlayerColorBySlot(i),
      gold: STARTING_GOLD,
      taxRate: 0.3,
      foodPriority: 'military' as const,
      isHuman: false,
      kingdomId: aiKingdoms[i],
    }));
    set({
      phase: 'starting_game',
      gameMode: 'human_vs_ai',
      players: [
        { id: HUMAN_ID, name: 'You', color: PLAYER_COLORS.human, gold: STARTING_GOLD, taxRate: 0.3, foodPriority: 'civilian', isHuman: true, kingdomId: kingdom },
        ...aiPlayers,
      ],
      cities: [], units: [], heroes: [], commanders: [], unitStacks: [], operationalArmies: [],
      commanderDraftOptions: [], commanderDraftSelectedIds: [], commanderDraftAssignment: {},
      constructions: [], roadConstructions: [], scoutTowers: [], defenseInstallations: [],       scoutMissions: [], scoutedHexes: new Set(),
      territory: new Map(), cycle: 0, notifications: [], wallSections: [], cityCaptureHold: {}, archerDoctrineModalCityId: null, pendingRecruits: [], pendingIncorporations: [],
      combatHexesThisCycle: new Set(),
      lastCombatFxAtMs: 0,
      lastDefenseVolleyFx: [],
      lastRangedShotFx: [],
      rangedShooterUnitIds: [],
      combatMoraleState: new Map(),
      combatKillFeed: [],
      contestedZoneHexKeys: [],
      scrollRegionClaimed: emptyScrollRegionClaimed(),
      scrollInventory: {},
      scrollAttachments: [],
      scrollRelicPickupModal: null,
      activeWeather: null, lastWeatherEndCycle: -10,
      visibleHexes: new Set(), exploredHexes: new Set(), pendingCityHex: null,
      battleModalHexKey: null,
      majorEngagementStrategyByHex: {},
    });
    get().placeStartingCity(startHex.q, startHex.r);
  },

  startSoloPlacement: () => {
    cityNameIdx = 0;
    const kingdom = get().selectedKingdom;
    const tiles = get().tiles;
    const config = get().config;
    const startHex = findRandomStartHexWithFallback(kingdom, tiles, config);
    if (!startHex) {
      get().addNotification('Could not find any valid capital location on this map. Regenerate the world or try another size.', 'danger');
      return;
    }
    set({
      phase: 'starting_game',
      gameMode: 'human_solo',
      players: [
        { id: HUMAN_ID, name: 'You', color: PLAYER_COLORS.human, gold: STARTING_GOLD, taxRate: 0.3, foodPriority: 'civilian', isHuman: true, kingdomId: kingdom },
        /** Inert owner for solo dummy capital — never receives planAiTurn. */
        { id: AI_ID, name: 'Training target', color: PLAYER_COLORS.ai, gold: STARTING_GOLD, taxRate: 0.3, foodPriority: 'military', isHuman: false },
      ],
      cities: [], units: [], heroes: [], commanders: [], unitStacks: [], operationalArmies: [],
      commanderDraftOptions: [], commanderDraftSelectedIds: [], commanderDraftAssignment: {},
      constructions: [], roadConstructions: [], scoutTowers: [], defenseInstallations: [],       scoutMissions: [], scoutedHexes: new Set(),
      territory: new Map(), cycle: 0, notifications: [], wallSections: [], cityCaptureHold: {}, archerDoctrineModalCityId: null, pendingRecruits: [], pendingIncorporations: [],
      combatHexesThisCycle: new Set(),
      lastCombatFxAtMs: 0,
      lastDefenseVolleyFx: [],
      lastRangedShotFx: [],
      rangedShooterUnitIds: [],
      combatMoraleState: new Map(),
      combatKillFeed: [],
      contestedZoneHexKeys: [],
      scrollRegionClaimed: emptyScrollRegionClaimed(),
      scrollInventory: {},
      scrollAttachments: [],
      scrollRelicPickupModal: null,
      activeWeather: null, lastWeatherEndCycle: -10,
      visibleHexes: new Set(), exploredHexes: new Set(), pendingCityHex: null,
      battleModalHexKey: null,
      majorEngagementStrategyByHex: {},
    });
    get().placeStartingCity(startHex.q, startHex.r);
  },

  startBotVsBot: () => {
    const s = get();
    if (!s.isGenerated) {
      get().generateWorld();
    }
    cityNameIdx = 0;
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

    const allTileKeys = new Set<string>();
    tiles.forEach((_, key) => allTileKeys.add(key));

    const scrollInvBot: Record<string, ScrollItem[]> = {};
    scrollInvBot[AI_ID] = [];
    scrollInvBot[AI_ID_2] = [];

    set({
      phase: 'playing',
      gameMode: 'bot_vs_bot',
      tiles: new Map(tiles),
      players: [
        { id: AI_ID, name: 'North Empire', color: PLAYER_COLORS.ai, gold: STARTING_GOLD, taxRate: 0.3, foodPriority: 'military', isHuman: false },
        { id: AI_ID_2, name: 'South Empire', color: PLAYER_COLORS.ai2, gold: STARTING_GOLD, taxRate: 0.3, foodPriority: 'military', isHuman: false },
      ],
      cities,
      units: [],
      heroes: [],
      commanders: [],
      unitStacks: [],
      operationalArmies: [],
      commanderDraftOptions: [],
      commanderDraftSelectedIds: [],
      commanderDraftAssignment: {},
      territory,
      visibleHexes: allTileKeys,
      exploredHexes: allTileKeys,
      wallSections: [],
      cityCaptureHold: {},
      archerDoctrineModalCityId: null,
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
      combatMoraleState: new Map(),
      combatKillFeed: [],
      contestedZoneHexKeys,
      specialRegions: s.specialRegions ?? [],
      scrollRelics: s.scrollRelics ?? [],
      scrollRegionClaimed: emptyScrollRegionClaimed(),
      scrollInventory: scrollInvBot,
      scrollAttachments: [],
      scrollRelicPickupModal: null,
      notifications: [
        { id: generateId('n'), turn: 0, message: 'Bot vs Bot — observing both empires.', type: 'success' },
      ],
      battleModalHexKey: null,
      majorEngagementStrategyByHex: {},
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

  startSpectateMatch: ({ opponentCount }) => {
    const s = get();
    if (!s.isGenerated) {
      get().addNotification('Generate a map first.', 'warning');
      return;
    }
    const n = Math.min(5, Math.max(1, opponentCount));
    const totalBots = n + 1;
    const { tiles, config } = get();
    if (!tiles || tiles.size === 0) return;

    const aiIds = AI_PLAYER_IDS.slice(0, totalBots) as string[];
    const kingdoms = pickKingdomsForSpectateBots(totalBots);
    const players: Player[] = aiIds.map((id, i) => ({
      id,
      name: KINGDOM_DISPLAY_NAMES[kingdoms[i]!],
      color: aiPlayerColorBySlot(i),
      gold: STARTING_GOLD,
      taxRate: 0.3,
      foodPriority: 'military' as const,
      isHuman: false,
      kingdomId: kingdoms[i],
    }));

    cityNameIdx = 0;

    const cities = placeManyAiCapitalsApart(totalBots, aiIds, tiles, config);
    if (cities.length < 2) {
      get().addNotification('Could not place AI capitals. Try a larger map or different seed.', 'danger');
      return;
    }
    for (const c of cities) {
      c.name = nextCityName();
    }

    const c0 = cities[0]!;
    const c1 = cities[1]!;
    placeAncientCity(tiles, c0.q, c0.r, c1.q, c1.r);
    const contestedZoneHexKeys = computeContestedZoneHexKeys(tiles, c0.q, c0.r, c1.q, c1.r, config);
    const territory = calculateTerritory(cities, tiles);

    const allTileKeys = new Set<string>();
    tiles.forEach((_, key) => allTileKeys.add(key));

    const scrollInvBot: Record<string, ScrollItem[]> = {};
    for (const p of players) scrollInvBot[p.id] = [];

    const commanders: Commander[] = [];
    for (const city of cities) {
      for (let i = 0; i < COMMANDER_STARTING_PICK; i++) {
        const seed = (config.seed ^ city.q * 1315423911 ^ city.r * 9737333 ^ i * 0xcafebabe) >>> 0;
        const rolled = rollCommanderIdentity(seed);
        commanders.push(
          createCommanderRecord(
            city.ownerId,
            rolled,
            renderCommanderPortraitDataUrl(rolled.portraitSeed),
            city.q,
            city.r,
            { kind: 'city_defense', cityId: city.id },
          ),
        );
      }
    }

    set({
      phase: 'playing',
      gameMode: 'spectate',
      tiles: new Map(tiles),
      players,
      cities,
      units: [],
      heroes: [],
      commanders,
      unitStacks: [],
      operationalArmies: [],
      commanderDraftOptions: [],
      commanderDraftSelectedIds: [],
      commanderDraftAssignment: {},
      territory,
      visibleHexes: allTileKeys,
      exploredHexes: allTileKeys,
      wallSections: [],
      cityCaptureHold: {},
      archerDoctrineModalCityId: null,
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
      combatMoraleState: new Map(),
      combatKillFeed: [],
      contestedZoneHexKeys,
      specialRegions: s.specialRegions ?? [],
      scrollRelics: s.scrollRelics ?? [],
      scrollRegionClaimed: emptyScrollRegionClaimed(),
      scrollInventory: scrollInvBot,
      scrollAttachments: [],
      scrollRelicPickupModal: null,
      notifications: [
        { id: generateId('n'), turn: 0, message: `Spectating ${totalBots} AI empires.`, type: 'success' },
      ],
      battleModalHexKey: null,
      majorEngagementStrategyByHex: {},
    });
    get().startRealTimeLoop();
    get().runCycle();
  },

  setPendingCity: (q, r) => {
    const { tiles } = get();
    const tile = tiles.get(tileKey(q, r));
    if (!tile || !isCapitalStartHex(tile)) return;
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
    const { tiles: tilesState, config, gameMode } = get();
    const tile = tilesState.get(tileKey(q, r));
    if (!tile || !isCapitalStartHex(tile)) return;

    const tiles = new Map(tilesState);
    clearVillageForCapitalTile(tiles, q, r);

    const solo = gameMode === 'human_solo';

    const humanCity: City = {
      id: generateId('city'), name: nextCityName(), q, r, ownerId: HUMAN_ID,
      ...structuredClone(STARTING_CITY_TEMPLATE),
    };
    humanCity.buildings = [{ type: 'city_center', q, r, assignedWorkers: 0 }];
    humanCity.storageCap = { ...CITY_CENTER_STORAGE };

    const aiIds = get().players.filter(p => !p.isHuman).map(p => p.id);
    let aiCities: City[] = [];
    if (solo) {
      const aiCity = placeAiStartingCity(q, r, tiles, config, AI_ID);
      if (aiCity) {
        aiCity.name = 'Training camp';
        aiCities = [aiCity];
      }
    } else {
      aiCities = placeAiStartingCitiesSequential(q, r, aiIds, tiles, config);
      for (const c of aiCities) {
        c.name = nextCityName();
      }
    }

    const firstAi = aiCities[0];
    const cities = [humanCity, ...aiCities];
    placeAncientCity(tiles, q, r, firstAi?.q, firstAi?.r);
    const contestedZoneHexKeys = firstAi
      ? computeContestedZoneHexKeys(tiles, q, r, firstAi.q, firstAi.r, config)
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

    const heroes: Hero[] = [];

    // Human vs AI: no pre-spawned AI army. AI uses champion params (from ai-params.json) and builds up from its city on the opposite side.
    const initVisible = computeVisibleHexes(
      HUMAN_ID,
      cities,
      [],
      heroes,
      tiles,
      get().scoutTowers ?? [],
      [],
      get().players.find(p => p.id === HUMAN_ID)?.mapQuadrantsRevealed,
      territory,
    );
    const initExplored = new Set(initVisible);

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
          'Named wilds are marked on the map. Explore to reveal relic sites; move a qualifying army onto the relic hex to claim that region’s scroll (+10% attack, defense, or movement by line). Assign scrolls from the hex panel.',
        type: 'info',
      });
    }
    if (!solo) {
      startNotifs.push({
        id: generateId('n'),
        turn: 0,
        message:
          aiCities.length > 1
            ? `Rival empires stir across the land (${aiCities.length} opponents).`
            : `A rival empire stirs across the land.`,
        type: 'warning',
      });
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
        message: aiCities[0]
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

    /** Human assigns commanders from the city panel (defense) or Army panel / hex panel; no random draft at start. */
    const aiCmds: Commander[] = [];
    for (const ac of aiCities) {
      const pid = ac.ownerId;
      for (let i = 0; i < COMMANDER_STARTING_PICK; i++) {
        const seed = (config.seed ^ ac.q * 1315423911 ^ ac.r * 9737333 ^ i * 0xcafebabe) >>> 0;
        const rolled = rollCommanderIdentity(seed);
        aiCmds.push(
          createCommanderRecord(
            pid,
            rolled,
            renderCommanderPortraitDataUrl(rolled.portraitSeed),
            ac.q,
            ac.r,
            { kind: 'city_defense', cityId: ac.id },
          ),
        );
      }
    }

    set({
      phase: 'playing',
      tiles,
      cities,
      territory,
      heroes,
      commanders: aiCmds,
      unitStacks: [],
      operationalArmies: [],
      commanderDraftOptions: [],
      commanderDraftSelectedIds: [],
      commanderDraftAssignment: {},
      wallSections: kingdomWalls,
      players: get().players.map(p =>
        p.id === HUMAN_ID ? { ...p, kingdomId: get().selectedKingdom } : p,
      ),
      cityCaptureHold: {},
      archerDoctrineModalCityId: null,
      pendingRecruits: [],
      pendingIncorporations: [],
      units: [],
      constructions: [],
      roadConstructions: [],
      scoutTowers: [],
      defenseInstallations: [],
      contestedZoneHexKeys,
      scrollRelics: get().scrollRelics ?? [],
      scrollRegionClaimed: emptyScrollRegionClaimed(),
      scrollInventory: scrollInv,
      scrollAttachments: [],
      scrollRelicPickupModal: null,
      visibleHexes: initVisible,
      exploredHexes: initExplored,
      notifications: startNotifs,
      battleModalHexKey: null,
      majorEngagementStrategyByHex: {},
      cityLogisticsOpen: false,
    });

    get().startRealTimeLoop();
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
          {
            name: opt.name,
            backstory: opt.backstory,
            traitIds: opt.traitIds,
            portraitSeed: opt.portraitSeed,
            commanderKind: opt.commanderKind ?? 'land',
          },
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
      s.players.find(p => p.id === HUMAN_ID)?.mapQuadrantsRevealed,
      s.territory,
    );
    const nextExplored = new Set(s.exploredHexes);
    for (const k of initVisible) nextExplored.add(k);

    set({
      phase: 'playing',
      commanders: [...humanCmds, ...aiCmds],
      commanderDraftOptions: [],
      commanderDraftSelectedIds: [],
      commanderDraftAssignment: {},
      visibleHexes: initVisible,
      exploredHexes: nextExplored,
    });
    get().startRealTimeLoop();
  },

  startRealTimeLoop: (opts?: { preserveTimes?: boolean }) => {
    clearAllTimers();
    const s = get();
    const unitsNoBuilders = s.units.filter(u => u.type !== 'builder');
    if (unitsNoBuilders.length !== s.units.length) {
      set({ units: unitsNoBuilders });
    }
    const isBot = s.gameMode === 'bot_vs_bot' || s.gameMode === 'bot_vs_bot_4' || s.gameMode === 'spectate';
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
      const movingCommanders = s.commanders.map(c => ({ ...c }));
      const closingFire = movementTick(
        movingUnits,
        movingHeroes,
        s.tiles,
        s.wallSections,
        s.cities,
        Date.now(),
        s.players,
        s.scrollAttachments,
        s.cycle,
        movingCommanders,
        s.territory,
        s.defenseInstallations,
      );
      autoEmbarkLandUnitsOntoScoutShipsAtHex(movingUnits, s.tiles);
      releaseAttackWaveHolds(movingUnits, s.cities);
      releaseMarchEchelonHolds(movingUnits, s.cities);
      syncCommandersToAssignments(movingCommanders, s.cities, movingUnits);

      const majorEngagementEnabled =
        s.gameMode !== 'bot_vs_bot' && s.gameMode !== 'bot_vs_bot_4' && s.gameMode !== 'spectate';
      const majorMap = new Map<string, Record<string, MajorEngagementDoctrine>>();
      for (const [hk, rec] of Object.entries(s.majorEngagementStrategyByHex)) {
        majorMap.set(hk, { ...rec });
      }
      const majorOpts: CombatTickMajorEngagementOptions | undefined = majorEngagementEnabled
        ? { byHex: majorMap, humanPlayerId: HUMAN_ID, enabled: true }
        : undefined;

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
        s.combatMoraleState,
        majorOpts,
      );

      const wallSectionsMut = s.wallSections.map(w => ({ ...w }));
      const coastalResult = coastalBombardmentTick(
        movingUnits,
        movingHeroes,
        wallSectionsMut,
        s.cycle,
        s.cities,
        s.tiles,
        now,
        s.scrollAttachments,
        movingCommanders,
      );

      // -- Siege tick: trebuchet/ram damage walls (design §17–19) --
      siegeTick(wallSectionsMut, movingUnits);

      const citiesBase = s.cities.map(c => ({
        ...c,
        buildings: c.buildings.map(b => ({ ...b })),
      }));
      siegeBuildingsTick(citiesBase, movingUnits);
      landUnitBuildingDamageTick(citiesBase, movingUnits);

      const mergedKilledUnitIds = [
        ...new Set([...closingFire.killedUnitIds, ...combatResult.killedUnitIds, ...coastalResult.killedUnitIds]),
      ];
      const mergedKilledHeroIds = [
        ...new Set([...(combatResult.killedHeroIds ?? []), ...(coastalResult.killedHeroIds ?? [])]),
      ];

      // Accumulate combat hexes for this cycle (ancient city: no reward if combat on that hex)
      const nextCombatHexes = new Set(s.combatHexesThisCycle);
      for (const key of combatResult.combatHexKeys) nextCombatHexes.add(key);
      for (const key of coastalResult.combatHexKeys) nextCombatHexes.add(key);

      // Remove dead units; return scrolls from fallen carriers
      const killedSet = new Set(mergedKilledUnitIds);
      const scrollReturn = returnScrollsForDeadCarriers(
        killedSet,
        s.scrollAttachments ?? [],
        { ...s.scrollInventory },
      );

      const aliveUnits = movingUnits.filter(u => u.hp > 0 && !mergedKilledUnitIds.includes(u.id));
      unassignCommandersWithDeadAnchors(movingCommanders, aliveUnits);

      const majorEngagementStrategyByHexNext = majorEngagementEnabled
        ? pruneEndedMajorEngagements(
            Object.fromEntries([...majorMap.entries()].map(([k, v]) => [k, { ...v }])),
            aliveUnits,
          )
        : pruneEndedMajorEngagements({ ...s.majorEngagementStrategyByHex }, aliveUnits);

      // Population: when a unit dies, its origin city loses 1 population (design doc §22)
      const killedIds = new Set(mergedKilledUnitIds);
      const popDeductByCityId: Record<string, number> = {};
      for (const u of s.units) {
        if (killedIds.has(u.id) && u.originCityId) {
          popDeductByCityId[u.originCityId] = (popDeductByCityId[u.originCityId] ?? 0) + 1;
        }
      }
      const updatedCities =
        Object.keys(popDeductByCityId).length === 0
          ? citiesBase
          : citiesBase.map(c => {
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
      clearInvalidCommanderAssignments(movingCommanders, citiesFinal, s.operationalArmies ?? []);

      const territoryAfterCapture = citiesFinal !== updatedCities ? calculateTerritory(citiesFinal, s.tiles) : undefined;
      let phaseAfterCapture: GamePhase = s.phase;
      if (s.gameMode === 'bot_vs_bot' || s.gameMode === 'spectate') {
        const aiIds = s.players.filter(p => !p.isHuman).map(p => p.id);
        const alive = aiIds.filter(pid => citiesFinal.some(c => c.ownerId === pid));
        if (alive.length <= 1) {
          phaseAfterCapture = 'victory';
          clearAllTimers();
          const w = alive[0];
          const wname = w ? s.players.find(p => p.id === w)?.name ?? 'Empire' : 'Empire';
          captureNotifs.push({ id: generateId('n'), turn: s.cycle, message: `${wname} conquers!`, type: 'success' });
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
        const aiIds = s.players.filter(p => !p.isHuman).map(p => p.id);
        const anyAiAlive = citiesFinal.some(c => aiIds.includes(c.ownerId));
        if (humanCitiesAfter.length === 0) {
          phaseAfterCapture = 'victory';
          clearAllTimers();
          captureNotifs.push({ id: generateId('n'), turn: s.cycle, message: 'Defeat! Your empire has fallen.', type: 'danger' });
        } else if (!anyAiAlive) {
          phaseAfterCapture = 'victory';
          clearAllTimers();
          captureNotifs.push({ id: generateId('n'), turn: s.cycle, message: 'Victory! You conquered all rival empires!', type: 'success' });
        }
      }

      const newNotifs =
        closingFire.notifications.length > 0 ||
        combatResult.notifications.length > 0 ||
        coastalResult.notifications.length > 0 ||
        captureNotifs.length > 0
          ? [
              ...s.notifications.slice(-8),
              ...closingFire.notifications,
              ...combatResult.notifications,
              ...coastalResult.notifications,
              ...captureNotifs,
            ]
          : s.notifications;

      const aliveHeroes = movingHeroes.filter(h => !mergedKilledHeroIds.includes(h.id));
      const ownerByCity = new Map(citiesFinal.map(c => [c.id, c.ownerId]));
      const syncedDefenses = (s.defenseInstallations ?? []).map(d => {
        const ow = ownerByCity.get(d.cityId);
        if (ow !== undefined && ow !== d.ownerId) return { ...d, ownerId: ow };
        return d;
      });
      const fxNow = Date.now();
      const defenseVolleyCombined = [
        ...combatResult.defenseVolleyFx,
        ...coastalResult.defenseVolleyFx,
      ];
      const allRangedShotFx = [...closingFire.rangedShotFx, ...combatResult.rangedShotFx];
      const hasFx =
        defenseVolleyCombined.length > 0 || allRangedShotFx.length > 0;

      const scrollPickupRt = tickScrollRelicPickup({
        newCycle: s.cycle,
        tiles: s.tiles,
        units: aliveUnits,
        players: s.players,
        scrollRelics: s.scrollRelics ?? [],
        scrollRegionClaimed: s.scrollRegionClaimed ?? emptyScrollRegionClaimed(),
        scrollInventory: scrollReturn.scrollInventory,
      });
      let scrollModalRt = s.scrollRelicPickupModal;
      for (const ev of scrollPickupRt.scrollRelicPickupEvents) {
        if (ev.playerId === HUMAN_ID) {
          scrollModalRt = { regionKind: ev.regionKind, kind: ev.kind };
        }
      }
      const notifsWithScrollRt =
        scrollPickupRt.notifications.length > 0 ? [...newNotifs, ...scrollPickupRt.notifications] : newNotifs;

      set({
        units: aliveUnits,
        cities: citiesFinal,
        territory: territoryAfterCapture ?? s.territory,
        phase: phaseAfterCapture,
        wallSections: wallSectionsMut,
        cityCaptureHold: captureHoldNext,
        heroes: aliveHeroes,
        commanders: movingCommanders,
        notifications: notifsWithScrollRt,
        combatHexesThisCycle: nextCombatHexes,
        defenseInstallations: syncedDefenses,
        scrollAttachments: scrollReturn.attachments,
        scrollInventory: scrollPickupRt.scrollInventory,
        scrollRegionClaimed: scrollPickupRt.scrollRegionClaimed,
        scrollRelicPickupModal: scrollModalRt,
        lastCombatFxAtMs: hasFx ? fxNow : s.lastCombatFxAtMs,
        lastDefenseVolleyFx: defenseVolleyCombined,
        lastRangedShotFx: allRangedShotFx,
        rangedShooterUnitIds: [...new Set(allRangedShotFx.map(r => r.attackerId))],
        combatMoraleState: combatResult.moraleState,
        combatKillFeed: combatResult.killFeed,
        majorEngagementStrategyByHex: majorEngagementStrategyByHexNext,
        battleModalHexKey:
          combatResult.newMajorEngagementHexKeys.length > 0
            ? combatResult.newMajorEngagementHexKeys[0]!
            : s.battleModalHexKey,
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
          let wallOut = [...st.wallSections];

          const wallStonePaid = st.wallEconomyStonePaidByCity ?? {};
          const queueWallAfterComplete: string[] = [];

          for (const site of st.constructions) {
            let availBP = computeConstructionAvailableBp(site, st.territory, st.cities, st.constructions);

            if (
              site.type === 'wall_section' &&
              site.cityId &&
              wallStonePaid[site.cityId] === false
            ) {
              availBP = 0;
            }

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
              } else if (site.type === 'wall_section') {
                const existingIdx = wallOut.findIndex(
                  w => w.ownerId === site.ownerId && w.q === site.q && w.r === site.r,
                );
                if (existingIdx < 0) {
                  wallOut.push({
                    q: site.q,
                    r: site.r,
                    ownerId: site.ownerId,
                    hp: WALL_SECTION_HP,
                    maxHp: WALL_SECTION_HP,
                  });
                }
                queueWallAfterComplete.push(site.cityId);
                completedNotifs.push({
                  id: generateId('n'),
                  turn: st.cycle,
                  message: `Wall section completed at (${site.q}, ${site.r})!`,
                  type: 'success',
                });
              } else {
                // Building: add to city and auto-assign workers
                const city = updatedCities.find(c => c.id === site.cityId);
                if (city) {
                  const b: CityBuilding = { type: site.type as BuildingType, q: site.q, r: site.r };
                  if (['quarry', 'mine', 'gold_mine', 'barracks', 'factory', 'academy', 'siege_workshop', 'farm', 'banana_farm', 'sawmill', 'port', 'shipyard', 'fishery', 'logging_hut', 'market', 'social_bar'].includes(site.type)) b.level = 1;
                  const jobs = BUILDING_JOBS[site.type as BuildingType] ?? 0;
                  if (jobs > 0) {
                    const totalEmployed = city.buildings.reduce((s, x) => s + ((x as CityBuilding).assignedWorkers ?? 0), 0);
                    const available = city.population - totalEmployed;
                    b.assignedWorkers = Math.min(jobs, Math.max(0, available));
                  }
                  city.buildings.push(ensureCityBuildingHp(b));
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
            wallSections: wallOut,
            notifications: allNotifs,
          });
          for (const cid of queueWallAfterComplete) {
            queueMicrotask(() => get().queueNextWallSection(cid, { silent: true }));
          }
        }
      }

      // -- Road construction tick --
      {
        const st = get();
        if (st.roadConstructions.length > 0) {
          const remaining: RoadConstructionSite[] = [];
          const completedNotifs: GameNotification[] = [];
          let tilesUpdated = false;
          const newTiles = new Map(st.tiles);

          for (const site of st.roadConstructions) {
            const availBP = computeRoadAvailableBp(site, st.territory, st.cities);
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
              completedNotifs.push({
                id: generateId('n'), turn: st.cycle,
                message: `Road completed at (${site.q}, ${site.r})!`,
                type: 'success',
              });
            } else {
              remaining.push({ ...site, bpAccumulated: newAccum });
            }
          }

          // Always write back so BP accumulation persists each tick (otherwise progress never saves)
          const allNotifs = completedNotifs.length > 0
            ? [...st.notifications.slice(-8), ...completedNotifs]
            : st.notifications;
          set({ roadConstructions: remaining, tiles: newTiles, notifications: allNotifs });
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
            const exploredNext = new Set(st.exploredHexes);
            for (const mission of st.scoutMissions) {
              if (nowMs >= mission.completesAt) {
                exploredNext.add(tileKey(mission.targetQ, mission.targetR));
              }
            }
            set({
              scoutMissions: remaining,
              scoutedHexes: newScouted,
              exploredHexes: exploredNext,
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
        const speedForCycle = (s.gameMode === 'bot_vs_bot' || s.gameMode === 'bot_vs_bot_4' || s.gameMode === 'spectate') ? (s.simSpeedMultiplier || 1) : 1;
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
          if (st.gameMode === 'bot_vs_bot' || st.gameMode === 'spectate') {
            const aiIds = st.players.filter(p => !p.isHuman).map(p => p.id);
            let bestId = aiIds[0];
            let bestScore = -1;
            for (const pid of aiIds) {
              const cs = st.cities.filter(c => c.ownerId === pid);
              const pop = cs.reduce((a, c) => a + c.population, 0);
              const score = cs.length * 1e6 + pop;
              if (score > bestScore) {
                bestScore = score;
                bestId = pid;
              }
            }
            const wname = st.players.find(p => p.id === bestId)?.name ?? 'Empire';
            const wc = st.cities.filter(c => c.ownerId === bestId);
            const wpop = wc.reduce((a, c) => a + c.population, 0);
            set({
              phase: 'victory',
              notifications: [...st.notifications.slice(-8), { id: generateId('n'), turn: st.cycle, message: `Time's up! ${wname} wins (${wc.length} cities, ${wpop} pop).`, type: 'success' }],
            });
          } else {
            const humanCities = st.cities.filter(c => c.ownerId === HUMAN_ID);
            const aiIds = st.players.filter(p => !p.isHuman).map(p => p.id);
            const aiCities = st.cities.filter(c => aiIds.includes(c.ownerId));
            const humanPop = humanCities.reduce((a, c) => a + c.population, 0);
            const aiPop = aiCities.reduce((a, c) => a + c.population, 0);
            const humanWins = humanCities.length > aiCities.length ||
              (humanCities.length === aiCities.length && humanPop >= aiPop);
            const msg = humanWins
              ? 'Time\'s up! You control more territory. Victory!'
              : 'Time\'s up! The rival empires dominate. Defeat.';
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
    if (s.phase !== 'playing' || (s.gameMode !== 'bot_vs_bot' && s.gameMode !== 'bot_vs_bot_4' && s.gameMode !== 'spectate')) return;
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
    let flushExplored = s.exploredHexes;
    let flushTerritory = s.territory;
    let flushHeroes: Hero[] = [];
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
              commanderKind: rolled.commanderKind,
            },
          ];
          if (pr.playerId === HUMAN_ID) {
            const kindLabel = rolled.commanderKind === 'naval' ? 'Naval commander' : 'Commander';
            flushNotifs.push({
              id: generateId('n'),
              turn: newCycle,
              message: `${kindLabel} ${rolled.name} has arrived.`,
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
        } else if (pr.type === 'builder') {
          const refund = UNIT_COSTS.builder.gold;
          flushPlayers = flushPlayers.map(p =>
            p.id === pr.playerId ? { ...p, gold: p.gold + refund } : p,
          );
          if (pr.playerId === HUMAN_ID) {
            flushNotifs.push({
              id: generateId('n'),
              turn: newCycle,
              message: 'Builder recruits are obsolete; gold refunded.',
              type: 'info',
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
      if (inc.playerId === HUMAN_ID) {
        flushVisible = patch.visibleHexes;
        flushExplored = new Set(flushExplored);
        for (const k of patch.visibleHexes) flushExplored.add(k);
      }
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

    flushCities = flushCities.map(c => ({
      ...c,
      buildings: c.buildings.map(b => ensureCityBuildingHp(b)),
    }));

    flushUnits = flushUnits.map(u => {
      if (u.hp <= 0 || u.hp >= u.maxHp || u.aboardShipId || isNavalUnitType(u.type) || u.type === 'builder') {
        return u;
      }
      if (u.status === 'fighting') return u;
      const add = Math.max(1, Math.floor(u.maxHp * UNIT_HP_REGEN_FRACTION_PER_CYCLE));
      return { ...u, hp: Math.min(u.maxHp, u.hp + add) };
    });

    let unitStacksMut = updateArmyRallyFromUnits(s.unitStacks ?? [], flushUnits);
    const replen = computeArmyReplenishment({
      unitStacks: unitStacksMut,
      units: flushUnits,
      cities: flushCities,
      players: flushPlayers,
      cycle: newCycle,
      pendingRecruits: [...pendingRecruitsAcc, ...s.pendingRecruits.filter(p => p.completesAtCycle !== newCycle)],
    });
    flushCities = replen.cities;
    flushPlayers = replen.players;
    unitStacksMut = replen.unitStacks;
    for (const pr of replen.newPending) {
      pendingRecruitsAcc.push(pr as PendingLandRecruit);
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
    let notifs = [...flushNotifs, ...weatherNotifs, ...econ.notifications];

    // Military upkeep (food + guns consumption, per cluster); reuse clusters from economy
    const upkeepResult = upkeepTick(units, cities, flushHeroes, newCycle, flushTiles, flushTerritory);
    notifs.push(...upkeepResult.notifications);

    let constructionsForSet = s.constructions;
    const autoBuild = planHumanBuilderAutomation({
      cities,
      players,
      tiles: flushTiles,
      territory: flushTerritory,
      constructions: constructionsForSet,
      defenseInstallations: s.defenseInstallations ?? [],
      scoutTowers: s.scoutTowers ?? [],
      humanPlayerId: HUMAN_ID,
      generateId,
    });
    if (autoBuild) {
      cities = autoBuild.nextCities;
      players = players.map(p => (p.id === HUMAN_ID ? { ...p, gold: autoBuild.nextGold } : p));
      constructionsForSet = [...constructionsForSet, ...autoBuild.newConstructions];
      if (autoBuild.notification) {
        notifs.push({
          id: generateId('n'),
          turn: newCycle,
          message: autoBuild.notification,
          type: 'info',
        });
      }
    }

    // AI turn(s): for each AI player, plan and apply builds, upgrades, recruits, moves, scouts, village incorporation, wall rings
    const aiPlayerIds =
      s.gameMode === 'human_solo' ? [] : s.players.filter(p => !p.isHuman).map(p => p.id);
    let scoutMissions = s.scoutMissions;
    let scoutedHexes = s.scoutedHexes;
    let tilesMut = flushTiles;
    let wallSectionsMut: WallSection[] = s.wallSections.map(w => ({ ...w }));
    const pendingScrollAttachments: ScrollAttachment[] = [];
    const pendingScrollRemovals: string[] = [];

    for (const aiPlayerId of aiPlayerIds) {
      const aiPlan = planAiTurn(
        aiPlayerId, cities, units, players, tilesMut, flushTerritory, getAiParams(), wallSectionsMut,
        s.contestedZoneHexKeys ?? [], s.commanders ?? [], s.scrollInventory ?? {}, s.scrollAttachments ?? [],
        s.scrollRelics ?? [], s.scrollRegionClaimed ?? emptyScrollRegionClaimed(),
      );
      const aiPlayer = players.find(p => p.id === aiPlayerId);
      if (!aiPlayer) continue;

      for (const build of aiPlan.builds) {
        const city = cities.find(c => c.id === build.cityId);
        if (!city || city.ownerId !== aiPlayerId) continue;
        if (aiPlayer.gold < BUILDING_COSTS[build.type]) continue;
        const ironCost = (BUILDING_IRON_COSTS[build.type] ?? 0);
        if (ironCost > 0 && (city.storage.iron ?? 0) < ironCost) continue;
        const b: CityBuilding = { type: build.type, q: build.q, r: build.r };
        if (['quarry', 'mine', 'gold_mine', 'barracks', 'factory', 'academy', 'siege_workshop', 'farm', 'banana_farm', 'market', 'social_bar'].includes(build.type)) b.level = 1;
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
        if (rec.type === 'builder') continue;
        const barracks = city.buildings.find(b => b.type === 'barracks');
        if (rec.type === 'defender' || wantL2 || wantL3) {
          if ((barracks?.level ?? 1) < 2) continue;
        }
        const sq = city.q;
        const sr = city.r;
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
          clearPatrolFieldsMutable(unit);
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
        if (constructionsForSet.some(c => c.cityId === city.id && c.type === 'wall_section')) continue;
        const ownerWallKeys = new Set(wallSectionsMut.filter(w => w.ownerId === aiPlayerId).map(w => tileKey(w.q, w.r)));
        const queuedWallKeys = new Set(
          constructionsForSet
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
        constructionsForSet = [...constructionsForSet, {
          id: generateId('con'),
          type: 'wall_section',
          q: next.q,
          r: next.r,
          cityId: city.id,
          ownerId: aiPlayerId,
          bpRequired: WALL_SECTION_BP_COST,
          bpAccumulated: 0,
          wallBuildRing: next.ring,
        }];
      }

      // AI commander field assignments
      for (const ca of aiPlan.commanderAssignments ?? []) {
        const cmd = flushCommanders.find(c => c.id === ca.commanderId && c.ownerId === aiPlayerId);
        if (cmd) cmd.assignment = ca.assignment;
      }

      // AI scroll attachments
      for (const sa of aiPlan.scrollAttachments ?? []) {
        const inv = s.scrollInventory[aiPlayerId] ?? [];
        const scrollItem = inv.find(si => si.id === sa.scrollId);
        if (!scrollItem) continue;
        const carrier = units.find(u => u.id === sa.carrierUnitId && u.ownerId === aiPlayerId);
        if (!carrier || carrier.hp <= 0) continue;
        const already = s.scrollAttachments.some(a => a.scrollId === sa.scrollId);
        if (already) continue;
        pendingScrollAttachments.push({
          id: generateId('sa'),
          scrollId: scrollItem.id,
          kind: scrollItem.kind,
          sourceRegion: scrollItem.sourceRegion,
          carrierUnitId: carrier.id,
          ownerId: aiPlayerId,
        });
        pendingScrollRemovals.push(sa.scrollId);
      }

      // AI stance changes (tactical combat adjustments)
      for (const sc of aiPlan.stanceChanges ?? []) {
        const unit = units.find(u => u.id === sc.unitId && u.ownerId === aiPlayerId);
        if (unit && unit.hp > 0) unit.stance = sc.stance;
      }

      // AI retreat (when losing badly)
      for (const rt of aiPlan.retreats ?? []) {
        const unit = units.find(u => u.id === rt.unitId && u.ownerId === aiPlayerId);
        if (unit && unit.hp > 0 && !unit.retreatAt) {
          unit.retreatAt = Date.now() + RETREAT_DELAY_MS;
        }
      }

      // AI university task selection
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
          s.gameMode === 'bot_vs_bot' || s.gameMode === 'spectate'
            ? (s.players.find(p => p.id === winnerId)?.name ?? 'Empire')
            : winnerId === HUMAN_ID
              ? 'You'
              : (s.gameMode === 'human_solo' ? 'Training target' : (s.players.find(p => p.id === winnerId)?.name ?? 'Enemy'));
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

    const scrollTick = tickScrollRelicPickup({
      newCycle,
      tiles: tilesMut,
      units: aliveUnits,
      players: playersForSet,
      scrollRelics: s.scrollRelics ?? [],
      scrollRegionClaimed: s.scrollRegionClaimed ?? emptyScrollRegionClaimed(),
      scrollInventory: s.scrollInventory ?? {},
    });
    notifs.push(...scrollTick.notifications);
    let nextScrollModal = s.scrollRelicPickupModal;
    for (const ev of scrollTick.scrollRelicPickupEvents) {
      if (ev.playerId === HUMAN_ID) {
        nextScrollModal = { regionKind: ev.regionKind, kind: ev.kind };
      }
    }

    // Victory check
    let phase: GamePhase = 'playing';
    if (s.gameMode === 'bot_vs_bot' || s.gameMode === 'spectate') {
      const aiIds = s.players.filter(p => !p.isHuman).map(p => p.id);
      const alive = aiIds.filter(pid => citiesForSet.some(c => c.ownerId === pid));
      if (alive.length <= 1) {
        phase = 'victory';
        clearAllTimers();
        const w = alive[0];
        const wname = w ? players.find(p => p.id === w)?.name ?? 'Empire' : 'Empire';
        notifs.push({ id: generateId('n'), turn: newCycle, message: `${wname} wins!`, type: 'success' });
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
      const aiIds = s.players.filter(p => !p.isHuman).map(p => p.id);
      const anyAiAlive = citiesForSet.some(c => aiIds.includes(c.ownerId));
      if (humanCities.length === 0) {
        phase = 'victory'; clearAllTimers();
        notifs.push({ id: generateId('n'), turn: newCycle, message: 'Defeat! Your empire has fallen.', type: 'danger' });
      } else if (!anyAiAlive) {
        phase = 'victory'; clearAllTimers();
        notifs.push({ id: generateId('n'), turn: newCycle, message: 'Victory! You conquered all rival empires!', type: 'success' });
      }
    }

    const wallEconomyStonePaidByCity: Record<string, boolean> = {};
    const citiesWallStone = citiesForSet.map(c => {
      const hasWallSite = constructionsForSet.some(
        con => con.cityId === c.id && con.type === 'wall_section',
      );
      if (!hasWallSite) return c;
      const slots = countDefensesTaskSlots(c);
      if (slots <= 0) {
        wallEconomyStonePaidByCity[c.id] = false;
        return c;
      }
      const cost = slots * WALL_BUILDER_STONE_PER_CYCLE_PER_SLOT;
      const stone = c.storage.stone ?? 0;
      if (stone >= cost) {
        wallEconomyStonePaidByCity[c.id] = true;
        return {
          ...c,
          storage: { ...c.storage, stone: stone - cost },
        };
      }
      wallEconomyStonePaidByCity[c.id] = false;
      return c;
    });

    set({
      cities: citiesWallStone,
      units: aliveUnits,
      heroes: flushHeroes,
      commanders: flushCommanders,
      unitStacks: unitStacksMut,
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
      combatMoraleState: new Map(),
      combatKillFeed: [],
      activeWeather: currentWeather,
      lastWeatherEndCycle: lastWeatherEnd,
      scoutMissions,
      scoutedHexes,
      tiles: tilesMut,
      pendingRecruits: pendingRecruitsAcc,
      pendingIncorporations: pendingIncorporationsAcc,
      constructions: constructionsForSet,
      visibleHexes: flushVisible,
      exploredHexes: flushExplored,
      scrollRegionClaimed: scrollTick.scrollRegionClaimed,
      scrollRelicPickupModal: nextScrollModal,
      scrollInventory: pendingScrollRemovals.length > 0
        ? Object.fromEntries(
            Object.entries(scrollTick.scrollInventory).map(([pid, items]) => [
              pid,
              items.filter(si => !pendingScrollRemovals.includes(si.id)),
            ]),
          )
        : scrollTick.scrollInventory,
      scrollAttachments: pendingScrollAttachments.length > 0
        ? [...s.scrollAttachments, ...pendingScrollAttachments]
        : s.scrollAttachments,
      notifications: [...s.notifications.slice(-8), ...notifs],
      wallEconomyStonePaidByCity,
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
      if (orderType === 'defend_pick' || orderType === 'city_defense_pick') {
        get().setTacticalCityDefenseTargetFromMap(q, r);
        return;
      }
      if (orderType === 'patrol_paint') {
        get().toggleTacticalPatrolPaintHex(q, r);
        return;
      }
      if (orderType === 'patrol_pick') {
        get().setTacticalPatrolTargetFromMap(q, r);
        return;
      }
      if (orderType === 'incorporate_village') {
        get().setTacticalIncorporateTargetForSelected(q, r);
        return;
      }
      if (orderType === 'attack_building_pick') {
        get().setTacticalAttackBuildingTargetForSelected(q, r);
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
    if (s.uiMode === 'build_defense') {
      const pd = s.pendingDefenseBuild;
      if (pd) {
        const before = s.constructions.length;
        get().startCityDefenseTowerBuild(q, r, pd.towerType, pd.level, pd.cityId);
        const after = get().constructions.length;
        if (after > before) {
          set({ uiMode: 'normal', pendingDefenseBuild: null });
        }
      }
      return;
    }
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
    if (s.archerDoctrineModalCityId !== null) {
      set({ archerDoctrineModalCityId: null });
      return;
    }
    if (s.battleModalHexKey !== null) {
      set({ battleModalHexKey: null });
      return;
    }
    if (s.assigningTacticalForSelectedStacks !== null || s.assigningTacticalForStack !== null) {
      set({
        assigningTacticalForSelectedStacks: null,
        assigningTacticalForStack: null,
        assigningTacticalOrderType: null,
        tacticalPatrolPaintHexKeys: [],
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
    if (s.uiMode === 'build_defense') {
      get().cancelDefensePlacement();
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
    } else if (s.uiMode === 'build_defense') {
      set({ selectedHex: null, uiMode: 'normal', pendingMove: null, pendingDefenseBuild: null, cityLogisticsOpen: false });
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
    const observer = s.gameMode === 'bot_vs_bot' || s.gameMode === 'bot_vs_bot_4' || s.gameMode === 'spectate';
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
    if (type === 'social_bar') {
      if (
        city.buildings.some(
          b => b.type === 'social_bar' && isCityBuildingOperational(ensureCityBuildingHp(b)),
        )
      ) {
        get().addNotification('Each city may only have one Social hall.', 'warning');
        return;
      }
    }
    if (type === 'quarry') {
      if (!tile.hasQuarryDeposit) { get().addNotification('Quarry must be built on a quarry deposit!', 'warning'); return; }
      if (city.population < 10) { get().addNotification('Need 10 population at city for quarry!', 'warning'); return; }
    } else if (type === 'mine') {
      if (!tile.hasMineDeposit) { get().addNotification('Mine must be built on a mine deposit!', 'warning'); return; }
      if (city.population < 10) { get().addNotification('Need 10 population at city for mine!', 'warning'); return; }
    } else if (type === 'logging_hut') {
      if (tile.biome !== 'forest') {
        get().addNotification('Logging hut must be built on forest!', 'warning'); return;
      }
      if (city.population < 10) { get().addNotification('Need 10 population at city for logging hut!', 'warning'); return; }
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

    const inTerr = isPlayerTerritory ? ' (city power + University if task matches)' : ' (University workforce if task matches)';
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
      `Trebuchet construction started (${TREBUCHET_FIELD_GOLD_COST}g, ${TREBUCHET_REFINED_WOOD_COST} ref., ${TREBUCHET_FIELD_BP_COST} BP). Nearest University provides BP.`,
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

  startCityDefenseTowerBuild: (q, r, towerType, targetLevel, placementCityId) => {
    const s = get();
    const player = s.players.find(p => p.id === HUMAN_ID);
    if (!player) return;

    // Always build on the hex passed from the UI (selected tile), not a pending move destination.
    const siteQ = q;
    const siteR = r;

    const tile = s.tiles.get(tileKey(siteQ, siteR));
    if (!tile || tile.biome === 'water' || tile.biome === 'mountain') {
      get().addNotification('Defenses can only be built on valid land hexes (not water or mountain).', 'warning');
      return;
    }
    if (s.cities.some(c => c.q === siteQ && c.r === siteR)) {
      get().addNotification('Cannot build defenses on the city center hex.', 'warning');
      return;
    }
    if (s.constructions.some(cs => cs.q === siteQ && cs.r === siteR)) {
      get().addNotification('Already under construction here!', 'warning');
      return;
    }
    const hexKey = tileKey(siteQ, siteR);
    const terr = s.territory.get(hexKey);
    if (!terr || terr.playerId !== HUMAN_ID) {
      get().addNotification('City defenses must be built inside your territory.', 'warning');
      return;
    }

    let payCity: City | undefined;
    if (placementCityId) {
      payCity = s.cities.find(c => c.id === placementCityId && c.ownerId === HUMAN_ID);
      if (!payCity) {
        get().addNotification('Could not find that city for defense placement.', 'warning');
        return;
      }
      const maxD = payCity.territoryRadius ?? TERRITORY_RADIUS;
      if (hexDistance(siteQ, siteR, payCity.q, payCity.r) > maxD) {
        get().addNotification(
          `That hex is outside ${payCity.name}'s territory ring (another city may own this tile on the map). Pick a hex closer to ${payCity.name}, or reassign overlapping territory by city order.`,
          'warning',
        );
        return;
      }
    } else {
      payCity = s.cities.find(c => c.id === terr.cityId);
    }
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
      const count = s.defenseInstallations.filter(d => d.cityId === payCity.id && d.type === towerType).length;
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
      cityId: payCity.id,
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
      `${DEFENSE_TOWER_DISPLAY_NAME[towerType]} L${targetLevel} project started (${bpRequired} BP).`,
      'info',
    );
  },

  buildRoad: (q, r) => {
    const s = get();
    const tile = s.tiles.get(tileKey(q, r));
    if (!tile || tile.biome === 'water') return;  // allow roads on mountains for mine connectivity
    if (tile.hasRoad) { get().addNotification('Road already here!', 'info'); return; }
    if (s.roadConstructions.some(rc => rc.q === q && rc.r === r)) return;
    const terr = s.territory.get(tileKey(q, r));
    if (!terr || terr.playerId !== HUMAN_ID) {
      get().addNotification('Roads must be in your territory (University workforce builds them).', 'warning');
      return;
    }
    const city = s.cities.find(c => c.id === terr.cityId);
    if (!city?.buildings.some(b => b.type === 'academy')) {
      get().addNotification('Need a University in this territory to build roads.', 'warning');
      return;
    }
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
      const nextDoc =
        newLevel === 3
          ? (c.archerDoctrineL3 === 'marksman' || c.archerDoctrineL3 === 'longbowman'
              ? c.archerDoctrineL3
              : null)
          : c.archerDoctrineL3;
      return {
        ...c,
        archerDoctrineL3: newLevel === 3 ? nextDoc : c.archerDoctrineL3,
        buildings: c.buildings.map(b =>
          b.type === 'barracks' && b.q === buildingQ && b.r === buildingR ? { ...b, level: newLevel } : b
        ),
      };
    });
    const upgradedCity = newCities.find(c => c.id === cityId);
    const showArcherModal =
      newLevel === 3 &&
      upgradedCity &&
      upgradedCity.archerDoctrineL3 !== 'marksman' &&
      upgradedCity.archerDoctrineL3 !== 'longbowman';
    set({
      players: s.players.map(p => p.id === HUMAN_ID ? { ...p, gold: p.gold - cost } : { ...p }),
      cities: newCities,
      ...(showArcherModal ? { archerDoctrineModalCityId: cityId } : {}),
    });
    get().addNotification(
      newLevel === 2
        ? 'Barracks upgraded to L2! Can recruit L2 units.'
        : 'Barracks upgraded to L3! Choose your archer doctrine; Crusaders can recruit Grand Crusaders.',
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

  upgradeResourceMine: (cityId, buildingQ, buildingR) => {
    const s = get();
    const player = s.players.find(p => p.id === HUMAN_ID);
    const city = s.cities.find(c => c.id === cityId);
    if (!player || !city) return;
    if (player.gold < RESOURCE_MINE_UPGRADE_COST) {
      get().addNotification(`Need ${RESOURCE_MINE_UPGRADE_COST} gold!`, 'warning');
      return;
    }
    const building = city.buildings.find(
      b =>
        (b.type === 'quarry' || b.type === 'mine' || b.type === 'gold_mine') &&
        b.q === buildingQ &&
        b.r === buildingR,
    );
    if (!building) return;
    const lvl = building.level ?? 1;
    if (lvl >= 2) {
      get().addNotification('This site is already upgraded (L2).', 'info');
      return;
    }
    const label =
      building.type === 'quarry' ? 'Quarry' : building.type === 'gold_mine' ? 'Gold mine' : 'Mine';
    const newCities = s.cities.map(c => {
      if (c.id !== cityId) return c;
      return {
        ...c,
        buildings: c.buildings.map(b =>
          (b.type === 'quarry' || b.type === 'mine' || b.type === 'gold_mine') &&
          b.q === buildingQ &&
          b.r === buildingR
            ? { ...b, level: 2 }
            : b,
        ),
      };
    });
    set({
      players: s.players.map(p => (p.id === HUMAN_ID ? { ...p, gold: p.gold - RESOURCE_MINE_UPGRADE_COST } : p)),
      cities: newCities,
    });
    get().addNotification(`${label} upgraded — higher output per cycle (L2).`, 'success');
  },

  upgradeSocialBar: (cityId, buildingQ, buildingR) => {
    const s = get();
    const player = s.players.find(p => p.id === HUMAN_ID);
    const city = s.cities.find(c => c.id === cityId);
    if (!player || !city) return;
    const building = city.buildings.find(
      b => b.type === 'social_bar' && b.q === buildingQ && b.r === buildingR,
    );
    if (!building) return;
    const lvl = building.level ?? 1;
    if (lvl >= 3) {
      get().addNotification('Social hall is already max level (L3).', 'info');
      return;
    }
    const cost = SOCIAL_BAR_UPGRADE_COSTS[lvl - 1];
    if (cost === undefined || player.gold < cost) {
      get().addNotification(`Need ${cost ?? '?'} gold to upgrade Social hall.`, 'warning');
      return;
    }
    const newLevel = lvl + 1;
    set({
      players: s.players.map(p => (p.id === HUMAN_ID ? { ...p, gold: p.gold - cost } : p)),
      cities: s.cities.map(c =>
        c.id !== cityId
          ? c
          : {
              ...c,
              buildings: c.buildings.map(b =>
                b.type === 'social_bar' && b.q === buildingQ && b.r === buildingR
                  ? { ...b, level: newLevel }
                  : b,
              ),
            },
      ),
    });
    get().addNotification(`Social hall upgraded to L${newLevel}! Stronger population growth bonus.`, 'success');
  },

  buyTradeMapQuadrant: quad => {
    const s = get();
    const p = s.players.find(pl => pl.id === HUMAN_ID);
    if (!p) return;
    const cur = { ...EMPTY_MAP_QUADRANTS, ...p.mapQuadrantsRevealed };
    if (cur[quad]) {
      get().addNotification('You already hold that map sheet.', 'info');
      return;
    }
    if (p.gold < TRADE_MAP_QUADRANT_GOLD) {
      get().addNotification(`Need ${TRADE_MAP_QUADRANT_GOLD} gold for a map sheet.`, 'warning');
      return;
    }
    const next = { ...cur, [quad]: true };
    set({
      players: s.players.map(pl =>
        pl.id === HUMAN_ID ? { ...pl, gold: pl.gold - TRADE_MAP_QUADRANT_GOLD, mapQuadrantsRevealed: next } : pl,
      ),
    });
    get().recomputeVision();
    get().addNotification(`${MAP_QUADRANT_LABELS[quad]} chart secured — full troop intel in that quarter.`, 'success');
  },

  buyTradeMapFullAtlas: () => {
    const s = get();
    const p = s.players.find(pl => pl.id === HUMAN_ID);
    if (!p) return;
    const cur = { ...EMPTY_MAP_QUADRANTS, ...p.mapQuadrantsRevealed };
    if (cur.nw && cur.ne && cur.sw && cur.se) {
      get().addNotification('You already own the full atlas.', 'info');
      return;
    }
    if (p.gold < TRADE_MAP_FULL_ATLAS_GOLD) {
      get().addNotification(`Need ${TRADE_MAP_FULL_ATLAS_GOLD} gold for the full atlas.`, 'warning');
      return;
    }
    const next = { nw: true, ne: true, sw: true, se: true };
    set({
      players: s.players.map(pl =>
        pl.id === HUMAN_ID ? { ...pl, gold: pl.gold - TRADE_MAP_FULL_ATLAS_GOLD, mapQuadrantsRevealed: next } : pl,
      ),
    });
    get().recomputeVision();
    get().addNotification('Imperial atlas complete — the whole map is open to your scouts.', 'success');
  },

  buyTradeResourcePack: key => {
    const s = get();
    const p = s.players.find(pl => pl.id === HUMAN_ID);
    const pack = TRADE_RESOURCE_PACK_GOLD[key];
    if (!p || !pack) return;
    if (p.gold < pack.gold) {
      get().addNotification('Not enough gold for that shipment.', 'warning');
      return;
    }
    const hc = s.cities.filter(c => c.ownerId === HUMAN_ID);
    if (hc.length === 0) return;
    const amt = pack.amount;
    const n = hc.length;
    const base = Math.floor(amt / n);
    const rem = amt % n;
    let idx = 0;
    const cities = s.cities.map(c => {
      if (c.ownerId !== HUMAN_ID) return c;
      const add = base + (idx < rem ? 1 : 0);
      idx++;
      if (add <= 0) return c;
      const cap = c.storageCap;
      const st = { ...c.storage };
      if (key === 'food') st.food = Math.min(cap.food, st.food + add);
      else if (key === 'goods') st.goods = Math.min(cap.goods, st.goods + add);
      else if (key === 'stone') st.stone = Math.min(cap.stone, (st.stone ?? 0) + add);
      else if (key === 'iron') st.iron = Math.min(cap.iron, (st.iron ?? 0) + add);
      else if (key === 'wood') st.wood = Math.min(cap.wood ?? 50, (st.wood ?? 0) + add);
      else if (key === 'refinedWood') {
        st.refinedWood = Math.min(cap.refinedWood ?? 50, (st.refinedWood ?? 0) + add);
      } else if (key === 'guns') st.guns = Math.min(cap.guns, st.guns + add);
      else if (key === 'gunsL2') {
        st.gunsL2 = Math.min(cap.gunsL2, (st.gunsL2 ?? 0) + add);
      }
      return { ...c, storage: st };
    });
    set({
      players: s.players.map(pl => (pl.id === HUMAN_ID ? { ...pl, gold: pl.gold - pack.gold } : pl)),
      cities,
    });
    get().addNotification(`Caravan delivered ${amt} ${key} (split across cities, capped by granaries).`, 'success');
  },

  buyTradeMoraleFestival: () => {
    const s = get();
    const p = s.players.find(pl => pl.id === HUMAN_ID);
    if (!p || p.gold < TRADE_MORALE_FESTIVAL_GOLD) {
      get().addNotification(`Need ${TRADE_MORALE_FESTIVAL_GOLD} gold for a festival.`, 'warning');
      return;
    }
    set({
      players: s.players.map(pl => (pl.id === HUMAN_ID ? { ...pl, gold: pl.gold - TRADE_MORALE_FESTIVAL_GOLD } : pl)),
      cities: s.cities.map(c =>
        c.ownerId === HUMAN_ID
          ? { ...c, morale: Math.min(100, c.morale + TRADE_MORALE_FESTIVAL_DELTA) }
          : c,
      ),
    });
    get().addNotification('City-wide festival! Morale rose in all your settlements.', 'success');
  },

  buyTradeRoyalSurvey: () => {
    const s = get();
    const p = s.players.find(pl => pl.id === HUMAN_ID);
    if (!p || p.gold < TRADE_ROYAL_SURVEY_GOLD) {
      get().addNotification(`Need ${TRADE_ROYAL_SURVEY_GOLD} gold for the royal survey.`, 'warning');
      return;
    }
    set({
      players: s.players.map(pl => (pl.id === HUMAN_ID ? { ...pl, gold: pl.gold - TRADE_ROYAL_SURVEY_GOLD } : pl)),
    });
    get().addNotification(
      'Royal surveyors map roads and ruins — send scouts and armies to named wilds to find relic scrolls on the ground.',
      'success',
    );
  },

  upgradeUniversity: (cityId, academyQ, academyR) => {
    const s = get();
    const player = s.players.find(p => p.id === HUMAN_ID);
    const city = s.cities.find(c => c.id === cityId);
    if (!player || !city) return;
    const building = city.buildings.find(b => b.type === 'academy' && b.q === academyQ && b.r === academyR);
    if (!building) return;
    const lvl = building.level ?? 1;
    if (lvl >= 5) {
      get().addNotification('University is at max level (L5).', 'info');
      return;
    }
    const cost = UNIVERSITY_UPGRADE_COSTS[lvl - 1];
    if (cost === undefined || player.gold < cost) {
      get().addNotification(`Need ${cost ?? '?'} gold to upgrade University.`, 'warning');
      return;
    }
    const newLevel = lvl + 1;
    const newCities = s.cities.map(c => {
      if (c.id !== cityId) return c;
      const building = c.buildings.find(b => b.type === 'academy' && b.q === academyQ && b.r === academyR);
      const prevTasks = getUniversitySlotTasks(c, building);
      const expanded = [...prevTasks];
      while (expanded.length < newLevel) {
        expanded.push(c.universityBuilderTask ?? expanded[expanded.length - 1] ?? 'expand_quarries');
      }
      if (expanded.length > newLevel) expanded.length = newLevel;
      return {
        ...c,
        universityBuilderSlotTasks: expanded,
        universityBuilderTask: expanded[0] ?? c.universityBuilderTask,
        buildings: c.buildings.map(b =>
          b.type === 'academy' && b.q === academyQ && b.r === academyR ? { ...b, level: newLevel } : b
        ),
      };
    });
    set({
      players: s.players.map(p => (p.id === HUMAN_ID ? { ...p, gold: p.gold - cost } : p)),
      cities: newCities,
    });
    get().addNotification(`University upgraded to L${newLevel}! Workforce: ${newLevel} builder slot${newLevel > 1 ? 's' : ''}.`, 'success');
  },

  setUniversityBuilderTask: (cityId, task) => {
    const s = get();
    const city = s.cities.find(c => c.id === cityId && c.ownerId === HUMAN_ID);
    if (!city?.buildings.some(b => b.type === 'academy')) {
      get().addNotification('Need a University in that city.', 'warning');
      return;
    }
    const academy = city.buildings.find(b => b.type === 'academy');
    const slotTasks = fillUniversitySlotTasks(city, academy, task);
    set({
      cities: s.cities.map(c =>
        c.id === cityId
          ? { ...c, universityBuilderTask: task, universityBuilderSlotTasks: slotTasks }
          : c,
      ),
    });
    get().addNotification(
      task === 'idle'
        ? 'University workforce: all slots unassigned.'
        : `University workforce: all slots → ${BUILDER_TASK_LABELS[task]}.`,
      'info',
    );
  },

  setUniversityBuilderSlotTask: (cityId, slotIndex, task) => {
    const s = get();
    const city = s.cities.find(c => c.id === cityId && c.ownerId === HUMAN_ID);
    const academy = city?.buildings.find(b => b.type === 'academy');
    if (!city || !academy) {
      get().addNotification('Need a University in that city.', 'warning');
      return;
    }
    const tasks = getUniversitySlotTasks(city, academy);
    if (slotIndex < 0 || slotIndex >= tasks.length) return;
    const next = [...tasks];
    next[slotIndex] = task;
    set({
      cities: s.cities.map(c =>
        c.id === cityId
          ? { ...c, universityBuilderSlotTasks: next, universityBuilderTask: next[0] ?? task }
          : c,
      ),
    });
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

  recruitUnit: (cityId, type, armsLevel, stackOpts) => {
    const s = get();
    const player = s.players.find(p => p.isHuman);
    const city = s.cities.find(c => c.id === cityId);
    if (!player || !city) return;

    if (isNavalUnitType(type)) {
      get().addNotification('Build ships at a Shipyard (Ships panel).', 'info'); return;
    }

    const isBuilder = type === 'builder';
    const barracks = city.buildings.find(b => b.type === 'barracks');
    const barracksLvl = barracks ? (barracks.level ?? 1) : 1;
    // Defender is always L3; other units use requested armsLevel (1/2/3)
    let effectiveLevel: 1 | 2 | 3 = type === 'defender' ? 3 : (armsLevel ?? 1);
    if (type === 'crusader_knight') effectiveLevel = 3;
    if (type === 'trebuchet' || type === 'battering_ram') effectiveLevel = 1;
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
      get().addNotification('Builders are tied to your University level — open the University to set workforce tasks.', 'info');
      return;
    } else if (type === 'trebuchet' || type === 'battering_ram') {
      const siegeWs = city.buildings.find(b => b.type === 'siege_workshop');
      if (!siegeWs) {
        get().addNotification('Build a Siege workshop to recruit trebuchets and battering rams!', 'warning'); return;
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

    let resolvedRangedVariant: RangedVariant | undefined;
    if (type === 'ranged' && wantL3) {
      const stackRv = stackOpts && 'rangedVariant' in stackOpts ? stackOpts.rangedVariant : undefined;
      if (barracksLvl >= 3) {
        const doc = city.archerDoctrineL3;
        if (doc !== 'marksman' && doc !== 'longbowman') {
          set({ archerDoctrineModalCityId: cityId });
          get().addNotification(
            'Choose your city archer doctrine (Marksman vs Longbowman) to train L3 iron archers.',
            'warning',
          );
          return;
        }
        resolvedRangedVariant = stackRv ?? doc;
      } else {
        resolvedRangedVariant = stackRv ?? 'marksman';
      }
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

    const stats = getUnitStats({
      type,
      armsLevel: effectiveLevel as 1 | 2 | 3,
      rangedVariant: resolvedRangedVariant,
    });
    const gunL2Upkeep = (stats as { gunL2Upkeep?: number }).gunL2Upkeep ?? 0;
    if (gunL2Upkeep > 0) {
      const totalGunsL2 = s.cities.filter(c => c.ownerId === HUMAN_ID).reduce((sum, c) => sum + (c.storage.gunsL2 ?? 0), 0);
      if (totalGunsL2 < gunL2Upkeep) {
        get().addNotification('Need L2 arms to recruit this unit! Build upgraded factory.', 'warning'); return;
      }
    }

    const spawnQ = city.q;
    const spawnR = city.r;
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

    let unitStacksNext = s.unitStacks ?? [];
    let targetStackId: string | undefined;
    if (stackOpts?.stackMode === 'new') {
      const sid = generateId('stack');
      const compArms: 1 | 2 | 3 = effArms;
      const comp0 =
        type === 'ranged' && compArms === 3 && resolvedRangedVariant
          ? { unitType: type, armsLevel: compArms, count: 1, rangedVariant: resolvedRangedVariant }
          : { unitType: type, armsLevel: compArms, count: 1 };
      unitStacksNext = [
        ...unitStacksNext,
        {
          id: sid,
          ownerId: HUMAN_ID,
          homeCityId: cityId,
          name: stackOpts.name?.trim() || `Stack ${unitStacksNext.filter(a => a.ownerId === HUMAN_ID).length + 1}`,
          composition: [comp0],
          autoReplenish: false,
          rallyQ: city.q,
          rallyR: city.r,
        },
      ];
      targetStackId = sid;
    } else if (stackOpts?.stackMode === 'existing') {
      const ar = unitStacksNext.find(a => a.id === stackOpts.stackId && a.ownerId === HUMAN_ID);
      if (!ar) {
        get().addNotification('That unit stack no longer exists.', 'warning');
        return;
      }
      unitStacksNext = unitStacksNext.map(a =>
        a.id === ar.id
          ? {
              ...a,
              composition: mergeCompositionEntry(
                a.composition,
                type,
                effArms,
                1,
                type === 'ranged' && effArms === 3 ? resolvedRangedVariant : undefined,
              ),
              rallyQ: city.q,
              rallyR: city.r,
            }
          : a,
      );
      targetStackId = ar.id;
    }

    const prItem: PendingLandRecruit = {
      id: generateId('pr'),
      playerId: HUMAN_ID,
      cityId,
      type,
      effectiveArmsLevel: effArms,
      ...(type === 'ranged' && effArms === 3 && resolvedRangedVariant
        ? { rangedVariant: resolvedRangedVariant }
        : {}),
      spawnQ,
      spawnR,
      completesAtCycle: s.cycle + 1,
      ...(targetStackId ? { stackId: targetStackId } : {}),
    };

    const nextPlayers = s.players.map(p => p.id === player.id ? { ...p, gold: p.gold - goldCost } : p);
    if (gunL2Upkeep > 0) {
      updatedCities = updatedCities.slice();
      for (let i = 0; i < updatedCities.length; i++) {
        if (updatedCities[i].ownerId !== HUMAN_ID) continue;
        if ((updatedCities[i].storage.gunsL2 ?? 0) >= gunL2Upkeep) {
          updatedCities[i] = {
            ...updatedCities[i],
            storage: {
              ...updatedCities[i].storage,
              gunsL2: (updatedCities[i].storage.gunsL2 ?? 0) - gunL2Upkeep,
            },
          };
          break;
        }
      }
    }

    set({
      players: nextPlayers,
      cities: updatedCities,
      unitStacks: unitStacksNext,
      pendingRecruits: [...s.pendingRecruits, prItem],
    });
    const tierLabel = wantL3 ? `${ARMS_TIER_LABELS[3]} ` : wantL2 ? `${ARMS_TIER_LABELS[2]} ` : `${ARMS_TIER_LABELS[1]} `;
    const rwPart = refinedWoodCost > 0 ? `, ${refinedWoodCost} ref.` : '';
    const costStr =
      ironCost > 0
        ? (goldCost > 0 ? `${goldCost}g, ${ironCost} iron${rwPart}` : `${ironCost} iron${rwPart}`)
        : stoneCost > 0
          ? `${goldCost}g, ${stoneCost} stone${rwPart}`
          : refinedWoodCost > 0
            ? `${goldCost}g${rwPart}`
            : `${goldCost}g`;
    const displayName = getUnitDisplayName(type, effectiveLevel, resolvedRangedVariant);
    get().addNotification(`Training ${tierLabel}${displayName} — ready next cycle. (${costStr})`, 'info');
  },

  setCityArcherDoctrineL3: (cityId, doctrine) => {
    const s = get();
    set({
      cities: s.cities.map(c => (c.id === cityId ? { ...c, archerDoctrineL3: doctrine } : c)),
      archerDoctrineModalCityId: s.archerDoctrineModalCityId === cityId ? null : s.archerDoctrineModalCityId,
    });
    get().addNotification(
      `Archer doctrine: ${doctrine === 'marksman' ? 'Marksman' : 'Longbowman'} (locked for this city).`,
      'success',
    );
  },

  migrateLegacyArcherDoctrineIfNeeded: () => {
    const s = get();
    const next = migrateLegacyArcherDoctrine(s.cities);
    if (next !== s.cities) set({ cities: next });
  },

  trainAllStackTemplate: (cityId, stackId) => {
    const stk = get().unitStacks?.find(d => d.id === stackId && d.ownerId === HUMAN_ID);
    const city = get().cities.find(c => c.id === cityId);
    if (!stk || !city || city.ownerId !== HUMAN_ID) return;
    let budget = 40;
    for (const row of stk.composition) {
      if (row.count <= 0 || budget <= 0) continue;
      const have = get().units.filter(u => {
        if (u.stackId !== stackId || u.hp <= 0) return false;
        if (u.type !== row.unitType || (u.armsLevel ?? 1) !== row.armsLevel) return false;
        if (row.unitType === 'ranged' && row.armsLevel === 3) {
          return (u.rangedVariant ?? 'marksman') === (row.rangedVariant ?? 'marksman');
        }
        return true;
      }).length;
      const need = Math.min(row.count - have, budget);
      for (let i = 0; i < need; i++) {
        get().recruitUnit(cityId, row.unitType, row.armsLevel, {
          stackMode: 'existing',
          stackId,
          ...(row.unitType === 'ranged' && row.armsLevel === 3 && row.rangedVariant
            ? { rangedVariant: row.rangedVariant }
            : {}),
        });
        budget--;
        if (budget <= 0) return;
      }
    }
  },

  updateStackComposition: (stackId, composition) => {
    const s = get();
    set({
      unitStacks: (s.unitStacks ?? []).map(a =>
        a.id === stackId && a.ownerId === HUMAN_ID ? { ...a, composition } : a,
      ),
    });
  },

  setStackAutoReplenish: (stackId, enabled) => {
    const s = get();
    set({
      unitStacks: (s.unitStacks ?? []).map(a =>
        a.id === stackId && a.ownerId === HUMAN_ID ? { ...a, autoReplenish: enabled } : a,
      ),
    });
  },

  setStackName: (stackId, name) => {
    const s = get();
    set({
      unitStacks: (s.unitStacks ?? []).map(a =>
        a.id === stackId && a.ownerId === HUMAN_ID ? { ...a, name: name.trim() || a.name } : a,
      ),
    });
  },

  createArmy: (name) => {
    const s = get();
    const n = name?.trim() || `Field army ${(s.operationalArmies ?? []).filter(f => f.ownerId === HUMAN_ID).length + 1}`;
    const oa: OperationalArmy = {
      id: generateId('army'),
      ownerId: HUMAN_ID,
      name: n,
      stance: 'aggressive',
      stackIds: [],
    };
    set({ operationalArmies: [...(s.operationalArmies ?? []), oa] });
    get().addNotification(`Created ${n}. Add stacks from the army card (map hexes or barracks templates).`, 'info');
  },

  addStackToArmy: (armyId, stackId) => {
    const s = get();
    if (!s.unitStacks?.some(d => d.id === stackId && d.ownerId === HUMAN_ID)) {
      get().addNotification(
        'That unit stack does not exist. Train troops at a Barracks using a New or Existing stack, or pick a stack from the list.',
        'warning',
      );
      return;
    }
    set({
      operationalArmies: (s.operationalArmies ?? []).map(f => {
        if (f.ownerId !== HUMAN_ID) return f;
        const d0 = f.stackIds ?? [];
        if (f.id === armyId) {
          if (d0.includes(stackId)) return f;
          return { ...f, stackIds: [...d0, stackId] };
        }
        return { ...f, stackIds: d0.filter(id => id !== stackId) };
      }),
    });
    const name = s.unitStacks?.find(d => d.id === stackId)?.name ?? 'stack';
    get().addNotification(`Linked training stack "${name}" to army.`, 'success');
  },

  removeStackFromArmy: (armyId, stackId) => {
    const s = get();
    set({
      operationalArmies: (s.operationalArmies ?? []).map(f =>
        f.id === armyId && f.ownerId === HUMAN_ID
          ? { ...f, stackIds: (f.stackIds ?? []).filter(id => id !== stackId) }
          : f,
      ),
    });
  },

  selectStacksForArmy: (armyId) => {
    const s = get();
    const army = s.operationalArmies?.find(o => o.id === armyId && o.ownerId === HUMAN_ID);
    if (!army) return;
    const keys = new Set<string>();
    for (const u of s.units) {
      if (u.ownerId !== HUMAN_ID || u.hp <= 0) continue;
      if (u.armyId !== armyId) continue;
      keys.add(tileKey(u.q, u.r));
    }
    if (keys.size === 0) {
      get().addNotification('No units in this army on the map yet.', 'warning');
      return;
    }
    set({
      tacticalSelectedStackKeys: [...keys],
      tacticalOrderScope: 'army',
      tacticalOrderScopeArmyId: armyId,
    });
    get().addNotification(`Order scope: ${army.name} — ${keys.size} hex group(s).`, 'info');
  },

  deleteArmy: (armyId) => {
    const s = get();
    const scopeFix =
      s.tacticalOrderScope === 'army' && s.tacticalOrderScopeArmyId === armyId
        ? { tacticalOrderScope: 'all' as const, tacticalOrderScopeArmyId: null }
        : {};
    set({
      operationalArmies: (s.operationalArmies ?? []).filter(o => !(o.id === armyId && o.ownerId === HUMAN_ID)),
      units: s.units.map(u =>
        u.ownerId === HUMAN_ID && u.armyId === armyId ? { ...u, armyId: undefined } : u,
      ),
      commanders: s.commanders.map(c => {
        if (c.ownerId !== HUMAN_ID) return c;
        if (c.assignment?.kind === 'field_army' && c.assignment.armyId === armyId) {
          return { ...c, assignment: null };
        }
        return c;
      }),
      ...scopeFix,
    });
  },

  attachSelectedStacksToArmy: (armyId) => {
    const s = get();
    const army = s.operationalArmies?.find(o => o.id === armyId && o.ownerId === HUMAN_ID);
    if (!army) return;
    const keys = s.tacticalSelectedStackKeys ?? [];
    if (keys.length === 0) {
      get().addNotification('Select one or more stacks on the map list, then attach.', 'warning');
      return;
    }
    const unitIds = new Set<string>();
    for (const key of keys) {
      for (const u of s.units) {
        if (u.ownerId !== HUMAN_ID || u.hp <= 0) continue;
        if (tileKey(u.q, u.r) !== key) continue;
        if (u.aboardShipId || u.type === 'builder') continue;
        if (isNavalUnitType(u.type)) continue;
        unitIds.add(u.id);
      }
    }
    if (unitIds.size === 0) {
      get().addNotification('No land units in the selected stacks.', 'warning');
      return;
    }
    set({
      units: s.units.map(u => (unitIds.has(u.id) ? { ...u, armyId } : u)),
    });
    get().addNotification(`Attached ${unitIds.size} unit(s) to ${army.name}.`, 'success');
  },

  attachHexStackToArmy: (armyId, q, r) => {
    const s = get();
    const army = s.operationalArmies?.find(o => o.id === armyId && o.ownerId === HUMAN_ID);
    if (!army) return;
    const key = tileKey(q, r);
    const unitIds = new Set<string>();
    for (const u of s.units) {
      if (u.ownerId !== HUMAN_ID || u.hp <= 0) continue;
      if (tileKey(u.q, u.r) !== key) continue;
      if (u.aboardShipId || u.type === 'builder') continue;
      if (isNavalUnitType(u.type)) continue;
      unitIds.add(u.id);
    }
    if (unitIds.size === 0) {
      get().addNotification('No land units at that hex to attach (ships/builders excluded).', 'warning');
      return;
    }
    set({
      units: s.units.map(u => (unitIds.has(u.id) ? { ...u, armyId } : u)),
    });
    get().addNotification(`Attached ${unitIds.size} unit(s) at (${q},${r}) to ${army.name}.`, 'success');
  },

  detachHexStackFromArmy: (armyId, q, r) => {
    const s = get();
    const army = s.operationalArmies?.find(o => o.id === armyId && o.ownerId === HUMAN_ID);
    if (!army) return;
    const k = tileKey(q, r);
    let n = 0;
    set({
      units: s.units.map(u => {
        if (u.ownerId !== HUMAN_ID || u.hp <= 0) return u;
        if (u.armyId !== armyId) return u;
        if (tileKey(u.q, u.r) !== k) return u;
        if (u.aboardShipId || u.type === 'builder' || isNavalUnitType(u.type)) return u;
        n++;
        return { ...u, armyId: undefined };
      }),
    });
    if (n > 0) {
      get().addNotification(`Detached ${n} unit(s) at (${q},${r}) from ${army.name}.`, 'info');
    }
  },

  setArmyMarchSpread: (armyId, mode) => {
    const s = get();
    set({
      operationalArmies: (s.operationalArmies ?? []).map(o =>
        o.id === armyId && o.ownerId === HUMAN_ID ? { ...o, marchSpread: mode } : o,
      ),
    });
    const army = s.operationalArmies?.find(o => o.id === armyId && o.ownerId === HUMAN_ID);
    const label =
      mode === 'spread' ? 'Spread formation' : mode === 'stack' ? 'Stacked' : 'Session default';
    if (army) get().addNotification(`${army.name}: march ${label}.`, 'info');
  },

  assignCommanderToArmy: (commanderId, armyId) => {
    const s = get();
    const cmd = s.commanders.find(c => c.id === commanderId && c.ownerId === HUMAN_ID);
    const army = s.operationalArmies?.find(o => o.id === armyId && o.ownerId === HUMAN_ID);
    if (!cmd || !army) return;
    if ((cmd.commanderKind ?? 'land') === 'naval') {
      get().addNotification('Assign naval commanders to a fleet from the map stack list.', 'warning');
      return;
    }
    const lead = s.units.find(
      u =>
        u.ownerId === HUMAN_ID &&
        u.armyId === armyId &&
        u.hp > 0 &&
        !u.aboardShipId &&
        !isNavalUnitType(u.type) &&
        u.type !== 'builder',
    );
    if (!lead) {
      get().addNotification('Attach land units to this army before assigning a commander.', 'warning');
      return;
    }
    set({
      commanders: s.commanders.map(c => {
        if (c.id === commanderId && c.ownerId === HUMAN_ID) {
          return { ...c, assignment: { kind: 'field_army' as const, armyId }, q: lead.q, r: lead.r };
        }
        if (c.ownerId === HUMAN_ID && c.assignment?.kind === 'field_army' && c.assignment.armyId === armyId) {
          return { ...c, assignment: null };
        }
        return c;
      }),
    });
    get().addNotification(`${cmd.name} leads ${army.name}.`, 'success');
  },

  toggleTacticalPatrolPaintHex: (q, r) => {
    const s = get();
    const k = tileKey(q, r);
    const tile = s.tiles.get(k);
    if (!tile || tile.biome === 'water') return;
    const setKeys = new Set(s.tacticalPatrolPaintHexKeys ?? []);
    if (setKeys.has(k)) setKeys.delete(k);
    else setKeys.add(k);
    set({ tacticalPatrolPaintHexKeys: [...setKeys] });
  },

  addTacticalPatrolPaintHex: (q, r) => {
    const s = get();
    const k = tileKey(q, r);
    const tile = s.tiles.get(k);
    if (!tile || tile.biome === 'water') return;
    const setKeys = new Set(s.tacticalPatrolPaintHexKeys ?? []);
    if (setKeys.has(k)) return;
    setKeys.add(k);
    set({ tacticalPatrolPaintHexKeys: [...setKeys] });
  },

  clearTacticalPatrolPaint: () => set({ tacticalPatrolPaintHexKeys: [] }),

  finishTacticalPatrolFromPaint: () => {
    const s = get();
    const pending = s.assigningTacticalForSelectedStacks;
    if (!pending || pending.orderType !== 'patrol_paint' || s.pendingTacticalOrders === null) return;
    const keys = s.tacticalPatrolPaintHexKeys ?? [];
    if (keys.length === 0) {
      get().addNotification('Select at least one land hex for patrol, or use Center patrol.', 'warning');
      return;
    }
    let sq = 0;
    let sr = 0;
    for (const k of keys) {
      const [q, r] = parseTileKey(k);
      sq += q;
      sr += r;
    }
    const n = keys.length;
    const centerQ = Math.round(sq / n);
    const centerR = Math.round(sr / n);
    const next = { ...s.pendingTacticalOrders };
    let placed = 0;
    for (const stackKey of pending.stackKeys) {
      const [fromQ, fromR] = stackKey.split(',').map(Number);
      const stackUnits = s.units.filter(
        u => u.q === fromQ && u.r === fromR && u.ownerId === HUMAN_ID && u.hp > 0 && !u.aboardShipId,
      );
      const pids = resolveParticipatingUnitIdsForTactical(
        stackUnits,
        stackKey,
        s.tacticalIncludedUnitTypes,
        s.tacticalStackUnitTypeFocus,
      );
      if (pids !== undefined && pids.length === 0) continue;
      next[stackKey] =
        pids && pids.length > 0
          ? {
              type: 'patrol',
              centerQ,
              centerR,
              radius: PATROL_DEFAULT_RADIUS,
              hexKeys: keys,
              participatingUnitIds: pids,
            }
          : {
              type: 'patrol',
              centerQ,
              centerR,
              radius: PATROL_DEFAULT_RADIUS,
              hexKeys: keys,
            };
      placed++;
    }
    if (placed === 0) {
      get().addNotification('No units match the current type filter on those stacks.', 'warning');
      return;
    }
    set({
      pendingTacticalOrders: next,
      assigningTacticalForSelectedStacks: null,
      tacticalPatrolPaintHexKeys: [],
    });
    get().addNotification('Patrol zone set — Confirm orders.', 'info');
  },

  startTacticalPatrolCenterOnly: () => {
    const s = get();
    if (s.pendingTacticalOrders === null) return;
    const stackKeys = humanStackKeysForTactical(s);
    if (stackKeys.length === 0) return;
    set({
      assigningTacticalForSelectedStacks: { orderType: 'patrol_pick', stackKeys },
      tacticalPatrolPaintHexKeys: [],
      assigningTacticalForStack: null,
      assigningTacticalOrderType: null,
    });
  },

  repairCityBuilding: (cityId, buildingQ, buildingR) => {
    const s = get();
    const city = s.cities.find(c => c.id === cityId && c.ownerId === HUMAN_ID);
    const player = s.players.find(p => p.isHuman);
    if (!city || !player) return;
    const b = city.buildings.find(x => x.q === buildingQ && x.r === buildingR);
    if (!b || b.buildingState !== 'ruins') return;
    const baseCost = BUILDING_COSTS[b.type];
    const gold = Math.ceil(baseCost * RUINS_REPAIR_GOLD_RATIO);
    if (player.gold < gold) {
      get().addNotification(`Need ${gold} gold to repair ruins.`, 'warning');
      return;
    }
    const maxHp = b.maxHp ?? defaultCityBuildingMaxHp(b.type, b.level ?? 1);
    set({
      players: s.players.map(p => (p.id === HUMAN_ID ? { ...p, gold: p.gold - gold } : p)),
      cities: s.cities.map(c =>
        c.id !== cityId
          ? c
          : {
              ...c,
              buildings: c.buildings.map(bb =>
                bb.q === buildingQ && bb.r === buildingR
                  ? { ...bb, buildingState: 'normal' as const, hp: maxHp, maxHp }
                  : bb,
              ),
            },
      ),
    });
    get().addNotification('Building repaired.', 'success');
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

  recruitCommanderInstant: () => {
    const s = get();
    const player = s.players.find(p => p.id === HUMAN_ID);
    if (!player) return;
    if (player.gold < COMMANDER_RECRUIT_GOLD) {
      get().addNotification(`Need ${COMMANDER_RECRUIT_GOLD} gold to recruit a commander!`, 'warning');
      return;
    }
    const seed = (Date.now() ^ (Math.floor(Math.random() * 0x7fffffff) << 3)) >>> 0;
    const rolled = rollCommanderIdentity(seed);
    const portraitDataUrl = renderCommanderPortraitDataUrl(rolled.portraitSeed);
    const cmd = {
      id: generateId('cmd'),
      name: rolled.name,
      ownerId: HUMAN_ID,
      q: 0,
      r: 0,
      portraitSeed: rolled.portraitSeed,
      portraitDataUrl,
      traitIds: rolled.traitIds,
      backstory: rolled.backstory,
      assignment: null,
      commanderKind: rolled.commanderKind,
    };
    set({
      players: s.players.map(p => (p.id === HUMAN_ID ? { ...p, gold: p.gold - COMMANDER_RECRUIT_GOLD } : p)),
      commanders: [...s.commanders, cmd],
    });
    const kindLabel = rolled.commanderKind === 'naval' ? 'Naval commander' : 'Commander';
    get().addNotification(`${kindLabel} ${rolled.name} recruited.`, 'success');
  },

  assignCommanderToCityDefense: (commanderId, cityId) => {
    const s = get();
    const cmd = s.commanders.find(c => c.id === commanderId && c.ownerId === HUMAN_ID);
    const city = s.cities.find(c => c.id === cityId && c.ownerId === HUMAN_ID);
    if (!cmd || !city) {
      get().addNotification('Invalid commander or city.', 'warning');
      return;
    }
    if ((cmd.commanderKind ?? 'land') === 'naval') {
      get().addNotification('Naval commanders lead fleets, not city garrisons.', 'warning');
      return;
    }
    set({
      commanders: s.commanders.map(c => {
        if (c.ownerId !== HUMAN_ID) return c;
        if (c.id === commanderId) {
          return { ...c, assignment: { kind: 'city_defense' as const, cityId }, q: city.q, r: city.r };
        }
        if (c.assignment?.kind === 'city_defense' && c.assignment.cityId === cityId) {
          return { ...c, assignment: null };
        }
        return c;
      }),
    });
    get().addNotification(`${cmd.name} assigned to defend ${city.name}.`, 'success');
  },

  assignCommanderToFieldStack: (commanderId, q, r) => {
    const s = get();
    const cmd = s.commanders.find(c => c.id === commanderId && c.ownerId === HUMAN_ID);
    if (!cmd) return;
    const kind = cmd.commanderKind ?? 'land';
    const base = s.units.filter(
      u =>
        u.q === q &&
        u.r === r &&
        u.ownerId === HUMAN_ID &&
        u.hp > 0 &&
        !u.aboardShipId &&
        u.type !== 'builder',
    );
    const navalCandidates = base.filter(u => isNavalUnitType(u.type)).sort((a, b) => a.id.localeCompare(b.id));
    const landCandidates = base.filter(u => !isNavalUnitType(u.type)).sort((a, b) => a.id.localeCompare(b.id));

    let anchor: (typeof s.units)[number] | undefined;
    if (kind === 'naval') {
      anchor = navalCandidates[0];
      if (!anchor) {
        get().addNotification('No ships on this hex for a naval commander.', 'warning');
        return;
      }
    } else {
      anchor = landCandidates[0];
      if (!anchor) {
        get().addNotification('No land army on this hex for this commander.', 'warning');
        return;
      }
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
    get().addNotification(
      `${cmd.name} leads the ${kind === 'naval' ? 'fleet' : 'stack'} (anchor unit).`,
      'success',
    );
  },

  assignCommanderToFieldAtSelectedHex: (commanderId) => {
    const sel = get().selectedHex;
    if (!sel) {
      get().addNotification('Select a hex with your troops first.', 'warning');
      return;
    }
    get().assignCommanderToFieldStack(commanderId, sel.q, sel.r);
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

  startDefensePlacement: (towerType, level, cityId) => {
    set({ uiMode: 'build_defense', pendingDefenseBuild: { towerType, level, cityId } });
    get().addNotification(`Click a territory hex to place ${towerType.replace('_', ' ')} (starts at L${level}).`, 'info');
  },

  cancelDefensePlacement: () => {
    set({ uiMode: 'normal', pendingDefenseBuild: null });
  },

  startBuilderBuild: (mode) => {
    const s = get();
    if (!s.selectedHex) return;
    const hasUniversity = s.cities.some(
      c => c.ownerId === HUMAN_ID && c.buildings.some(b => b.type === 'academy'),
    );
    if (!hasUniversity) {
      get().addNotification('Build a University — its workforce handles field construction.', 'warning');
      return;
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

  queueNextWallSection: (cityId, opts) => {
    const s = get();
    const city = s.cities.find(c => c.id === cityId);
    if (!city) return;
    if (s.constructions.some(c => c.cityId === cityId && c.type === 'wall_section')) return;
    const blockedReason = getWallProjectBlockedReason(city);
    if (blockedReason) {
      if (!opts?.silent) get().addNotification(blockedReason, 'warning');
      return;
    }
    const built = new Set(
      s.wallSections.filter(w => w.ownerId === city.ownerId).map(w => tileKey(w.q, w.r)),
    );
    const queued = new Set(
      s.constructions
        .filter(c => c.cityId === cityId && c.type === 'wall_section')
        .map(c => tileKey(c.q, c.r)),
    );
    const next = getNextWallBuildHex(city, s.tiles, built, queued);
    if (!next) {
      if (city.ownerId === HUMAN_ID && !opts?.silent) {
        get().addNotification(`No wall gaps left to build around ${city.name}.`, 'info');
      }
      return;
    }
    const site: ConstructionSite = {
      id: generateId('con'),
      type: 'wall_section',
      q: next.q,
      r: next.r,
      cityId: city.id,
      ownerId: city.ownerId,
      bpRequired: WALL_SECTION_BP_COST,
      bpAccumulated: 0,
      wallBuildRing: next.ring,
    };
    set({ constructions: [...s.constructions, site] });
    if (city.ownerId === HUMAN_ID && !opts?.silent) {
      const ringLabel = next.ring === 1 ? 'inner ring' : 'outer ring';
      get().addNotification(
        `${city.name}: wall section (${ringLabel}, ${next.q},${next.r}). ${WALL_BUILDER_STONE_PER_CYCLE_PER_SLOT} stone/cycle per Defenses slot while workers build.`,
        'success',
      );
    }
  },

  /** Queue the next wall hex (inner ring first, then outer). Ring argument ignored — use for UI compatibility. */
  buildWallRing: (cityId, _ring) => {
    const s = get();
    const city = s.cities.find(c => c.id === cityId);
    if (!city || city.ownerId !== HUMAN_ID) return;
    if (s.constructions.some(c => c.cityId === cityId && c.type === 'wall_section')) {
      get().addNotification('A wall section is already under construction for this city.', 'warning');
      return;
    }
    get().queueNextWallSection(cityId);
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
    const site: ConstructionSite = {
      id: generateId('con'), type: bType, q, r, cityId, ownerId: HUMAN_ID,
      bpRequired: BUILDING_BP_COST[bType], bpAccumulated: 0,
    };
    const updatedCities = s.cities.map(c =>
      c.id === cityId && ironCost > 0
        ? { ...c, storage: { ...c.storage, iron: Math.max(0, (c.storage.iron ?? 0) - ironCost) } }
        : c
    );
    set({
      constructions: [...s.constructions, site],
      cities: updatedCities,
      players: s.players.map(p => p.id === HUMAN_ID ? { ...p, gold: p.gold - BUILDING_COSTS[bType] } : p),
      uiMode: 'normal',
    });
    get().addNotification(`${typeLabel} construction started! University workforce applies BP when the task matches.`, 'success');
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
      const terr = s.territory.get(tileKey(q, r));
      if (!terr || terr.playerId !== HUMAN_ID) continue;
      const rcity = s.cities.find(c => c.id === terr.cityId);
      if (!rcity?.buildings.some(b => b.type === 'academy')) continue;
      newSites.push({ id: generateId('road'), q, r, ownerId: HUMAN_ID, bpRequired: ROAD_BP_COST, bpAccumulated: 0 });
    }
    if (newSites.length === 0) {
      get().addNotification('Road path must stay inside territory with a University.', 'warning');
      set({ uiMode: 'normal', roadPathSelection: [] }); return;
    }
    const fromQ = s.roadPathSelection[0]?.q ?? 0;
    const fromR = s.roadPathSelection[0]?.r ?? 0;
    newSites.sort((a, b) =>
      hexDistance(fromQ, fromR, a.q, a.r) - hexDistance(fromQ, fromR, b.q, b.r)
    );
    set({
      roadConstructions: [...s.roadConstructions, ...newSites],
      uiMode: 'normal',
      roadPathSelection: [],
    });
    get().addNotification(`Road construction queued for ${newSites.length} hex(es). University workforce builds in territory.`, 'success');
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
    const stackKey = tileKey(fromQ, fromR);
    const pids =
      s.pendingTacticalOrders !== null
        ? resolveParticipatingUnitIdsForTactical(
            stack,
            stackKey,
            s.tacticalIncludedUnitTypes,
            s.tacticalStackUnitTypeFocus,
          )
        : resolveParticipatingUnitIds(stack, s.tacticalIncludedUnitTypes);
    if (pids !== undefined && pids.length === 0) {
      get().addNotification('No units match the current type filter on this stack.', 'warning');
      return;
    }
    const marching = pids ? stack.filter(u => pids.includes(u.id)) : stack;
    if (marching.length === 0) return;
    const naval = marching.some(u => isNavalUnitType(u.type));
    if (naval && !marching.every(u => isNavalUnitType(u.type))) {
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
      if (!canLandStackEmbarkFriendlyScoutAt(s.tiles, s.units, toQ, toR, marching, HUMAN_ID)) {
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

    const stackKey = tileKey(fromQ, fromR);
    const pids =
      s.pendingTacticalOrders !== null
        ? resolveParticipatingUnitIdsForTactical(
            readyUnits,
            stackKey,
            s.tacticalIncludedUnitTypes,
            s.tacticalStackUnitTypeFocus,
          )
        : resolveParticipatingUnitIds(readyUnits, s.tacticalIncludedUnitTypes);
    if (pids !== undefined && pids.length === 0) {
      get().addNotification('No units match the current type filter on this stack.', 'warning');
      set({ uiMode: 'normal', selectedHex: null });
      return;
    }
    const marching = pids ? readyUnits.filter(u => pids.includes(u.id)) : readyUnits;

    const dist = hexDistance(fromQ, fromR, toQ, toR);
    if (dist === 0) { set({ uiMode: 'normal', selectedHex: null }); return; }
    const maxLeg = maxMoveOrderDistanceForDestination(toQ, toR, s.territory, HUMAN_ID);
    if (dist > maxLeg) {
      get().addNotification(`Too far! Max ${maxLeg} hexes for this destination.`, 'warning');
      set({ uiMode: 'normal', selectedHex: null });
      return;
    }

    const naval = marching.some(u => isNavalUnitType(u.type));
    if (naval && !marching.every(u => isNavalUnitType(u.type))) {
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
      if (!canLandStackEmbarkFriendlyScoutAt(s.tiles, s.units, toQ, toR, marching, HUMAN_ID)) {
        get().addNotification('Land units cannot enter water (need a friendly scout ship with room at destination).', 'warning');
        set({ uiMode: 'normal', selectedHex: null }); return;
      }
    }

    const marchDf = resolveMarchFormationDfForMarching(marching, s.defaultMarchFormation, s.operationalArmies);
    const echelon = applyEchelonForLandMove(
      s.units,
      fromQ,
      fromR,
      toQ,
      toR,
      marching,
      s.cities,
      s.tiles,
      s.territory,
      marchDf,
    );
    let newUnits: Unit[];
    if (echelon !== null) {
      newUnits = echelon;
    } else {
      newUnits = s.units.map(u => {
        if (u.q !== fromQ || u.r !== fromR || u.ownerId !== HUMAN_ID || u.hp <= 0 || u.aboardShipId) return u;
        if (pids && !pids.includes(u.id)) return u;
        const deployed = withoutPatrolFields(withDeployFlags(u, toQ, toR, s.cities));
        const next: Unit = {
          ...deployed,
          targetQ: toQ,
          targetR: toR,
          status: 'moving' as const,
          marchInitialHexDistance: marchHexDistanceAtOrder(u, toQ, toR),
        };
        delete next.marchEchelonHold;
        delete next.attackWaveHold;
        return next;
      });
    }

    set({ units: newUnits, selectedHex: null, uiMode: 'normal' });
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
    get().addNotification(`Stance set to ${stance.replace('_', ' ')}`, 'info');
  },

  activateAbility: (unitType) => {
    const s = get();
    if (!s.selectedHex) return;
    const { q, r } = s.selectedHex;
    const now = Date.now();
    const abilityId = getAbilityForUnit(unitType);
    if (!abilityId) return;
    const def = ABILITY_DEFS[abilityId];
    set({
      units: s.units.map(u => {
        if (u.q !== q || u.r !== r || u.ownerId !== HUMAN_ID || u.type !== unitType) return u;
        if (u.abilityCooldownUntil && now < u.abilityCooldownUntil) return u;
        if (def.toggle) {
          const newActive = !u.abilityActive;
          return { ...u, abilityActive: newActive };
        }
        return {
          ...u,
          abilityActive: true,
          abilityActiveUntil: now + def.durationMs,
          abilityCooldownUntil: now + def.durationMs + def.cooldownMs,
          chargeReady: abilityId === 'charge' ? true : u.chargeReady,
        };
      }),
    });
    get().addNotification(`${def.label} activated!`, 'info');
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
      const deployed = withoutPatrolFields(withDeployFlags(u, city.q, city.r, s.cities));
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

  setMajorEngagementDoctrine: (hexKey, doctrine) => {
    const s = get();
    const cur = s.majorEngagementStrategyByHex[hexKey];
    if (!cur) return;
    set({
      majorEngagementStrategyByHex: {
        ...s.majorEngagementStrategyByHex,
        [hexKey]: { ...cur, [HUMAN_ID]: doctrine },
      },
    });
  },

  openTacticalMode: () => {
    set({
      pendingTacticalOrders: {},
      tacticalSelectedStackKeys: [],
      tacticalOrderScope: 'all',
      tacticalOrderScopeArmyId: null,
      tacticalIncludedUnitTypes: 'all',
      tacticalStackUnitTypeFocus: {},
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
      tacticalOrderScope: 'all',
      tacticalOrderScopeArmyId: null,
      tacticalIncludedUnitTypes: 'all',
      tacticalStackUnitTypeFocus: {},
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

  setTacticalOrderScope: (scope, armyId) => {
    set({
      tacticalOrderScope: scope,
      tacticalOrderScopeArmyId: scope === 'army' ? (armyId ?? null) : null,
    });
  },

  setTacticalIncludedUnitTypes: (types) => {
    set({ tacticalIncludedUnitTypes: types });
  },

  toggleTacticalIncludedUnitType: (type) => {
    const s = get();
    if (s.tacticalIncludedUnitTypes === 'all') {
      const next = TACTICAL_FILTER_LAND_TYPES.filter(t => t !== type);
      if (next.length === 0) {
        get().addNotification('At least one unit type must remain selected.', 'warning');
        return;
      }
      set({ tacticalIncludedUnitTypes: next });
      return;
    }
    const cur = s.tacticalIncludedUnitTypes;
    const has = cur.includes(type);
    const next = has ? cur.filter(t => t !== type) : [...cur, type];
    if (next.length === 0) {
      get().addNotification('At least one unit type must remain selected.', 'warning');
      return;
    }
    if (next.length === TACTICAL_FILTER_LAND_TYPES.length) {
      set({ tacticalIncludedUnitTypes: 'all' });
    } else {
      set({ tacticalIncludedUnitTypes: next });
    }
  },

  toggleTacticalStackUnitTypeFocus: (stackKey, unitType) => {
    const s = get();
    const cur = s.tacticalStackUnitTypeFocus[stackKey];
    if (cur === unitType) {
      const next = { ...s.tacticalStackUnitTypeFocus };
      delete next[stackKey];
      set({ tacticalStackUnitTypeFocus: next });
      return;
    }
    set({ tacticalStackUnitTypeFocus: { ...s.tacticalStackUnitTypeFocus, [stackKey]: unitType } });
  },

  startTacticalOrderForSelected: (orderType) => {
    const s = get();
    if (s.pendingTacticalOrders === null) return;
    const stackKeys = humanStackKeysForTactical(s);
    if (stackKeys.length === 0) {
      if (s.tacticalOrderScope === 'selected') {
        get().addNotification('Order scope is “selected hex groups” — click hex groups in the list to include them.', 'warning');
      } else if (s.tacticalOrderScope === 'army') {
        get().addNotification('That field army has no land troops on the map yet — attach troops or change scope.', 'warning');
      } else {
        get().addNotification('No human forces on the map to order.', 'warning');
      }
      return;
    }
    const ot = orderType === 'patrol_pick' ? 'patrol_paint' : orderType;
    set({
      assigningTacticalForSelectedStacks: { orderType: ot, stackKeys },
      assigningTacticalForStack: null,
      assigningTacticalOrderType: null,
      tacticalPatrolPaintHexKeys: ot === 'patrol_paint' ? [] : (s.tacticalPatrolPaintHexKeys ?? []),
    });
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
    let appliedStacks = 0;
    for (const stackKey of stackKeys) {
      const [fromQ, fromR] = stackKey.split(',').map(Number);
      const dist = hexDistance(fromQ, fromR, toQ, toR);
      if (dist > maxLeg || dist === 0) continue;
      const stackUnits = s.units.filter(
        u => u.q === fromQ && u.r === fromR && u.ownerId === HUMAN_ID && u.hp > 0 && !u.aboardShipId,
      );
      const pids = resolveParticipatingUnitIdsForTactical(
        stackUnits,
        stackKey,
        s.tacticalIncludedUnitTypes,
        s.tacticalStackUnitTypeFocus,
      );
      if (pids !== undefined && pids.length === 0) continue;
      const marching = pids ? stackUnits.filter(u => pids.includes(u.id)) : stackUnits;
      if (tile.biome === 'water') {
        if (!canLandStackEmbarkFriendlyScoutAt(s.tiles, s.units, toQ, toR, marching, HUMAN_ID)) continue;
      } else {
        if (marching.some(u => isNavalUnitType(u.type))) continue;
      }
      next[stackKey] =
        pids && pids.length > 0
          ? { type: orderType, toQ, toR, participatingUnitIds: pids }
          : { type: orderType, toQ, toR };
      any = true;
      appliedStacks++;
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
    get().addNotification(`${appliedStacks} stack(s) → (${toQ}, ${toR}). Confirm when ready.`, 'info');
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
      if (dist > maxLeg || dist <= 0) continue;
      const stackUnits = s.units.filter(
        u => u.q === fromQ && u.r === fromR && u.ownerId === HUMAN_ID && u.hp > 0 && !u.aboardShipId,
      );
      const pids = resolveParticipatingUnitIdsForTactical(
        stackUnits,
        stackKey,
        s.tacticalIncludedUnitTypes,
        s.tacticalStackUnitTypeFocus,
      );
      if (pids !== undefined && pids.length === 0) continue;
      next[stackKey] =
        pids && pids.length > 0
          ? { type: 'incorporate_village', toQ, toR, participatingUnitIds: pids }
          : { type: 'incorporate_village', toQ, toR };
      any = true;
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

  setTacticalAttackBuildingTargetForSelected: (toQ, toR) => {
    const s = get();
    const pending = s.assigningTacticalForSelectedStacks;
    if (!pending || pending.orderType !== 'attack_building_pick' || s.pendingTacticalOrders === null) return;
    let cityId: string | null = null;
    for (const city of s.cities) {
      if (city.ownerId === HUMAN_ID) continue;
      const b = city.buildings.find(x => x.q === toQ && x.r === toR);
      if (b && isCityBuildingOperational(ensureCityBuildingHp(b))) {
        cityId = city.id;
        break;
      }
    }
    if (!cityId) {
      get().addNotification('Click an enemy city building (not the city center unless it is the only tile).', 'warning');
      return;
    }
    const maxLeg = maxMoveOrderDistanceForDestination(toQ, toR, s.territory, HUMAN_ID);
    const { stackKeys } = pending;
    const next = { ...s.pendingTacticalOrders };
    let any = false;
    for (const stackKey of stackKeys) {
      const [fromQ, fromR] = stackKey.split(',').map(Number);
      const dist = hexDistance(fromQ, fromR, toQ, toR);
      if (dist > maxLeg || dist <= 0) continue;
      const stackUnits = s.units.filter(
        u => u.q === fromQ && u.r === fromR && u.ownerId === HUMAN_ID && u.hp > 0 && !u.aboardShipId,
      );
      const pids = resolveParticipatingUnitIdsForTactical(
        stackUnits,
        stackKey,
        s.tacticalIncludedUnitTypes,
        s.tacticalStackUnitTypeFocus,
      );
      if (pids !== undefined && pids.length === 0) continue;
      next[stackKey] =
        pids && pids.length > 0
          ? {
              type: 'attack_building',
              cityId,
              buildingQ: toQ,
              buildingR: toR,
              participatingUnitIds: pids,
            }
          : { type: 'attack_building', cityId, buildingQ: toQ, buildingR: toR };
      any = true;
    }
    if (!any) {
      get().addNotification(`No stack in range (max ${maxLeg} hexes for this destination).`, 'warning');
      return;
    }
    set({ pendingTacticalOrders: next, assigningTacticalForSelectedStacks: null });
    get().addNotification('Raid building orders set — Confirm orders.', 'info');
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
      const stackUnits = s.units.filter(
        u => u.q === fromQ && u.r === fromR && u.ownerId === HUMAN_ID && u.hp > 0 && !u.aboardShipId,
      );
      const pids = resolveParticipatingUnitIdsForTactical(
        stackUnits,
        stackKey,
        s.tacticalIncludedUnitTypes,
        s.tacticalStackUnitTypeFocus,
      );
      if (pids !== undefined && pids.length === 0) continue;
      const marchingUnits = pids ? stackUnits.filter(u => pids.includes(u.id)) : stackUnits;
      let waveGroups: string[][];
      let tacticPreset: SiegeTacticId | undefined;
      let tacticWidth: number | undefined;
      let tacticDepth: number | undefined;

      if (payload.mode === 'tactic') {
        waveGroups = buildWaveGroupsFromTactic(
          marchingUnits,
          payload.tacticPreset,
          payload.width,
          payload.depth,
        );
        if (waveGroups.length === 0) continue;
        tacticPreset = payload.tacticPreset;
        tacticWidth = payload.width;
        tacticDepth = payload.depth;
      } else {
        const form = payload.perStack[stackKey];
        if (!form) continue;
        let w1ids: string[];
        let w2ids: string[];
        if (payload.useWaves) {
          w1ids = selectUnitIdsByTypeCounts(marchingUnits, form.wave1);
          const used = new Set(w1ids);
          w2ids = selectUnitIdsByTypeCounts(marchingUnits, form.wave2, used);
          if (w1ids.length === 0 && w2ids.length === 0) continue;
          if (w2ids.length > 0 && w1ids.length === 0) {
            get().addNotification('Wave 1 cannot be empty if wave 2 has units.', 'warning');
            return;
          }
        } else {
          w1ids = selectUnitIdsByTypeCounts(marchingUnits, form.wave1);
          w2ids = [];
          if (w1ids.length === 0) continue;
        }
        waveGroups =
          payload.useWaves && w2ids.length > 0 ? [w1ids, w2ids] : [w1ids].filter(w => w.length > 0);
      }

      next[stackKey] = {
        type: 'attack_city',
        cityId: draft.cityId,
        attackStyle: payload.attackStyle,
        waveGroups,
        ...(tacticPreset !== undefined ? { tacticPreset, tacticWidth, tacticDepth } : {}),
      };
      placed++;
    }
    if (placed === 0) {
      get().addNotification('No valid stacks or units for this attack.', 'warning');
      return;
    }
    if (payload.mode === 'tactic') {
      get().setDefaultMarchFormation({
        enabled: true,
        preset: payload.tacticPreset,
        width: payload.width,
        depth: payload.depth,
      });
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
        const deployed = withoutPatrolFields(withDeployFlags(u, city.q, city.r, s.cities));
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
    const mode = s.tacticalCityDefenseMode ?? 'auto_engage';
    const next = { ...s.pendingTacticalOrders };
    let placed = 0;
    for (const k of stackKeys) {
      const [fromQ, fromR] = k.split(',').map(Number);
      const dist = hexDistance(fromQ, fromR, city.q, city.r);
      if (dist <= 0 || !isWithinPlayerMoveOrderRange(fromQ, fromR, city.q, city.r, s.territory, HUMAN_ID)) continue;
      const stackUnits = s.units.filter(
        u => u.q === fromQ && u.r === fromR && u.ownerId === HUMAN_ID && u.hp > 0 && !u.aboardShipId,
      );
      const pids = resolveParticipatingUnitIdsForTactical(
        stackUnits,
        k,
        s.tacticalIncludedUnitTypes,
        s.tacticalStackUnitTypeFocus,
      );
      if (pids !== undefined && pids.length === 0) continue;
      next[k] =
        pids && pids.length > 0
          ? { type: 'city_defense', cityId, mode, participatingUnitIds: pids }
          : { type: 'city_defense', cityId, mode };
      placed++;
    }
    if (placed === 0) {
      get().addNotification('No selected stack is in range of that city.', 'warning');
      return;
    }
    set({ pendingTacticalOrders: next });
    get().addNotification(`${placed} stack(s) city defense (${mode.replace('_', ' ')}). Confirm when ready.`, 'info');
  },

  setTacticalDefendTargetFromMap: (q, r) => {
    get().setTacticalCityDefenseTargetFromMap(q, r);
  },

  setTacticalCityDefenseTargetFromMap: (q, r) => {
    const s = get();
    const pending = s.assigningTacticalForSelectedStacks;
    if (!pending || s.pendingTacticalOrders === null) return;
    if (pending.orderType !== 'defend_pick' && pending.orderType !== 'city_defense_pick') return;
    const city = s.cities.find(c => c.q === q && c.r === r && c.ownerId === HUMAN_ID);
    if (!city) {
      get().addNotification('Click your city center hex for city defense.', 'warning');
      return;
    }
    const mode = s.tacticalCityDefenseMode ?? 'auto_engage';
    const { stackKeys } = pending;
    const next = { ...s.pendingTacticalOrders };
    let any = false;
    for (const stackKey of stackKeys) {
      const [fromQ, fromR] = stackKey.split(',').map(Number);
      if (!isWithinPlayerMoveOrderRange(fromQ, fromR, city.q, city.r, s.territory, HUMAN_ID)) continue;
      const stackUnits = s.units.filter(
        u => u.q === fromQ && u.r === fromR && u.ownerId === HUMAN_ID && u.hp > 0 && !u.aboardShipId,
      );
      const pids = resolveParticipatingUnitIdsForTactical(
        stackUnits,
        stackKey,
        s.tacticalIncludedUnitTypes,
        s.tacticalStackUnitTypeFocus,
      );
      if (pids !== undefined && pids.length === 0) continue;
      next[stackKey] =
        pids && pids.length > 0
          ? { type: 'city_defense', cityId: city.id, mode, participatingUnitIds: pids }
          : { type: 'city_defense', cityId: city.id, mode };
      any = true;
    }
    if (!any) {
      get().addNotification('No stack is in range of that city for this move leg.', 'warning');
      return;
    }
    set({ pendingTacticalOrders: next, assigningTacticalForSelectedStacks: null });
    get().addNotification(`City defense ${city.name} — Confirm orders.`, 'info');
  },

  setTacticalPatrolTargetFromMap: (q, r) => {
    const s = get();
    const pending = s.assigningTacticalForSelectedStacks;
    if (!pending || pending.orderType !== 'patrol_pick' || s.pendingTacticalOrders === null) return;
    const tile = s.tiles.get(tileKey(q, r));
    if (!tile || tile.biome === 'water') {
      get().addNotification('Patrol center must be on land.', 'warning');
      return;
    }
    const { stackKeys } = pending;
    const next = { ...s.pendingTacticalOrders };
    let any = false;
    for (const stackKey of stackKeys) {
      const [fromQ, fromR] = stackKey.split(',').map(Number);
      if (!isWithinPlayerMoveOrderRange(fromQ, fromR, q, r, s.territory, HUMAN_ID)) continue;
      const stackUnits = s.units.filter(
        u => u.q === fromQ && u.r === fromR && u.ownerId === HUMAN_ID && u.hp > 0 && !u.aboardShipId,
      );
      const pids = resolveParticipatingUnitIdsForTactical(
        stackUnits,
        stackKey,
        s.tacticalIncludedUnitTypes,
        s.tacticalStackUnitTypeFocus,
      );
      if (pids !== undefined && pids.length === 0) continue;
      next[stackKey] =
        pids && pids.length > 0
          ? {
              type: 'patrol',
              centerQ: q,
              centerR: r,
              radius: PATROL_DEFAULT_RADIUS,
              participatingUnitIds: pids,
            }
          : { type: 'patrol', centerQ: q, centerR: r, radius: PATROL_DEFAULT_RADIUS };
      any = true;
    }
    if (!any) {
      get().addNotification('No stack in range of that patrol center.', 'warning');
      return;
    }
    set({ pendingTacticalOrders: next, assigningTacticalForSelectedStacks: null });
    get().addNotification(`Patrol (${q},${r}) r${PATROL_DEFAULT_RADIUS} — Confirm orders.`, 'info');
  },

  clearTacticalOrdersForSelected: () => {
    const s = get();
    if (s.pendingTacticalOrders === null) return;
    const keys = new Set(humanStackKeysForTactical(s));
    if (keys.size === 0) return;
    const next = { ...s.pendingTacticalOrders };
    for (const k of keys) delete next[k];
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
    const pids = resolveParticipatingUnitIdsForTactical(
      stack,
      stackKey,
      s.tacticalIncludedUnitTypes,
      s.tacticalStackUnitTypeFocus,
    );
    if (pids !== undefined && pids.length === 0) {
      get().addNotification('No units match the current type filter on this stack.', 'warning');
      set({ assigningTacticalForStack: null, assigningTacticalOrderType: null });
      return;
    }
    const marching = pids ? stack.filter(u => pids.includes(u.id)) : stack;
    const destTile = s.tiles.get(tileKey(toQ, toR));
    if (!destTile) {
      set({ assigningTacticalForStack: null, assigningTacticalOrderType: null });
      return;
    }
    const naval = marching.some(u => isNavalUnitType(u.type));
    if (naval && !marching.every(u => isNavalUnitType(u.type))) {
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
      if (!canLandStackEmbarkFriendlyScoutAt(s.tiles, s.units, toQ, toR, marching, HUMAN_ID)) {
        get().addNotification('Need a friendly scout ship with cargo at that water hex.', 'warning');
        set({ assigningTacticalForStack: null, assigningTacticalOrderType: null });
        return;
      }
    }
    const moveOrder =
      pids && pids.length > 0
        ? { type: orderType, toQ, toR, participatingUnitIds: pids }
        : { type: orderType, toQ, toR };
    const next = { ...s.pendingTacticalOrders, [stackKey]: moveOrder };
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
          if (!orderAppliesToUnit(order, u)) return u;
          const deployed = withoutPatrolFields(withDeployFlags(u, city.q, city.r, s.cities));
          return {
            ...deployed,
            defendCityId: city.id,
            cityDefenseMode: 'auto_engage' as const,
            targetQ: city.q,
            targetR: city.r,
            status: 'moving' as const,
            marchInitialHexDistance: marchHexDistanceAtOrder(u, city.q, city.r),
          };
        });
        notifs.push(`Stack at (${fromQ},${fromR}) defending ${city.name}`);
      } else if (order.type === 'city_defense' && order.cityId) {
        const city = s.cities.find(c => c.id === order.cityId && c.ownerId === HUMAN_ID);
        if (!city) continue;
        const dDef = hexDistance(fromQ, fromR, city.q, city.r);
        if (dDef === 0 || !isWithinPlayerMoveOrderRange(fromQ, fromR, city.q, city.r, s.territory, HUMAN_ID)) continue;
        const mode = order.mode ?? 'auto_engage';
        units = units.map(u => {
          if (u.q !== fromQ || u.r !== fromR || u.ownerId !== HUMAN_ID || u.hp <= 0) return u;
          if (!isLandMilitaryUnit(u)) return u;
          if (!orderAppliesToUnit(order, u)) return u;
          const deployed = withoutPatrolFields(withDeployFlags(u, city.q, city.r, s.cities));
          const next: Unit = {
            ...deployed,
            defendCityId: city.id,
            cityDefenseMode: mode,
            patrolCenterQ: undefined,
            patrolCenterR: undefined,
            patrolRadius: undefined,
            targetQ: city.q,
            targetR: city.r,
            status: 'moving' as const,
            marchInitialHexDistance: marchHexDistanceAtOrder(u, city.q, city.r),
          };
          if (mode === 'stagnant') next.garrisonCityId = city.id;
          else delete next.garrisonCityId;
          return next;
        });
        notifs.push(`Stack at (${fromQ},${fromR}) city defense ${mode} → ${city.name}`);
      } else if (order.type === 'patrol') {
        const radius = order.radius ?? PATROL_DEFAULT_RADIUS;
        const hexKeys = order.hexKeys;
        units = units.map(u => {
          if (u.q !== fromQ || u.r !== fromR || u.ownerId !== HUMAN_ID || u.hp <= 0) return u;
          if (!isLandMilitaryUnit(u)) return u;
          if (!orderAppliesToUnit(order, u)) return u;
          const x: Unit = {
            ...u,
            defendCityId: undefined,
            garrisonCityId: undefined,
            cityDefenseMode: undefined,
            patrolCenterQ: order.centerQ,
            patrolCenterR: order.centerR,
            patrolRadius: radius,
            patrolHexKeys: hexKeys && hexKeys.length > 0 ? [...hexKeys] : undefined,
            status: 'idle' as const,
            targetQ: undefined,
            targetR: undefined,
          };
          delete x.marchInitialHexDistance;
          delete x.moveLegMs;
          delete x.marchEchelonHold;
          delete x.attackWaveHold;
          delete x.retaliateUnitId;
          delete x.retaliateDefenseId;
          delete x.attackBuildingTarget;
          delete x.siegingCityId;
          delete x.assaulting;
          if (x.incorporateVillageAt) delete x.incorporateVillageAt;
          return x;
        });
        notifs.push(
          hexKeys && hexKeys.length > 0
            ? `Stack at (${fromQ},${fromR}) patrol (${hexKeys.length} hexes)`
            : `Stack at (${fromQ},${fromR}) patrol r${radius}`,
        );
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
          if (!orderAppliesToUnit(order, u)) return u;
          const deployed = withoutPatrolFields(withDeployFlags(u, toQ, toR, s.cities));
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
        const groups = order.waveGroups.filter(g => g.length > 0);
        if (groups.length === 0) continue;
        const participate = new Set(groups.flat());
        const march = getAttackMarchParams(order.attackStyle, city, fromQ, fromR, s.tiles);

        function waveIndexForUnit(uid: string): number {
          for (let i = 0; i < groups.length; i++) {
            if (groups[i].includes(uid)) return i;
          }
          return -1;
        }

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
          const wi = waveIndexForUnit(u.id);
          if (wi < 0) return u;
          if (wi > 0) {
            const waitFor = groups[wi - 1] ?? [];
            const deployed = withoutPatrolFields(withDeployFlags(u, march.targetQ, march.targetR, s.cities));
            const nextU: Unit = {
              ...deployed,
              status: 'idle' as const,
              targetQ: undefined,
              targetR: undefined,
              assaulting: false,
              attackWaveHold: {
                waitForUnitIds: [...waitFor],
                cityId: city.id,
                rallyQ: march.rallyQ,
                rallyR: march.rallyR,
                centerQ: march.centerQ,
                centerR: march.centerR,
                attackStyle: order.attackStyle,
              },
            };
            delete nextU.siegingCityId;
            if (nextU.incorporateVillageAt) delete nextU.incorporateVillageAt;
            delete nextU.retaliateUnitId;
            delete nextU.retaliateDefenseId;
            delete nextU.attackBuildingTarget;
            return nextU;
          }
          const deployed = withoutPatrolFields(withDeployFlags(u, march.targetQ, march.targetR, s.cities));
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
          delete next.retaliateUnitId;
          delete next.retaliateDefenseId;
          delete next.attackBuildingTarget;
          return next;
        });
        notifs.push(`Stack at (${fromQ},${fromR}) → attack ${city.name}`);
      } else if (order.type === 'attack_building' && order.cityId) {
        const city = s.cities.find(c => c.id === order.cityId);
        if (!city || city.ownerId === HUMAN_ID) continue;
        const building = city.buildings.find(b => b.q === order.buildingQ && b.r === order.buildingR);
        if (!building || !isCityBuildingOperational(ensureCityBuildingHp(building))) continue;
        const toQ = order.buildingQ;
        const toR = order.buildingR;
        const dist = hexDistance(fromQ, fromR, toQ, toR);
        if (dist === 0 || !isWithinPlayerMoveOrderRange(fromQ, fromR, toQ, toR, s.territory, HUMAN_ID)) continue;
        units = units.map(u => {
          if (u.q !== fromQ || u.r !== fromR || u.ownerId !== HUMAN_ID || u.hp <= 0) return u;
          if (!isLandMilitaryUnit(u)) return u;
          if (!orderAppliesToUnit(order, u)) return u;
          const deployed = withoutPatrolFields(withDeployFlags(u, toQ, toR, s.cities));
          return {
            ...deployed,
            attackBuildingTarget: { cityId: city.id, q: toQ, r: toR },
            retaliateUnitId: undefined,
            retaliateDefenseId: undefined,
            targetQ: toQ,
            targetR: toR,
            status: 'moving' as const,
            assaulting: false,
            marchInitialHexDistance: marchHexDistanceAtOrder(u, toQ, toR),
          };
        });
        notifs.push(`Stack at (${fromQ},${fromR}) → raid building at (${toQ},${toR})`);
      } else if ((order.type === 'move' || order.type === 'intercept') && order.toQ !== undefined && order.toR !== undefined) {
        const toQ = order.toQ;
        const toR = order.toR;
        const tile = s.tiles.get(tileKey(toQ, toR));
        if (!tile) continue;
        const dist = hexDistance(fromQ, fromR, toQ, toR);
        if (dist === 0 || !isWithinPlayerMoveOrderRange(fromQ, fromR, toQ, toR, s.territory, HUMAN_ID)) continue;
        const marchStack = stackUnits.filter(
          u => !u.aboardShipId && orderAppliesToUnit(order, u),
        );
        if (marchStack.length === 0) continue;
        if (tile.biome === 'water') {
          if (!canLandStackEmbarkFriendlyScoutAt(s.tiles, units, toQ, toR, marchStack, HUMAN_ID)) continue;
        } else if (marchStack.some(u => isNavalUnitType(u.type))) continue;
        const marchDfT = resolveMarchFormationDfForMarching(marchStack, s.defaultMarchFormation, s.operationalArmies);
        const echelon = applyEchelonForLandMove(
          units,
          fromQ,
          fromR,
          toQ,
          toR,
          marchStack,
          s.cities,
          s.tiles,
          s.territory,
          marchDfT,
        );
        if (echelon !== null) {
          units = echelon;
        } else {
          units = units.map(u => {
            if (u.q !== fromQ || u.r !== fromR || u.ownerId !== HUMAN_ID || u.hp <= 0) return u;
            if (!orderAppliesToUnit(order, u)) return u;
            const deployed = withoutPatrolFields(withDeployFlags(u, toQ, toR, s.cities));
            const next: Unit = {
              ...deployed,
              targetQ: toQ,
              targetR: toR,
              status: 'moving' as const,
              assaulting: false,
              marchInitialHexDistance: marchHexDistanceAtOrder(u, toQ, toR),
              retaliateUnitId: undefined,
              retaliateDefenseId: undefined,
              attackBuildingTarget: undefined,
            };
            delete next.marchEchelonHold;
            delete next.attackWaveHold;
            return next;
          });
        }
        notifs.push(`Stack at (${fromQ},${fromR}) → (${toQ},${toR})`);
      }
    }
    set({
      units,
      pendingTacticalOrders: null,
      tacticalSelectedStackKeys: [],
      tacticalOrderScope: 'all',
      tacticalOrderScopeArmyId: null,
      tacticalStackUnitTypeFocus: {},
      assigningTacticalForSelectedStacks: null,
      assigningTacticalForStack: null,
      assigningTacticalOrderType: null,
      tacticalAttackCityDraft: null,
    });
    if (notifs.length > 0) {
      get().addNotification(`Orders: ${notifs.join('; ')}`, 'info');
    } else if (Object.keys(orders).some(k => orders[k as keyof typeof orders])) {
      get().addNotification(
        'No orders applied — check range, terrain, or that your stacks are still on those hexes.',
        'warning',
      );
    }
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

  startSplitStack: (count, explicitQ?, explicitR?) => {
    const s = get();
    const fromQ = explicitQ ?? s.selectedHex?.q;
    const fromR = explicitR ?? s.selectedHex?.r;
    if (fromQ === undefined || fromR === undefined) return;
    const stack = s.units.filter(u => u.q === fromQ && u.r === fromR && u.ownerId === HUMAN_ID && u.hp > 0);
    const n = Math.max(1, Math.min(count, stack.length - 1));
    if (n >= stack.length) {
      get().addNotification('Split must leave at least one unit in the stack.', 'warning');
      return;
    }
    set({ splitStackPending: { fromQ, fromR, count: n } });
    get().addNotification(`Splitting ${n} unit(s). Click an adjacent hex to place them.`, 'info');
  },

  startSplitStackByUnitType: (unitType, explicitQ?, explicitR?) => {
    const s = get();
    const fromQ = explicitQ ?? s.selectedHex?.q;
    const fromR = explicitR ?? s.selectedHex?.r;
    if (fromQ === undefined || fromR === undefined) return;
    const stack = s.units.filter(u => u.q === fromQ && u.r === fromR && u.ownerId === HUMAN_ID && u.hp > 0);
    const ofType = stack.filter(u => u.type === unitType);
    if (ofType.length === 0) {
      get().addNotification('No units of that type in this stack.', 'warning');
      return;
    }
    let unitIds = ofType.map(u => u.id);
    if (unitIds.length === stack.length) {
      unitIds = unitIds.slice(0, -1);
    }
    if (unitIds.length === 0) {
      get().addNotification('Cannot split — at least one unit must stay on this hex.', 'warning');
      return;
    }
    const n = unitIds.length;
    set({ splitStackPending: { fromQ, fromR, count: n, unitIds } });
    get().addNotification(`Splitting ${n} ${unitType.replace(/_/g, ' ')}(s). Click an adjacent hex to place them.`, 'info');
  },

  cancelSplitStack: () => {
    set({ splitStackPending: null });
  },

  splitStackToHex: (toQ, toR) => {
    const s = get();
    const pending = s.splitStackPending;
    if (!pending) return;
    const { fromQ, fromR, count, unitIds: pendingIds } = pending;
    const stack = s.units.filter(u => u.q === fromQ && u.r === fromR && u.ownerId === HUMAN_ID && u.hp > 0);
    const stackIds = new Set(stack.map(u => u.id));
    let ids: Set<string>;
    if (pendingIds && pendingIds.length > 0) {
      const valid = pendingIds.filter(id => stackIds.has(id));
      if (valid.length === 0) {
        set({ splitStackPending: null });
        return;
      }
      ids = new Set(valid);
    } else {
      const toMove = stack.slice(0, count);
      ids = new Set(toMove.map(u => u.id));
    }
    if (stack.length - ids.size < 1) {
      get().addNotification('Split must leave at least one unit in the stack.', 'warning');
      return;
    }
    const n = ids.size;
    const newUnits = s.units.map(u => {
      if (!ids.has(u.id)) return u;
      const moved: Unit = { ...u, q: toQ, r: toR, targetQ: undefined, targetR: undefined, status: 'idle' as const };
      delete moved.marchInitialHexDistance;
      delete moved.moveLegMs;
      return isLandMilitaryUnit(moved)
        ? {
            ...moved,
            garrisonCityId: undefined,
            defendCityId: undefined,
            cityDefenseMode: undefined,
            patrolCenterQ: undefined,
            patrolCenterR: undefined,
            patrolRadius: undefined,
            patrolHexKeys: undefined,
          }
        : moved;
    });
    set({ units: newUnits, splitStackPending: null });
    get().addNotification(`Split ${n} unit(s) to (${toQ}, ${toR}).`, 'info');
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

  setCityGarrisonPatrol: (cityId, enabled) => {
    const s = get();
    set({
      cities: s.cities.map(c =>
        c.id === cityId && c.ownerId === HUMAN_ID ? { ...c, garrisonPatrol: enabled } : c,
      ),
    });
    get().addNotification(
      enabled
        ? 'Garrison patrol on: ranged garrison will fire at enemies in this city’s territory within the patrol radius.'
        : 'Garrison patrol off.',
      'info',
    );
  },

  setCityGarrisonPatrolRadius: (cityId, radius) => {
    const s = get();
    const r = Math.min(GARRISON_PATROL_RADIUS_MAX, Math.max(GARRISON_PATROL_RADIUS_MIN, Math.round(radius)));
    set({
      cities: s.cities.map(c =>
        c.id === cityId && c.ownerId === HUMAN_ID ? { ...c, garrisonPatrolRadius: r } : c,
      ),
    });
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
      sourceRegion: scroll.sourceRegion,
      carrierUnitId: unitId,
      ownerId: human.id,
      armyId: unit.armyId,
    };
    set({
      scrollInventory: { ...s.scrollInventory, [human.id]: inv },
      scrollAttachments: [...s.scrollAttachments, att],
    });
    get().addNotification(
      `${scrollItemDisplayName(scroll)} assigned to ${getUnitDisplayName(unit.type, unit.armsLevel ?? 1, unit.rangedVariant)}.`,
      'success',
    );
  },

  assignScrollToArmy: (scrollItemId, armyId) => {
    const s = get();
    const human = s.players.find(p => p.isHuman);
    if (!human) return;
    const inv = [...(s.scrollInventory[human.id] ?? [])];
    const idx = inv.findIndex(x => x.id === scrollItemId);
    if (idx < 0) return;
    const carrier = s.units.find(
      u =>
        u.ownerId === human.id &&
        u.armyId === armyId &&
        u.hp > 0 &&
        !u.aboardShipId &&
        u.type !== 'builder' &&
        !isNavalUnitType(u.type) &&
        !s.scrollAttachments.some(a => a.carrierUnitId === u.id),
    );
    if (!carrier) {
      get().addNotification('No eligible army unit can carry that scroll right now.', 'warning');
      return;
    }
    const scroll = inv[idx];
    inv.splice(idx, 1);
    const att: ScrollAttachment = {
      id: generateId('satt'),
      scrollId: scroll.id,
      kind: scroll.kind,
      sourceRegion: scroll.sourceRegion,
      carrierUnitId: carrier.id,
      ownerId: human.id,
      armyId,
    };
    set({
      scrollInventory: { ...s.scrollInventory, [human.id]: inv },
      scrollAttachments: [...s.scrollAttachments, att],
    });
    const armyName = s.operationalArmies.find(a => a.id === armyId)?.name ?? 'army';
    get().addNotification(`${scrollItemDisplayName(scroll)} assigned to ${armyName}.`, 'success');
  },

  unassignScrollFromUnit: (unitId) => {
    const s = get();
    const human = s.players.find(p => p.isHuman);
    if (!human) return;
    const att = s.scrollAttachments.find(a => a.carrierUnitId === unitId && a.ownerId === human.id);
    if (!att) return;
    const unit = s.units.find(u => u.id === unitId);
    if (!unit || unit.ownerId !== human.id) return;
    const item: ScrollItem = { id: att.scrollId, kind: att.kind, sourceRegion: att.sourceRegion };
    set({
      scrollAttachments: s.scrollAttachments.filter(a => a.id !== att.id),
      scrollInventory: {
        ...s.scrollInventory,
        [human.id]: [...(s.scrollInventory[human.id] ?? []), item],
      },
    });
    get().addNotification(`${scrollItemDisplayName(item)} returned to inventory.`, 'info');
  },

  clearScrollRelicPickupModal: () => set({ scrollRelicPickupModal: null }),

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
  getSiegeWorkshopCityAt: (q, r) => {
    const key = tileKey(q, r);
    for (const city of get().cities) {
      if (city.ownerId !== HUMAN_ID) continue;
      if (city.buildings.some(b => b.type === 'siege_workshop' && tileKey(b.q, b.r) === key)) {
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
    const jobTypes: BuildingType[] = ['farm', 'banana_farm', 'factory', 'market', 'quarry', 'mine', 'gold_mine', 'city_center', 'barracks', 'academy', 'siege_workshop', 'sawmill', 'port', 'shipyard', 'fishery', 'logging_hut', 'social_bar'];
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
  getSupplyConnectionPaths: () => new Map<string, { q: number; r: number }[][]>(),
  getSupplyClustersWithPaths: () => {
    const s = get();
    const humanCities = s.cities.filter(c => c.ownerId === HUMAN_ID);
    if (humanCities.length === 0) return [];
    return [
      {
        clusterKey: 'empire',
        cluster: { cityIds: humanCities.map(c => c.id), cities: humanCities },
        paths: [] as { q: number; r: number }[][],
      },
    ];
  },
  getSupplyClustersWithHealth: () => {
    const s = get();
    const entries = s.getSupplyClustersWithPaths();
    const stmt = s.getEmpireIncomeStatement();
    return entries.map(e => ({ ...e, foodSurplus: stmt?.foodSurplus ?? true }));
  },
  getClusterForHex: (q, r) => {
    const s = get();
    if (!s.isInPlayerTerritory(q, r)) return null;
    const humanCities = s.cities.filter(c => c.ownerId === HUMAN_ID);
    if (humanCities.length === 0) return null;
    return 'empire';
  },
  getEmpireIncomeStatement: () => {
    const s = get();
    const humanCities = s.cities.filter(c => c.ownerId === HUMAN_ID);
    if (humanCities.length === 0) return null;
    const harvestMult = getWeatherHarvestMultiplier(s.activeWeather);
    return computeEmpireIncomeStatement(s.cities, s.units, s.tiles, s.territory, s.heroes, HUMAN_ID, harvestMult);
  },
  getClusterIncomeStatement: (_clusterKey) => get().getEmpireIncomeStatement(),

  // ─── Vision ──────────────────────────────────────────────
  recomputeVision: () => {
    const s = get();
    if (s.gameMode === 'bot_vs_bot' || s.gameMode === 'bot_vs_bot_4' || s.gameMode === 'spectate') {
      const allKeys = new Set<string>();
      s.tiles.forEach((_, key) => allKeys.add(key));
      set({ visibleHexes: allKeys, exploredHexes: allKeys });
    } else {
      const newVisible = computeVisibleHexes(
        HUMAN_ID,
        s.cities,
        s.units,
        s.heroes,
        s.tiles,
        s.scoutTowers ?? [],
        s.commanders ?? [],
        s.players.find(p => p.id === HUMAN_ID)?.mapQuadrantsRevealed,
        s.territory,
      );
      const explored = new Set(s.exploredHexes);
      for (const k of newVisible) explored.add(k);
      set({ visibleHexes: newVisible, exploredHexes: explored });
    }
  },
}));
