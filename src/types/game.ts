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
  /** Rich-forest marker (map flavor / UI); logging huts may be built on any forest tile. */
  hasWoodDeposit: boolean;
  /** Land tile not connected to map border via land (used for village flavor). */
  isIsland: boolean;
  /**
   * Scroll-discovery terrain (sprinkled like biome patches). Visuals + which scroll line this hex feeds.
   * Replaces old single large `specialRegionId` disks.
   */
  specialTerrainKind?: SpecialRegionKind;
};

/** Main-menu map shape presets (water layout & landmass style). */
export type MapTerrainPreset = 'continents' | 'islands' | 'lake' | 'no_water';

export type MapConfig = {
  width: number;
  height: number;
  seed: number;
  noiseScale: number;
  moistureScale: number;
  provinceDensity: number;
  ruinDensity: number;
  villageDensity: number;
  /** When true, elevation is boosted near all 4 corners so they stay land (for 4-bot maps). */
  ensureCornerLand?: boolean;
  /**
   * Land / ocean layout: continents (default), islands (more ocean), lake (large central sea),
   * no_water (no ocean tiles — dry map).
   */
  mapTerrain?: MapTerrainPreset;
};

export const DEFAULT_MAP_CONFIG: MapConfig = {
  width: 67,
  height: 67,
  seed: 42,
  noiseScale: 0.035,
  moistureScale: 0.045,
  provinceDensity: 0.015,
  ruinDensity: 0.03,
  /** 20% fewer villages vs original 0.02 */
  villageDensity: 0.016,
};

/** Main-menu map sizes (width × height). */
export const MAP_SIZE_PRESETS = {
  small: { width: 38, height: 38 },
  normal: { width: 52, height: 52 },
  large: { width: 67, height: 67 },
} as const;
export type MapSizePreset = keyof typeof MAP_SIZE_PRESETS;

/** Up to five AI opponents in Play / Spectate (ids match existing 1v1 + extras). */
export const AI_PLAYER_IDS = [
  'player_ai',
  'player_ai_2',
  'player_ai_3',
  'player_ai_4',
  'player_ai_5',
] as const;

// ─── Visual Constants (Map) ────────────────────────────────────────

export const HEX_RADIUS = 1.0;
export const HEX_INNER_RATIO = 0.92;

/** Hand-tinted “illuminated manuscript” palette: muted, readable, fantasy-medieval. */
export const BIOME_COLORS: Record<Biome, string> = {
  water: '#3d7ea8',
  plains: '#9cb85c',
  forest: '#3d7a3a',
  mountain: '#aeb6c4',
  desert: '#d4b06a',
};
export const BIOME_COLORS_DARK: Record<Biome, string> = {
  water: '#2a5a78',
  plains: '#6f8a3e',
  forest: '#285c28',
  mountain: '#6a7382',
  desert: '#a68442',
};
/** Cool summit white — reads on ink-stone rock in the 3D snow cap pass. */
export const MOUNTAIN_SNOW_COLOR = '#dce6f4';
/** Mountains are flat (same as plains) so clicking is reliable; color makes them distinctly white. */
export const BIOME_HEIGHTS: Record<Biome, { base: number; variation: number }> = {
  water: { base: 0.12, variation: 0.03 }, plains: { base: 0.30, variation: 0.10 },
  forest: { base: 0.45, variation: 0.12 }, mountain: { base: 0.30, variation: 0.08 },
  desert: { base: 0.25, variation: 0.08 },
};
export const ROAD_COLOR = '#5a4a38';
export const RUINS_COLOR = '#6b5348';
export const PROVINCE_CENTER_COLOR = '#f0c860';  // gold
export const VILLAGE_COLOR = '#c49560';  // tan, distinct from ruins
export const VILLAGE_ROOF_COLOR = '#8a5520';
export const ANCIENT_CITY_COLOR = '#7c3aed';  // purple for easy distinction
/** Hotspot between the two main rivals; flat overlay on map (distinct from ancient-city violet). */
export const CONTESTED_ZONE_COLOR = '#a855f7';
/**
 * Payout every 2nd economy cycle (cycles 2, 4, 6, …) if one rival has more troops+heroes in the zone.
 * Random gold OR iron per tick; ~16g implied per iron so expected value matches (~16g vs 1 iron/roll × 2 iron).
 */
export const CONTESTED_ZONE_GOLD_REWARD = 32;
export const CONTESTED_ZONE_IRON_REWARD = 2;
export const GOLD_MINE_DEPOSIT_COLOR = '#e8c030';  // gold/yellow
export const QUARRY_DEPOSIT_COLOR = '#6b7280';  // gray for stone deposits
export const WOOD_DEPOSIT_COLOR = '#166534';  // deep green

// ─── Special map regions & scrolls ─────────────────────────────────

/** Terrain flavors for scroll discovery (scattered across the map). */
export type SpecialRegionKind = 'mexca' | 'hills_lost' | 'forest_secrets' | 'isle_lost';

export type ScrollKind = 'combat' | 'defense' | 'movement';

export interface SpecialRegion {
  id: string;
  kind: SpecialRegionKind;
  /** Display name */
  name: string;
  /** Legacy fields — unused for sprinkled terrain; kept for typing/UI metadata. */
  centerQ: number;
  centerR: number;
  radius: number;
  /** Scroll granted when discovery completes on this terrain line. */
  scrollReward: ScrollKind;
}

export interface ScrollItem {
  id: string;
  kind: ScrollKind;
  /** Which named region this scroll was taken from; drives title/lore in UI. */
  sourceRegion?: SpecialRegionKind;
}

/** A scroll assigned to a carrier unit; optionally tagged to an {@link OperationalArmy} so the whole army shares bonuses on that hex. */
export interface ScrollAttachment {
  id: string;
  scrollId: string;
  kind: ScrollKind;
  carrierUnitId: string;
  ownerId: string;
  /** When set, any land unit on this hex with matching {@link Unit.armyId} receives scroll bonuses. */
  armyId?: string;
  /** Mirrored from {@link ScrollItem.sourceRegion} for round-trip when the carrier dies. */
  sourceRegion?: SpecialRegionKind;
}

/** Legacy disk radius (no longer used for generation; kept for tools/docs). */
export const SPECIAL_REGION_HEX_RADIUS = 5;

/** Noise scale for clustering special scroll terrain (legacy; named wilds now use single blobs). */
export const SPECIAL_TERRAIN_NOISE_SCALE = 0.088;
/**
 * Cluster threshold in 0..1 space (legacy; named wilds now use single blobs).
 * ~0.72 leaves ~28% of land candidates in the noise “upper” band before biome pick.
 */
export const SPECIAL_TERRAIN_CLUSTER_THRESHOLD = 0.72;

/** Each named wilds flavor is one connected patch; a match has 2–4 flavors. */
export const SPECIAL_REGION_KINDS_MIN = 2;
export const SPECIAL_REGION_KINDS_MAX = 4;
/** Min / max hexes per connected wilds patch (approximate target for BFS growth). */
export const SPECIAL_REGION_BLOB_SIZE_MIN = 6;
export const SPECIAL_REGION_BLOB_SIZE_MAX = 24;
/** No wilds hex may lie within this axial distance of a capital (game uses rebuild after capitals). */
export const SPECIAL_TERRAIN_CAPITAL_EXCLUSION_RADIUS = 10;

/** Humans must walk every hex of the relic's connected special-terrain patch before claiming (see scroll search). */
export const SCROLL_SEARCH_CYCLES_REQUIRED = 3;

/** Seeded relic site: one per special terrain flavor present on the map. */
export type ScrollRelicSite = {
  regionKind: SpecialRegionKind;
  q: number;
  r: number;
};

export const SCROLL_COMBAT_BONUS = 0.1;
export const SCROLL_DEFENSE_BONUS = 0.1;
export const SCROLL_MOVEMENT_BONUS = 0.1;

export const SPECIAL_REGION_DISPLAY_NAME: Record<SpecialRegionKind, string> = {
  mexca: 'The Abandoned Cities of Mexca',
  hills_lost: 'Hills of the Lost Tribes',
  forest_secrets: 'Forest of Secrets',
  isle_lost: 'Isle of Lost',
};

/** Map overlay tint (distinct from contested purple / ancient city). */
export const SPECIAL_REGION_OVERLAY_COLORS: Record<SpecialRegionKind, string> = {
  mexca: '#c4a574',
  hills_lost: '#8b7d6b',
  forest_secrets: '#2d6a4f',
  isle_lost: '#0891b2',
};

export const SCROLL_DISPLAY_NAME: Record<ScrollKind, string> = {
  combat: 'Scroll of Victory',
  defense: 'Scroll of Warding',
  movement: 'Scroll of Celerity',
};

/** Short title for scrolls tied to a named region (inventory / attach UI). */
export const SCROLL_REGION_ITEM_NAME: Record<SpecialRegionKind, string> = {
  mexca: 'Scroll of Mexca',
  hills_lost: 'Scroll of the Lost Tribes',
  forest_secrets: 'Scroll of the Forest of Secrets',
  isle_lost: 'Scroll of the Isle of Lost',
};

/** Flavor text shown when a relic is claimed. */
export const SCROLL_RELIC_LORE: Record<SpecialRegionKind, string> = {
  mexca:
    'Wind-carved plazas and empty avenues still echo with market-cries. The victor’s path was written here before your empire had a name.',
  hills_lost:
    'Stone cairns older than any crown line the ridges. The tribes did not vanish — they became the hills.',
  forest_secrets:
    'Sap runs like ink in bark grooves; paths close behind you. What is written here only reveals itself to those who stay.',
  isle_lost:
    'Tide draws wreckage into rings like a crown. The drowned keep their counsel, but the scroll remembers their war.',
};

/** Display name for inventory / notifications: regional title when known, else generic scroll line name. */
export function scrollItemDisplayName(item: ScrollItem): string {
  if (item.sourceRegion) return SCROLL_REGION_ITEM_NAME[item.sourceRegion];
  return SCROLL_DISPLAY_NAME[item.kind];
}

export function emptyScrollRegionClaimed(): Record<SpecialRegionKind, string[]> {
  return { mexca: [], hills_lost: [], forest_secrets: [], isle_lost: [] };
}

/** Which scroll line a terrain flavor feeds (Mexca + Isle both → combat). */
export function scrollKindForTerrain(kind: SpecialRegionKind): ScrollKind {
  if (kind === 'mexca' || kind === 'isle_lost') return 'combat';
  if (kind === 'hills_lost') return 'defense';
  return 'movement';
}

/** Static metadata for UI (names / tints); terrain is on tiles via {@link Tile.specialTerrainKind}. */
export function createSpecialRegionMetadata(): SpecialRegion[] {
  const kinds: SpecialRegionKind[] = ['mexca', 'hills_lost', 'forest_secrets', 'isle_lost'];
  return kinds.map((kind, i) => ({
    id: `sr_meta_${kind}`,
    kind,
    name: SPECIAL_REGION_DISPLAY_NAME[kind],
    centerQ: 0,
    centerR: 0,
    radius: 0,
    scrollReward: scrollKindForTerrain(kind),
  }));
}

/** One UI slot per kind; an army uses up to three carriers (one scroll each) to cover all three. */
export const SCROLL_ARMY_SLOT_ORDER: ScrollKind[] = ['combat', 'defense', 'movement'];

export const SCROLL_SLOT_LABEL: Record<ScrollKind, string> = {
  combat: 'Attack',
  defense: 'Defense',
  movement: 'Movement',
};

// ─── Game Phase & UI ───────────────────────────────────────────────

export type GamePhase =
  | 'setup'
  | 'place_city'
  /** Brief transition: players reset, capital not placed yet (avoids manual placement UI flicker). */
  | 'starting_game'
  | 'commander_setup'
  | 'playing'
  | 'victory'
  | 'total_starvation';
export type UIMode = 'normal' | 'move' | 'build' | 'build_mine' | 'build_quarry' | 'build_gold_mine' | 'build_logging_hut' | 'build_road' | 'build_defense' | 'defend' | 'intercept';
export type FoodPriority = 'civilian' | 'military';

/** Playable kingdoms — human selection at game start; affects spawn, bonuses, and some units. */
export type KingdomId = 'mongols' | 'fishers' | 'crusaders' | 'traders';

export const KINGDOM_IDS: KingdomId[] = ['mongols', 'fishers', 'crusaders', 'traders'];

export const KINGDOM_DISPLAY_NAMES: Record<KingdomId, string> = {
  mongols: 'The Mongols',
  fishers: 'Fishers',
  crusaders: 'The Crusaders',
  traders: 'The Trading Tribe',
};

/** 1v1 AI uses a different tribe than the human so kingdom-locked units and labels stay consistent. */
export function pickAiKingdom(humanKingdom: KingdomId): KingdomId {
  const i = KINGDOM_IDS.indexOf(humanKingdom);
  return KINGDOM_IDS[(i + 1) % KINGDOM_IDS.length]!;
}

/** Kingdoms for AI rivals — cycles if there are more opponents than remaining tribes. */
export function pickOpponentKingdoms(humanKingdom: KingdomId, count: number): KingdomId[] {
  const pool = KINGDOM_IDS.filter(k => k !== humanKingdom);
  const out: KingdomId[] = [];
  for (let i = 0; i < count; i++) {
    out.push(pool[i % pool.length]!);
  }
  return out;
}

export function pickKingdomsForSpectateBots(count: number): KingdomId[] {
  const out: KingdomId[] = [];
  for (let i = 0; i < count; i++) {
    out.push(KINGDOM_IDS[i % KINGDOM_IDS.length]!);
  }
  return out;
}

/** Setup-screen art: distinctive unit/building sprites per tribe (public paths). */
export const KINGDOM_SETUP_ICONS: Record<KingdomId, string> = {
  mongols: '/sprites/units/horse_archer.png',
  fishers: '/sprites/units/fisher_transport.png',
  crusaders: '/sprites/units/crusader_knight.png',
  traders: '/sprites/buildings/market.png',
};

/** Default when UI has not set a kingdom (e.g. mechanics test shortcut). */
export const DEFAULT_KINGDOM_ID: KingdomId = 'traders';

export type BuildingType =
  | 'city_center' | 'farm' | 'banana_farm' | 'factory' | 'barracks' | 'academy' | 'siege_workshop' | 'market' | 'quarry' | 'mine' | 'gold_mine'
  | 'sawmill' | 'port' | 'shipyard' | 'fishery' | 'logging_hut' | 'social_bar';
/** Construction site type: buildings (in city) or field-built siege/scout/defense (builder on hex). */
export type ConstructionSiteType = BuildingType | 'trebuchet' | 'scout_tower' | 'city_defense' | 'wall_section';
export type UnitType =
  | 'infantry' | 'cavalry' | 'ranged' | 'horse_archer' | 'crusader_knight' | 'builder' | 'trebuchet' | 'battering_ram' | 'defender'
  | 'scout_ship' | 'warship' | 'transport_ship' | 'fisher_transport' | 'capital_ship';

/** L3 iron archer specialization (chosen once per city with L3 barracks). */
export type RangedVariant = 'marksman' | 'longbowman';

/** Naval units: move on water only; ship-vs-ship combat on water. Warships/capital ships also shore-bombard land (separate tick). */
export const NAVAL_UNIT_TYPES: ReadonlySet<UnitType> = new Set([
  'scout_ship', 'warship', 'transport_ship', 'fisher_transport', 'capital_ship',
]);

export function isNavalUnitType(type: UnitType): boolean {
  return NAVAL_UNIT_TYPES.has(type);
}
export type UnitStatus = 'idle' | 'moving' | 'fighting' | 'starving';
export type ArmyStance = 'aggressive' | 'defensive' | 'passive' | 'skirmish' | 'hold_the_line';

/** Legacy type — heroes are not spawned; APIs still accept `heroes: []`. */
export type HeroType = 'general' | 'logistician';
export interface Hero {
  id: string;
  name: string;
  type: HeroType;
  q: number;
  r: number;
  ownerId: string;
  hp?: number;
  maxHp?: number;
}

export const HERO_BASE_HP = 100;
/** Legacy — combat still references this if heroes ever exist; not spawned in play. */
export const HERO_ATTACK = 25;

/** Human tactical attack plan vs an enemy city. */
export type AttackCityStyle = 'siege' | 'direct' | 'assault';

// ─── Player ────────────────────────────────────────────────────────

/** Empire trade: cartographer’s quarters — reveals enemy land units in that map quarter (fog of war). */
export type MapQuadrantId = 'nw' | 'ne' | 'sw' | 'se';

export interface MapQuadrantsRevealed {
  nw: boolean;
  ne: boolean;
  sw: boolean;
  se: boolean;
}

export const EMPTY_MAP_QUADRANTS: MapQuadrantsRevealed = {
  nw: false,
  ne: false,
  sw: false,
  se: false,
};

/** Gold per single quadrant map sheet from the trade menu. */
export const TRADE_MAP_QUADRANT_GOLD = 85;
/** Buy all four at once (slight discount vs 4× single). */
export const TRADE_MAP_FULL_ATLAS_GOLD = 280;

/** Premium resource packs (empire pool — split across your cities into storage, capped per city). */
export const TRADE_RESOURCE_PACK_GOLD: Record<
  'food' | 'goods' | 'stone' | 'iron' | 'wood' | 'refinedWood' | 'guns' | 'gunsL2',
  { gold: number; amount: number }
> = {
  food: { gold: 10, amount: 24 },
  goods: { gold: 14, amount: 14 },
  stone: { gold: 16, amount: 10 },
  iron: { gold: 22, amount: 8 },
  wood: { gold: 12, amount: 14 },
  refinedWood: { gold: 28, amount: 6 },
  guns: { gold: 18, amount: 10 },
  gunsL2: { gold: 42, amount: 5 },
};

export const TRADE_MORALE_FESTIVAL_GOLD = 48;
export const TRADE_MORALE_FESTIVAL_DELTA = 10;
export const TRADE_ROYAL_SURVEY_GOLD = 36;
/** +cycles toward scroll discovery on all lines (flavor + small mechanical boost). */
export const TRADE_ROYAL_SURVEY_SCROLL_CYCLES = 2;

export interface Player {
  id: string;
  name: string;
  color: string;
  gold: number;
  taxRate: number;
  foodPriority: FoodPriority;
  isHuman: boolean;
  /** Chosen kingdom (human); 1v1 AI rival uses {@link pickAiKingdom}. */
  kingdomId?: KingdomId;
  /** Trade menu: which map quarters show enemy land units through the fog. */
  mapQuadrantsRevealed?: MapQuadrantsRevealed;
}

// ─── City ──────────────────────────────────────────────────────────

/** City building under siege: intact vs burned shell (cheaper repair than new build). */
export type BuildingState = 'normal' | 'ruins';

export interface CityBuilding {
  type: BuildingType;
  q: number;
  r: number;
  level?: number;  // default 1; used for barracks, factory, quarry, mine, farm
  assignedWorkers?: number;  // all job buildings; employment tracked separately from population
  /** Port: ship unit ids currently assigned to this port (docked / home). */
  dockedShipIds?: string[];
  /** Structural HP (siege); defaults applied via {@link ensureCityBuildingHp}. */
  hp?: number;
  maxHp?: number;
  buildingState?: BuildingState;
}

/** University workforce directive — drives automated builds and which sites get extra BP. */
export type BuilderTask =
  | 'expand_quarries'
  | 'expand_iron_mines'
  | 'expand_forestry'
  | 'city_defenses'
  /** Slot contributes no BP to construction sites and is skipped by automation. */
  | 'idle';

export const DEFAULT_BUILDER_TASK: BuilderTask = 'expand_quarries';

export const BUILDER_TASK_LABELS: Record<BuilderTask, string> = {
  expand_quarries: 'Expand quarries',
  expand_iron_mines: 'Expand iron mines',
  expand_forestry: 'Expand forestry',
  city_defenses: 'Walls',
  idle: 'Unassigned',
};

/** Gold to upgrade University (academy) one level; L1→L2 … L4→L5. */
export const UNIVERSITY_UPGRADE_COSTS: [number, number, number, number] = [22, 32, 42, 52];

/** Social hall: one per city; boosts natural population growth by level. */
export const SOCIAL_BAR_BUILD_GOLD = 28;
export const SOCIAL_BAR_BP = 82;
/** L1→L2 and L2→L3 (max building level 3). */
export const SOCIAL_BAR_UPGRADE_COSTS: [number, number] = [22, 30];
/** Per level ≥1: multiply birth count by (1 + level × this). L1 ×1.08, L2 ×1.16, L3 ×1.24. */
export const SOCIAL_BAR_BIRTH_MULT_PER_LEVEL = 0.08;

export const MAP_QUADRANT_LABELS: Record<MapQuadrantId, string> = {
  nw: 'Northwest',
  ne: 'Northeast',
  sw: 'Southwest',
  se: 'Southeast',
};

export interface City {
  id: string;
  name: string;
  q: number;
  r: number;
  ownerId: string;
  population: number;
  morale: number;
  storage: { food: number; goods: number; guns: number; gunsL2: number; iron: number; stone: number; wood: number; refinedWood: number };
  storageCap: { food: number; goods: number; guns: number; gunsL2: number; iron: number; stone: number; wood: number; refinedWood: number };
  buildings: CityBuilding[];
  /** Workforce priority for this city's University — automation + extra BP on matching sites. */
  universityBuilderTask?: BuilderTask;
  /**
   * Per–builder-slot task at the University (length matches academy level slots).
   * When absent, {@link universityBuilderTask} is repeated for each slot.
   */
  universityBuilderSlotTasks?: BuilderTask[];
  /** Cycles remaining as frontier city (+25% migration); only for incorporated villages */
  frontierCity?: number;
  /** Hex steps from center included in this city's territory; default {@link TERRITORY_RADIUS}. */
  territoryRadius?: number;
  /**
   * When true, garrisoned bow units (ranged / horse archer) fire at enemies in this city's territory
   * within {@link garrisonPatrolRadius} hex steps of the city center (combat tick).
   */
  garrisonPatrol?: boolean;
  /**
   * Patrol depth from city center; only tiles at most this far from the center are valid patrol targets.
   * Default {@link TERRITORY_RADIUS}; clamped to {@link GARRISON_PATROL_RADIUS_MIN}..{@link GARRISON_PATROL_RADIUS_MAX}.
   */
  garrisonPatrolRadius?: number;
  /** Last cycle: natural growth (births − deaths) */
  lastNaturalGrowth?: number;
  /** Last cycle: migration (positive = immigrants, negative = emigrants) */
  lastMigration?: number;
  /** Smoothed carrying capacity (population expectations); lags actual production by ~2–4 cycles */
  expectedCarryingCapacity?: number;
  /**
   * L3 iron archer line for this city (set once when barracks first reaches L3).
   * `undefined` = pre-feature / never set; `null` = L3 barracks but player must choose;
   * `'marksman' | 'longbowman'` = locked doctrine.
   */
  archerDoctrineL3?: RangedVariant | null;
}

// ─── Unit stack (training template + optional auto-replenish) ─────

/** One row in a stack’s desired composition (type + arms tier × count). */
export interface StackCompositionEntry {
  unitType: UnitType;
  armsLevel: 1 | 2 | 3;
  count: number;
  /** L3 ranged only: must match {@link Unit.rangedVariant} for that row. */
  rangedVariant?: RangedVariant;
}

/** @deprecated Use StackCompositionEntry */
export type DivisionCompositionEntry = StackCompositionEntry;
export type ArmyCompositionEntry = StackCompositionEntry;

/** Named stack created when you train units; replenishment targets this template. */
export interface UnitStack {
  id: string;
  ownerId: string;
  homeCityId: string;
  name: string;
  composition: StackCompositionEntry[];
  autoReplenish: boolean;
  rallyQ: number;
  rallyR: number;
}

/** @deprecated Use UnitStack */
export type Division = UnitStack;
/** @deprecated Use UnitStack */
export type Army = UnitStack;

/** Per-field-army march shape: inherit session default, force spread, or force stacked. */
export type ArmyMarchSpreadMode = 'inherit' | 'spread' | 'stack';

/**
 * Field army: created in the Army panel. Map hex stacks + unit stacks can receive orders.
 * Units link via {@link Unit.armyId}; trained stacks link via {@link OperationalArmy.stackIds}.
 */
export interface OperationalArmy {
  id: string;
  ownerId: string;
  name: string;
  stance: ArmyStance;
  /** Unit stacks (training groups) attached to this army for org/replenish. */
  stackIds: string[];
  targetQ?: number;
  targetR?: number;
  /** Shared inter-hex cadence when movement is driven at army level (optional until loop migrates). */
  nextMoveAt?: number;
  marchInitialHexDistance?: number;
  moveLegMs?: number;
  /**
   * Land march formation override for units with this {@link Unit.armyId}.
   * `inherit` uses the session “Default formation & tactics” toggle.
   */
  marchSpread?: ArmyMarchSpreadMode;
}

/** @deprecated Renamed to {@link OperationalArmy} — same shape. */
export type FieldArmy = OperationalArmy;

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
  armsLevel?: 1 | 2 | 3;  // 1 = L1, 2 = L2 (stone), 3 = L3 (iron); defender is L3 only
  /** L3 ranged (`type === 'ranged'`) only: Marksman vs Longbowman. */
  rangedVariant?: RangedVariant;
  status: UnitStatus;
  stance: ArmyStance;
  targetQ?: number;
  targetR?: number;
  nextMoveAt: number;
  /** Hex distance to destination when the current march order was issued (UI progress). Cleared when not moving. */
  marchInitialHexDistance?: number;
  /** Duration (ms) of the current inter-hex cooldown after last step; used for progress bar smoothing. */
  moveLegMs?: number;
  /** City that recruited this unit; when unit dies, that city loses 1 population (design: pop not deducted until death). */
  originCityId?: string;
  /** When set, this unit is defending this city (stack → Defend → city). */
  defendCityId?: string;
  /** When set, retreat will execute at this timestamp (2s delay). Until then unit does not attack. */
  retreatAt?: number;
  /** When true, unit is assaulting a city (massive attack debuff for attacker). */
  assaulting?: boolean;
  /** Camped outside an enemy city (siege); use siege UI to begin a center assault. */
  siegingCityId?: string;
  /** Later wave: waits until wave-1 units reach the rally hex (or are gone). */
  attackWaveHold?: {
    waitForUnitIds: string[];
    cityId: string;
    rallyQ: number;
    rallyR: number;
    centerQ: number;
    centerR: number;
    attackStyle: AttackCityStyle;
  };
  /** Echelon march (non-siege): wait until prior wave reaches rally hex, then march to destination. */
  marchEchelonHold?: {
    waitForUnitIds: string[];
    rallyQ: number;
    rallyR: number;
    destQ: number;
    destR: number;
  };
  /** Land units carried by a transport/scout ship; excluded from combat/map stack until unloaded. */
  aboardShipId?: string;
  /** Naval: ids of carried land units (capacity limits apply). */
  cargoUnitIds?: string[];
  /** When set, land military unit is in this city's garrison (shown as badge on city hex until deployed). */
  garrisonCityId?: string;
  /** Unit stack this unit was trained into (replenishment / template). */
  stackId?: string;
  /** Operational field army this unit belongs to (shared orders / commander / scroll layer). */
  armyId?: string;
  /**
   * City defense order: auto_engage roams territory to intercept; stagnant stays on city center.
   * Only meaningful when {@link defendCityId} is set.
   */
  cityDefenseMode?: 'auto_engage' | 'stagnant';
  /** Patrol mission: wander within this disk, engage spotted enemies. */
  patrolCenterQ?: number;
  patrolCenterR?: number;
  patrolRadius?: number;
  /** When set, patrol is limited to these hexes (from tactical paint); overrides disk wander. */
  patrolHexKeys?: string[];
  /** When set, land military will auto-incorporate this neutral village on arrival (tactical order). */
  incorporateVillageAt?: { q: number; r: number };
  /** Auto-chase this enemy land unit (retaliation / close into range). Cleared when target dies. */
  retaliateUnitId?: string;
  /** Auto-chase this enemy defense tower. Cleared when destroyed. */
  retaliateDefenseId?: string;
  /** Tactical/build focus: damage this enemy city building until ruined. */
  attackBuildingTarget?: { cityId: string; q: number; r: number };
  /** Active ability state: whether active and when cooldown expires. */
  abilityActive?: boolean;
  /** Timestamp (ms) when the active ability expires. */
  abilityActiveUntil?: number;
  /** Timestamp (ms) after which the ability can be activated again. */
  abilityCooldownUntil?: number;
  /** Cavalry charge: true on the first tick of contact, auto-clears after. */
  chargeReady?: boolean;
}

// ─── Commander (assign to city defense or a field army anchor unit) ─

export type CommanderTraitId =
  | 'duelist'
  | 'stalwart'
  | 'tactician'
  | 'siege_born'
  | 'skirmisher'
  | 'warden';

export const COMMANDER_TRAIT_INFO: Record<
  CommanderTraitId,
  { label: string; desc: string; attackBonus: number; defenseBonus: number }
> = {
  duelist: {
    label: 'Duelist',
    desc: '+8% attack (melee focus)',
    attackBonus: 0.08,
    defenseBonus: 0,
  },
  stalwart: {
    label: 'Stalwart',
    desc: '+10% defense (incoming damage)',
    attackBonus: 0,
    defenseBonus: 0.1,
  },
  tactician: {
    label: 'Tactician',
    desc: '+4% attack and +4% defense',
    attackBonus: 0.04,
    defenseBonus: 0.04,
  },
  siege_born: {
    label: 'Siege-born',
    desc: '+6% attack when holding ground',
    attackBonus: 0.06,
    defenseBonus: 0.02,
  },
  skirmisher: {
    label: 'Skirmisher',
    desc: '+7% attack for mobile stacks',
    attackBonus: 0.07,
    defenseBonus: 0,
  },
  warden: {
    label: 'Warden',
    desc: '+12% defense on city tile',
    attackBonus: 0,
    defenseBonus: 0.12,
  },
};

export type CommanderAssignment =
  | { kind: 'city_defense'; cityId: string }
  /** @deprecated Prefer `field_army` (see {@link OperationalArmy}) for new field assignments. */
  | { kind: 'field'; anchorUnitId: string }
  | { kind: 'field_army'; armyId: string };

/** Land commanders lead armies; naval commanders lead ship stacks (~25% roll on recruit). */
export type CommanderKind = 'land' | 'naval';

export interface Commander {
  id: string;
  name: string;
  ownerId: string;
  q: number;
  r: number;
  /** Seeded portrait + combat variance; stable for the match. */
  portraitSeed: number;
  /** Client-generated data URL (knight bust); optional if generation failed. */
  portraitDataUrl?: string;
  traitIds: CommanderTraitId[];
  backstory: string;
  assignment: CommanderAssignment | null;
  /** Defaults to land when missing (older saves). */
  commanderKind?: CommanderKind;
}

/** Draft pool at match start: pick {@link COMMANDER_STARTING_PICK} of these. */
export interface CommanderDraftOption {
  draftId: string;
  name: string;
  backstory: string;
  traitIds: CommanderTraitId[];
  portraitSeed: number;
  portraitDataUrl?: string;
  commanderKind?: CommanderKind;
}

/** Candidates shown before you choose five; independent of barracks. */
export const COMMANDER_DRAFT_POOL_SIZE = 8;
/** How many commanders you field after the draft. */
export const COMMANDER_STARTING_PICK = 5;

/** Additional commanders after the starting five (not limited by barracks). */
export const COMMANDER_RECRUIT_GOLD = 50;

// ─── Road construction (builder-built; free, takes builder time) ───

export interface RoadConstructionSite {
  id: string;
  q: number;
  r: number;
  ownerId: string;
  bpRequired: number;
  bpAccumulated: number;
}

export const ROAD_BP_COST = 40;

// ─── City defense towers (builder-built on territory) ──────────────

/** Built by builders on city territory; auto-fires at enemies in combat ticks. */
export type DefenseTowerType = 'mortar' | 'archer_tower' | 'ballista';

export type DefenseTowerLevel = 1 | 2 | 3 | 4 | 5;

export interface DefenseInstallation {
  id: string;
  q: number;
  r: number;
  ownerId: string;
  /** Territory city this defense counts against (max per city). */
  cityId: string;
  type: DefenseTowerType;
  level: DefenseTowerLevel;
}

export const DEFENSE_TOWER_MAX_PER_CITY: Record<DefenseTowerType, number> = {
  mortar: 1,
  archer_tower: 2,
  ballista: 2,
};

/** Per-level costs: L1 gold only → L5 all resources (most expensive). */
export interface DefenseTowerLevelCost {
  gold: number;
  wood?: number;
  stone?: number;
  iron?: number;
}

export const DEFENSE_TOWER_LEVEL_COSTS: Record<DefenseTowerLevel, DefenseTowerLevelCost> = {
  1: { gold: 12 },
  2: { gold: 18, wood: 6 },
  3: { gold: 28, stone: 10 },
  4: { gold: 40, iron: 8 },
  5: { gold: 65, wood: 15, stone: 12, iron: 10 },
};

export function getDefenseTowerBpCost(type: DefenseTowerType, level: DefenseTowerLevel): number {
  const base = type === 'mortar' ? 48 : type === 'archer_tower' ? 42 : 44;
  return base + level * 10;
}

export const DEFENSE_TOWER_ARCHER_RANGE = 3;
export const DEFENSE_TOWER_BALLISTA_RANGE = 3;

export const DEFENSE_TOWER_DISPLAY_NAME: Record<DefenseTowerType, string> = {
  mortar: 'Mortar',
  archer_tower: 'Archer tower',
  ballista: 'Ballista',
};

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
  /** When type === 'city_defense': which tower and target level (1–5). */
  defenseTowerType?: DefenseTowerType;
  defenseTowerTargetLevel?: DefenseTowerLevel;
  /** When type === 'city_defense': also count builders here (site may differ when placing from a pending move). */
  cityDefenseBuilderBpHex?: { q: number; r: number };
  /** When type === 'wall_section': originating city/ring for grouped wall projects. */
  wallBuildRing?: 1 | 2;
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
/** Builder BP needed to complete one wall section project. */
export const WALL_SECTION_BP_COST = 38;
/** Stone consumed per economy cycle per University slot assigned to Defenses while a wall section is building. */
export const WALL_BUILDER_STONE_PER_CYCLE_PER_SLOT = 3;

/** Passive heal per economy cycle for land units not in combat (fraction of maxHp). */
export const UNIT_HP_REGEN_FRACTION_PER_CYCLE = 0.04;

/** Default patrol radius (hex steps) when assigning a patrol mission from the tactical bar. */
export const PATROL_DEFAULT_RADIUS = 4;

/** Gold multiplier vs building fresh cost to repair a ruined building. */
export const RUINS_REPAIR_GOLD_RATIO = 0.4;

/** Base max HP for city buildings under siege (scaled by level for job buildings). */
export function defaultCityBuildingMaxHp(type: BuildingType, level: number = 1): number {
  const lv = Math.max(1, level);
  if (type === 'city_center') return 200;
  if (type === 'barracks' || type === 'academy' || type === 'factory' || type === 'siege_workshop') return 70 * lv;
  if (type === 'market' || type === 'port' || type === 'shipyard' || type === 'social_bar') return 55 * lv;
  return 45 * lv;
}

/** Ensure hp/maxHp exist for buildings (migration + new builds). */
export function ensureCityBuildingHp(b: CityBuilding): CityBuilding {
  const lvl = b.level ?? 1;
  const maxHp = b.maxHp ?? defaultCityBuildingMaxHp(b.type, lvl);
  const hp = b.hp !== undefined ? b.hp : b.buildingState === 'ruins' ? 0 : maxHp;
  return { ...b, maxHp, hp, buildingState: b.buildingState ?? 'normal' };
}

/** True if this building contributes to production / jobs (not ruins / destroyed). */
export function isCityBuildingOperational(b: CityBuilding): boolean {
  if (b.buildingState === 'ruins') return false;
  const maxHp = b.maxHp ?? defaultCityBuildingMaxHp(b.type, b.level ?? 1);
  if (b.hp !== undefined && b.hp <= 0 && maxHp > 0) return false;
  return true;
}

// ─── Scout Towers (field-built by builders; vision only) ───────────
export interface ScoutTower {
  id: string;
  q: number;
  r: number;
  ownerId: string;
}
export const SCOUT_TOWER_VISION_RANGE = 4;
export const SCOUT_TOWER_BP_COST = 60;
export const SCOUT_TOWER_GOLD_COST = 5;

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
  city_center: 0, farm: 75, banana_farm: 75, factory: 75, barracks: 150, academy: 110, siege_workshop: 130, market: 45, quarry: 75, mine: 75, gold_mine: 90,
  sawmill: 70, port: 120, shipyard: 135, fishery: 75, logging_hut: 75, social_bar: SOCIAL_BAR_BP,
};

/** BP required for builder to build a trebuchet in the field (on the hex). */
export const TREBUCHET_FIELD_BP_COST = 90;
/** Gold cost to start field trebuchet construction (same as barracks recruit). */
export const TREBUCHET_FIELD_GOLD_COST = 8;
/** Refined wood from city storage (sawmill) for trebuchet — siege workshop recruit and field build. */
export const TREBUCHET_REFINED_WOOD_COST = 4;

export const CITY_BUILDING_POWER = 65;
export const BUILDER_POWER = 10;
export const BP_RATE_BASE = 50;

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
/** Garrison patrol depth slider (hex steps from city center). */
export const GARRISON_PATROL_RADIUS_MIN = 1;
export const GARRISON_PATROL_RADIUS_MAX = 6;
/** Incorporated villages use the same territory radius as starting capitals. */
export const VILLAGE_CITY_TERRITORY_RADIUS = TERRITORY_RADIUS;
/** If a move destination is within this many hexes of your territory, you may issue orders up to MOVE_ORDER_MAX_IN_TERRITORY_BAND hexes; otherwise cap is MOVE_ORDER_MAX_OUTSIDE_BAND. */
export const MOVE_ORDER_TERRITORY_BAND_HEXES = 20;
export const MOVE_ORDER_MAX_IN_TERRITORY_BAND = 20;
export const MOVE_ORDER_MAX_OUTSIDE_BAND = 10;

/** Rough max hexes a unit can move in one economy cycle (30s) at speed 1 after UNIT_MOVEMENT_DELAY_MULT (~1.7). Informational only. Supply radius should stay >= this. */
export const MOVEMENT_HEXES_PER_CYCLE_ESTIMATE = 20;
/** Units/builders get supply when within this hex distance of any friendly city. No roads required.
 *  >= MOVEMENT_HEXES_PER_CYCLE_ESTIMATE so one cycle of movement doesn't leave supply. */
export const SUPPLY_VICINITY_RADIUS = 24;
export const STARTING_GOLD = 600;

export const STARTING_CITY_TEMPLATE: Omit<City, 'id' | 'name' | 'q' | 'r' | 'ownerId'> = {
  population: 150,
  morale: 75,
  storage: { food: 150, goods: 45, guns: 5, gunsL2: 0, iron: 0, stone: 0, wood: 0, refinedWood: 0 },
  storageCap: { food: 1000, goods: 100, guns: 100, gunsL2: 100, iron: 50, stone: 50, wood: 50, refinedWood: 50 },
  buildings: [],
};

export const VILLAGE_INCORPORATE_COST = 25;

export const VILLAGE_CITY_TEMPLATE: Omit<City, 'id' | 'name' | 'q' | 'r' | 'ownerId'> = {
  population: 10,
  morale: 50,
  storage: { food: 15, goods: 5, guns: 0, gunsL2: 0, iron: 0, stone: 0, wood: 0, refinedWood: 0 },
  storageCap: { food: 50, goods: 50, guns: 50, gunsL2: 50, iron: 50, stone: 50, wood: 50, refinedWood: 50 },
  buildings: [],
  territoryRadius: VILLAGE_CITY_TERRITORY_RADIUS,
};

export const BUILDING_COLORS: Record<BuildingType, string> = {
  city_center: '#8b5cf6', // purple (administrative)
  farm:        '#4ade80', // green
  banana_farm: '#86efac', // lighter green (Fishers)
  factory:     '#f59e0b', // amber/orange
  barracks:    '#ef4444', // red
  academy:     '#0ea5e9', // sky blue (civilian)
  siege_workshop: '#b45309', // amber/brown (siege engines)
  market:      '#facc15', // gold/yellow
  quarry:      '#78716c', // stone
  mine:        '#57534e', // iron
  gold_mine:   '#e8c030', // gold
  sawmill:     '#ca8a04', // amber wood
  port:        '#0369a1', // harbor blue
  shipyard:    '#1e3a5f', // dock gray-blue
  fishery:     '#0d9488', // teal
  logging_hut: '#365314', // forest green
  social_bar: '#c084fc', // violet (gathering place)
};

export const BUILDING_COSTS: Record<BuildingType, number> = {
  city_center: 0, farm: 15, banana_farm: 15, factory: 25, barracks: 50, academy: 35, siege_workshop: 38, market: 2, quarry: 10, mine: 10, gold_mine: 20,
  sawmill: 20, port: 40, shipyard: 45, fishery: 18,   logging_hut: 12,
  social_bar: SOCIAL_BAR_BUILD_GOLD,
};

/** Iron cost for buildings that require it (e.g. gold_mine). Others are 0. */
export const BUILDING_IRON_COSTS: Partial<Record<BuildingType, number>> = {
  gold_mine: 20,
};

/** Jobs per building (flat 2 for production, 2 for barracks/academy, 1 for city_center). Use getBuildingJobs(b) for level-aware count. */
export const BUILDING_JOBS: Record<BuildingType, number> = {
  city_center: 1, farm: 2, banana_farm: 2, factory: 2, barracks: 2, academy: 2, siege_workshop: 2, market: 2, quarry: 2, mine: 2, gold_mine: 2,
  sawmill: 2, port: 1, shipyard: 2, fishery: 2,   logging_hut: 2,
  social_bar: 2,
};

/** Farms and Fishers banana farms share production rules. */
export function isFarmBuildingType(t: BuildingType): boolean {
  return t === 'farm' || t === 'banana_farm';
}

/** Land biomes where a farm / banana farm may be placed (cleared fields — not forest or mountain). */
export function isValidFarmPlacementBiome(biome: Biome): boolean {
  return biome !== 'water' && biome !== 'mountain' && biome !== 'forest';
}

/** Level-aware job count (e.g. L2 farm has 3 jobs). Use when the building instance is available. */
export function getBuildingJobs(b: { type: BuildingType; level?: number }): number {
  const base = BUILDING_JOBS[b.type] ?? 0;
  if (isFarmBuildingType(b.type) && (b.level ?? 1) >= 2) return 3;
  return base;
}

export const BARACKS_UPGRADE_COST = 25;
/** Barracks L2 → L3 (Crusader knight unlock). */
export const BARACKS_L3_UPGRADE_COST = 40;
export const FACTORY_UPGRADE_COST = 15;
export const FARM_UPGRADE_COST = 20;
/** Quarry / iron mine / gold mine L1 → L2 (same economy slot as farm upgrade). */
export const RESOURCE_MINE_UPGRADE_COST = 20;
/** L2 farm total food per cycle (higher productivity per job than L1). */
export const FARM_L2_FOOD_PER_CYCLE = 60;
export const WALL_SECTION_STONE_COST = 5;
export const WORKERS_PER_LEVEL = 5;
export const MIN_STAFFING_RATIO = 0.4;

export type BuildingProduction = {
  food: number; goods: number; guns: number;
  stone?: number; iron?: number; gold?: number; wood?: number; refinedWood?: number;
};

/** Sawmill: refined output per staffed level per cycle; wood consumed separately in economy tick. */
export const SAWMILL_WOOD_PER_REFINED = 2;

export const BUILDING_PRODUCTION: Record<BuildingType, BuildingProduction> = {
  city_center: { food: 0, goods: 0, guns: 0 },
  farm:        { food: 27, goods: 0, guns: 0 },
  banana_farm: { food: 27, goods: 0, guns: 0 },
  factory:     { food: 0, goods: 0, guns: 1 },
  barracks:    { food: 0, goods: 0, guns: 0 },
  academy:     { food: 0, goods: 0, guns: 0 },
  siege_workshop: { food: 0, goods: 0, guns: 0 },
  market:      { food: 0, goods: 0, guns: 0 },
  quarry:      { food: 0, goods: 0, guns: 0, stone: 3 },
  mine:        { food: 0, goods: 0, guns: 0, iron: 3 },
  gold_mine:   { food: 0, goods: 0, guns: 0, gold: 7 },
  sawmill:     { food: 0, goods: 0, guns: 0, refinedWood: 1 },
  port:        { food: 0, goods: 0, guns: 0 },
  shipyard:    { food: 0, goods: 0, guns: 0 },
  fishery:     { food: 23, goods: 0, guns: 0 },
  logging_hut: { food: 0, goods: 0, guns: 0, wood: 2 },
  social_bar: { food: 0, goods: 0, guns: 0 },
};

// L2 factory: 1 iron -> 10 gunsL2 per cycle
export const FACTORY_L2_IRON_PER_CYCLE = 1;
export const FACTORY_L2_ARMS_PER_CYCLE = 6;

export const MARKET_GOLD_PER_CYCLE = 1;

/** Market gold: per incorporated village hex in the owning player's territory (empire-wide pool). */
export const MARKET_GOLD_PER_VILLAGE = 5;

/** Multiplier on census tax gold: floor(pop × taxRate × this). */
export const POPULATION_TAX_GOLD_MULT = 1.5;

/** Storage cap provided by city center (1 per city, required) */
export const CITY_CENTER_STORAGE = { food: 1000, goods: 100, guns: 100, gunsL2: 100, iron: 50, stone: 50, wood: 50, refinedWood: 50 };

/** Extra food multiplier for farms on plains biome (design: fertile soil). */
export const PLAINS_FARM_FOOD_MULT = 1.2;

/** Mongol land armies: effective speed multiplier in movement tick. */
export const MONGOL_LAND_SPEED_MULT = 1.1;
/** Trading tribe: BP/sec multiplier for city building + road construction. */
export const TRADER_CONSTRUCTION_SPEED_MULT = 1.2;

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

/** Ship purchase at shipyard (PDF costs). */
export const SHIP_RECRUIT_COSTS: Record<
  'scout_ship' | 'warship' | 'transport_ship' | 'fisher_transport' | 'capital_ship',
  { gold: number; wood?: number; refinedWood?: number }
> = {
  scout_ship:       { gold: 1, wood: 1 },
  warship:          { gold: 2, wood: 2 },
  transport_ship:   { gold: 5, refinedWood: 5 },
  fisher_transport: { gold: 1 },
  capital_ship:     { gold: 5, refinedWood: 5 },
};

export function getShipMaxCargo(type: UnitType): number {
  if (type === 'scout_ship') return 5;
  if (type === 'transport_ship') return 20;
  if (type === 'fisher_transport') return 1;
  return 0;
}

/** L1 recruit costs (gold only for combat; defender not recruitable at L1). */
export const UNIT_COSTS: Record<UnitType, { gold: number; iron?: number; refinedWood?: number }> = {
  infantry:        { gold: 1 },
  cavalry:         { gold: 3 },
  ranged:          { gold: 2 },
  horse_archer:    { gold: 3 },
  crusader_knight: { gold: 0 },
  builder:         { gold: 2 },
  trebuchet:       { gold: 8, refinedWood: TREBUCHET_REFINED_WOOD_COST },
  battering_ram:   { gold: 6 },
  defender:        { gold: 0, iron: 2 },  // L3 only; cost comes from UNIT_L3_COSTS
  scout_ship:      { gold: 0 },
  warship:         { gold: 0 },
  transport_ship:  { gold: 0 },
  fisher_transport: { gold: 0 },
  capital_ship:    { gold: 0 },
};
/** L2 recruit costs (gold + stone); siege/builder/defender have no L2. */
export const UNIT_L2_COSTS: Record<UnitType, { gold: number; stone?: number; refinedWood?: number }> = {
  infantry:        { gold: 1, stone: 2 },
  cavalry:         { gold: 3, stone: 3 },
  ranged:          { gold: 2, stone: 2 },
  horse_archer:    { gold: 3, stone: 2 },
  crusader_knight: { gold: 0 },
  builder:         { gold: 2 },
  trebuchet:       { gold: 8, refinedWood: TREBUCHET_REFINED_WOOD_COST },
  battering_ram:   { gold: 6 },
  defender:        { gold: 0 },  // defender has no L2; L3 only
  scout_ship:      { gold: 0 },
  warship:         { gold: 0 },
  transport_ship:  { gold: 0 },
  fisher_transport: { gold: 0 },
  capital_ship:    { gold: 0 },
};
/** L3 recruit costs (gold + iron); defender is iron only. */
export const UNIT_L3_COSTS: Record<UnitType, { gold: number; iron?: number; refinedWood?: number }> = {
  infantry:        { gold: 2, iron: 1 },
  cavalry:         { gold: 5, iron: 2 },
  ranged:          { gold: 3, iron: 1 },
  horse_archer:    { gold: 5, iron: 2 },
  /** Best infantry; Crusaders only; requires L3 barracks; higher iron than standard L3 infantry. */
  crusader_knight: { gold: 4, iron: 3 },
  builder:         { gold: 2 },
  trebuchet:       { gold: 8, refinedWood: TREBUCHET_REFINED_WOOD_COST },
  battering_ram:   { gold: 6 },
  defender:        { gold: 0, iron: 2 },  // L3 only, iron only
  scout_ship:      { gold: 0 },
  warship:         { gold: 0 },
  transport_ship:  { gold: 0 },
  fisher_transport: { gold: 0 },
  capital_ship:    { gold: 0 },
};
/** Defender (L3 only) iron cost from city storage. */
export const DEFENDER_IRON_COST = 2;

export const UNIT_DISPLAY_NAMES: Record<UnitType, string> = {
  infantry:         'Infantry',
  cavalry:          'Cavalry',
  ranged:           'Archer',
  horse_archer:     'Horse Archer',
  crusader_knight:  'Crusader Knight',
  builder:          'Builder',
  trebuchet:        'Trebuchet',
  battering_ram:    'Battering Ram',
  defender:         'Defender',
  scout_ship:       'Scout Ship',
  warship:          'Warship',
  transport_ship:   'Transport',
  fisher_transport: 'Fisher Boat',
  capital_ship:     'Capital Ship',
};

export const UNIT_BASE_STATS: Record<UnitType, {
  maxHp: number; attack: number; range: number;
  speed: number; foodUpkeep: number; gunUpkeep: number; gunL2Upkeep?: number;
  /** Siege damage vs wall sections (trebuchet 3 hex, ram melee). */
  siegeAttack?: number;
  /** 0–1; reduces incoming damage. */
  damageResist?: number;
  /** When on friendly city hex (defender only). */
  damageResistOnCityHex?: number;
}> = {
  infantry:       { maxHp: 100, attack: 15, range: 1, speed: 1.0, foodUpkeep: 1, gunUpkeep: 0 },
  cavalry:        { maxHp: 75,  attack: 20, range: 1, speed: 1.5, foodUpkeep: 2, gunUpkeep: 0 },
  ranged:         { maxHp: 50,  attack: 12, range: 2, speed: 1.0, foodUpkeep: 1, gunUpkeep: 0 },
  horse_archer:   { maxHp: 65,  attack: 14, range: 2, speed: 1.35, foodUpkeep: 2, gunUpkeep: 0 },
  crusader_knight:{ maxHp: 100, attack: 12, range: 1, speed: 0.9, foodUpkeep: 1, gunUpkeep: 0 },
  builder:        { maxHp: 40,  attack: 0,  range: 0, speed: 1.0, foodUpkeep: 1, gunUpkeep: 0 },
  trebuchet:      { maxHp: 60,  attack: 5,  range: 3, speed: 0.6, foodUpkeep: 2, gunUpkeep: 0, siegeAttack: 25 },
  battering_ram:  { maxHp: 120, attack: 10, range: 1, speed: 0.5, foodUpkeep: 2, gunUpkeep: 0, siegeAttack: 40 },
  defender:       { maxHp: 130, attack: 8,  range: 1, speed: 0.9, foodUpkeep: 1, gunUpkeep: 0, damageResist: 0.25, damageResistOnCityHex: 0.4 },
  scout_ship:     { maxHp: 70,  attack: 6,  range: 1, speed: 1.2, foodUpkeep: 1, gunUpkeep: 0 },
  warship:        { maxHp: 110, attack: 18, range: 2, speed: 1.0, foodUpkeep: 2, gunUpkeep: 0 },
  transport_ship: { maxHp: 140, attack: 0,  range: 0, speed: 0.75, foodUpkeep: 2, gunUpkeep: 0 },
  fisher_transport: { maxHp: 55, attack: 0, range: 0, speed: 0.9, foodUpkeep: 1, gunUpkeep: 0 },
  capital_ship:   { maxHp: 160, attack: 36, range: 2, speed: 0.85, foodUpkeep: 3, gunUpkeep: 0 },
};

// Level 2 unit stats (require L2 arms); siege and defender have no L2 variant
export const UNIT_L2_STATS: Record<UnitType, {
  maxHp: number; attack: number; range: number;
  speed: number; foodUpkeep: number; gunUpkeep: number; gunL2Upkeep: number;
  siegeAttack?: number;
  damageResist?: number;
  damageResistOnCityHex?: number;
}> = {
  infantry:       { maxHp: 120, attack: 18, range: 1, speed: 1.0, foodUpkeep: 1, gunUpkeep: 0, gunL2Upkeep: 1 },
  cavalry:        { maxHp: 90,  attack: 24, range: 1, speed: 1.5, foodUpkeep: 2, gunUpkeep: 0, gunL2Upkeep: 1 },
  ranged:         { maxHp: 60,  attack: 14, range: 2, speed: 1.0, foodUpkeep: 1, gunUpkeep: 0, gunL2Upkeep: 2 },
  horse_archer:   { maxHp: 78,  attack: 17, range: 2, speed: 1.35, foodUpkeep: 2, gunUpkeep: 0, gunL2Upkeep: 2 },
  crusader_knight:{ maxHp: 120, attack: 15, range: 1, speed: 0.9, foodUpkeep: 1, gunUpkeep: 0, gunL2Upkeep: 2 },
  builder:        { maxHp: 40,  attack: 0,  range: 0, speed: 1.0, foodUpkeep: 1, gunUpkeep: 0, gunL2Upkeep: 0 },
  trebuchet:      { maxHp: 60,  attack: 5,  range: 3, speed: 0.6, foodUpkeep: 2, gunUpkeep: 0, gunL2Upkeep: 0, siegeAttack: 25 },
  battering_ram:  { maxHp: 120, attack: 10, range: 1, speed: 0.5, foodUpkeep: 2, gunUpkeep: 0, gunL2Upkeep: 0, siegeAttack: 40 },
  defender:       { maxHp: 130, attack: 8,  range: 1, speed: 0.9, foodUpkeep: 1, gunUpkeep: 0, gunL2Upkeep: 0, damageResist: 0.25, damageResistOnCityHex: 0.4 },
  scout_ship:     { maxHp: 70,  attack: 6,  range: 1, speed: 1.2, foodUpkeep: 1, gunUpkeep: 0, gunL2Upkeep: 0 },
  warship:        { maxHp: 110, attack: 18, range: 2, speed: 1.0, foodUpkeep: 2, gunUpkeep: 0, gunL2Upkeep: 0 },
  transport_ship: { maxHp: 140, attack: 0,  range: 0, speed: 0.75, foodUpkeep: 2, gunUpkeep: 0, gunL2Upkeep: 0 },
  fisher_transport: { maxHp: 55, attack: 0, range: 0, speed: 0.9, foodUpkeep: 1, gunUpkeep: 0, gunL2Upkeep: 0 },
  capital_ship:   { maxHp: 160, attack: 36, range: 2, speed: 0.85, foodUpkeep: 3, gunUpkeep: 0, gunL2Upkeep: 0 },
};

/** Same ranged reach as field {@link UNIT_BASE_STATS} trebuchet. */
export const DEFENSE_TOWER_MORTAR_RANGE = UNIT_BASE_STATS.trebuchet.range;

// Level 3 unit stats (require L2 barracks, iron cost); defender is L3 only
export const UNIT_L3_STATS: Record<UnitType, {
  maxHp: number; attack: number; range: number;
  speed: number; foodUpkeep: number; gunUpkeep: number; gunL2Upkeep: number;
  siegeAttack?: number;
  damageResist?: number;
  damageResistOnCityHex?: number;
}> = {
  infantry:       { maxHp: 140, attack: 21, range: 1, speed: 1.0, foodUpkeep: 1, gunUpkeep: 0, gunL2Upkeep: 2 },
  cavalry:        { maxHp: 105, attack: 28, range: 1, speed: 1.5, foodUpkeep: 2, gunUpkeep: 0, gunL2Upkeep: 2 },
  /** Legacy baseline; L3 ranged uses {@link UNIT_L3_RANGED_MARKSMAN} / {@link UNIT_L3_RANGED_LONGBOW} via {@link getUnitStats}. */
  ranged:         { maxHp: 70,  attack: 17, range: 2, speed: 1.0, foodUpkeep: 1, gunUpkeep: 0, gunL2Upkeep: 2 },
  horse_archer:   { maxHp: 92,  attack: 20, range: 2, speed: 1.35, foodUpkeep: 2, gunUpkeep: 0, gunL2Upkeep: 2 },
  crusader_knight:{ maxHp: 175, attack: 32, range: 1, speed: 0.95, foodUpkeep: 2, gunUpkeep: 0, gunL2Upkeep: 3, damageResist: 0.15 },
  builder:        { maxHp: 40,  attack: 0,  range: 0, speed: 1.0, foodUpkeep: 1, gunUpkeep: 0, gunL2Upkeep: 0 },
  trebuchet:      { maxHp: 60,  attack: 5,  range: 3, speed: 0.6, foodUpkeep: 2, gunUpkeep: 0, gunL2Upkeep: 0, siegeAttack: 25 },
  battering_ram:  { maxHp: 120, attack: 10, range: 1, speed: 0.5, foodUpkeep: 2, gunUpkeep: 0, gunL2Upkeep: 0, siegeAttack: 40 },
  defender:       { maxHp: 130, attack: 8,  range: 1, speed: 0.9, foodUpkeep: 1, gunUpkeep: 0, gunL2Upkeep: 0, damageResist: 0.25, damageResistOnCityHex: 0.4 },
  scout_ship:     { maxHp: 70,  attack: 6,  range: 1, speed: 1.2, foodUpkeep: 1, gunUpkeep: 0, gunL2Upkeep: 0 },
  warship:        { maxHp: 110, attack: 18, range: 2, speed: 1.0, foodUpkeep: 2, gunUpkeep: 0, gunL2Upkeep: 0 },
  transport_ship: { maxHp: 140, attack: 0,  range: 0, speed: 0.75, foodUpkeep: 2, gunUpkeep: 0, gunL2Upkeep: 0 },
  fisher_transport: { maxHp: 55, attack: 0, range: 0, speed: 0.9, foodUpkeep: 1, gunUpkeep: 0, gunL2Upkeep: 0 },
  capital_ship:   { maxHp: 160, attack: 36, range: 2, speed: 0.85, foodUpkeep: 3, gunUpkeep: 0, gunL2Upkeep: 0 },
};

/** L3 iron Marksman: short range, high attack (same upkeep as L3 ranged). */
export const UNIT_L3_RANGED_MARKSMAN: (typeof UNIT_L3_STATS)['ranged'] = {
  maxHp: 70, attack: 24, range: 1, speed: 1.0, foodUpkeep: 1, gunUpkeep: 0, gunL2Upkeep: 2,
};

/** L3 iron Longbowman: long range, lower attack. */
export const UNIT_L3_RANGED_LONGBOW: (typeof UNIT_L3_STATS)['ranged'] = {
  maxHp: 65, attack: 13, range: 3, speed: 1.0, foodUpkeep: 1, gunUpkeep: 0, gunL2Upkeep: 2,
};

/** Short UI labels for arms tiers (units). */
export const ARMS_TIER_LABELS: Record<1 | 2 | 3, string> = {
  1: 'Standard',
  2: 'Stone-forged',
  3: 'Iron-forged',
};

/** Theme A — display names by tier (excludes L3 ranged; use variant + {@link getUnitDisplayName}). */
export const UNIT_DISPLAY_BY_ARMS: Partial<Record<UnitType, Record<1 | 2 | 3, string>>> = {
  infantry: { 1: 'Infantry', 2: 'Man-at-Arms', 3: 'Paladin' },
  cavalry: { 1: 'Cavalry', 2: 'Lancer', 3: 'Knight' },
  ranged: { 1: 'Archer', 2: 'Skirmisher', 3: 'Archer' },
  horse_archer: { 1: 'Horse Archer', 2: 'Steppe Rider', 3: 'Keshik' },
  crusader_knight: { 1: 'Crusader', 2: 'Crusader', 3: 'Grand Crusader' },
  defender: { 1: 'Defender', 2: 'Defender', 3: 'Warden' },
};

/**
 * Player-facing unit name (Theme A + L3 ranged variants).
 * Naval types ignore arms tier.
 */
export function getUnitDisplayName(
  type: UnitType,
  armsLevel?: 1 | 2 | 3,
  rangedVariant?: RangedVariant,
): string {
  if (isNavalUnitType(type)) return UNIT_DISPLAY_NAMES[type];
  const al = armsLevel ?? 1;
  if (type === 'ranged' && al === 3) {
    if (rangedVariant === 'longbowman') return 'Longbowman';
    return 'Marksman';
  }
  if (type === 'crusader_knight') return UNIT_DISPLAY_BY_ARMS.crusader_knight?.[3] ?? UNIT_DISPLAY_NAMES.crusader_knight;
  if (type === 'defender') return UNIT_DISPLAY_BY_ARMS.defender?.[3] ?? UNIT_DISPLAY_NAMES.defender;
  const row = UNIT_DISPLAY_BY_ARMS[type];
  if (row && row[al]) return row[al];
  return UNIT_DISPLAY_NAMES[type];
}

/** Old saves: L3 barracks but no doctrine field → default marksman so recruitment works. */
export function migrateLegacyArcherDoctrine(cities: City[]): City[] {
  return cities.map(c => {
    const hasL3 = c.buildings.some(b => b.type === 'barracks' && (b.level ?? 1) >= 3);
    if (hasL3 && c.archerDoctrineL3 === undefined) {
      return { ...c, archerDoctrineL3: 'marksman' };
    }
    return c;
  });
}

export function cityHasL3Barracks(city: City): boolean {
  return city.buildings.some(b => b.type === 'barracks' && (b.level ?? 1) >= 3);
}

/** Resolve unit stats by arms level (L1/L2/L3). Defender uses L3. Ships ignore arms tiers. */
export function getUnitStats(u: { type: UnitType; armsLevel?: 1 | 2 | 3; rangedVariant?: RangedVariant }) {
  if (isNavalUnitType(u.type)) return UNIT_BASE_STATS[u.type];
  /** Crusader knight is always treated as L3-tier stats (recruit requires L3 barracks). */
  if (u.type === 'crusader_knight') return UNIT_L3_STATS.crusader_knight;
  const level = u.armsLevel ?? 1;
  if (u.type === 'ranged' && level === 3) {
    if (u.rangedVariant === 'longbowman') return UNIT_L3_RANGED_LONGBOW;
    return UNIT_L3_RANGED_MARKSMAN;
  }
  if (level === 3) return UNIT_L3_STATS[u.type];
  if (level === 2) return UNIT_L2_STATS[u.type];
  return UNIT_BASE_STATS[u.type];
}

export const TERRAIN_FOOD_YIELD: Record<Biome, number> = {
  water: 0, plains: 1.5, forest: 0.5, mountain: 0, desert: 0.25,
};

// ─── Population Growth Constants ─────────────────────────────────
export const POP_BIRTH_RATE = 0.12;           // per-capita logistic birth rate (was 0.25; lower so AFK doesn't overshoot into starvation)
export const POP_NATURAL_DEATHS = 1;          // flat natural deaths per city per cycle
export const POP_CARRYING_CAPACITY_PER_FOOD = 4;  // K = foodProduced * this
/** Smoothing for expected K (0.25 ≈ 2–4 cycle adjustment); births use expected K, not instant production */
export const POP_EXPECTED_K_ALPHA = 0.25;
/** Extra deaths per cycle when city has no food in storage (starvation) */
export const STARVATION_DEATHS = 2;
/**
 * Logistic births floor to 0 when P is tiny; allow 1 birth/cycle if empire grain can support it
 * (recover from collapse while farms restaff).
 */
export const POP_RECOVERY_BIRTH_MAX_P = 8;
/** Empire pooled grain must be at least this × civilian demand for that city to allow a recovery birth */
export const POP_RECOVERY_BIRTH_FOOD_MULT = 5;

export const PLAYER_COLORS = {
  human: '#55aaee',
  ai: '#ee5555',
  ai2: '#eebb44',
  ai3: '#55cc88',
  ai4: '#aa66dd',
  ai5: '#cc8866',
};

export function aiPlayerColorBySlot(slotIndex: number): string {
  const keys = ['ai', 'ai2', 'ai3', 'ai4', 'ai5'] as const;
  const k = keys[Math.min(Math.max(0, slotIndex), keys.length - 1)];
  return PLAYER_COLORS[k];
}

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
/**
 * Multiplier on time between hex steps (1 = legacy pace). Above 1 slows armies (better for multiplayer readability).
 * Applied in movement tick: moveDelay = (1000 / effectiveSpeed) * this factor.
 */
export const UNIT_MOVEMENT_DELAY_MULT = 1.7;
/**
 * Multiplier on unit-vs-unit combat damage (melee same-hex, ranged/counter, hero vs unit).
 * Tuned with {@link COMBAT_KILL_XP} and hit/glance rolls so a typical same-hex fight (e.g. 5v5 L1 infantry)
 * lasts about {@link CYCLE_INTERVAL_SEC} combat ticks on average (~1 economy cycle), giving time to react;
 * bigger engagements (multiple hexes, ranged/tower pressure, reinforcements) stack duration and often span multiple cycles.
 * Sanity-check: `npm run sim-combat-length`.
 * Does not apply to defense towers, siege vs walls, coastal bombardment, or starvation/upkeep.
 */
export const COMBAT_UNIT_DAMAGE_SCALE = 0.545;
/** XP granted to killer on unit kill in combat (kept low so brawls don’t spike level mid-fight). */
export const COMBAT_KILL_XP = 4;
/**
 * Deterministic hit model for unit-vs-unit combat (melee + Phase B). Rolls use cycle + time + ids + salt.
 * Full hit portion, then glance ({@link COMBAT_GLANCE_DAMAGE_MULT}), remainder miss.
 */
export const COMBAT_HIT_FULL_CHANCE = 0.72;
export const COMBAT_HIT_GLANCE_CHANCE = 0.18;
export const COMBAT_GLANCE_DAMAGE_MULT = 0.42;

/** Battleship shore bombardment: max hex distance from ship (on water) to aim point on land. */
export const COASTAL_BOMBARD_RANGE = 3;
/** Chance the shell centers on the aimed hex; otherwise scatters to a random adjacent land hex. */
export const COASTAL_BOMBARD_DIRECT_HIT_CHANCE = 0.38;
/** HP removed from each enemy wall section in the 7-hex splash. */
export const COASTAL_BOMBARD_WALL_DAMAGE = 3;
/** Base raw damage to land units in splash before scaling and per-target splash rolls. */
export const COASTAL_BOMBARD_UNIT_BASE = 11;
/** Splash accuracy on land units (full / glance / miss); glance uses {@link COASTAL_BOMBARD_SPLASH_GLANCE_MULT}. */
export const COASTAL_BOMBARD_SPLASH_FULL_CHANCE = 0.32;
export const COASTAL_BOMBARD_SPLASH_GLANCE_CHANCE = 0.22;
export const COASTAL_BOMBARD_SPLASH_GLANCE_MULT = 0.45;

// ─── Terrain Combat Modifiers ─────────────────────────────────────
export const TERRAIN_DEFENSE_BONUS: Partial<Record<Biome, number>> = {
  forest: 0.15,
  mountain: 0.20,
};
export const TERRAIN_RANGED_ATTACK_BONUS: Partial<Record<Biome, number>> = {
  mountain: 0.10,
};
export const TERRAIN_CAVALRY_PENALTY: Partial<Record<Biome, number>> = {
  forest: 0.10,
  mountain: 0.15,
};
/** Attacking units adjacent to water get a fording penalty. */
export const RIVER_CROSSING_ATTACK_PENALTY = 0.20;

// ─── Unit Counter Multipliers (rock-paper-scissors) ──────────────
export const COUNTER_MULTIPLIER: Partial<Record<UnitType, Partial<Record<UnitType, number>>>> = {
  cavalry:        { ranged: 1.30, horse_archer: 1.20 },
  ranged:         { infantry: 1.20, crusader_knight: 1.15 },
  infantry:       { cavalry: 1.25 },
  horse_archer:   { infantry: 1.30, ranged: 1.10 },
  crusader_knight:{ cavalry: 1.25, infantry: 1.15 },
  battering_ram:  { defender: 1.20 },
};

// ─── Morale System ────────────────────────────────────────────────
export const MORALE_MAX = 100;
export const MORALE_START = 100;
export const MORALE_ALLY_DEATH_DROP = 6;
export const MORALE_HERO_DEATH_DROP = 25;
export const MORALE_COMMANDER_DEATH_DROP = 20;
export const MORALE_KILL_BOOST = 4;
export const MORALE_COMMANDER_PRESENCE_BOOST = 2;
export const MORALE_HOME_TERRITORY_BOOST = 1;
export const MORALE_OUTNUMBER_DRAIN_PER_TICK = 1;
export const MORALE_WAVER_THRESHOLD = 30;
export const MORALE_WAVER_ATTACK_PENALTY = 0.25;
export const MORALE_ROUT_THRESHOLD = 15;

// ─── Flanking Bonus ───────────────────────────────────────────────
export const FLANK_2_HEX_BONUS = 0.15;
export const FLANK_3_HEX_BONUS = 0.25;

// ─── Stance Combat Modifiers ─────────────────────────────────────
export const STANCE_AGGRESSIVE_ATTACK_BONUS = 0.15;
export const STANCE_AGGRESSIVE_DEFENSE_PENALTY = 0.15;
export const STANCE_DEFENSIVE_DEFENSE_BONUS = 0.15;
export const STANCE_DEFENSIVE_ATTACK_PENALTY = 0.15;
export const STANCE_HOLD_DEFENSE_BONUS = 0.25;

// ─── Active Abilities ─────────────────────────────────────────────
export type AbilityId = 'shield_wall' | 'charge' | 'volley_fire' | 'barrage' | 'holy_zeal';

export const ABILITY_DEFS: Record<AbilityId, {
  label: string;
  desc: string;
  unitTypes: UnitType[];
  durationMs: number;
  cooldownMs: number;
  toggle?: boolean;
}> = {
  shield_wall: {
    label: 'Shield Wall',
    desc: '+40% defense, -50% attack, immobile',
    unitTypes: ['infantry'],
    durationMs: 0,
    cooldownMs: 0,
    toggle: true,
  },
  charge: {
    label: 'Charge',
    desc: '2x damage on first contact',
    unitTypes: ['cavalry'],
    durationMs: 1000,
    cooldownMs: 30000,
  },
  volley_fire: {
    label: 'Volley Fire',
    desc: '+50% ranged damage for 3s',
    unitTypes: ['ranged', 'horse_archer'],
    durationMs: 3000,
    cooldownMs: 20000,
  },
  barrage: {
    label: 'Barrage',
    desc: 'Area damage to all in target hex for 5s',
    unitTypes: ['trebuchet'],
    durationMs: 5000,
    cooldownMs: 60000,
  },
  holy_zeal: {
    label: 'Holy Zeal',
    desc: 'Immune to morale loss for 10s',
    unitTypes: ['crusader_knight'],
    durationMs: 10000,
    cooldownMs: 45000,
  },
};

export function getAbilityForUnit(type: UnitType): AbilityId | null {
  for (const [id, def] of Object.entries(ABILITY_DEFS)) {
    if (def.unitTypes.includes(type)) return id as AbilityId;
  }
  return null;
}

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
/** Extra hex radius from every territory hex you own (line-of-sight for enemies + terrain reveal tick). */
export const TERRITORY_BORDER_VISION_RANGE = 2;
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

/** True if any neighbor hex has the given biome. */
export function hexTouchesBiome(
  tiles: Map<string, Tile>,
  q: number,
  r: number,
  biome: Biome,
): boolean {
  return hexNeighbors(q, r).some(([nq, nr]) => tiles.get(tileKey(nq, nr))?.biome === biome);
}
