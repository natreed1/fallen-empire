'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import { useGameStore } from '@/store/useGameStore';
import { countVillagesInPlayerTerritory, isUnitInSupplyVicinityOfPlayerCities } from '@/lib/empireEconomy';
import { computeCityProductionRate, computeSawmillBuildingPreview } from '@/lib/gameLoop';
import { getWeatherHarvestMultiplier } from '@/lib/weather';
import { BUILDING_COSTS, BUILDING_PRODUCTION, BUILDING_BP_COST, BUILDING_JOBS, CITY_BUILDING_POWER, BUILDER_POWER, BP_RATE_BASE, TERRAIN_FOOD_YIELD, UNIT_COSTS, UNIT_L2_COSTS, UNIT_L3_COSTS, UNIT_BASE_STATS, UNIT_DISPLAY_NAMES, getUnitDisplayName, ARMS_TIER_LABELS, type RangedVariant, COMMANDER_TRAIT_INFO, COMMANDER_RECRUIT_GOLD, VILLAGE_INCORPORATE_COST, MARKET_GOLD_PER_CYCLE, MARKET_GOLD_PER_VILLAGE, POPULATION_TAX_GOLD_MULT, SCOUT_MISSION_COST, WEATHER_DISPLAY, BARACKS_UPGRADE_COST, BARACKS_L3_UPGRADE_COST, FACTORY_UPGRADE_COST, FARM_UPGRADE_COST, RESOURCE_MINE_UPGRADE_COST, FARM_L2_FOOD_PER_CYCLE, WALL_SECTION_STONE_COST, WALL_BUILDER_STONE_PER_CYCLE_PER_SLOT, WORKERS_PER_LEVEL, MIN_STAFFING_RATIO, TREBUCHET_FIELD_BP_COST, TREBUCHET_FIELD_GOLD_COST, TREBUCHET_REFINED_WOOD_COST, SAWMILL_WOOD_PER_REFINED, getBuildingJobs, getUnitStats, BuildingType, UnitType, ArmyStance, Biome, hexDistance, getHexRing, tileKey, POP_BIRTH_RATE, POP_NATURAL_DEATHS, POP_CARRYING_CAPACITY_PER_FOOD, POP_EXPECTED_K_ALPHA, STARVATION_DEATHS, SHIP_RECRUIT_COSTS, isNavalUnitType, getShipMaxCargo, hexTouchesBiome, AttackCityStyle, DefenseTowerType, DefenseTowerLevel, DEFENSE_TOWER_LEVEL_COSTS, DEFENSE_TOWER_MAX_PER_CITY, DEFENSE_TOWER_DISPLAY_NAME, defenseInstallationCurrentHp, defenseInstallationMaxHp, City, CONTESTED_ZONE_GOLD_REWARD, CONTESTED_ZONE_IRON_REWARD, KingdomId, KINGDOM_IDS, KINGDOM_DISPLAY_NAMES, KINGDOM_SETUP_ICONS, SCROLL_DISPLAY_NAME, scrollItemDisplayName, SCROLL_RELIC_LORE, SCROLL_REGION_ITEM_NAME, SPECIAL_REGION_DISPLAY_NAME, SPECIAL_REGION_OVERLAY_COLORS, SCROLL_COMBAT_BONUS, SCROLL_DEFENSE_BONUS, SCROLL_MOVEMENT_BONUS, SCROLL_ARMY_SLOT_ORDER, SCROLL_SLOT_LABEL, MAP_SIZE_PRESETS, type MapSizePreset, type MapTerrainPreset, type ScrollKind, type SpecialRegionKind, type ScrollAttachment, type ScrollItem, type Commander, UNIVERSITY_UPGRADE_COSTS, BUILDER_TASK_LABELS, type BuilderTask, type ArmyMarchSpreadMode, DEFAULT_BUILDER_TASK, ABILITY_DEFS,   getAbilityForUnit, TERRITORY_RADIUS, GARRISON_PATROL_RADIUS_MIN, GARRISON_PATROL_RADIUS_MAX, defaultCityBuildingMaxHp, RUINS_REPAIR_GOLD_RATIO, isCityBuildingOperational, EMPTY_MAP_QUADRANTS, TRADE_MAP_QUADRANT_GOLD, TRADE_MAP_FULL_ATLAS_GOLD, TRADE_RESOURCE_PACK_GOLD, TRADE_MORALE_FESTIVAL_GOLD, TRADE_MORALE_FESTIVAL_DELTA, TRADE_ROYAL_SURVEY_GOLD, MAP_QUADRANT_LABELS, type MapQuadrantId, SOCIAL_BAR_BUILD_GOLD, SOCIAL_BAR_BP, SOCIAL_BAR_UPGRADE_COSTS, SOCIAL_BAR_BIRTH_MULT_PER_LEVEL, isFarmBuildingType, isValidFarmPlacementBiome, type CouncilPostId, COUNCIL_POST_INFO, COUNCIL_POST_IDS, POLITICIAN_TRAIT_INFO, type PoliticianTraitId, type Politician, type TechId, TECH_TREE, TECH_IDS, STARTING_TECHS, EDUCATION_UPGRADE_COSTS, UNIVERSITY_BUILDING_UPGRADE_COSTS, UNIVERSITY_SPECIALIZATION_INFO, type UniversitySpecialization } from '@/types/game';
import { getAvailableTechs } from '@/lib/researchTick';
import { computeCouncilBoosts, isAssignedToCouncil, getCouncilAppointment } from '@/lib/nationalCouncil';
import {
  battleClusterContainingHex,
  clusterHumanBattleEngagements,
  humanBattleHexKeysFlat,
  likelyWinnerForHumanBattle,
} from '@/lib/battlePreview';
import {
  computeConstructionAvailableBp,
  computeRoadAvailableBp,
  getUniversityBuilderSlots,
  getUniversitySlotTasks,
  universityTaskMatchesSiteType,
} from '@/lib/builders';
import { countLandMilitaryByType, TACTICAL_FILTER_LAND_TYPES, unitIdsMatchingTypes } from '@/lib/siege';
import type { SiegeTacticId } from '@/lib/siegeTactics';
import { SIEGE_TACTIC_META, buildWaveGroupsFromTactic } from '@/lib/siegeTactics';
import { findCityForRefinedWoodSpend } from '@/lib/territory';
import { countDefensesTaskSlots } from '@/lib/wallBuilding';
import Image from 'next/image';
import Link from 'next/link';
import { BuilderCottagePanel } from '@/components/ui/panelThemes/BuilderCottagePanel';
import { MapRoomPanel } from '@/components/ui/panelThemes/MapRoomPanel';

function scrollAttachmentLabel(att: Pick<ScrollAttachment, 'kind' | 'sourceRegion'>): string {
  if (att.sourceRegion) return SCROLL_REGION_ITEM_NAME[att.sourceRegion];
  return SCROLL_DISPLAY_NAME[att.kind];
}

/** Compact scroll slots beside commander — attached (filled) + inventory (dashed). */
function FieldCommandScrollBoxes({
  inventory,
  attachments,
  onAssignFromInventory,
  onReturnAttachment,
}: {
  inventory: ScrollItem[];
  attachments: ScrollAttachment[];
  onAssignFromInventory: (scrollItemId: string) => void;
  onReturnAttachment: (carrierUnitId: string) => void;
}) {
  if (inventory.length === 0 && attachments.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5 min-w-0 max-w-[14rem]">
      <span className="text-[8px] uppercase tracking-wide text-amber-300/55">Scrolls</span>
      <div className="flex flex-wrap gap-1 items-center">
        {attachments.map(att => (
          <button
            key={att.id}
            type="button"
            title={`${scrollAttachmentLabel(att)} — return to inventory`}
            onClick={e => {
              e.stopPropagation();
              onReturnAttachment(att.carrierUnitId);
            }}
            className="w-9 h-9 rounded border border-amber-500/55 bg-amber-950/45 text-amber-100 text-[8px] font-medium leading-tight px-0.5 hover:bg-amber-900/50 flex items-center justify-center text-center"
          >
            {scrollAttachmentLabel(att).slice(0, 4)}
          </button>
        ))}
        {inventory.map(si => (
          <button
            key={si.id}
            type="button"
            title={`Assign ${scrollItemDisplayName(si)}`}
            onClick={e => {
              e.stopPropagation();
              onAssignFromInventory(si.id);
            }}
            className="w-9 h-9 rounded border border-dashed border-amber-600/50 bg-black/35 text-amber-100/95 text-[7px] leading-tight px-0.5 hover:border-amber-400/60 hover:bg-amber-950/30 flex items-center justify-center text-center line-clamp-2"
          >
            {scrollItemDisplayName(si).slice(0, 8)}
          </button>
        ))}
      </div>
    </div>
  );
}

function canAffordDefenseHud(gold: number, city: City | undefined, level: DefenseTowerLevel): boolean {
  if (!city) return false;
  const c = DEFENSE_TOWER_LEVEL_COSTS[level];
  if (gold < c.gold) return false;
  if ((c.wood ?? 0) > (city.storage.wood ?? 0)) return false;
  if ((c.stone ?? 0) > (city.storage.stone ?? 0)) return false;
  if ((c.iron ?? 0) > (city.storage.iron ?? 0)) return false;
  return true;
}

function formatDefenseLevelCost(level: DefenseTowerLevel): string {
  const c = DEFENSE_TOWER_LEVEL_COSTS[level];
  const parts: string[] = [`${c.gold}g`];
  if (c.wood) parts.push(`${c.wood} wood`);
  if (c.stone) parts.push(`${c.stone} stone`);
  if (c.iron) parts.push(`${c.iron} iron`);
  return parts.join(' · ');
}

export default function GameHUD() {
  const phase = useGameStore(s => s.phase);
  const searchParams = useSearchParams();
  const mpLobby = searchParams.get('mp') != null && searchParams.get('room') != null;
  return (
    <div className="absolute inset-0 pointer-events-none z-10">
      {phase === 'setup' && !mpLobby && <SetupScreen />}
      {phase === 'place_city' && <PlaceCityOverlay />}
      {(phase === 'playing' || phase === 'starting_game') && <PlayingHUD />}
      {phase === 'victory' && <VictoryScreen />}
    </div>
  );
}

// ─── Multiplayer lobby (menu) ─────────────────────────────────────

function MultiplayerOnlinePanel({ onBack }: { onBack: () => void }) {
  const router = useRouter();
  const [createdRoomId, setCreatedRoomId] = useState<string | null>(null);
  const [joinRoomId, setJoinRoomId] = useState('');
  const [copied, setCopied] = useState(false);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const inviteLink =
    createdRoomId != null ? `${origin}/?mp=join&room=${encodeURIComponent(createdRoomId)}` : '';
  const hostLink =
    createdRoomId != null ? `${origin}/?mp=host&room=${encodeURIComponent(createdRoomId)}` : '';

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-md pointer-events-auto">
      <div className="medieval-frame max-w-lg w-full">
        <div className="absolute -top-3 -left-3 text-xl text-amber-400/80 z-10 medieval-shimmer">⚜</div>
        <div className="absolute -top-3 -right-3 text-xl text-amber-400/80 z-10 medieval-shimmer">⚜</div>
        <div className="absolute -bottom-3 -left-3 text-xl text-amber-400/80 z-10 medieval-shimmer">⚜</div>
        <div className="absolute -bottom-3 -right-3 text-xl text-amber-400/80 z-10 medieval-shimmer">⚜</div>
        <div className="medieval-frame-inner font-medieval p-8 text-center">
          <h2 className="font-cinzel text-xl font-bold text-empire-gold tracking-wide mb-2">1v1 Online</h2>
          <div className="medieval-divider my-3">
            <span className="text-empire-gold/50 text-xs">⚜</span>
          </div>
          <p className="text-empire-parchment/65 text-sm mb-6">
            Run the game server in another terminal:{' '}
            <code className="text-empire-gold/80 text-xs">npm run game-server</code>
            <span className="block mt-1 text-empire-parchment/45 text-xs">
              Optional: set <code className="text-empire-parchment/55">NEXT_PUBLIC_MULTIPLAYER_WS_URL</code> if the
              server is not on localhost:3333.
            </span>
          </p>

          <div className="text-left space-y-6">
            <div>
              <p className="text-empire-parchment/60 text-xs uppercase tracking-wide mb-2">Host a match</p>
              {!createdRoomId ? (
                <button
                  type="button"
                  onClick={() => setCreatedRoomId(crypto.randomUUID())}
                  className="w-full px-4 py-2.5 bg-empire-gold/15 border border-empire-gold/55 rounded text-empire-gold text-sm font-semibold hover:bg-empire-gold/25"
                >
                  Create match
                </button>
              ) : (
                <div className="space-y-3">
                  <p className="text-empire-parchment/55 text-xs">Send this link to your opponent:</p>
                  <div className="flex flex-col gap-2">
                    <input
                      readOnly
                      value={inviteLink}
                      className="w-full text-[11px] leading-snug bg-black/35 border border-empire-stone/35 rounded px-2 py-2 text-empire-parchment/90"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard.writeText(inviteLink).then(() => {
                            setCopied(true);
                            setTimeout(() => setCopied(false), 2000);
                          });
                        }}
                        className="flex-1 px-3 py-2 border border-empire-gold/45 rounded text-empire-gold text-xs hover:bg-empire-gold/15"
                      >
                        {copied ? 'Copied' : 'Copy invite link'}
                      </button>
                      <button
                        type="button"
                        onClick={() => router.push(hostLink)}
                        className="flex-1 px-3 py-2 bg-empire-gold/20 border border-empire-gold/60 rounded text-empire-gold text-xs font-semibold hover:bg-empire-gold/30"
                      >
                        Enter as host
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div>
              <p className="text-empire-parchment/60 text-xs uppercase tracking-wide mb-2">Join a match</p>
              <div className="flex gap-2">
                <input
                  value={joinRoomId}
                  onChange={e => setJoinRoomId(e.target.value)}
                  placeholder="Paste room ID (UUID)"
                  className="flex-1 min-w-0 text-sm bg-black/35 border border-empire-stone/35 rounded px-3 py-2 text-empire-parchment placeholder:text-empire-parchment/35"
                />
                <button
                  type="button"
                  disabled={!joinRoomId.trim()}
                  onClick={() => {
                    const id = joinRoomId.trim();
                    if (!id) return;
                    router.push(`/?mp=join&room=${encodeURIComponent(id)}`);
                  }}
                  className="shrink-0 px-4 py-2 border border-empire-stone/45 rounded text-empire-parchment/90 text-sm disabled:opacity-40 hover:bg-empire-gold/10"
                >
                  Join
                </button>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onBack}
            className="mt-8 text-empire-parchment/50 text-sm hover:text-empire-parchment/80"
          >
            ← Back
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Setup ─────────────────────────────────────────────────────────

function SetupScreen() {
  const generateWorld = useGameStore(s => s.generateWorld);
  const isGenerated = useGameStore(s => s.isGenerated);
  const startPlacement = useGameStore(s => s.startPlacement);
  const startBattleTest = useGameStore(s => s.startBattleTest);
  const startSpectateMatch = useGameStore(s => s.startSpectateMatch);
  const selectedKingdom = useGameStore(s => s.selectedKingdom);
  const setSelectedKingdom = useGameStore(s => s.setSelectedKingdom);

  const [menuStep, setMenuStep] = useState<'root' | 'play_setup' | 'spectate_setup' | 'multiplayer_lobby'>('root');
  const [mapSize, setMapSize] = useState<MapSizePreset>('normal');
  const [mapTerrain, setMapTerrain] = useState<MapTerrainPreset>('continents');
  const [opponents, setOpponents] = useState(1);

  useEffect(() => {
    if (!isGenerated) {
      generateWorld({ width: 38, height: 38, mapTerrain: 'continents' });
    }
  }, [isGenerated, generateWorld]);

  const dim = MAP_SIZE_PRESETS[mapSize];

  const beginMatch = (mode: 'play' | 'spectate') => {
    const seed = Math.floor(Math.random() * 0x7fffffff);
    generateWorld({
      width: dim.width,
      height: dim.height,
      seed,
      ensureCornerLand: opponents >= 2,
      mapTerrain,
    });
    if (mode === 'play') {
      startPlacement({ opponentCount: opponents });
    } else {
      startSpectateMatch({ opponentCount: opponents });
    }
  };

  if (menuStep === 'multiplayer_lobby') {
    return <MultiplayerOnlinePanel onBack={() => setMenuStep('root')} />;
  }

  if (menuStep === 'root') {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-md pointer-events-auto">
        <div className="medieval-frame">
          <div className="absolute -top-3 -left-3 text-xl text-amber-400/80 z-10 medieval-shimmer">⚜</div>
          <div className="absolute -top-3 -right-3 text-xl text-amber-400/80 z-10 medieval-shimmer">⚜</div>
          <div className="absolute -bottom-3 -left-3 text-xl text-amber-400/80 z-10 medieval-shimmer">⚜</div>
          <div className="absolute -bottom-3 -right-3 text-xl text-amber-400/80 z-10 medieval-shimmer">⚜</div>
          <div className="medieval-frame-inner font-medieval px-10 py-10 text-center max-w-lg">
            <h1 className="font-cinzel medieval-title text-4xl font-bold tracking-[0.2em] mb-2 drop-shadow-[0_0_12px_rgba(201,168,76,0.35)]">
              FALLEN EMPIRE
            </h1>
            <div className="medieval-divider my-4">
              <span className="text-empire-gold/60 text-sm">⚜</span>
            </div>
            <p className="text-empire-parchment/70 mb-8 text-lg leading-relaxed italic">
              The old empire has crumbled. Rebuild — or be conquered.
            </p>
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => setMenuStep('play_setup')}
                className="px-8 py-3 bg-empire-gold/15 border-2 border-empire-gold/60 rounded text-empire-gold font-bold text-lg tracking-wide hover:bg-empire-gold/25 hover:border-empire-gold/80 hover:shadow-[0_0_20px_rgba(201,168,76,0.2)] transition-all duration-300"
              >
                Play
              </button>
              <button
                type="button"
                onClick={() => setMenuStep('multiplayer_lobby')}
                className="px-8 py-3 bg-transparent border-2 border-violet-400/50 rounded text-violet-100 text-lg font-semibold tracking-wide hover:bg-violet-950/40 hover:border-violet-300/70 transition-all duration-300"
              >
                1v1 Online
              </button>
              <p className="text-empire-parchment/45 text-xs -mt-1 mb-0">
                Multiplayer vs a friend — requires the game server (see screen after click).
              </p>
              <button
                type="button"
                onClick={() => setMenuStep('spectate_setup')}
                className="px-8 py-3 bg-transparent border border-empire-gold/30 rounded text-empire-parchment/80 text-lg tracking-wide hover:bg-empire-gold/10 hover:border-empire-gold/50 transition-all duration-300"
              >
                Spectate
              </button>
              <button
                type="button"
                onClick={() => startBattleTest()}
                className="px-8 py-2.5 bg-transparent border border-sky-500/35 rounded text-sky-200/90 text-sm tracking-wide hover:bg-sky-950/40 hover:border-sky-400/50 transition-all duration-300"
              >
                Battle test (10v10)
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isPlay = menuStep === 'play_setup';

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-md pointer-events-auto">
      <div className="medieval-frame max-w-lg w-full">
        <div className="absolute -top-3 -left-3 text-xl text-amber-400/80 z-10 medieval-shimmer">⚜</div>
        <div className="absolute -top-3 -right-3 text-xl text-amber-400/80 z-10 medieval-shimmer">⚜</div>
        <div className="absolute -bottom-3 -left-3 text-xl text-amber-400/80 z-10 medieval-shimmer">⚜</div>
        <div className="absolute -bottom-3 -right-3 text-xl text-amber-400/80 z-10 medieval-shimmer">⚜</div>
        <div className="medieval-frame-inner font-medieval p-8 text-center max-h-[min(90vh,640px)] overflow-y-auto medieval-scroll">
          <h2 className="font-cinzel text-xl font-bold text-empire-gold tracking-wide mb-1">
            {isPlay ? 'New Game' : 'Spectate'}
          </h2>
          <div className="medieval-divider my-3">
            <span className="text-empire-gold/50 text-xs">⚜</span>
          </div>
          <p className="text-empire-parchment/60 text-sm mb-4 italic">
            {isPlay
              ? 'Choose map size and how many AI rivals to face (you + rivals).'
              : `Watch ${opponents + 1} AI empires (${opponents} rival slots — same total as Play).`}
          </p>

        <div className="text-left space-y-4 mb-4">
          <div>
            <p className="text-empire-parchment/60 text-xs uppercase tracking-wide mb-2">Map size</p>
            <div className="flex flex-wrap gap-2">
              {(['small', 'normal', 'large'] as const).map(preset => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setMapSize(preset)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border capitalize ${
                    mapSize === preset
                      ? 'border-empire-gold bg-empire-gold/15 text-empire-gold'
                      : 'border-empire-stone/40 text-empire-parchment/75 hover:border-empire-gold/40'
                  }`}
                >
                  {preset}{' '}
                  <span className="text-empire-parchment/45">
                    ({MAP_SIZE_PRESETS[preset].width}×{MAP_SIZE_PRESETS[preset].height})
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-empire-parchment/60 text-xs uppercase tracking-wide mb-2">Map type</p>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { id: 'continents' as const, label: 'Continents', hint: 'Default coastlines' },
                  { id: 'islands' as const, label: 'Islands', hint: 'Archipelago — mostly ocean' },
                  { id: 'lake' as const, label: 'Lake', hint: 'Big central sea' },
                  { id: 'no_water' as const, label: 'No water', hint: 'Dry land only' },
                ] as const
              ).map(({ id, label, hint }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMapTerrain(id)}
                  className={`px-3 py-2 rounded-lg text-left text-xs border transition-colors ${
                    mapTerrain === id
                      ? 'border-empire-gold bg-empire-gold/15 text-empire-gold'
                      : 'border-empire-stone/40 text-empire-parchment/80 hover:border-empire-gold/40'
                  }`}
                >
                  <span className="font-semibold block">{label}</span>
                  <span className="text-empire-parchment/45 text-[10px]">{hint}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-empire-parchment/60 text-xs uppercase tracking-wide mb-2">Opponents (1–5)</p>
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={opponents}
              onChange={e => setOpponents(Number(e.target.value))}
              className="w-full accent-empire-gold"
            />
            <p className="text-empire-parchment/70 text-sm mt-1">
              {isPlay ? `You vs ${opponents} AI` : `${opponents + 1} AI empires`}
            </p>
          </div>
        </div>

        {isPlay && (
          <>
            <p className="text-empire-parchment/60 text-xs uppercase tracking-wide mb-2">Choose your kingdom</p>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {KINGDOM_IDS.map((id: KingdomId) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSelectedKingdom(id)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                    selectedKingdom === id
                      ? 'border-empire-gold bg-empire-gold/20 text-empire-gold'
                      : 'border-empire-stone/40 bg-empire-dark/60 text-empire-parchment/80 hover:border-empire-gold/50'
                  }`}
                >
                  <span className="relative w-9 h-9 shrink-0 rounded border border-empire-stone/35 bg-black/35 overflow-hidden flex items-center justify-center">
                    <Image
                      src={KINGDOM_SETUP_ICONS[id]}
                      alt=""
                      width={36}
                      height={36}
                      className="object-contain"
                      style={{ imageRendering: 'pixelated' }}
                    />
                  </span>
                  <span className="text-left leading-tight">{KINGDOM_DISPLAY_NAMES[id]}</span>
                </button>
              ))}
            </div>
          </>
        )}

        <div className="flex flex-col gap-2 mt-2">
          <button
            type="button"
            onClick={() => beginMatch(isPlay ? 'play' : 'spectate')}
            className="px-8 py-3 bg-empire-gold/15 border-2 border-empire-gold/60 rounded text-empire-gold font-bold text-base tracking-wide hover:bg-empire-gold/25 hover:border-empire-gold/80 hover:shadow-[0_0_20px_rgba(201,168,76,0.2)] transition-all duration-300"
          >
            {isPlay ? 'Start game' : 'Start spectating'}
          </button>
          <button
            type="button"
            onClick={() => setMenuStep('root')}
            className="px-8 py-2 text-empire-parchment/60 text-sm hover:text-empire-parchment/90 transition-colors"
          >
            ← Back
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}

function PlaceCityOverlay() {
  const pendingCityHex = useGameStore(s => s.pendingCityHex);
  const gameMode = useGameStore(s => s.gameMode);
  const confirmCityPlacement = useGameStore(s => s.confirmCityPlacement);
  const cancelCityPlacement = useGameStore(s => s.cancelCityPlacement);
  const getTile = useGameStore(s => s.getTile);
  const soloPlacement = gameMode === 'human_solo';

  if (pendingCityHex) {
    const tile = getTile(pendingCityHex.q, pendingCityHex.r);
    const biomeName = tile ? tile.biome.charAt(0).toUpperCase() + tile.biome.slice(1) : 'Unknown';
    return (
      <div className="absolute top-8 left-1/2 -translate-x-1/2 pointer-events-auto">
        <div className="bg-empire-dark/95 border border-empire-gold/50 rounded-lg px-8 py-4 text-center shadow-xl">
          <p className="text-empire-gold font-bold tracking-wide text-lg">CONFIRM CAPITAL LOCATION?</p>
          <p className="text-empire-parchment/60 text-sm mt-1 mb-1">
            Hex ({pendingCityHex.q}, {pendingCityHex.r}) &mdash; {biomeName}
          </p>
          <p className="text-empire-parchment/40 text-xs mb-4">
            The rest of the map will be hidden until your units explore it.
            {soloPlacement && (
              <span className="block mt-2 text-emerald-400/80">
                Inert enemy capital is placed opposite you for siege practice — it will not build, recruit, or act.
              </span>
            )}
          </p>
          <div className="flex gap-4 justify-center">
            <button
              onClick={confirmCityPlacement}
              className="px-6 py-2 bg-green-700/60 border border-green-500/70 rounded-lg text-green-200 font-bold tracking-wide hover:bg-green-600/70 transition-colors"
            >
              CONFIRM
            </button>
            <button
              onClick={cancelCityPlacement}
              className="px-6 py-2 bg-red-900/40 border border-red-500/50 rounded-lg text-red-300 font-bold tracking-wide hover:bg-red-800/50 transition-colors"
            >
              CANCEL
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute top-8 left-1/2 -translate-x-1/2 pointer-events-none">
      <div className="bg-empire-dark/90 border border-empire-gold/40 rounded-lg px-6 py-3 text-center animate-pulse">
        <p className="text-empire-gold font-bold tracking-wide">CHOOSE YOUR STARTING LOCATION</p>
        <p className="text-empire-parchment/50 text-sm mt-1">
          Click a valid land hex — not special terrain, province centers, ruins, or ancient sites.
        </p>
        {soloPlacement && (
          <p className="text-emerald-400/70 text-xs mt-2">Mechanics test — inert enemy capital for attacks only.</p>
        )}
      </div>
    </div>
  );
}

function VictoryScreen() {
  const notifications = useGameStore(s => s.notifications);
  const last = notifications[notifications.length - 1];
  const isWin = last?.type === 'success';
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/70 pointer-events-auto">
      <div className="bg-empire-dark border border-empire-gold/40 rounded-xl p-8 text-center max-w-md">
        <h1 className={`text-4xl font-bold tracking-widest mb-4 ${isWin ? 'text-empire-gold' : 'text-red-400'}`}>
          {isWin ? 'VICTORY' : 'DEFEAT'}
        </h1>
        <p className="text-empire-parchment/70 mb-6">{last?.message ?? 'The game is over.'}</p>
        <button onClick={() => window.location.reload()}
          className="px-8 py-3 bg-empire-gold/20 border border-empire-gold/60 rounded-lg text-empire-gold font-bold hover:bg-empire-gold/30 transition-colors">
          PLAY AGAIN
        </button>
      </div>
    </div>
  );
}

// ─── Playing HUD ───────────────────────────────────────────────────

function ArcherDoctrineModal() {
  const cityId = useGameStore(s => s.archerDoctrineModalCityId);
  const cities = useGameStore(s => s.cities);
  const setDoctrine = useGameStore(s => s.setCityArcherDoctrineL3);
  if (!cityId) return null;
  const city = cities.find(c => c.id === cityId);
  if (!city) return null;
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/65 pointer-events-auto">
      <div className="bg-empire-dark/95 border border-amber-500/50 rounded-xl p-5 max-w-md w-full mx-4 shadow-2xl">
        <h3 className="text-amber-200 font-bold text-sm mb-2">Archer doctrine — {city.name}</h3>
        <p className="text-empire-parchment/75 text-xs mb-4">
          Choose once (locked for this city):{' '}
          <span className="text-cyan-200">Marksman</span> — range 1, high attack;{' '}
          <span className="text-amber-200">Longbowman</span> — range 3, lower attack.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            className="flex-1 py-2 rounded bg-cyan-900/50 border border-cyan-500/40 text-cyan-100 text-xs font-bold hover:bg-cyan-800/50"
            onClick={() => setDoctrine(cityId, 'marksman')}
          >
            Marksman
          </button>
          <button
            type="button"
            className="flex-1 py-2 rounded bg-amber-900/50 border border-amber-500/40 text-amber-100 text-xs font-bold hover:bg-amber-800/50"
            onClick={() => setDoctrine(cityId, 'longbowman')}
          >
            Longbowman
          </button>
        </div>
      </div>
    </div>
  );
}

function BattleTestTopBar() {
  const exitBattleTestToMenu = useGameStore(s => s.exitBattleTestToMenu);
  return (
    <div className="fixed top-0 left-0 right-0 z-40 pointer-events-auto flex items-center justify-between gap-3 px-4 py-2 bg-empire-dark/92 border-b border-red-500/45">
      <p className="text-empire-parchment/90 text-sm min-w-0">
        <span className="text-red-400 font-bold">Battle test</span>
        <span className="text-empire-parchment/55 ml-2 hidden sm:inline">
          10× L1 infantry vs 10× on one hex · movement & combat only (no economy)
        </span>
      </p>
      <button
        type="button"
        onClick={() => exitBattleTestToMenu()}
        className="shrink-0 text-xs px-3 py-1.5 rounded border border-empire-stone/50 text-empire-parchment/85 hover:bg-empire-stone/15"
      >
        Exit to menu
      </button>
    </div>
  );
}

function PlayingHUD() {
  const gameMode = useGameStore(s => s.gameMode);
  const pendingTacticalOrders = useGameStore(s => s.pendingTacticalOrders);
  const tacticalAttackCityDraft = useGameStore(s => s.tacticalAttackCityDraft);
  const migrateLegacyArcherDoctrineIfNeeded = useGameStore(s => s.migrateLegacyArcherDoctrineIfNeeded);
  useEffect(() => {
    migrateLegacyArcherDoctrineIfNeeded();
  }, [migrateLegacyArcherDoctrineIfNeeded]);

  if (gameMode === 'battle_test') {
    return (
      <>
        <BattleTestTopBar />
        <SidePanel />
        <MoveConfirmPopup />
        <CombatHud />
        <div className="fixed bottom-4 left-2 z-30 flex flex-col-reverse gap-2 items-start max-w-[min(20rem,calc(100vw-1rem))] pointer-events-none">
          <div className="pointer-events-auto w-56 min-w-0">
            <NotificationLog />
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <ArcherDoctrineModal />
      <TopBar />
      <WeatherOverlay />
      <CityModal />
      <SidePanel />
      {pendingTacticalOrders !== null && <TacticalBottomBar />}
      {tacticalAttackCityDraft !== null && <AttackCitySetupModal />}
      <div className="fixed bottom-4 left-2 z-30 flex flex-col-reverse gap-2 items-start max-w-[min(20rem,calc(100vw-1rem))] pointer-events-none">
        <div className="pointer-events-auto w-56 min-w-0">
          <BuilderActivityPanel />
        </div>
        <NotificationLog />
      </div>
      <DefensePlacementOverlay />
      <SiegeProgressPanel />
      <SupplyClusterSidePanel />
      <SupplyViewPanel />
      <MoveConfirmPopup />
      <CombatHud />
      <ScrollSearchPromptModal />
      <SpecialRegionSearchGuideModal />
      <ScrollRelicPickupModal />
      <CivilianPanel />
    </>
  );
}

// ─── Civilian Panel (National Council + Education + Research) ──────

function CivilianPanel() {
  const open = useGameStore(s => s.civilianPanelOpen);
  const tab = useGameStore(s => s.civilianPanelTab);
  const close = useGameStore(s => s.closeCivilianPanel);
  const setTab = useGameStore(s => s.setCivilianPanelTab);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { close(); e.preventDefault(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 pointer-events-auto"
      onClick={close}
    >
      <div
        className="bg-empire-dark/95 border border-indigo-500/40 rounded-xl shadow-2xl w-[min(44rem,calc(100vw-2rem))] max-h-[85vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-indigo-500/20">
          <h2 className="text-indigo-200 font-bold text-base tracking-wide">National Civilian Affairs</h2>
          <button type="button" onClick={close} className="text-empire-parchment/40 hover:text-empire-parchment/70 text-lg">&times;</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-indigo-500/15 px-5 pt-2 gap-1">
          {(['council', 'education', 'research'] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-xs font-semibold uppercase tracking-wide rounded-t transition-colors ${
                tab === t
                  ? 'bg-indigo-500/20 text-indigo-200 border-b-2 border-indigo-400'
                  : 'text-empire-parchment/50 hover:text-empire-parchment/75'
              }`}
            >
              {t === 'council' ? 'Council' : t === 'education' ? 'Education' : 'Research'}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 min-h-[20rem]">
          {tab === 'council' && <CouncilTab />}
          {tab === 'education' && <EducationTab />}
          {tab === 'research' && <ResearchTab />}
        </div>
      </div>
    </div>
  );
}

function CouncilTab() {
  const players = useGameStore(s => s.players);
  const commanders = useGameStore(s => s.commanders);
  const politicians = useGameStore(s => s.politicians);
  const assignToPost = useGameStore(s => s.assignToCouncilPost);
  const removePost = useGameStore(s => s.removeFromCouncilPost);

  const human = players.find(p => p.isHuman);
  if (!human) return null;

  const council = human.nationalCouncil;
  const myCommanders = commanders.filter(c => c.ownerId === human.id);
  const myPoliticians = politicians.filter(p => p.ownerId === human.id);
  const boosts = computeCouncilBoosts(council, commanders, politicians);

  return (
    <div className="space-y-4">
      <div className="bg-indigo-950/30 rounded-lg p-3 border border-indigo-500/15">
        <h3 className="text-indigo-200 font-bold text-xs uppercase tracking-wide mb-2">Council Bonuses</h3>
        <div className="grid grid-cols-5 gap-2 text-[11px]">
          {[
            { label: 'Gold', val: boosts.goldMult, color: 'text-yellow-300' },
            { label: 'Production', val: boosts.productionMult, color: 'text-green-300' },
            { label: 'Research', val: boosts.researchMult, color: 'text-cyan-300' },
            { label: 'Attack', val: boosts.attackMult, color: 'text-red-300' },
            { label: 'Defense', val: boosts.defenseMult, color: 'text-blue-300' },
          ].map(b => (
            <div key={b.label} className="text-center">
              <span className={`${b.color} font-bold`}>{b.val === 1 ? '—' : `×${b.val.toFixed(2)}`}</span>
              <div className="text-empire-parchment/40">{b.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {COUNCIL_POST_IDS.map(postId => {
          const info = COUNCIL_POST_INFO[postId];
          const appt = getCouncilAppointment(council, postId);
          const assigned = appt
            ? appt.assigneeKind === 'commander'
              ? myCommanders.find(c => c.id === appt.assigneeId)
              : myPoliticians.find(p => p.id === appt.assigneeId)
            : null;

          return (
            <div key={postId} className="bg-empire-dark/60 rounded-lg p-3 border border-empire-stone/20">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-empire-gold font-bold text-xs uppercase">{info.label}</h4>
                {assigned && (
                  <button
                    type="button"
                    onClick={() => removePost(postId)}
                    className="text-[10px] text-red-400/60 hover:text-red-400"
                  >
                    Remove
                  </button>
                )}
              </div>
              <p className="text-[10px] text-empire-parchment/45 mb-2 leading-snug">{info.desc}</p>

              {assigned ? (
                <div className="bg-indigo-950/30 rounded p-2 border border-indigo-500/15">
                  <span className="text-indigo-200 text-xs font-semibold">{assigned.name}</span>
                  <span className="text-[10px] text-empire-parchment/40 ml-1.5">
                    ({appt!.assigneeKind === 'commander' ? 'Commander' : 'Politician'})
                  </span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {appt!.assigneeKind === 'commander'
                      ? (assigned as Commander).traitIds.map(tid => (
                          <span key={tid} className="text-[9px] bg-red-900/30 text-red-300/80 px-1.5 py-0.5 rounded">
                            {COMMANDER_TRAIT_INFO[tid]?.label}
                          </span>
                        ))
                      : (assigned as Politician).traitIds.map(tid => (
                          <span key={tid} className="text-[9px] bg-indigo-900/30 text-indigo-300/80 px-1.5 py-0.5 rounded">
                            {POLITICIAN_TRAIT_INFO[tid]?.label}
                          </span>
                        ))}
                  </div>
                </div>
              ) : (
                <CouncilPostPicker
                  postId={postId}
                  commanders={myCommanders}
                  politicians={myPoliticians}
                  council={council}
                  onAssign={assignToPost}
                />
              )}
            </div>
          );
        })}
      </div>

      {myPoliticians.length === 0 && myCommanders.length === 0 && (
        <p className="text-[11px] text-empire-parchment/40 text-center py-2">
          No commanders or politicians available. Build a University in a city to generate graduates.
        </p>
      )}
    </div>
  );
}

function CouncilPostPicker({
  postId,
  commanders,
  politicians,
  council,
  onAssign,
}: {
  postId: CouncilPostId;
  commanders: Commander[];
  politicians: Politician[];
  council: import('@/types/game').NationalCouncil | undefined;
  onAssign: (postId: CouncilPostId, assigneeId: string, kind: 'commander' | 'politician') => void;
}) {
  const [open, setOpen] = useState(false);
  const available = [
    ...commanders
      .filter(c => !isAssignedToCouncil(council, c.id))
      .map(c => ({ id: c.id, name: c.name, kind: 'commander' as const, traits: c.traitIds })),
    ...politicians
      .filter(p => !isAssignedToCouncil(council, p.id))
      .map(p => ({ id: p.id, name: p.name, kind: 'politician' as const, traits: p.traitIds })),
  ];

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full text-[10px] text-indigo-400/70 hover:text-indigo-300 border border-dashed border-indigo-500/25 rounded py-2 hover:border-indigo-500/50 transition-colors"
      >
        + Assign
      </button>
    );
  }

  if (available.length === 0) {
    return (
      <div className="text-[10px] text-empire-parchment/40 py-1">
        No available candidates.
        <button type="button" onClick={() => setOpen(false)} className="ml-2 text-indigo-400/60 hover:text-indigo-400 underline">Close</button>
      </div>
    );
  }

  return (
    <div className="space-y-1 max-h-28 overflow-y-auto">
      {available.map(a => (
        <button
          key={a.id}
          type="button"
          onClick={() => { onAssign(postId, a.id, a.kind); setOpen(false); }}
          className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded text-[10px] border border-transparent hover:border-indigo-500/30 hover:bg-indigo-950/30 transition-colors"
        >
          <span className={`font-semibold ${a.kind === 'commander' ? 'text-red-300' : 'text-indigo-300'}`}>
            {a.name}
          </span>
          <span className="text-empire-parchment/35">
            {a.kind === 'commander' ? 'Cmdr' : 'Pol'}
          </span>
        </button>
      ))}
      <button type="button" onClick={() => setOpen(false)} className="text-[10px] text-empire-parchment/40 hover:text-empire-parchment/60 w-full text-center py-0.5">
        Cancel
      </button>
    </div>
  );
}

function EducationTab() {
  const players = useGameStore(s => s.players);
  const cities = useGameStore(s => s.cities);
  const upgradeEducation = useGameStore(s => s.upgradeEducation);

  const human = players.find(p => p.isHuman);
  if (!human) return null;

  const edu = human.education ?? { level: 1, literacy: 0 };
  const canUpgrade = edu.level < 5;
  const costIdx = edu.level - 1;
  const upgradeCost = canUpgrade && costIdx >= 0 && costIdx < EDUCATION_UPGRADE_COSTS.length
    ? EDUCATION_UPGRADE_COSTS[costIdx]
    : null;
  const canAfford = upgradeCost !== null && human.gold >= upgradeCost;

  const universityCount = cities
    .filter(c => c.ownerId === human.id)
    .reduce((acc, c) => acc + c.buildings.filter(b => b.type === 'university').length, 0);

  const totalUniLevel = cities
    .filter(c => c.ownerId === human.id)
    .reduce((acc, c) => acc + c.buildings.filter(b => b.type === 'university').reduce((s, b) => s + (b.level ?? 1), 0), 0);

  return (
    <div className="space-y-4">
      <div className="bg-indigo-950/30 rounded-lg p-4 border border-indigo-500/15">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-indigo-200 font-bold text-sm">National Education</h3>
          <span className="text-empire-gold font-bold text-sm">Level {edu.level}</span>
        </div>

        <div className="mb-3">
          <div className="flex items-center justify-between text-[11px] mb-1">
            <span className="text-empire-parchment/60">Literacy</span>
            <span className="text-cyan-300 font-semibold">{edu.literacy.toFixed(1)} / 100</span>
          </div>
          <div className="w-full h-2.5 bg-empire-stone/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-indigo-600 to-cyan-400 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, edu.literacy)}%` }}
            />
          </div>
          <p className="text-[10px] text-empire-parchment/40 mt-1">
            Literacy drives technology research speed. Universities and education level increase literacy each cycle.
          </p>
        </div>

        {canUpgrade && upgradeCost !== null && (
          <button
            type="button"
            onClick={upgradeEducation}
            disabled={!canAfford}
            className={`w-full px-3 py-2 text-xs font-semibold rounded border transition-colors ${
              canAfford
                ? 'border-empire-gold/50 text-empire-gold hover:bg-empire-gold/10'
                : 'border-empire-stone/20 text-empire-parchment/30 cursor-not-allowed'
            }`}
          >
            Upgrade Education to L{edu.level + 1} — {upgradeCost}g
          </button>
        )}
        {edu.level >= 5 && (
          <div className="text-[11px] text-green-400/80 text-center py-1">Education at maximum level.</div>
        )}
      </div>

      <div className="bg-empire-dark/60 rounded-lg p-3 border border-empire-stone/15">
        <h4 className="text-empire-parchment/70 font-bold text-xs uppercase mb-2">Universities</h4>
        {universityCount === 0 ? (
          <p className="text-[11px] text-empire-parchment/40">
            No universities built yet. Build one in a city to boost education and generate commanders & politicians.
          </p>
        ) : (
          <div className="text-[11px] text-empire-parchment/60">
            <span className="text-indigo-300 font-semibold">{universityCount}</span> universit{universityCount === 1 ? 'y' : 'ies'} across your empire
            (total levels: {totalUniLevel}).
          </div>
        )}
      </div>
    </div>
  );
}

interface TechTreeNode {
  id: TechId;
  children: TechTreeNode[];
}

interface TechBranch {
  name: string;
  icon: string;
  root: TechTreeNode;
}

const TECH_BRANCHES: TechBranch[] = [
  {
    name: 'Agriculture',
    icon: '🌾',
    root: {
      id: 'agriculture_1',
      children: [{ id: 'agriculture_2', children: [] }],
    },
  },
  {
    name: 'Mining & Industry',
    icon: '⛏️',
    root: {
      id: 'mining_1',
      children: [
        {
          id: 'mining_2',
          children: [
            {
              id: 'iron_working',
              children: [
                { id: 'advanced_metallurgy', children: [] },
              ],
            },
          ],
        },
        {
          id: 'masonry_1',
          children: [
            { id: 'advanced_construction', children: [] },
          ],
        },
      ],
    },
  },
  {
    name: 'Forestry & Naval',
    icon: '🌲',
    root: {
      id: 'forestry_1',
      children: [
        {
          id: 'naval_technology',
          children: [{ id: 'advanced_naval', children: [] }],
        },
      ],
    },
  },
  {
    name: 'Military',
    icon: '⚔️',
    root: {
      id: 'military_tactics_1',
      children: [
        {
          id: 'military_tactics_2',
          children: [
            { id: 'gunpowder', children: [] },
            { id: 'siege_engineering', children: [] },
          ],
        },
      ],
    },
  },
  {
    name: 'Economics',
    icon: '💰',
    root: {
      id: 'economics_1',
      children: [{ id: 'economics_2', children: [] }],
    },
  },
];

function TechNode({
  node,
  researched,
  activeResearch,
  available,
  progress,
  startResearch,
  cancelResearch,
  depth,
}: {
  node: TechTreeNode;
  researched: Set<TechId>;
  activeResearch: TechId | null;
  available: TechId[];
  progress: number;
  startResearch: (id: TechId) => void;
  cancelResearch: () => void;
  depth: number;
}) {
  const def = TECH_TREE[node.id];
  const isResearched = researched.has(node.id);
  const isActive = activeResearch === node.id;
  const isAvailable = available.includes(node.id);
  const hasAnyPrereqResearched = def.prerequisites.length === 0 || def.prerequisites.some(p => researched.has(p));

  const isVisible = isResearched || hasAnyPrereqResearched;
  if (!isVisible) return null;

  const isLocked = !isResearched && !isActive;
  const canStart = isAvailable && !isResearched && !activeResearch;
  const missingPrereqs = def.prerequisites.filter(p => !researched.has(p));

  const visibleChildren = node.children.filter(child => {
    const cDef = TECH_TREE[child.id];
    const childHasPrereq = cDef.prerequisites.length === 0 || cDef.prerequisites.some(p => researched.has(p));
    return researched.has(child.id) || childHasPrereq;
  });

  return (
    <div className="flex flex-col items-center">
      {/* Node card */}
      <div
        className={`relative w-full max-w-[11rem] rounded-lg border transition-all duration-300 ${
          isResearched
            ? 'bg-green-950/30 border-green-500/30 shadow-[0_0_8px_rgba(34,197,94,0.12)]'
            : isActive
              ? 'bg-indigo-950/40 border-indigo-400/50 shadow-[0_0_10px_rgba(99,102,241,0.15)]'
              : canStart
                ? 'bg-empire-dark/40 border-empire-stone/20 hover:border-indigo-500/40 cursor-pointer hover:shadow-[0_0_8px_rgba(99,102,241,0.1)]'
                : 'bg-black/60 border-empire-stone/8'
        }`}
        onClick={() => { if (canStart) startResearch(node.id); }}
      >
        {isLocked && !canStart && (
          <div className="absolute inset-0 rounded-lg bg-black/50 z-10 flex items-center justify-center">
            <span className="text-empire-parchment/20 text-lg">🔒</span>
          </div>
        )}

        <div className={`p-2 ${isLocked && !canStart ? 'opacity-30' : ''}`}>
          <div className="flex items-center justify-between mb-0.5">
            <span className={`text-[11px] font-bold leading-tight ${
              isResearched ? 'text-green-300' : isActive ? 'text-indigo-300' : canStart ? 'text-empire-parchment/80' : 'text-empire-parchment/40'
            }`}>
              {def.label}
            </span>
            {isResearched && <span className="text-[8px] text-green-400/80 font-bold uppercase shrink-0 ml-1">✓</span>}
            {isActive && <span className="text-[8px] text-indigo-400/80 font-bold uppercase shrink-0 ml-1">...</span>}
          </div>

          <p className={`text-[9px] leading-snug mb-1 ${
            isResearched ? 'text-empire-parchment/50' : canStart ? 'text-empire-parchment/40' : 'text-empire-parchment/25'
          }`}>{def.desc}</p>

          {isActive && (
            <div className="mb-1">
              <div className="flex items-center justify-between text-[9px] mb-0.5">
                <span className="text-empire-parchment/50">Progress</span>
                <span className="text-cyan-300 font-semibold">{progress.toFixed(0)}/{def.researchCost}</span>
              </div>
              <div className="w-full h-1.5 bg-empire-stone/20 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-indigo-600 to-cyan-400 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, (progress / def.researchCost) * 100)}%` }}
                />
              </div>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); cancelResearch(); }}
                className="text-[8px] text-red-400/50 hover:text-red-400 mt-0.5"
              >
                Cancel
              </button>
            </div>
          )}

          {!isResearched && def.researchCost > 0 && !isActive && (
            <div className="text-[8px] text-empire-parchment/30">Cost: {def.researchCost} RP</div>
          )}

          {missingPrereqs.length > 0 && !isResearched && (
            <div className="flex flex-wrap gap-0.5 mt-0.5">
              {missingPrereqs.map(p => (
                <span key={p} className="text-[7px] px-1 py-0.5 rounded bg-red-900/20 text-red-400/50">
                  {TECH_TREE[p]?.label ?? p}
                </span>
              ))}
            </div>
          )}

          {isResearched && (def.unlocksBuildings.length > 0 || def.unlocksUnits.length > 0) && (
            <div className="text-[8px] text-empire-parchment/30 mt-0.5">
              {def.unlocksBuildings.length > 0 && <span>🏗 {def.unlocksBuildings.join(', ')}</span>}
              {def.unlocksUnits.length > 0 && <span className="ml-1">⚔ {def.unlocksUnits.map(u => UNIT_DISPLAY_NAMES[u] ?? u).join(', ')}</span>}
            </div>
          )}
        </div>
      </div>

      {/* Connector line + children */}
      {visibleChildren.length > 0 && (
        <div className="flex flex-col items-center w-full">
          <div className="w-px h-3 bg-empire-stone/20" />
          {visibleChildren.length === 1 ? (
            <TechNode
              node={visibleChildren[0]}
              researched={researched}
              activeResearch={activeResearch}
              available={available}
              progress={progress}
              startResearch={startResearch}
              cancelResearch={cancelResearch}
              depth={depth + 1}
            />
          ) : (
            <div className="relative flex gap-2 justify-center w-full">
              <div
                className="absolute top-0 h-px bg-empire-stone/20"
                style={{
                  left: `calc(50% - ${(visibleChildren.length - 1) * 50}%)`,
                  right: `calc(50% - ${(visibleChildren.length - 1) * 50}%)`,
                }}
              />
              {visibleChildren.map((child) => (
                <div key={child.id} className="flex flex-col items-center">
                  <div className="w-px h-3 bg-empire-stone/20" />
                  <TechNode
                    node={child}
                    researched={researched}
                    activeResearch={activeResearch}
                    available={available}
                    progress={progress}
                    startResearch={startResearch}
                    cancelResearch={cancelResearch}
                    depth={depth + 1}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ResearchTab() {
  const players = useGameStore(s => s.players);
  const startResearch = useGameStore(s => s.startResearch);
  const cancelResearch = useGameStore(s => s.cancelResearch);

  const human = players.find(p => p.isHuman);
  if (!human) return null;

  const researched = new Set(human.researchedTechs ?? STARTING_TECHS);
  const activeResearch = (human.activeResearch ?? null) as TechId | null;
  const progress = human.researchProgress ?? 0;
  const available = getAvailableTechs(human);

  return (
    <div className="space-y-4">
      {/* Active research summary at top */}
      {activeResearch && (
        <div className="bg-indigo-950/30 rounded-lg p-3 border border-indigo-500/15">
          <div className="flex items-center justify-between">
            <h3 className="text-indigo-200 font-bold text-xs">
              Researching: {TECH_TREE[activeResearch].label}
            </h3>
            <span className="text-cyan-300 text-[10px] font-semibold">
              {progress.toFixed(0)} / {TECH_TREE[activeResearch].researchCost} RP
            </span>
          </div>
          <div className="w-full h-2 bg-empire-stone/20 rounded-full overflow-hidden mt-1.5">
            <div
              className="h-full bg-gradient-to-r from-indigo-600 to-cyan-400 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, (progress / TECH_TREE[activeResearch].researchCost) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {!activeResearch && (
        <div className="bg-indigo-950/20 rounded-lg p-2.5 border border-indigo-500/10 text-center">
          <p className="text-[10px] text-empire-parchment/50">No active research — select a technology below to begin.</p>
        </div>
      )}

      {/* Tech Tree Branches */}
      <div className="space-y-5">
        {TECH_BRANCHES.map(branch => (
          <div key={branch.name}>
            <div className="flex items-center gap-1.5 mb-2">
              <span className="text-sm">{branch.icon}</span>
              <h3 className="text-indigo-200/80 font-bold text-[11px] uppercase tracking-wider">{branch.name}</h3>
              <div className="flex-1 h-px bg-indigo-500/10 ml-1" />
            </div>
            <div className="flex justify-center">
              <TechNode
                node={branch.root}
                researched={researched}
                activeResearch={activeResearch}
                available={available}
                progress={progress}
                startResearch={startResearch}
                cancelResearch={cancelResearch}
                depth={0}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Special wilds: search prompt (first entry) + guide (from side panel) ─

function ScrollSearchPromptModal() {
  const modal = useGameStore(s => s.scrollSearchPromptModal);
  const clearScrollSearchPromptModal = useGameStore(s => s.clearScrollSearchPromptModal);
  if (!modal) return null;
  const terrainName = SPECIAL_REGION_DISPLAY_NAME[modal.regionKind];
  return (
    <div
      className="fixed inset-0 z-[92] flex items-center justify-center bg-black/50 pointer-events-auto"
      onClick={() => clearScrollSearchPromptModal()}
    >
      <div
        className="bg-empire-dark/95 border border-teal-500/50 rounded-xl p-5 max-w-sm w-full mx-4 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-teal-200 font-bold text-sm mb-2">Search area</h3>
        <p className="text-empire-parchment/75 text-xs mb-4 leading-relaxed">
          Your troops entered <span className="text-teal-100/95">{terrainName}</span>. Walk a qualifying army across{' '}
          <strong className="text-empire-parchment/90">every hex</strong> of this wilds patch. When it is fully explored, move onto the{' '}
          <strong className="text-empire-parchment/90">relic</strong> tile to reveal the scroll and equip it to an army.
        </p>
        <button
          type="button"
          onClick={() => clearScrollSearchPromptModal()}
          className="w-full px-3 py-2 text-xs font-bold rounded border border-teal-500/45 text-teal-100 hover:bg-teal-950/40"
        >
          Understood
        </button>
      </div>
    </div>
  );
}

function SpecialRegionSearchGuideModal() {
  const guide = useGameStore(s => s.specialRegionSearchGuideModal);
  const clearSpecialRegionSearchGuideModal = useGameStore(s => s.clearSpecialRegionSearchGuideModal);
  const pendingTacticalOrders = useGameStore(s => s.pendingTacticalOrders);
  const tiles = useGameStore(s => s.tiles);
  const scrollRelics = useGameStore(s => s.scrollRelics);
  const scrollRegionClaimed = useGameStore(s => s.scrollRegionClaimed);
  const scrollRelicClusters = useGameStore(s => s.scrollRelicClusters);
  const scrollSearchVisited = useGameStore(s => s.scrollSearchVisited);
  const players = useGameStore(s => s.players);
  const openTacticalMode = useGameStore(s => s.openTacticalMode);
  const addNotification = useGameStore(s => s.addNotification);

  if (pendingTacticalOrders !== null || !guide) return null;
  const tile = tiles.get(tileKey(guide.q, guide.r));
  const terrainKind = tile?.specialTerrainKind;
  if (!terrainKind) return null;
  const terrainName = SPECIAL_REGION_DISPLAY_NAME[terrainKind];
  const human = players.find(p => p.isHuman);
  const hid = human?.id ?? '';
  const claimed = hid ? (scrollRegionClaimed[terrainKind] ?? []).includes(hid) : false;
  const relicForRegion = scrollRelics.find(r => r.regionKind === terrainKind);
  const cluster = scrollRelicClusters[terrainKind] ?? [];
  const visited = scrollSearchVisited[hid]?.[terrainKind] ?? [];
  const visSet = new Set(visited);
  const explored = cluster.filter(k => visSet.has(k)).length;
  const total = cluster.length;
  const searchComplete = total > 0 && cluster.every(k => visSet.has(k));

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 pointer-events-auto"
      onClick={() => clearSpecialRegionSearchGuideModal()}
    >
      <div
        className="bg-empire-dark/95 border border-teal-600/50 rounded-xl p-5 max-w-sm w-full mx-4 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-teal-200 font-bold text-sm mb-1">Search — {terrainName}</h3>
        <p className="text-empire-parchment/70 text-xs mb-3 leading-relaxed">
          {claimed
            ? `You hold ${SCROLL_REGION_ITEM_NAME[terrainKind]} (inventory or assigned to an army).`
            : 'Send a qualifying army through army orders: select stack(s) → Move → path through every hex of this wilds, then end on the relic tile to claim the scroll.'}
        </p>
        {!claimed && total > 0 && (
          <p className="text-teal-200/90 text-[11px] mb-3 font-mono border border-teal-600/35 rounded px-2 py-1.5 bg-teal-950/30">
            Search progress: {explored} / {total} hex{total === 1 ? '' : 'es'}
            {searchComplete ? ' — patch fully explored. Claim the relic hex.' : ''}
          </p>
        )}
        {!claimed && relicForRegion && (
          <p className="text-empire-parchment/55 text-[10px] mb-3">
            Relic site: ({relicForRegion.q}, {relicForRegion.r}) — visible as a marker when discovered.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              const rq = relicForRegion?.q;
              const rr = relicForRegion?.r;
              const coordHint =
                rq !== undefined && rr !== undefined ? ` Target relic hex (${rq}, ${rr}).` : '';
              addNotification(`Army orders: select stack(s) → Move → click destination(s) → Confirm orders.${coordHint}`, 'info');
              clearSpecialRegionSearchGuideModal();
              openTacticalMode();
            }}
            className="flex-1 min-w-[8rem] px-3 py-2 text-xs font-bold rounded border border-empire-gold/50 text-empire-gold hover:bg-empire-gold/10"
          >
            Open army orders
          </button>
          <button
            type="button"
            onClick={() => clearSpecialRegionSearchGuideModal()}
            className="px-3 py-2 text-xs rounded border border-empire-stone/40 text-empire-parchment/80 hover:bg-empire-stone/20"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

const SCROLL_RELIC_MODAL_BANNER: Record<SpecialRegionKind, string> = {
  mexca: '/sprites/overlays/biomes/sr_mexca_1.png',
  hills_lost: '/sprites/overlays/biomes/sr_hills_lost_1.png',
  forest_secrets: '/sprites/overlays/biomes/sr_forest_secrets_1.png',
  isle_lost: '/sprites/overlays/biomes/sr_isle_lost_wreck_1.png',
};

function ScrollRelicPickupScrollArt({ regionKind, kind }: { regionKind: SpecialRegionKind; kind: ScrollKind }) {
  const accent = SPECIAL_REGION_OVERLAY_COLORS[regionKind];
  const sealLetter = SCROLL_SLOT_LABEL[kind].slice(0, 1);
  return (
    <div className="relative flex justify-center py-2">
      <div className="relative">
        <svg
          viewBox="0 0 120 100"
          className="w-36 h-[7.5rem] drop-shadow-lg"
          aria-hidden
        >
          <defs>
            <linearGradient id={`scroll-parch-${regionKind}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#f4e4c4" />
              <stop offset="100%" stopColor="#d4c4a8" />
            </linearGradient>
          </defs>
          <ellipse cx="60" cy="88" rx="44" ry="8" fill="black" opacity="0.2" />
          <path
            d="M28 18 h64 q8 0 8 8 v52 q0 8 -8 8 h-56 q-8 0 -8 -8 v-52 q0 -8 8 -8 z"
            fill={`url(#scroll-parch-${regionKind})`}
            stroke="#8b7355"
            strokeWidth="1.2"
          />
          <path d="M36 28 h48 M36 38 h40 M36 48 h44 M36 58 h36" stroke="#a89878" strokeWidth="1.2" strokeLinecap="round" opacity="0.65" />
          <circle cx="60" cy="22" r="10" fill={accent} opacity="0.85" />
          <path
            d="M92 22 q10 0 10 10 v48 q0 6 -6 6 h-4"
            fill="#e8dcc8"
            stroke="#8b7355"
            strokeWidth="1"
          />
        </svg>
        <span
          className="absolute left-1/2 top-[10px] -translate-x-1/2 text-[13px] font-bold text-[#1a1510] pointer-events-none"
          aria-hidden
        >
          {sealLetter}
        </span>
      </div>
      <Image
        src="/sprites/entities/deposit_ancient.png"
        alt=""
        width={48}
        height={48}
        className="absolute bottom-1 right-4 opacity-90 pointer-events-none"
      />
    </div>
  );
}

function ScrollRelicPickupModal() {
  const modal = useGameStore(s => s.scrollRelicPickupModal);
  const clearScrollRelicPickupModal = useGameStore(s => s.clearScrollRelicPickupModal);
  const openTacticalMode = useGameStore(s => s.openTacticalMode);

  useEffect(() => {
    if (!modal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'a' && e.key !== 'A') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      openTacticalMode();
      clearScrollRelicPickupModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal, openTacticalMode, clearScrollRelicPickupModal]);

  if (!modal) return null;
  const { regionKind, kind } = modal;
  const bonus =
    kind === 'combat'
      ? `+${Math.round(SCROLL_COMBAT_BONUS * 100)}% attack when carried by a land army`
      : kind === 'defense'
        ? `+${Math.round(SCROLL_DEFENSE_BONUS * 100)}% defense when carried by a land army`
        : `+${Math.round(SCROLL_MOVEMENT_BONUS * 100)}% land movement when carried`;

  const openArmy = () => {
    openTacticalMode();
    clearScrollRelicPickupModal();
  };

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/55 pointer-events-auto"
      onClick={() => clearScrollRelicPickupModal()}
    >
      <div
        className="bg-empire-dark/95 border border-amber-600/45 rounded-xl overflow-hidden max-w-md w-full mx-4 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="relative h-24 w-full overflow-hidden border-b border-amber-900/40">
          <Image
            src={SCROLL_RELIC_MODAL_BANNER[regionKind]}
            alt=""
            fill
            className="object-cover opacity-90"
            sizes="(max-width: 448px) 100vw, 448px"
            priority
          />
          <div className="absolute inset-0 bg-gradient-to-t from-empire-dark/90 to-transparent" />
          <p className="absolute bottom-2 left-3 right-3 text-amber-100/95 text-sm font-bold drop-shadow-md">
            {SCROLL_REGION_ITEM_NAME[regionKind]}
          </p>
        </div>
        <div className="p-5">
          <p className="text-empire-parchment/55 text-[11px] uppercase tracking-wide mb-1">
            {SCROLL_DISPLAY_NAME[kind]} · added to your inventory
          </p>
          <ScrollRelicPickupScrollArt regionKind={regionKind} kind={kind} />
          <p className="text-empire-parchment/85 text-sm leading-relaxed mb-3">{SCROLL_RELIC_LORE[regionKind]}</p>
          <p className="text-teal-200/90 text-xs mb-4 border-t border-empire-stone/25 pt-3">{bonus}</p>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={openArmy}
              className="w-full px-3 py-2.5 text-sm font-semibold rounded border border-empire-gold/50 text-empire-gold hover:bg-empire-gold/10 flex items-center justify-center gap-2"
            >
              <span>Open Army to equip</span>
              <kbd className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-empire-gold/35 bg-black/30">
                A
              </kbd>
            </button>
            <button
              type="button"
              onClick={() => clearScrollRelicPickupModal()}
              className="w-full px-3 py-2 text-xs rounded border border-empire-stone/40 text-empire-parchment/75 hover:bg-empire-stone/15"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CityModal() {
  const getSelectedCityForDisplay = useGameStore(s => s.getSelectedCityForDisplay);
  const cityLogisticsOpen = useGameStore(s => s.cityLogisticsOpen);
  const gameMode = useGameStore(s => s.gameMode);
  const closeCityModal = useGameStore(s => s.closeCityModal);
  const city = getSelectedCityForDisplay();
  if (!city || !cityLogisticsOpen) return null;

  const isObserver = gameMode === 'bot_vs_bot' || gameMode === 'bot_vs_bot_4' || gameMode === 'spectate';

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) closeCityModal();
  };

  return (
    <div
      className="absolute inset-0 flex items-center justify-center bg-black/60 pointer-events-auto z-[100] isolate"
      onClick={handleBackdropClick}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="city-modal-title"
        className="bg-empire-dark/95 border border-empire-gold/50 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl relative z-[1] pointer-events-auto"
        onClick={e => e.stopPropagation()}
      >
        <CityModalContent city={city} onClose={closeCityModal} isObserver={isObserver} />
      </div>
    </div>
  );
}

function GarrisonPatrolControls({ city }: { city: City }) {
  const setCityGarrisonPatrol = useGameStore(s => s.setCityGarrisonPatrol);
  const setCityGarrisonPatrolRadius = useGameStore(s => s.setCityGarrisonPatrolRadius);
  const enabled = city.garrisonPatrol ?? false;
  const radius = city.garrisonPatrolRadius ?? TERRITORY_RADIUS;

  return (
    <div className="mt-3 pt-3 border-t border-empire-stone/20">
      <p className="text-empire-gold/80 text-xs font-semibold uppercase tracking-wide mb-1">Garrison patrol</p>
      <p className="text-[10px] text-empire-parchment/55 mb-2 leading-snug">
        Ranged units in garrison (archers / horse archers) shoot enemies standing on this city&apos;s territory, up to the patrol depth from the city center. Return fire when you are shot at works even if stance is passive or skirmish.
      </p>
      <label className="flex items-center gap-2 cursor-pointer text-[11px] text-empire-parchment/90 mb-2">
        <input
          type="checkbox"
          checked={enabled}
          onChange={e => setCityGarrisonPatrol(city.id, e.target.checked)}
          className="accent-empire-gold"
        />
        Patrol territory (auto-fire)
      </label>
      <div>
        <label className="text-[10px] text-empire-parchment/50 block mb-1">
          Patrol depth: {radius} hex{radius !== 1 ? 'es' : ''} from city center
        </label>
        <input
          type="range"
          min={GARRISON_PATROL_RADIUS_MIN}
          max={GARRISON_PATROL_RADIUS_MAX}
          step={1}
          value={radius}
          onChange={e => setCityGarrisonPatrolRadius(city.id, Number(e.target.value))}
          className="w-full h-1 bg-empire-stone/30 rounded-lg appearance-none cursor-pointer accent-empire-gold"
        />
      </div>
    </div>
  );
}

function CityDefenseCommanderPicker({ city }: { city: import('@/types/game').City }) {
  const commanders = useGameStore(s => s.commanders);
  const assignCommanderToCityDefense = useGameStore(s => s.assignCommanderToCityDefense);
  const unassignCommander = useGameStore(s => s.unassignCommander);
  const roster = commanders.filter(
    c => c.ownerId === 'player_human' && (c.commanderKind ?? 'land') !== 'naval',
  );
  const defender = roster.find(
    c => c.assignment?.kind === 'city_defense' && c.assignment.cityId === city.id,
  );

  if (roster.length === 0) {
    return (
      <p className="text-[10px] text-empire-parchment/45 italic">
        {commanders.some(c => c.ownerId === 'player_human')
          ? 'No land commanders — naval officers lead fleets only. Recruit more from barracks.'
          : 'No commanders yet — recruit from the Barracks tab when viewing this city on the map, or from the Army panel.'}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {defender ? (
        <div className="flex gap-2 items-start rounded-lg border border-violet-500/35 bg-violet-950/20 p-2">
          {defender.portraitDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={defender.portraitDataUrl}
              width={44}
              height={44}
              alt=""
              className="rounded border border-violet-500/40 shrink-0"
              style={{ imageRendering: 'pixelated' }}
            />
          ) : (
            <div className="w-11 h-11 rounded bg-empire-stone/25 border border-violet-500/30 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold text-violet-200">{defender.name}</div>
            <div className="text-[9px] text-empire-parchment/50 mt-0.5">
              {defender.traitIds.map(t => COMMANDER_TRAIT_INFO[t].label).join(' · ')}
            </div>
            <button
              type="button"
              onClick={() => unassignCommander(defender.id)}
              className="mt-1.5 text-[10px] px-2 py-0.5 rounded border border-empire-stone/40 text-empire-parchment/70 hover:bg-empire-stone/20"
            >
              Remove from city defense
            </button>
          </div>
        </div>
      ) : (
        <p className="text-[10px] text-empire-parchment/45">No commander assigned to this city.</p>
      )}
      <div className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wide text-empire-parchment/40">Assign</span>
        {roster.map(c => {
          const isCurrent = defender?.id === c.id;
          const busyElsewhere =
            c.assignment?.kind === 'city_defense' && c.assignment.cityId !== city.id;
          return (
            <button
              key={c.id}
              type="button"
              disabled={isCurrent}
              onClick={() => assignCommanderToCityDefense(c.id, city.id)}
              className={`text-left px-2 py-1.5 rounded border text-[11px] transition-colors ${
                isCurrent
                  ? 'border-violet-500/50 bg-violet-900/30 text-violet-100 cursor-default'
                  : 'border-violet-600/35 bg-violet-950/25 text-violet-100 hover:bg-violet-900/35 disabled:opacity-50'
              }`}
            >
              {c.name}
              {isCurrent ? ' — current' : busyElsewhere ? ' (moves from another city)' : ''}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CityModalContent({ city, onClose, isObserver = false }: { city: import('@/types/game').City; onClose: () => void; isObserver?: boolean }) {
  const [showPopulationMechanics, setShowPopulationMechanics] = useState(false);
  const setFoodPriority = useGameStore(s => s.setFoodPriority);
  const setTaxRate = useGameStore(s => s.setTaxRate);
  const repairCityBuilding = useGameStore(s => s.repairCityBuilding);
  const players = useGameStore(s => s.players);
  const cities = useGameStore(s => s.cities);
  const tiles = useGameStore(s => s.tiles);
  const territory = useGameStore(s => s.territory);
  const units = useGameStore(s => s.units);
  const activeWeather = useGameStore(s => s.activeWeather);
  const human = players.find(p => p.isHuman);
  const harvestMult = getWeatherHarvestMultiplier(activeWeather);
  const localProd = computeCityProductionRate(city, tiles, territory, harvestMult);
  const ownerPlayer = isObserver ? players.find(p => p.id === city.ownerId) : human;
  const empireCities = ownerPlayer ? cities.filter(c => c.ownerId === ownerPlayer.id) : [];
  const empireTotal = empireCities.reduce(
    (acc, c) => {
      const p = computeCityProductionRate(c, tiles, territory, harvestMult);
      return { food: acc.food + p.food, guns: acc.guns + p.guns };
    },
    { food: 0, guns: 0 },
  );
  const fromNetwork = {
    food: Math.max(0, empireTotal.food - localProd.food),
    guns: Math.max(0, empireTotal.guns - localProd.guns),
  };
  const isIsolated = empireCities.length <= 1;

  let totalJobs = 0;
  let employed = 0;
  for (const b of city.buildings) {
    const jobs = getBuildingJobs(b);
    totalJobs += jobs;
    employed += (b as import('@/types/game').CityBuilding).assignedWorkers ?? 0;
  }
  const openJobs = Math.max(0, totalJobs - employed);
  const foodExpense = Math.ceil(city.population * 0.25);

  return (
    <div className="space-y-4">
      {showPopulationMechanics && (
        <PopulationMechanicsPopover
          city={city}
          foodProducedPerCycle={localProd.food}
          onClose={() => setShowPopulationMechanics(false)}
        />
      )}
      <div className="flex justify-between items-center gap-3">
        <div className="min-w-0">
          {isObserver && (
            <p className="text-xs text-empire-parchment/50 uppercase tracking-wide mb-0.5">
              Observing {players.find(p => p.id === city.ownerId)?.name ?? 'AI'}
            </p>
          )}
          <h2 id="city-modal-title" className="text-xl font-bold text-empire-gold truncate">{city.name}</h2>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="shrink-0 w-10 h-10 flex items-center justify-center rounded-lg border border-empire-stone/40 bg-empire-stone/20 text-empire-parchment/70 hover:bg-empire-gold/20 hover:text-empire-gold hover:border-empire-gold/50 active:scale-95 text-xl font-bold leading-none transition-colors cursor-pointer select-none relative z-[2]"
          aria-label="Close"
        >
          ×
        </button>
      </div>
      {(city.frontierCity ?? 0) > 0 && (
        <div className="px-3 py-1.5 bg-amber-900/30 border border-amber-500/50 rounded text-amber-300 text-xs font-semibold">
          Frontier City — +25% migration for {city.frontierCity} more cycle{(city.frontierCity ?? 0) !== 1 ? 's' : ''}
        </div>
      )}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <button type="button" onClick={() => setShowPopulationMechanics(true)} className="col-span-2 grid grid-cols-2 gap-x-4 gap-y-0 text-left rounded hover:bg-empire-stone/20 transition-colors cursor-pointer" title="Click for growth mechanics">
          <span className="text-empire-parchment/50">Population</span>
          <span className="text-empire-parchment font-medium">{city.population}</span>
        </button>
        <span className="text-empire-parchment/50">Natural growth (last cycle)</span>
        <span className="text-empire-parchment">
          {(city.lastNaturalGrowth ?? 0) >= 0 ? '+' : ''}{city.lastNaturalGrowth ?? 0}
        </span>
        <span className="text-empire-parchment/50">Migration (last cycle)</span>
        <span className="text-empire-parchment" title="Positive = immigrants; negative = emigrants. Migration moves population between your cities.">
          {(city.lastMigration ?? 0) >= 0 ? '+' : ''}{city.lastMigration ?? 0}
        </span>
        <span className="text-empire-parchment/50">Net pop change</span>
        <span className="text-empire-parchment">
          {(city.lastNaturalGrowth ?? 0) + (city.lastMigration ?? 0) >= 0 ? '+' : ''}
          {(city.lastNaturalGrowth ?? 0) + (city.lastMigration ?? 0)}
        </span>
        <span className="text-empire-parchment/50">Morale</span>
        <MoraleBar value={city.morale} />
        <span className="text-empire-parchment/50">Jobs</span>
        <span className="text-empire-parchment">{employed} employed / {totalJobs} total ({openJobs} open)</span>
      </div>
      <div className="border-t border-empire-stone/30 pt-3">
        <p className="text-empire-gold/80 text-xs font-semibold uppercase tracking-wide mb-2">Resource flow (per cycle)</p>
        <div className="space-y-1.5 text-sm">
          <div>
            <div className="flex justify-between items-baseline">
              <span className="text-empire-parchment/70">Food</span>
              <span className={localProd.food + (isIsolated ? 0 : fromNetwork.food) - foodExpense >= 0 ? 'text-green-400' : 'text-red-400'}>
                Net {(localProd.food + (isIsolated ? 0 : fromNetwork.food) - foodExpense) >= 0 ? '+' : ''}
                {localProd.food + (isIsolated ? 0 : fromNetwork.food) - foodExpense}
              </span>
            </div>
            <div className="text-xs text-empire-parchment/50 mt-0.5">
              Local +{localProd.food}
              {!isIsolated && fromNetwork.food > 0 && <> · Network +{fromNetwork.food}</>}
              <> · Consumption −{foodExpense}</>
            </div>
          </div>
          <div>
            <div className="flex justify-between items-baseline">
              <span className="text-empire-parchment/70">Arms</span>
              <span className="text-empire-parchment">
                Net +{localProd.guns + (isIsolated ? 0 : fromNetwork.guns)}
              </span>
            </div>
            <div className="text-xs text-empire-parchment/50 mt-0.5">
              Local +{localProd.guns}
              {!isIsolated && fromNetwork.guns > 0 && <> · Network +{fromNetwork.guns}</>}
            </div>
          </div>
          <div>
            <div className="flex justify-between items-baseline">
              <span className="text-empire-parchment/70">Wood</span>
              <span className="text-empire-parchment">Local +{localProd.wood}/cycle</span>
            </div>
          </div>
          <div>
            <div className="flex justify-between items-baseline">
              <span className="text-empire-parchment/70">Refined wood</span>
              <span className="text-empire-parchment">Local +{localProd.refinedWood}/cycle</span>
            </div>
          </div>
        </div>
      </div>
      <div className="border-t border-empire-stone/30 pt-3">
        <p className="text-empire-gold/80 text-xs font-semibold uppercase tracking-wide mb-2">City center & buildings</p>
        <div className="space-y-1 text-sm">
          {city.buildings.map((b, i) => {
            const jobs = getBuildingJobs(b);
            const assigned = (b as import('@/types/game').CityBuilding).assignedWorkers ?? 0;
            const label = b.type === 'city_center' ? 'City Center' : b.type.charAt(0).toUpperCase() + b.type.slice(1);
            const maxHp = b.maxHp ?? defaultCityBuildingMaxHp(b.type, b.level ?? 1);
            const hp = b.hp ?? maxHp;
            const ruined = b.buildingState === 'ruins' || !isCityBuildingOperational(b);
            const repairGold = Math.ceil(BUILDING_COSTS[b.type] * RUINS_REPAIR_GOLD_RATIO);
            const canRepair = human && city.ownerId === human.id && (human.gold ?? 0) >= repairGold;
            return (
              <div key={i} className="flex flex-col gap-0.5 text-empire-parchment/80">
                <div className="flex justify-between">
                  <span>{label}{ruined ? ' (ruins)' : ''}</span>
                  <span>{assigned}/{jobs} workers</span>
                </div>
                {b.type !== 'city_center' && (
                  <div className="flex justify-between items-center text-[10px] text-empire-parchment/50">
                    <span>
                      HP {hp}/{maxHp}
                    </span>
                    {ruined && !isObserver && (
                      <button
                        type="button"
                        disabled={!canRepair}
                        onClick={() => repairCityBuilding(city.id, b.q, b.r)}
                        className="px-1.5 py-0.5 rounded border border-amber-500/40 text-amber-200/90 disabled:opacity-40"
                      >
                        Repair {repairGold}g
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {!isObserver && human && city.ownerId === human.id && (
        <div className="border-t border-empire-stone/30 pt-3">
          <p className="text-empire-gold/80 text-xs font-semibold uppercase tracking-wide mb-1">Defense commander</p>
          <p className="text-[10px] text-empire-parchment/55 mb-2 leading-snug">
            Recruit commanders ({COMMANDER_RECRUIT_GOLD}g) from a Barracks or the Army panel. Assign one to boost troops fighting on this city&apos;s tile.
          </p>
          <CityDefenseCommanderPicker city={city} />
          <GarrisonPatrolControls city={city} />
        </div>
      )}
      {!isObserver && (
        <>
          <div>
            <label className="text-xs text-empire-parchment/50 block mb-1">Food Priority</label>
            <div className="flex gap-1">
              {(['civilian', 'military'] as const).map(p => (
                <button key={p} onClick={() => setFoodPriority(p)}
                  className={`flex-1 px-2 py-1 text-xs rounded border transition-colors ${
                    human?.foodPriority === p ? 'border-empire-gold/60 bg-empire-gold/20 text-empire-gold' : 'border-empire-stone/30 text-empire-parchment/50 hover:border-empire-stone/50'
                  }`}>
                  {p === 'civilian' ? 'Feed People' : 'Feed Army'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-empire-parchment/50 block mb-1">Tax Rate: {Math.round((human?.taxRate ?? 0) * 100)}%</label>
            <input type="range" min="0" max="100" step="10"
              value={(human?.taxRate ?? 0.3) * 100}
              onChange={e => setTaxRate(Number(e.target.value) / 100)}
              className="w-full h-1 bg-empire-stone/30 rounded-lg appearance-none cursor-pointer accent-empire-gold" />
          </div>
        </>
      )}
      {isObserver && (
        <div className="text-xs text-empire-parchment/50 border-t border-empire-stone/30 pt-3">
          Tax: {Math.round((players.find(p => p.id === city.ownerId)?.taxRate ?? 0.3) * 100)}% · Food: {(players.find(p => p.id === city.ownerId)?.foodPriority ?? 'military').replace('_', ' ')}
        </div>
      )}
    </div>
  );
}

// ─── Weather Overlay ────────────────────────────────────────────────

function WeatherOverlay() {
  const activeWeather = useGameStore(s => s.activeWeather);

  if (!activeWeather) return null;

  const display = WEATHER_DISPLAY[activeWeather.type];
  const isTyphoon = activeWeather.type === 'typhoon';

  return (
    <>
      {/* Full-screen atmospheric overlay */}
      <div className={`absolute inset-0 pointer-events-none z-[5] transition-opacity duration-1000 ${
        isTyphoon
          ? 'bg-gradient-to-b from-cyan-900/20 via-transparent to-blue-900/15'
          : 'bg-gradient-to-b from-amber-900/20 via-orange-900/10 to-transparent'
      }`}>
        {/* Animated weather particles */}
        {isTyphoon ? <TyphoonParticles /> : <DroughtParticles />}
      </div>

      {/* Weather status banner — top-left under the top bar */}
      <div className="absolute top-12 left-2 pointer-events-auto z-10">
        <div className={`${display.bgColor} border ${display.borderColor} rounded-lg px-4 py-3 shadow-2xl backdrop-blur-sm max-w-[260px]`}>
          <div className="flex items-center gap-3 mb-1.5">
            <div className="relative w-10 h-10 flex-shrink-0">
              <Image
                src={display.icon}
                alt={display.label}
                width={40}
                height={40}
                className="pixelated drop-shadow-lg"
                style={{ imageRendering: 'pixelated' }}
              />
            </div>
            <div>
              <div className={`${display.color} font-bold text-sm tracking-widest`}>
                {display.label}
              </div>
              <div className="text-empire-parchment/50 text-[10px]">
                {activeWeather.duration} cycle{activeWeather.duration > 1 ? 's' : ''} remaining
              </div>
            </div>
          </div>
          <div className="text-empire-parchment/60 text-[10px] leading-relaxed">
            {display.description}
          </div>
          {/* Harvest penalty indicator */}
          <div className="mt-2 flex items-center gap-2">
            <span className="text-red-400 text-xs font-bold">-50%</span>
            <div className="flex-1 h-1.5 bg-empire-stone/30 rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${
                isTyphoon ? 'bg-cyan-500/70' : 'bg-amber-500/70'
              }`} style={{ width: `${(activeWeather.duration / 3) * 100}%` }} />
            </div>
            <span className="text-empire-parchment/40 text-[10px]">Harvest</span>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Typhoon animated rain particles (CSS) ──────────────────────────

function TyphoonParticles() {
  return (
    <div className="absolute inset-0 overflow-hidden">
      {Array.from({ length: 30 }).map((_, i) => (
        <div
          key={i}
          className="absolute bg-cyan-300/30 rounded-full"
          style={{
            width: '2px',
            height: `${12 + Math.random() * 20}px`,
            left: `${Math.random() * 100}%`,
            top: `${Math.random() * 100}%`,
            transform: `rotate(${15 + Math.random() * 10}deg)`,
            animation: `typhoon-rain ${0.4 + Math.random() * 0.6}s linear infinite`,
            animationDelay: `${Math.random() * 2}s`,
            opacity: 0.3 + Math.random() * 0.4,
          }}
        />
      ))}
      <style jsx>{`
        @keyframes typhoon-rain {
          0% { transform: translateY(-20px) translateX(-5px) rotate(15deg); opacity: 0; }
          20% { opacity: 0.6; }
          100% { transform: translateY(120vh) translateX(40px) rotate(15deg); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

// ─── Drought animated heat shimmer particles (CSS) ──────────────────

function DroughtParticles() {
  return (
    <div className="absolute inset-0 overflow-hidden">
      {Array.from({ length: 15 }).map((_, i) => (
        <div
          key={i}
          className="absolute bg-amber-400/20 rounded-full"
          style={{
            width: `${30 + Math.random() * 60}px`,
            height: '2px',
            left: `${Math.random() * 100}%`,
            bottom: `${Math.random() * 40}%`,
            animation: `heat-shimmer ${2 + Math.random() * 3}s ease-in-out infinite`,
            animationDelay: `${Math.random() * 3}s`,
            opacity: 0.2 + Math.random() * 0.3,
          }}
        />
      ))}
      <style jsx>{`
        @keyframes heat-shimmer {
          0%, 100% { transform: translateY(0) scaleX(1); opacity: 0.1; }
          50% { transform: translateY(-8px) scaleX(1.3); opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}

// ─── Combat banner + battle report modal ───────────────────────────

function CombatHud() {
  return (
    <>
      <BattleReportModal />
    </>
  );
}

function BattleReportModal() {
  const battleModalHexKey = useGameStore(s => s.battleModalHexKey);
  const closeBattleModal = useGameStore(s => s.closeBattleModal);
  const openBattleModal = useGameStore(s => s.openBattleModal);
  const units = useGameStore(s => s.units);
  const players = useGameStore(s => s.players);
  const exitBattleReportToMoveMode = useGameStore(s => s.exitBattleReportToMoveMode);
  const gameMode = useGameStore(s => s.gameMode);
  const moraleState = useGameStore(s => s.combatMoraleState);
  const killFeed = useGameStore(s => s.combatKillFeed);

  const battleKeys = useMemo(() => humanBattleHexKeysFlat(units), [units]);
  const battleClusterHexKeys = useMemo(
    () => battleClusterContainingHex(units, battleModalHexKey),
    [units, battleModalHexKey],
  );

  const outlook = useMemo(() => {
    if (!battleModalHexKey || battleClusterHexKeys.length === 0) {
      return { label: '—', lean: 'tossup' as const, pctYou: 50 };
    }
    return likelyWinnerForHumanBattle(units, battleClusterHexKeys, moraleState);
  }, [battleModalHexKey, battleClusterHexKeys, units, moraleState]);

  /** Unit ids tied to this report; follows stacks as they move so we do not close when the anchor hex empties. */
  const battleReportEngagementUnitIdsRef = useRef<Set<string> | null>(null);
  const battleReportFocusedHexPrevRef = useRef<string | null>(null);

  useEffect(() => {
    if (!battleModalHexKey) {
      battleReportEngagementUnitIdsRef.current = null;
      battleReportFocusedHexPrevRef.current = null;
      return;
    }
    if (battleReportFocusedHexPrevRef.current !== battleModalHexKey) {
      battleReportFocusedHexPrevRef.current = battleModalHexKey;
      const clusterHexes = new Set(battleClusterContainingHex(units, battleModalHexKey));
      const ids = new Set<string>();
      for (const u of units) {
        if (u.hp <= 0 || u.aboardShipId) continue;
        if (clusterHexes.has(tileKey(u.q, u.r))) ids.add(u.id);
      }
      battleReportEngagementUnitIdsRef.current = ids;
    }
  }, [battleModalHexKey, units]);

  useEffect(() => {
    if (!battleModalHexKey) return;
    let ref = battleReportEngagementUnitIdsRef.current;
    if (!ref) return;

    const unitById = new Map(units.map(u => [u.id, u]));
    const pruned = new Set<string>();
    for (const id of ref) {
      const u = unitById.get(id);
      if (u && u.hp > 0 && !u.aboardShipId) pruned.add(id);
    }
    battleReportEngagementUnitIdsRef.current = pruned;
    ref = pruned;

    if (ref.size === 0) {
      closeBattleModal();
      return;
    }

    const clusters = clusterHumanBattleEngagements(units);
    let touched = false;
    for (const hexKeys of clusters) {
      const hexSet = new Set(hexKeys);
      const clusterUnitIds = new Set<string>();
      for (const u of units) {
        if (u.hp <= 0 || u.aboardShipId) continue;
        if (hexSet.has(tileKey(u.q, u.r))) clusterUnitIds.add(u.id);
      }
      const intersects = [...clusterUnitIds].some(id => ref.has(id));
      if (intersects) {
        touched = true;
        for (const id of clusterUnitIds) ref.add(id);
      }
    }
    if (!touched) closeBattleModal();
  }, [units, battleModalHexKey, closeBattleModal]);

  const clusterHexSet = useMemo(() => new Set(battleClusterHexKeys), [battleClusterHexKeys]);

  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const dragSessionRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  useEffect(() => {
    setDragOffset({ x: 0, y: 0 });
  }, [battleModalHexKey]);

  if (!battleModalHexKey || gameMode === 'bot_vs_bot' || gameMode === 'bot_vs_bot_4' || gameMode === 'spectate') return null;

  const [q, r] = battleModalHexKey.split(',').map(Number);
  const atHex = units.filter(
    u => clusterHexSet.has(tileKey(u.q, u.r)) && u.hp > 0 && !u.aboardShipId
  );
  const yours = atHex.filter(u => u.ownerId.includes('human'));
  const enemies = atHex.filter(u => !u.ownerId.includes('human'));

  const sumHp = (list: typeof atHex) =>
    list.reduce((acc, u) => acc + Math.max(0, u.hp), 0);
  const sumMax = (list: typeof atHex) =>
    list.reduce((acc, u) => acc + (u.maxHp ?? getUnitStats(u).maxHp), 0);

  const nameFor = (ownerId: string) => players.find(p => p.id === ownerId)?.name ?? ownerId;

  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) closeBattleModal();
  };

  const clampBattleReportDrag = (x: number, y: number) => {
    const margin = 40;
    const maxX = Math.max(0, window.innerWidth / 2 - margin);
    const maxY = Math.max(0, window.innerHeight / 2 - margin);
    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y)),
    };
  };

  const handleBattleReportCornerPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragSessionRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: dragOffset.x,
      originY: dragOffset.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleBattleReportCornerPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const s = dragSessionRef.current;
    if (!s || e.pointerId !== s.pointerId) return;
    const nx = s.originX + (e.clientX - s.startX);
    const ny = s.originY + (e.clientY - s.startY);
    setDragOffset(clampBattleReportDrag(nx, ny));
  };

  const handleBattleReportCornerPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const s = dragSessionRef.current;
    if (!s || e.pointerId !== s.pointerId) return;
    dragSessionRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  };

  const battleReportCornerHandleClass =
    'absolute z-[2] h-5 w-5 touch-none select-none rounded-sm border border-amber-900/50 bg-[#141428]/95 hover:bg-amber-950/40 cursor-grab active:cursor-grabbing';

  return (
    <div
      className="absolute inset-0 bg-black/70 backdrop-blur-[2px] pointer-events-auto z-[95] isolate"
      onClick={handleBackdrop}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="battle-report-title"
        style={{
          position: 'fixed',
          left: `calc(50% + ${dragOffset.x}px)`,
          top: `calc(50% + ${dragOffset.y}px)`,
          transform: 'translate(-50%, -50%)',
        }}
        className="medieval-frame medieval-frame--hud relative w-[min(100%,20rem)] max-w-[20rem] pointer-events-auto flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <button
          type="button"
          tabIndex={-1}
          aria-label="Drag to move battle report"
          title="Drag to move"
          className={`${battleReportCornerHandleClass} -left-1.5 -top-1.5`}
          onPointerDown={handleBattleReportCornerPointerDown}
          onPointerMove={handleBattleReportCornerPointerMove}
          onPointerUp={handleBattleReportCornerPointerUp}
          onPointerCancel={handleBattleReportCornerPointerUp}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label="Drag to move battle report"
          title="Drag to move"
          className={`${battleReportCornerHandleClass} -right-1.5 -top-1.5`}
          onPointerDown={handleBattleReportCornerPointerDown}
          onPointerMove={handleBattleReportCornerPointerMove}
          onPointerUp={handleBattleReportCornerPointerUp}
          onPointerCancel={handleBattleReportCornerPointerUp}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label="Drag to move battle report"
          title="Drag to move"
          className={`${battleReportCornerHandleClass} -left-1.5 -bottom-1.5`}
          onPointerDown={handleBattleReportCornerPointerDown}
          onPointerMove={handleBattleReportCornerPointerMove}
          onPointerUp={handleBattleReportCornerPointerUp}
          onPointerCancel={handleBattleReportCornerPointerUp}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label="Drag to move battle report"
          title="Drag to move"
          className={`${battleReportCornerHandleClass} -right-1.5 -bottom-1.5`}
          onPointerDown={handleBattleReportCornerPointerDown}
          onPointerMove={handleBattleReportCornerPointerMove}
          onPointerUp={handleBattleReportCornerPointerUp}
          onPointerCancel={handleBattleReportCornerPointerUp}
        />
        <div className="medieval-frame-inner flex flex-col min-h-0 max-h-[min(58vh,22rem)] px-2.5 pb-2.5 pt-2.5 font-medieval text-empire-parchment/88">
          <div className="flex items-start justify-between gap-2 mb-2 shrink-0">
          <div className="min-w-0 pr-1">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-amber-500/70 text-[9px] select-none" aria-hidden>
                ⚜
              </span>
              <h2
                id="battle-report-title"
                className="font-cinzel medieval-title text-[13px] font-bold tracking-[0.12em] uppercase leading-tight"
              >
                Battle report
              </h2>
              <span className="text-amber-500/70 text-[9px] select-none" aria-hidden>
                ⚜
              </span>
            </div>
            <div className="medieval-divider my-1.5 opacity-80" />
            <p className="text-empire-parchment/60 text-[10px] leading-snug italic">
              {battleClusterHexKeys.length <= 1 ? (
                <>Hex ({q}, {r}) · Retreat: 2s delay before routing.</>
              ) : (
                <>
                  Linked:{' '}
                  {battleClusterHexKeys.map(k => {
                    const [hq, hr] = k.split(',').map(Number);
                    return (
                      <span key={k} className="text-empire-parchment/65">
                        ({hq}, {hr}){' '}
                      </span>
                    );
                  })}
                  · Retreat: 2s delay.
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={closeBattleModal}
            className="relative z-[5] font-cinzel text-[10px] text-empire-gold/90 hover:text-empire-gold px-2 py-1 rounded border border-empire-gold/35 bg-black/20 hover:bg-empire-gold/10 shrink-0 tracking-wide"
          >
            Close
          </button>
        </div>

        {battleKeys.length > 1 && (
          <div className="flex flex-wrap gap-1.5 mb-2 shrink-0">
            {battleKeys.map(k => {
              const [cq, cr] = k.split(',').map(Number);
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => openBattleModal(k)}
                  className={`font-cinzel text-[10px] px-2 py-0.5 rounded border transition-colors tracking-wide ${
                    k === battleModalHexKey
                      ? 'border-empire-gold/70 bg-empire-gold/12 text-empire-gold shadow-[inset_0_0_12px_rgba(201,168,76,0.12)]'
                      : 'border-amber-900/40 text-empire-parchment/75 hover:border-empire-gold/40 hover:bg-black/20'
                  }`}
                >
                  ({cq}, {cr})
                </button>
              );
            })}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 text-[10px] mb-2 shrink-0">
          <div className="rounded border border-emerald-900/45 bg-emerald-950/20 px-2 py-1.5 shadow-[inset_0_0_0_1px_rgba(201,168,76,0.06)]">
            <p className="font-cinzel text-emerald-400/95 text-[9px] mb-0.5 uppercase tracking-[0.1em]">Your force</p>
            <p className="text-empire-parchment/80 leading-tight">
              {yours.length} unit{yours.length !== 1 ? 's' : ''} · {Math.round(sumHp(yours))} / {Math.round(sumMax(yours))} HP
            </p>
          </div>
          <div className="rounded border border-rose-900/45 bg-rose-950/25 px-2 py-1.5 shadow-[inset_0_0_0_1px_rgba(201,168,76,0.06)]">
            <p className="font-cinzel text-rose-400/95 text-[9px] mb-0.5 uppercase tracking-[0.1em]">Enemy</p>
            <p className="text-empire-parchment/80 leading-tight">
              {enemies.length} unit{enemies.length !== 1 ? 's' : ''} · {Math.round(sumHp(enemies))} / {Math.round(sumMax(enemies))} HP
            </p>
          </div>
        </div>

        <div className="mb-2 p-2 rounded border border-amber-800/35 bg-gradient-to-b from-amber-950/25 to-black/35 shrink-0 shadow-[inset_0_1px_0_rgba(201,168,76,0.08)]">
          <p className="font-cinzel text-empire-gold/90 text-[9px] tracking-[0.12em] mb-0.5 uppercase">Likely victor</p>
          <p className="text-empire-parchment/95 text-[11px] font-medium leading-tight">{outlook.label}</p>
          <p className="text-empire-parchment/50 text-[9px] mt-0.5 tabular-nums leading-tight italic">
            ~{outlook.pctYou}% — rough tally of vigor and spirit (HP &amp; morale).
          </p>
        </div>

        {/* Morale bars */}
        {(() => {
          const yourOwner = yours[0]?.ownerId;
          const enemyOwner = enemies[0]?.ownerId;
          const nHex = battleClusterHexKeys.length || 1;
          const avgMorale = (owner: string | undefined) => {
            if (!owner) return 100;
            let s = 0;
            for (const hk of battleClusterHexKeys) {
              s += moraleState.get(`${hk}:${owner}`)?.morale ?? 100;
            }
            return s / nHex;
          };
          const yourMorale = avgMorale(yourOwner);
          const enMorale = avgMorale(enemyOwner);
          return (
            <div className="grid grid-cols-2 gap-2 mb-2 shrink-0">
              <div>
                <div className="flex items-center justify-between text-[10px] mb-0.5">
                  <span className="font-cinzel text-emerald-400/80 text-[9px] tracking-wide">Spirit</span>
                  <span className={`${yourMorale < 30 ? 'text-amber-400' : yourMorale < 15 ? 'text-red-400' : 'text-emerald-400/70'}`}>{Math.round(yourMorale)}</span>
                </div>
                <div className="h-1.5 bg-black/40 rounded-full overflow-hidden ring-1 ring-empire-gold/10">
                  <div className={`h-full rounded-full ${yourMorale > 30 ? 'bg-emerald-600/90' : yourMorale > 15 ? 'bg-amber-600/90' : 'bg-red-600/90'}`} style={{ width: `${yourMorale}%` }} />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between text-[10px] mb-0.5">
                  <span className="font-cinzel text-rose-400/80 text-[9px] tracking-wide">Spirit</span>
                  <span className={`${enMorale < 30 ? 'text-amber-400' : enMorale < 15 ? 'text-red-400' : 'text-rose-400/70'}`}>{Math.round(enMorale)}</span>
                </div>
                <div className="h-1.5 bg-black/40 rounded-full overflow-hidden ring-1 ring-empire-gold/10">
                  <div className={`h-full rounded-full ${enMorale > 30 ? 'bg-rose-600/90' : enMorale > 15 ? 'bg-amber-600/90' : 'bg-red-600/90'}`} style={{ width: `${enMorale}%` }} />
                </div>
              </div>
            </div>
          );
        })()}

        {/* Kill feed for this hex */}
        {(() => {
          const hexKills = killFeed.filter(k => battleClusterHexKeys.includes(k.hexKey));
          if (hexKills.length === 0) return null;
          return (
            <div className="mb-2 p-1.5 rounded border border-amber-900/30 bg-black/25 max-h-16 overflow-y-auto shrink-0 medieval-scroll shadow-[inset_0_0_12px_rgba(0,0,0,0.35)]">
              <p className="font-cinzel text-[9px] text-empire-gold/70 mb-1 uppercase tracking-[0.14em]">Casualties</p>
              {hexKills.slice(-8).map((k, i) => (
                <div key={i} className="text-[10px] text-empire-parchment/70 leading-tight">
                  <span className={k.killerOwner.includes('human') ? 'text-emerald-400' : 'text-rose-400'}>
                    {UNIT_DISPLAY_NAMES[k.killerType as UnitType] ?? k.killerType}
                  </span>
                  {' \u2192 '}
                  <span className={k.victimOwner.includes('human') ? 'text-emerald-400' : 'text-rose-400'}>
                    {UNIT_DISPLAY_NAMES[k.victimType as UnitType] ?? k.victimType}
                  </span>
                </div>
              ))}
            </div>
          );
        })()}

        <div className="flex-1 overflow-y-auto min-h-0 space-y-2 pr-0.5 medieval-scroll">
          <div>
            <p className="font-cinzel text-emerald-400/90 text-[9px] uppercase tracking-[0.12em] mb-1">Your ranks</p>
            <ul className="space-y-1">
              {yours.map(u => {
                const max = u.maxHp ?? getUnitStats(u).maxHp;
                const pct = max > 0 ? Math.round((100 * u.hp) / max) : 0;
                return (
                  <li key={u.id} className="flex items-center gap-1 text-[10px] text-empire-parchment/90">
                    <span className="w-20 truncate shrink-0">{getUnitDisplayName(u.type, u.armsLevel ?? 1, u.rangedVariant)}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-black/35 overflow-hidden ring-1 ring-emerald-900/30">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-800/90 to-emerald-600/90 rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-empire-parchment/60 tabular-nums w-12 text-right shrink-0 text-[9px]">
                      {u.hp}/{max}
                    </span>
                  </li>
                );
              })}
              {yours.length === 0 && <li className="text-empire-parchment/45 text-[10px] italic">No units here.</li>}
            </ul>
          </div>
          <div>
            <p className="font-cinzel text-rose-400/90 text-[9px] uppercase tracking-[0.12em] mb-1">Enemy ranks</p>
            <ul className="space-y-1">
              {enemies.map(u => {
                const max = u.maxHp ?? getUnitStats(u).maxHp;
                const pct = max > 0 ? Math.round((100 * u.hp) / max) : 0;
                return (
                  <li key={u.id} className="flex items-center gap-1 text-[10px] text-empire-parchment/90">
                    <span className="w-20 truncate shrink-0">{getUnitDisplayName(u.type, u.armsLevel ?? 1, u.rangedVariant)}</span>
                    <span className="text-empire-parchment/50 w-14 truncate shrink-0">{nameFor(u.ownerId)}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-black/35 overflow-hidden ring-1 ring-rose-900/30">
                      <div
                        className="h-full bg-gradient-to-r from-rose-900/90 to-rose-600/85 rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-empire-parchment/60 tabular-nums w-12 text-right shrink-0 text-[9px]">
                      {u.hp}/{max}
                    </span>
                  </li>
                );
              })}
              {enemies.length === 0 && <li className="text-empire-parchment/45 text-[10px] italic">No enemy in view.</li>}
            </ul>
          </div>
        </div>

        <div className="mt-2 pt-2 border-t border-empire-gold/15 flex flex-wrap gap-1.5 justify-end shrink-0">
          <button
            type="button"
            title="Close report and choose where to move your stack"
            onClick={() => {
              const lead = yours[0];
              if (lead) exitBattleReportToMoveMode(lead.q, lead.r);
              else closeBattleModal();
            }}
            className="font-cinzel px-2.5 py-1 text-[10px] font-bold rounded border border-amber-700/55 bg-amber-950/40 text-amber-200/95 hover:bg-amber-900/55 hover:border-amber-500/50 transition-colors tracking-wide shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
          >
            Retreat
          </button>
          <button
            type="button"
            onClick={closeBattleModal}
            className="font-cinzel px-2.5 py-1 text-[10px] font-bold rounded border border-empire-gold/35 text-empire-parchment/85 hover:bg-empire-gold/10 hover:border-empire-gold/50 transition-colors tracking-wide"
          >
            Dismiss
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}

// ─── Move Confirmation Popup ──────────────────────────────────────

function MoveConfirmPopup() {
  const pendingMove = useGameStore(s => s.pendingMove);
  const selectedHex = useGameStore(s => s.selectedHex);
  const confirmMove = useGameStore(s => s.confirmMove);
  const cancelMove = useGameStore(s => s.cancelMove);
  const getSelectedUnits = useGameStore(s => s.getSelectedUnits);
  const getUnitsAt = useGameStore(s => s.getUnitsAt);
  const getTile = useGameStore(s => s.getTile);

  if (!pendingMove || !selectedHex) return null;

  const units = getSelectedUnits();
  const dist = hexDistance(selectedHex.q, selectedHex.r, pendingMove.toQ, pendingMove.toR);
  const destTile = getTile(pendingMove.toQ, pendingMove.toR);
  const biomeName = destTile ? destTile.biome.charAt(0).toUpperCase() + destTile.biome.slice(1) : 'Unknown';

  const destUnits = getUnitsAt(pendingMove.toQ, pendingMove.toR);
  const enemiesAtDest = destUnits.filter(u => !u.ownerId.includes('human') && u.hp > 0);
  const isAttack = enemiesAtDest.length > 0;

  const borderColor = isAttack ? 'border-red-500/60' : 'border-green-500/40';
  const titleColor = isAttack ? 'text-red-400' : 'text-green-400';
  const titleText = isAttack ? 'CONFIRM ATTACK?' : 'CONFIRM MOVEMENT?';
  const btnBg = isAttack ? 'bg-red-700/60 border-red-500/70 text-red-200 hover:bg-red-600/70' : 'bg-green-700/60 border-green-500/70 text-green-200 hover:bg-green-600/70';
  const btnLabel = isAttack ? 'ATTACK' : 'MARCH';

  return (
    <div className="absolute top-20 left-1/2 -translate-x-1/2 pointer-events-auto z-20">
      <div className={`bg-empire-dark/95 border ${borderColor} rounded-lg px-6 py-4 text-center shadow-xl min-w-[280px]`}>
        <p className={`${titleColor} font-bold tracking-wide text-sm mb-2`}>{titleText}</p>

        <div className="text-xs text-empire-parchment/60 space-y-1 mb-3">
          <p>
            <span className="text-empire-parchment/40">From:</span>{' '}
            ({selectedHex.q}, {selectedHex.r})
            <span className="text-empire-parchment/30 mx-1">&rarr;</span>
            <span className="text-empire-parchment/40">To:</span>{' '}
            ({pendingMove.toQ}, {pendingMove.toR})
          </p>
          <p>
            <span className="text-empire-parchment/40">Terrain:</span>{' '}
            <span className="text-empire-parchment">{biomeName}</span>
            <span className="text-empire-parchment/30 mx-1">&bull;</span>
            <span className="text-empire-parchment/40">Distance:</span>{' '}
            <span className="text-empire-parchment">{dist} hex{dist !== 1 ? 'es' : ''}</span>
          </p>
          <p className="text-empire-parchment">
            {units.length} unit{units.length !== 1 ? 's' : ''} will {isAttack ? 'engage' : 'march'}
          </p>
          {isAttack && (
            <p className="text-red-400 font-semibold">
              &#9876; {enemiesAtDest.length} enemy unit{enemiesAtDest.length !== 1 ? 's' : ''} detected!
            </p>
          )}
        </div>

        <div className="flex gap-3 justify-center">
          <button
            onClick={confirmMove}
            className={`px-5 py-2 border rounded-lg font-bold text-xs tracking-wide transition-colors ${btnBg}`}
          >
            {btnLabel}
          </button>
          <button
            onClick={cancelMove}
            className="px-5 py-2 bg-red-900/40 border border-red-500/50 rounded-lg text-red-300 font-bold text-xs tracking-wide hover:bg-red-800/50 transition-colors"
          >
            CANCEL
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Top Bar ───────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const TRADE_RESOURCE_PACK_LABELS: Record<keyof typeof TRADE_RESOURCE_PACK_GOLD, string> = {
  food: 'Grain',
  goods: 'Goods',
  stone: 'Stone',
  iron: 'Iron',
  wood: 'Wood',
  refinedWood: 'Refined wood',
  guns: 'Arms',
  gunsL2: 'L2 arms',
};

const MAP_QUADRANT_IDS: MapQuadrantId[] = ['nw', 'ne', 'sw', 'se'];

function TradeEmporiumModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const gold = useGameStore(s => s.players.find(p => p.isHuman)?.gold ?? 0);
  const revealed = useGameStore(s => {
    const p = s.players.find(pl => pl.isHuman);
    return { ...EMPTY_MAP_QUADRANTS, ...p?.mapQuadrantsRevealed };
  });
  const buyTradeMapQuadrant = useGameStore(s => s.buyTradeMapQuadrant);
  const buyTradeMapFullAtlas = useGameStore(s => s.buyTradeMapFullAtlas);
  const buyTradeResourcePack = useGameStore(s => s.buyTradeResourcePack);
  const buyTradeMoraleFestival = useGameStore(s => s.buyTradeMoraleFestival);
  const buyTradeRoyalSurvey = useGameStore(s => s.buyTradeRoyalSurvey);

  if (!open || !mounted || typeof document === 'undefined') return null;

  const atlasOwned = revealed.nw && revealed.ne && revealed.sw && revealed.se;

  return createPortal(
    <div
      className="fixed inset-0 z-[2147483645] isolate flex items-center justify-center pointer-events-auto bg-black/50 p-3 sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="bg-empire-dark border border-empire-gold/45 rounded-xl shadow-2xl w-[min(100%,36rem)] max-h-[90vh] overflow-y-auto p-4 sm:p-5 space-y-4 relative z-10"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="trade-emporium-title"
      >
        <div className="flex justify-between items-start gap-2">
          <div>
            <h3 id="trade-emporium-title" className="text-empire-gold font-bold text-sm tracking-wide">
              Imperial trade emporium
            </h3>
            <p className="text-empire-parchment/55 text-[11px] mt-1 leading-snug">
              Spend gold on cartography, caravans, and civic boosts. Map sheets reveal enemy land units in that quarter of the world (fog still hides terrain until you scout).
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-empire-parchment/50 hover:text-empire-parchment text-xl leading-none px-1 shrink-0"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <p className="text-[11px] text-empire-gold/80">
          Your gold: <span className="font-mono font-semibold">{gold}</span>
        </p>

        <section className="space-y-2">
          <h4 className="text-[10px] font-semibold uppercase tracking-wide text-empire-parchment/50">Cartographer — map quarters</h4>
          <div className="grid grid-cols-2 gap-2">
            {MAP_QUADRANT_IDS.map(q => {
              const owned = revealed[q];
              return (
                <button
                  key={q}
                  type="button"
                  disabled={owned || gold < TRADE_MAP_QUADRANT_GOLD}
                  onClick={() => buyTradeMapQuadrant(q)}
                  className={`text-left rounded border px-2.5 py-2 text-[11px] transition-colors ${
                    owned
                      ? 'border-emerald-600/35 bg-emerald-950/25 text-emerald-200/90 cursor-default'
                      : gold >= TRADE_MAP_QUADRANT_GOLD
                        ? 'border-empire-stone/40 bg-empire-stone/10 hover:bg-empire-stone/20 text-empire-parchment'
                        : 'border-empire-stone/20 text-empire-parchment/35 cursor-not-allowed'
                  }`}
                >
                  <div className="font-semibold">{MAP_QUADRANT_LABELS[q]} sheet</div>
                  <div className={owned ? 'text-emerald-300/80' : 'text-yellow-400/90'}>
                    {owned ? 'Owned' : `${TRADE_MAP_QUADRANT_GOLD}g`}
                  </div>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            disabled={atlasOwned || gold < TRADE_MAP_FULL_ATLAS_GOLD}
            onClick={() => buyTradeMapFullAtlas()}
            className={`w-full text-left rounded border px-2.5 py-2 text-[11px] ${
              atlasOwned
                ? 'border-emerald-600/35 bg-emerald-950/20 text-emerald-200/80 cursor-default'
                : gold >= TRADE_MAP_FULL_ATLAS_GOLD
                  ? 'border-amber-600/45 bg-amber-950/25 text-amber-200 hover:bg-amber-950/35'
                  : 'border-empire-stone/20 text-empire-parchment/35 cursor-not-allowed'
            }`}
          >
            <span className="font-semibold">Full atlas (all four quarters)</span>
            <span className="block text-yellow-400/90">{atlasOwned ? 'Complete' : `${TRADE_MAP_FULL_ATLAS_GOLD}g`}</span>
          </button>
        </section>

        <section className="space-y-2">
          <h4 className="text-[10px] font-semibold uppercase tracking-wide text-empire-parchment/50">Resource caravans (split across cities)</h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {(Object.keys(TRADE_RESOURCE_PACK_GOLD) as (keyof typeof TRADE_RESOURCE_PACK_GOLD)[]).map(key => {
              const pack = TRADE_RESOURCE_PACK_GOLD[key];
              const can = gold >= pack.gold;
              return (
                <button
                  key={key}
                  type="button"
                  disabled={!can}
                  onClick={() => buyTradeResourcePack(key)}
                  className={`text-left rounded border px-2 py-1.5 text-[10px] ${
                    can
                      ? 'border-empire-stone/35 bg-stone-900/40 hover:border-empire-stone/55 text-empire-parchment'
                      : 'border-empire-stone/15 text-empire-parchment/30 cursor-not-allowed'
                  }`}
                >
                  <div className="font-medium text-empire-parchment/90">{TRADE_RESOURCE_PACK_LABELS[key]}</div>
                  <div className="text-yellow-400/85">{pack.gold}g → +{pack.amount}</div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="space-y-2">
          <h4 className="text-[10px] font-semibold uppercase tracking-wide text-empire-parchment/50">Civic &amp; scholars</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              disabled={gold < TRADE_MORALE_FESTIVAL_GOLD}
              onClick={() => buyTradeMoraleFestival()}
              className={`text-left rounded border px-2.5 py-2 text-[11px] ${
                gold >= TRADE_MORALE_FESTIVAL_GOLD
                  ? 'border-fuchsia-600/35 bg-fuchsia-950/20 hover:bg-fuchsia-950/30 text-empire-parchment'
                  : 'border-empire-stone/20 text-empire-parchment/35 cursor-not-allowed'
              }`}
            >
              <div className="font-semibold">Grand festival</div>
              <div className="text-empire-parchment/55 text-[10px]">+{TRADE_MORALE_FESTIVAL_DELTA} morale in every city</div>
              <div className="text-yellow-400/90">{TRADE_MORALE_FESTIVAL_GOLD}g</div>
            </button>
            <button
              type="button"
              disabled={gold < TRADE_ROYAL_SURVEY_GOLD}
              onClick={() => buyTradeRoyalSurvey()}
              className={`text-left rounded border px-2.5 py-2 text-[11px] ${
                gold >= TRADE_ROYAL_SURVEY_GOLD
                  ? 'border-cyan-600/35 bg-cyan-950/20 hover:bg-cyan-950/30 text-empire-parchment'
                  : 'border-empire-stone/20 text-empire-parchment/35 cursor-not-allowed'
              }`}
            >
              <div className="font-semibold">Royal survey</div>
              <div className="text-empire-parchment/55 text-[10px]">
                Map the frontier — hints for finding relic scrolls in the wilds
              </div>
              <div className="text-yellow-400/90">{TRADE_ROYAL_SURVEY_GOLD}g</div>
            </button>
          </div>
        </section>
      </div>
    </div>,
    document.body,
  );
}

function TopBar() {
  const cycle = useGameStore(s => s.cycle);
  const players = useGameStore(s => s.players);
  const cities = useGameStore(s => s.cities);
  const units = useGameStore(s => s.units);
  const territory = useGameStore(s => s.territory);
  const gameTimeRemaining = useGameStore(s => s.gameTimeRemaining);
  const cycleTimeRemaining = useGameStore(s => s.cycleTimeRemaining);
  const uiMode = useGameStore(s => s.uiMode);
  const tiles = useGameStore(s => s.tiles);
  const activeWeather = useGameStore(s => s.activeWeather);
  const gameMode = useGameStore(s => s.gameMode);
  const simSpeedMultiplier = useGameStore(s => s.simSpeedMultiplier);
  const setSimSpeedMultiplier = useGameStore(s => s.setSimSpeedMultiplier);
  const getSelectedCityForDisplay = useGameStore(s => s.getSelectedCityForDisplay);
  const pendingTacticalOrders = useGameStore(s => s.pendingTacticalOrders);
  const openTacticalMode = useGameStore(s => s.openTacticalMode);
  const contestedZoneHexKeys = useGameStore(s => s.contestedZoneHexKeys);

  const [tradeOpen, setTradeOpen] = useState(false);
  const human = players.find(p => p.isHuman);
  const isObserverMode = gameMode === 'bot_vs_bot' || gameMode === 'bot_vs_bot_4' || gameMode === 'spectate';
  const observedCity = isObserverMode ? getSelectedCityForDisplay() : null;
  const displayPlayer = isObserverMode
    ? (observedCity ? players.find(p => p.id === observedCity.ownerId) : players[0]) ?? null
    : human ?? null;
  const humanCities = cities.filter(c => c.ownerId === (displayPlayer?.id ?? human?.id));

  const citiesForResources = humanCities;
  const logisticsLabel =
    humanCities.length === 0
      ? '—'
      : `${humanCities.length} cit${humanCities.length !== 1 ? 'ies' : 'y'} · pooled economy`;

  const totalPop = humanCities.reduce((s, c) => s + c.population, 0);
  const totalGrain = citiesForResources.reduce((s, c) => s + c.storage.food, 0);
  const maxGrain = citiesForResources.reduce((s, c) => s + c.storageCap.food, 0);
  const totalArms = citiesForResources.reduce((s, c) => s + c.storage.guns, 0);
  const maxArms = citiesForResources.reduce((s, c) => s + c.storageCap.guns, 0);
  const totalStone = citiesForResources.reduce((s, c) => s + (c.storage.stone ?? 0), 0);
  const totalIron = citiesForResources.reduce((s, c) => s + (c.storage.iron ?? 0), 0);
  const totalWood = citiesForResources.reduce((s, c) => s + (c.storage.wood ?? 0), 0);
  const totalRefinedWood = citiesForResources.reduce((s, c) => s + (c.storage.refinedWood ?? 0), 0);
  const totalGunsL2 = citiesForResources.reduce((s, c) => s + (c.storage.gunsL2 ?? 0), 0);
  const totalUnits = units.filter(u => u.ownerId === (displayPlayer?.id ?? human?.id) && u.hp > 0).length;

  const harvestMult = getWeatherHarvestMultiplier(activeWeather);
  const empireVillageCount = countVillagesInPlayerTerritory(
    displayPlayer?.id ?? human?.id ?? '',
    cities,
    territory,
    tiles,
  );
  let grainPerCycle = 0;
  let armsPerCycle = 0;
  let stonePerCycle = 0;
  let ironPerCycle = 0;
  let goldPerCycle = 0;
  let woodPerCycle = 0;
  let refinedWoodPerCycle = 0;
  for (const city of citiesForResources) {
    const prod = computeCityProductionRate(city, tiles, territory, harvestMult);
    grainPerCycle += prod.food;
    armsPerCycle += prod.guns;
    stonePerCycle += prod.stone;
    ironPerCycle += prod.iron;
    woodPerCycle += prod.wood;
    refinedWoodPerCycle += prod.refinedWood;
    const taxRate = (displayPlayer ?? human)?.taxRate ?? 0.3;
    const baseTax = Math.floor(city.population * taxRate * POPULATION_TAX_GOLD_MULT);
    const moraleMod = city.morale / 100;
    let marketGold = 0;
    for (const b of city.buildings) {
      if (b.type !== 'market') continue;
      const jobs = BUILDING_JOBS.market;
      const assigned = (b as import('@/types/game').CityBuilding).assignedWorkers ?? 0;
      const staffRatio = jobs > 0 ? Math.min(1, assigned / jobs) : 0;
      marketGold += Math.floor(MARKET_GOLD_PER_VILLAGE * empireVillageCount * moraleMod * staffRatio);
    }
    goldPerCycle += baseTax + marketGold;
  }

  // Civilian consumption: 0.25 food per pop per cycle (consumptionPhase)
  const civilianFoodDemand = Math.ceil(totalPop * 0.25);
  // Military upkeep: food + guns for units in supply range of any city (empire pool)
  let militaryFoodDemand = 0;
  let militaryGunDemand = 0;
  const displayPlayerId = displayPlayer?.id ?? human?.id ?? '';
  const humanUnits = units.filter(u => u.ownerId === displayPlayerId && u.hp > 0);
  for (const u of humanUnits) {
    if (!isUnitInSupplyVicinityOfPlayerCities(u, humanCities)) continue;
    const stats = getUnitStats(u);
    militaryFoodDemand += stats.foodUpkeep;
    militaryGunDemand += stats.gunUpkeep ?? 0;
  }
  // L2 factories: 1 iron per city with L2 factory per cycle (playerResourcePhase)
  const l2FactoryCityCount = humanCities.filter(c =>
    c.buildings.some(b => b.type === 'factory' && ((b as import('@/types/game').CityBuilding).level ?? 1) >= 2),
  ).length;
  const ironConsumedPerCycle = l2FactoryCityCount;
  const ironNetPerCycle = ironPerCycle - ironConsumedPerCycle;

  const grainNetPerCycle = grainPerCycle - civilianFoodDemand - militaryFoodDemand;
  const armsNetPerCycle = armsPerCycle - militaryGunDemand;

  const urgent = gameTimeRemaining < 300;
  const grainPct = maxGrain > 0 ? Math.round((totalGrain / maxGrain) * 100) : 0;

  return (
    <>
    <TradeEmporiumModal open={tradeOpen} onClose={() => setTradeOpen(false)} />
    <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-2 bg-empire-dark/90 backdrop-blur-sm border-b border-empire-stone/30 pointer-events-auto">
      <div className="flex items-center gap-4 text-sm">
        {/* Timer */}
        <span className={`font-mono font-bold text-base ${urgent ? 'text-red-400 animate-pulse' : 'text-empire-parchment'}`}>
          {formatTime(gameTimeRemaining)}
        </span>
        {(gameMode === 'bot_vs_bot' || gameMode === 'bot_vs_bot_4' || gameMode === 'spectate') && displayPlayer && (
          <span className="text-empire-gold/80 text-xs font-medium">Observing: {displayPlayer.name}</span>
        )}
        {(gameMode === 'bot_vs_bot' || gameMode === 'bot_vs_bot_4' || gameMode === 'spectate') && (
          <div className="flex items-center gap-0.5">
            {([1, 2, 4] as const).map((speed) => (
              <button
                key={speed}
                type="button"
                onClick={() => setSimSpeedMultiplier(speed)}
                className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                  simSpeedMultiplier === speed
                    ? 'bg-empire-gold/30 text-empire-gold border border-empire-gold/50'
                    : 'bg-empire-stone/20 text-empire-parchment/70 border border-empire-stone/30 hover:bg-empire-stone/30'
                }`}
              >
                {speed}x
              </button>
            ))}
          </div>
        )}
        <div className="w-px h-5 bg-empire-stone/30" />

        <div className="flex items-center gap-1.5">
          <span className="text-empire-parchment/50 text-[10px]">Empire</span>
          <span
            className={`text-xs font-medium ${
              humanCities.length === 0
                ? 'text-empire-parchment/40'
                : grainNetPerCycle < 0
                  ? 'text-amber-400'
                  : 'text-green-400/90'
            }`}
            title="Civilian grain and military upkeep draw from all your cities (supplied units only for army upkeep preview)."
          >
            {logisticsLabel}
          </span>
        </div>
        <div className="w-px h-5 bg-empire-stone/30" />

        {/* Gold */}
        <div className="flex items-center gap-1.5">
          <span className="text-empire-parchment/50 text-xs">Gold</span>
          <span className="text-yellow-400 font-bold text-xs">{(displayPlayer ?? human)?.gold ?? 0}</span>
          <span className="text-yellow-300/70 text-[10px]">+{goldPerCycle}/c</span>
        </div>
        <div className="w-px h-5 bg-empire-stone/30" />

        {/* Grain: current/max + bar + net per-cycle rate */}
        <div className="flex items-center gap-1.5" title={`+${grainPerCycle} prod, −${civilianFoodDemand} pop, −${militaryFoodDemand} army/c`}>
          <span className="text-empire-parchment/50 text-xs">Grain</span>
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1">
              <span className="text-green-400 font-bold text-xs">{totalGrain}</span>
              <span className="text-empire-parchment/30 text-[10px]">/ {maxGrain}</span>
              <span className={`text-[10px] ${grainNetPerCycle >= 0 ? 'text-green-300/70' : 'text-red-400/80'}`}>
                {grainNetPerCycle >= 0 ? '+' : ''}{grainNetPerCycle}/c
              </span>
            </div>
            <div className="w-16 h-1 bg-empire-stone/20 rounded-full overflow-hidden">
              <div className="h-full bg-green-500/70 rounded-full transition-all" style={{ width: `${grainPct}%` }} />
            </div>
          </div>
        </div>
        <div className="w-px h-5 bg-empire-stone/30" />

        {/* Arms: current/max + net per-cycle rate (L1 only; L2 from iron) */}
        <div className="flex items-center gap-1.5" title={`+${armsPerCycle} prod, −${militaryGunDemand} army/c`}>
          <span className="text-empire-parchment/50 text-xs">Arms</span>
          <div className="flex items-center gap-1">
            <span className="text-orange-300 font-bold text-xs">{totalArms}</span>
            <span className="text-empire-parchment/30 text-[10px]">/ {maxArms}</span>
            <span className={`text-[10px] ${armsNetPerCycle >= 0 ? 'text-orange-200/70' : 'text-red-400/80'}`}>
              {armsNetPerCycle >= 0 ? '+' : ''}{armsNetPerCycle}/c
            </span>
          </div>
        </div>
        <div className="w-px h-5 bg-empire-stone/30" />
        <div className="flex items-center gap-1.5" title={`+${stonePerCycle}/c from quarries`}>
          <span className="text-empire-parchment/50 text-[10px]">Stone</span>
          <span className="text-stone-300 font-bold text-xs">{totalStone}</span>
          <span className="text-stone-300/70 text-[10px]">+{stonePerCycle}/c</span>
        </div>
        <div className="w-px h-5 bg-empire-stone/30" />
        <div className="flex items-center gap-1.5" title={`+${ironPerCycle} prod, −${ironConsumedPerCycle} L2/c`}>
          <span className="text-empire-parchment/50 text-[10px]">Iron</span>
          <span className="text-amber-300 font-bold text-xs">{totalIron}</span>
          <span className={`text-[10px] ${ironNetPerCycle >= 0 ? 'text-amber-300/70' : 'text-red-400/80'}`}>
            {ironNetPerCycle >= 0 ? '+' : ''}{ironNetPerCycle}/c
          </span>
        </div>
        <div className="w-px h-5 bg-empire-stone/30" />
        <div className="flex items-center gap-1.5" title={`+${woodPerCycle}/c wood, +${refinedWoodPerCycle}/c refined (sawmill)`}>
          <span className="text-empire-parchment/50 text-[10px]">Wood</span>
          <span className="text-emerald-400 font-bold text-xs">{totalWood}</span>
          <span className="text-emerald-300/70 text-[10px]">+{woodPerCycle}/c</span>
          <span className="text-empire-parchment/30 text-[10px]">|</span>
          <span className="text-teal-300 font-bold text-xs">{totalRefinedWood}</span>
          <span className="text-teal-300/70 text-[10px]">+{refinedWoodPerCycle}/c</span>
        </div>
        <div className="w-px h-5 bg-empire-stone/30" />
        {(() => {
          const hasL2Factory = humanCities.some(c =>
            c.buildings.some(b => b.type === 'factory' && (b.level ?? 1) >= 2)
          );
          if (!hasL2Factory && totalGunsL2 === 0) return null;
          return (
            <>
              <div className="flex items-center gap-1.5">
                <span className="text-empire-parchment/50 text-[10px]" title="Upgraded arms for L2 units">L2 Arms</span>
                <span className="text-cyan-300 font-bold text-xs">{totalGunsL2}</span>
              </div>
              <div className="w-px h-5 bg-empire-stone/30" />
            </>
          );
        })()}

        {/* Weather indicator (compact) */}
        {activeWeather && (() => {
          const wd = WEATHER_DISPLAY[activeWeather.type];
          return (
            <>
              <div className="w-px h-5 bg-empire-stone/30" />
              <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded ${
                activeWeather.type === 'typhoon' ? 'bg-cyan-900/40 border border-cyan-500/30' : 'bg-amber-900/40 border border-amber-500/30'
              }`}>
                <Image src={wd.icon} alt={wd.label} width={16} height={16} style={{ imageRendering: 'pixelated' }} />
                <span className={`text-[10px] font-bold ${wd.color}`}>{wd.label}</span>
                <span className="text-red-400 text-[10px] font-bold">-50%</span>
                <span className="text-empire-parchment/40 text-[10px]">{activeWeather.duration}c</span>
              </div>
            </>
          );
        })()}

        {/* Pop & Army */}
        <Stat label="Pop" value={totalPop} color="text-blue-300" />
        <Stat label="Army" value={totalUnits} color="text-red-300" />
        <Stat label="Cycle" value={cycle} />
        {contestedZoneHexKeys.length > 0 && (
          <span
            className="text-[10px] text-purple-300/95 max-w-[11rem] leading-tight hidden sm:inline"
            title={`Purple contested ground: more troops than your rival in the zone — every other cycle, ${CONTESTED_ZONE_GOLD_REWARD} gold or ${CONTESTED_ZONE_IRON_REWARD} iron (nearest city). Ties pay nothing.`}
          >
            Contested ground — {CONTESTED_ZONE_GOLD_REWARD}g or {CONTESTED_ZONE_IRON_REWARD} iron / 2 cycles
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Link
          href="/workflow"
          className="text-[10px] text-empire-parchment/60 hover:text-empire-gold uppercase transition-colors"
          title="Notes, ideas & backlog"
        >
          Workflow
        </Link>
        {pendingTacticalOrders !== null && (
          <span className="text-xs text-empire-gold bg-empire-gold/10 px-2 py-1 rounded">Army — Assign orders then Confirm</span>
        )}
        {uiMode === 'move' && pendingTacticalOrders === null && (
          <span className="text-xs text-green-400 bg-green-400/10 px-2 py-1 rounded">MOVE — Click destination</span>
        )}
        {!isObserverMode && (
          <>
            <button
              type="button"
              onClick={() => setTradeOpen(true)}
              className="text-[10px] uppercase text-violet-200/95 hover:text-violet-100 border border-violet-500/40 hover:border-violet-400/55 px-2 py-1 rounded transition-colors"
            >
              Trade
            </button>
            <button
              type="button"
              onClick={() => useGameStore.getState().openCivilianPanel()}
              className="text-[10px] uppercase text-indigo-300/90 hover:text-indigo-200 border border-indigo-400/40 hover:border-indigo-400/60 px-2 py-1 rounded transition-colors"
            >
              Civilian
            </button>
            <button
              type="button"
              onClick={openTacticalMode}
              className="text-[10px] uppercase text-empire-gold/90 hover:text-empire-gold border border-empire-gold/40 hover:border-empire-gold/60 px-2 py-1 rounded transition-colors"
            >
              Army
            </button>
          </>
        )}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-empire-parchment/40 uppercase">Next cycle</span>
          <div className="w-20 h-2 bg-empire-stone/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-empire-gold/60 rounded-full transition-all duration-1000"
              style={{ width: `${((30 - cycleTimeRemaining) / 30) * 100}%` }}
            />
          </div>
          <span className="text-xs text-empire-parchment/60 font-mono w-5 text-right">{cycleTimeRemaining}</span>
        </div>
      </div>
    </div>
    </>
  );
}

function Stat({ label, value, color = 'text-empire-parchment' }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-empire-parchment/50 text-xs">{label}</span>
      <span className={`font-bold ${color}`}>{value}</span>
    </div>
  );
}

// ─── Attack city setup (after map click on enemy capital) ───────────

type StackWaveForm = { w1: Partial<Record<UnitType, number>>; w2: Partial<Record<UnitType, number>> };

const SIEGE_TACTIC_IDS: SiegeTacticId[] = ['classic_four', 'boxed', 'winged'];

function formatAttackCityWaveSummary(order: { waveGroups: string[][] }): string {
  const g = order.waveGroups.filter(w => w.length > 0);
  if (g.length === 0) return '';
  if (g.length === 1) return ` (${g[0]!.length}u)`;
  return ` (${g.map((w, i) => `W${i + 1}:${w.length}`).join(' ')})`;
}

function filterStackForTacticalAttack(
  stackUnits: import('@/types/game').Unit[],
  tacticalIncludedUnitTypes: 'all' | UnitType[],
): import('@/types/game').Unit[] {
  if (tacticalIncludedUnitTypes === 'all') return stackUnits;
  const ids = new Set(unitIdsMatchingTypes(stackUnits, tacticalIncludedUnitTypes));
  return stackUnits.filter(u => ids.has(u.id));
}

const TACTIC_PREVIEW_KNIGHT_SRC = '/sprites/units/crusader_knight.png';

/** Small knight sprite used as “mock soldier” in formation thumbnails. */
function TacticKnightFigure({ dimmed }: { dimmed?: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={TACTIC_PREVIEW_KNIGHT_SRC}
      alt=""
      width={18}
      height={18}
      draggable={false}
      className={`w-[18px] h-[18px] object-contain shrink-0 select-none [image-rendering:pixelated] drop-shadow-[0_1px_0_rgba(0,0,0,0.75)] ${dimmed ? 'opacity-45' : ''}`}
    />
  );
}

/** Formation layout thumbnails using knight PNGs (same art as in-game crusader). */
function TacticStyleDiagram({ id }: { id: SiegeTacticId }) {
  if (id === 'classic_four') {
    return (
      <div className="flex flex-col gap-0.5 items-center justify-center h-[4.25rem] w-full">
        <div className="flex gap-0.5 justify-center">
          <TacticKnightFigure />
          <TacticKnightFigure />
        </div>
        <div className="flex gap-0.5 justify-center">
          <TacticKnightFigure />
          <TacticKnightFigure />
          <TacticKnightFigure />
        </div>
        <div className="flex gap-0.5 justify-center">
          <TacticKnightFigure />
          <TacticKnightFigure />
        </div>
        <div className="flex gap-0.5 justify-center">
          <TacticKnightFigure />
        </div>
      </div>
    );
  }
  if (id === 'boxed') {
    return (
      <div className="grid grid-cols-3 gap-0.5 place-items-center h-[4.25rem] w-[4.5rem] mx-auto p-1 border border-amber-600/40 rounded bg-stone-950">
        <TacticKnightFigure />
        <TacticKnightFigure />
        <TacticKnightFigure />
        <TacticKnightFigure />
        <TacticKnightFigure dimmed />
        <TacticKnightFigure />
        <TacticKnightFigure />
        <TacticKnightFigure />
        <TacticKnightFigure />
      </div>
    );
  }
  return (
    <div className="flex gap-1 items-center justify-center h-[4.25rem] w-full">
      <div className="flex flex-col gap-0.5">
        <TacticKnightFigure />
        <TacticKnightFigure />
      </div>
      <div className="flex flex-col gap-0.5">
        <TacticKnightFigure />
        <TacticKnightFigure />
        <TacticKnightFigure />
      </div>
      <div className="flex flex-col gap-0.5">
        <TacticKnightFigure />
        <TacticKnightFigure />
      </div>
    </div>
  );
}

function MarchTacticsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const defaultMarchFormation = useGameStore(s => s.defaultMarchFormation);
  const setDefaultMarchFormation = useGameStore(s => s.setDefaultMarchFormation);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!open || !mounted || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[2147483646] isolate flex items-center justify-center pointer-events-auto bg-black/50 p-3 sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="bg-empire-dark border border-empire-gold/45 rounded-xl shadow-2xl w-[min(100%,44rem)] max-w-[44rem] min-h-[min(88vh,52rem)] max-h-[94vh] overflow-y-auto overflow-x-auto p-4 sm:p-5 space-y-4 relative z-10 flex flex-col"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="march-tactics-title"
      >
        <div className="flex justify-between items-start gap-2 shrink-0">
          <div>
            <h3 id="march-tactics-title" className="text-empire-gold font-bold text-sm tracking-wide">
              Default formation & march tactics
            </h3>
            <p className="text-empire-parchment/55 text-[11px] mt-1 leading-snug">
              <span className="text-empire-gold/80 font-semibold">Default</span> keeps armies stacked on the destination hex until you enable spreading. Each field army can override this (Armies tab → “This army’s land marches”). Land moves and tactical move/intercept use the resolved setting. City assault uses wave presets separately. Saved for this session.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-empire-parchment/50 hover:text-empire-parchment text-xl leading-none px-1 shrink-0"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <label className="flex items-center gap-2 text-[11px] text-empire-parchment/80 cursor-pointer shrink-0">
          <input
            type="checkbox"
            checked={defaultMarchFormation.enabled}
            onChange={e => setDefaultMarchFormation({ enabled: e.target.checked })}
            className="rounded border-empire-stone/40"
          />
          Spread into formation (off = Default: stacked)
        </label>

        <div className="grid grid-cols-3 gap-2 sm:gap-3 flex-1 min-h-0 min-w-0 w-full">
          {SIEGE_TACTIC_IDS.map(presetId => (
            <button
              key={presetId}
              type="button"
              onClick={() => setDefaultMarchFormation({ preset: presetId })}
              className={`text-left rounded-lg border p-2 min-w-0 flex flex-col transition-colors ${
                defaultMarchFormation.preset === presetId
                  ? 'border-empire-gold/55 bg-empire-gold/10 ring-1 ring-empire-gold/30'
                  : 'border-empire-stone/35 bg-stone-900 hover:border-empire-stone/50'
              }`}
            >
              <div className="h-[6.25rem] sm:h-[7rem] flex items-center justify-center bg-stone-950 rounded-md mb-1.5 overflow-hidden border border-empire-stone/25 shrink-0">
                <div className="scale-[1.02] sm:scale-[1.08] origin-center">
                  <TacticStyleDiagram id={presetId} />
                </div>
              </div>
              <div className="text-[9px] sm:text-[10px] font-semibold text-empire-parchment/95 leading-tight">
                {SIEGE_TACTIC_META[presetId].label}
              </div>
              <p className="text-[7px] sm:text-[8px] text-empire-parchment/45 leading-snug mt-0.5 line-clamp-3">
                {SIEGE_TACTIC_META[presetId].short}
              </p>
            </button>
          ))}
        </div>

        <div className="flex gap-2 items-center text-[10px] text-empire-parchment/75 shrink-0">
          <span className="whitespace-nowrap w-12">Width</span>
          <input
            type="range"
            min={1}
            max={5}
            value={defaultMarchFormation.width}
            onChange={e => setDefaultMarchFormation({ width: Number(e.target.value) })}
            className="flex-1 min-w-0 accent-amber-500 relative z-0"
          />
          <span className="text-empire-gold/90 w-4 text-center">{defaultMarchFormation.width}</span>
        </div>
        <div className="flex gap-2 items-center text-[10px] text-empire-parchment/75 shrink-0">
          <span className="whitespace-nowrap w-12">Depth</span>
          <input
            type="range"
            min={1}
            max={5}
            value={defaultMarchFormation.depth}
            onChange={e => setDefaultMarchFormation({ depth: Number(e.target.value) })}
            className="flex-1 min-w-0 accent-amber-500 relative z-0"
          />
          <span className="text-empire-gold/90 w-4 text-center">{defaultMarchFormation.depth}</span>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="w-full px-3 py-2 text-xs font-bold rounded border border-empire-gold/45 bg-empire-gold/15 text-empire-gold hover:bg-empire-gold/25 shrink-0 mt-auto"
        >
          Done
        </button>
      </div>
    </div>,
    document.body,
  );
}

function AttackCitySetupModal() {
  const draft = useGameStore(s => s.tacticalAttackCityDraft);
  const cancel = useGameStore(s => s.cancelTacticalAttackCityDraft);
  const commit = useGameStore(s => s.commitTacticalAttackCitySetup);
  const units = useGameStore(s => s.units); // re-render stacks when units change
  const tacticalIncludedUnitTypes = useGameStore(s => s.tacticalIncludedUnitTypes);

  const [attackStyle, setAttackStyle] = useState<AttackCityStyle>('siege');
  const [setupMode, setSetupMode] = useState<'tactic' | 'manual'>('tactic');
  const [tacticPreset, setTacticPreset] = useState<SiegeTacticId>('classic_four');
  const [tacticWidth, setTacticWidth] = useState(3);
  const [tacticDepth, setTacticDepth] = useState(3);
  const [useWaves, setUseWaves] = useState(false);
  const [forms, setForms] = useState<Record<string, StackWaveForm>>({});

  const draftKey = draft ? `${draft.cityId}:${draft.stackKeys.join('|')}` : '';
  useEffect(() => {
    if (!draftKey) return;
    const d = useGameStore.getState().tacticalAttackCityDraft;
    if (!d) return;
    const uNow = useGameStore.getState().units;
    const init: Record<string, StackWaveForm> = {};
    for (const sk of d.stackKeys) {
      const [q, r] = sk.split(',').map(Number);
      const stackUnits = uNow.filter(
        x => x.q === q && x.r === r && x.ownerId === 'player_human' && x.hp > 0 && !x.aboardShipId,
      );
      const maxByType = countLandMilitaryByType(stackUnits);
      init[sk] = { w1: { ...maxByType }, w2: {} };
    }
    setForms(init);
    setAttackStyle('siege');
    setSetupMode('tactic');
    const df = useGameStore.getState().defaultMarchFormation;
    setTacticPreset(df.preset);
    setTacticWidth(df.width);
    setTacticDepth(df.depth);
    setUseWaves(false);
  }, [draftKey]);

  if (!draft) return null;

  const setCount = (stackKey: string, wave: 'w1' | 'w2', t: UnitType, raw: string) => {
    const n = Math.max(0, parseInt(raw, 10) || 0);
    setForms(prev => {
      const cur = prev[stackKey];
      if (!cur) return prev;
      const next = { ...cur, [wave]: { ...cur[wave], [t]: n } };
      return { ...prev, [stackKey]: next };
    });
  };

  const onApply = () => {
    if (setupMode === 'tactic') {
      commit({
        mode: 'tactic',
        attackStyle,
        tacticPreset,
        width: tacticWidth,
        depth: tacticDepth,
      });
      return;
    }
    const perStack: Record<string, { wave1: Partial<Record<UnitType, number>>; wave2: Partial<Record<UnitType, number>> }> = {};
    for (const sk of draft.stackKeys) {
      const f = forms[sk];
      if (!f) continue;
      if (useWaves) {
        perStack[sk] = { wave1: { ...f.w1 }, wave2: { ...f.w2 } };
      } else {
        perStack[sk] = { wave1: { ...f.w1 }, wave2: {} };
      }
    }
    commit({ mode: 'manual', attackStyle, useWaves, perStack });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-auto bg-black/55 p-4">
      <div className="bg-empire-dark/98 border border-empire-gold/50 rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-4 space-y-4">
        <div className="flex justify-between items-start gap-2">
          <div>
            <h3 className="text-empire-gold font-bold text-sm tracking-wide">Attack {draft.cityName}</h3>
            <p className="text-empire-parchment/60 text-xs mt-1">
              Pick a formation preset or set counts by type; width and depth shape how many waves march and how large the leading groups are.
            </p>
          </div>
          <button
            type="button"
            onClick={cancel}
            className="text-empire-parchment/50 hover:text-empire-parchment text-xl leading-none px-1"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="space-y-2">
          <span className="text-[10px] text-empire-parchment/40 uppercase">Attack type</span>
          <div className="flex flex-col gap-2">
            <label className="flex items-start gap-2 text-xs text-empire-parchment/90 cursor-pointer">
              <input type="radio" name="ac-style" checked={attackStyle === 'siege'} onChange={() => setAttackStyle('siege')} className="mt-0.5" />
              <span>
                <span className="text-amber-300 font-medium">Siege</span>
                <span className="text-empire-parchment/55 block">Camp outside the city, cut approach, starve the garrison; then assault from the siege panel.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-xs text-empire-parchment/90 cursor-pointer">
              <input type="radio" name="ac-style" checked={attackStyle === 'direct'} onChange={() => setAttackStyle('direct')} className="mt-0.5" />
              <span>
                <span className="text-cyan-300 font-medium">Direct attack</span>
                <span className="text-empire-parchment/55 block">March on the city center; no extra assault penalty.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-xs text-empire-parchment/90 cursor-pointer">
              <input type="radio" name="ac-style" checked={attackStyle === 'assault'} onChange={() => setAttackStyle('assault')} className="mt-0.5" />
              <span>
                <span className="text-red-300 font-medium">Assault</span>
                <span className="text-empire-parchment/55 block">Straight rush on the center — powerful but you fight at a heavy disadvantage on the walls.</span>
              </span>
            </label>
          </div>
        </div>

        <div className="space-y-2">
          <span className="text-[10px] text-empire-parchment/40 uppercase">Composition</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setSetupMode('tactic')}
              className={`flex-1 px-2 py-1.5 text-[11px] rounded border ${
                setupMode === 'tactic'
                  ? 'border-empire-gold/60 bg-empire-gold/15 text-empire-gold'
                  : 'border-empire-stone/40 text-empire-parchment/70 hover:bg-empire-stone/10'
              }`}
            >
              Tactic presets
            </button>
            <button
              type="button"
              onClick={() => setSetupMode('manual')}
              className={`flex-1 px-2 py-1.5 text-[11px] rounded border ${
                setupMode === 'manual'
                  ? 'border-empire-gold/60 bg-empire-gold/15 text-empire-gold'
                  : 'border-empire-stone/40 text-empire-parchment/70 hover:bg-empire-stone/10'
              }`}
            >
              Manual by type
            </button>
          </div>
        </div>

        {setupMode === 'tactic' && (
          <>
            <div className="space-y-2">
              <span className="text-[10px] text-empire-parchment/40 uppercase">Formation</span>
              <div className="space-y-2">
                {SIEGE_TACTIC_IDS.map(id => {
                  const meta = SIEGE_TACTIC_META[id];
                  return (
                    <label
                      key={id}
                      className={`flex items-start gap-2 text-xs cursor-pointer rounded border p-2 ${
                        tacticPreset === id ? 'border-empire-gold/50 bg-empire-gold/10' : 'border-empire-stone/30'
                      }`}
                    >
                      <input
                        type="radio"
                        name="ac-tactic"
                        checked={tacticPreset === id}
                        onChange={() => setTacticPreset(id)}
                        className="mt-0.5"
                      />
                      <span>
                        <span className="text-empire-parchment font-medium">{meta.label}</span>
                        <span className="text-empire-parchment/55 block text-[11px] leading-snug">{meta.short}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="space-y-3 border border-empire-stone/25 rounded-lg p-2">
              <div>
                <div className="flex justify-between text-[11px] text-empire-parchment/80 mb-1">
                  <span>Front width</span>
                  <span className="text-empire-gold/90">{tacticWidth}</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={5}
                  step={1}
                  value={tacticWidth}
                  onChange={e => setTacticWidth(Number(e.target.value))}
                  className="w-full accent-amber-600"
                />
                <p className="text-[10px] text-empire-parchment/45 mt-0.5">Higher = larger groups in the first wave before splitting into follow-up marches.</p>
              </div>
              <div>
                <div className="flex justify-between text-[11px] text-empire-parchment/80 mb-1">
                  <span>Echelon depth</span>
                  <span className="text-empire-gold/90">{tacticDepth}</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={5}
                  step={1}
                  value={tacticDepth}
                  onChange={e => setTacticDepth(Number(e.target.value))}
                  className="w-full accent-amber-600"
                />
                <p className="text-[10px] text-empire-parchment/45 mt-0.5">Higher = more separate waves (cavalry → line → rear).</p>
              </div>
            </div>
            <div className="space-y-2">
              <span className="text-[10px] text-empire-parchment/40 uppercase">Preview (per stack)</span>
              {draft.stackKeys.map(sk => {
                const [q, r] = sk.split(',').map(Number);
                const stackUnits = units.filter(
                  u => u.q === q && u.r === r && u.ownerId === 'player_human' && u.hp > 0 && !u.aboardShipId,
                );
                const marching = filterStackForTacticalAttack(stackUnits, tacticalIncludedUnitTypes);
                const groups = buildWaveGroupsFromTactic(marching, tacticPreset, tacticWidth, tacticDepth);
                if (marching.length === 0) {
                  return (
                    <div key={sk} className="text-[11px] text-amber-400/90 border border-amber-500/25 rounded px-2 py-1">
                      ({q},{r}) — no units match the current type filter.
                    </div>
                  );
                }
                if (groups.length === 0) {
                  return (
                    <div key={sk} className="text-[11px] text-amber-400/90 border border-amber-500/25 rounded px-2 py-1">
                      ({q},{r}) — no land army units for this formation.
                    </div>
                  );
                }
                return (
                  <div key={sk} className="text-[11px] text-empire-parchment/85 border border-empire-stone/25 rounded px-2 py-1.5 space-y-0.5">
                    <div className="text-empire-gold/90 font-medium">
                      Stack ({q}, {r})
                    </div>
                    {groups.map((g, i) => (
                      <div key={i} className="text-empire-parchment/75 pl-1">
                        Wave {i + 1}: {g.length} unit{g.length === 1 ? '' : 's'}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {setupMode === 'manual' && (
          <>
            <label className="flex items-center gap-2 text-xs text-empire-parchment/90 cursor-pointer select-none">
              <input type="checkbox" checked={useWaves} onChange={e => setUseWaves(e.target.checked)} className="rounded border-empire-stone/50" />
              <span>Send in waves (wave 2 waits until wave 1 reaches the rally point)</span>
            </label>

            {draft.stackKeys.map(sk => {
              const [q, r] = sk.split(',').map(Number);
              const f = forms[sk];
              const stackUnits = units.filter(
                u => u.q === q && u.r === r && u.ownerId === 'player_human' && u.hp > 0 && !u.aboardShipId,
              );
              const maxByType = countLandMilitaryByType(stackUnits);
              const types = Object.keys(maxByType) as UnitType[];
              if (types.length === 0) {
                return (
                  <div key={sk} className="text-xs text-amber-400 border border-amber-500/30 rounded p-2">
                    Stack ({q},{r}) has no land combat units for this attack.
                  </div>
                );
              }
              return (
                <div key={sk} className="border border-empire-stone/30 rounded-lg p-2 space-y-2">
                  <div className="text-xs text-empire-gold font-medium">Stack at ({q}, {r})</div>
                  <div className="space-y-1">
                    {types.map(t => {
                      const max = maxByType[t] ?? 0;
                      const v1 = Math.min(max, f?.w1[t] ?? 0);
                      const v2 = useWaves ? Math.min(max - v1, f?.w2[t] ?? 0) : 0;
                      return (
                        <div key={t} className="flex flex-wrap items-center gap-2 text-[11px]">
                          <span className="text-empire-parchment/80 w-24 shrink-0">{UNIT_DISPLAY_NAMES[t] ?? t}</span>
                          <span className="text-empire-parchment/40">max {max}</span>
                          {!useWaves ? (
                            <input
                              type="number"
                              min={0}
                              max={max}
                              value={v1}
                              onChange={e => setCount(sk, 'w1', t, e.target.value)}
                              className="w-16 px-1 py-0.5 rounded bg-empire-stone/20 border border-empire-stone/40 text-empire-parchment"
                            />
                          ) : (
                            <>
                              <span className="text-empire-parchment/50">W1</span>
                              <input
                                type="number"
                                min={0}
                                max={max}
                                value={v1}
                                onChange={e => setCount(sk, 'w1', t, e.target.value)}
                                className="w-14 px-1 py-0.5 rounded bg-empire-stone/20 border border-empire-stone/40 text-empire-parchment"
                              />
                              <span className="text-empire-parchment/50">W2</span>
                              <input
                                type="number"
                                min={0}
                                max={Math.max(0, max - v1)}
                                value={v2}
                                onChange={e => setCount(sk, 'w2', t, e.target.value)}
                                className="w-14 px-1 py-0.5 rounded bg-empire-stone/20 border border-empire-stone/40 text-empire-parchment"
                              />
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </>
        )}

        <div className="flex gap-2 pt-2 border-t border-empire-stone/30">
          <button
            type="button"
            onClick={onApply}
            className="flex-1 px-3 py-2 text-xs font-bold rounded border border-red-500/50 bg-red-900/30 text-red-200 hover:bg-red-800/40"
          >
            Add to orders
          </button>
          <button
            type="button"
            onClick={cancel}
            className="px-3 py-2 text-xs rounded border border-empire-stone/40 text-empire-parchment/80 hover:bg-empire-stone/20"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Builder Activity Panel (bottom-left: all active constructions) ─────

function BuilderActivityPanel() {
  const constructions = useGameStore(s => s.constructions);
  const roadConstructions = useGameStore(s => s.roadConstructions);
  const tiles = useGameStore(s => s.tiles);
  const territory = useGameStore(s => s.territory);
  const cities = useGameStore(s => s.cities);
  const gameMode = useGameStore(s => s.gameMode);
  const selectHex = useGameStore(s => s.selectHex);

  if (gameMode === 'bot_vs_bot' || gameMode === 'bot_vs_bot_4' || gameMode === 'spectate') return null;

  const humanConstructions = constructions.filter(c => c.ownerId === 'player_human');
  const humanRoads = roadConstructions.filter(r => r.ownerId === 'player_human');
  if (humanConstructions.length === 0 && humanRoads.length === 0) return null;

  const items: { key: string; label: string; pct: number; bpPerSec: number; etaSec: number; q: number; r: number }[] = [];

  for (const site of humanConstructions) {
    const availBP = computeConstructionAvailableBp(site, territory, cities, constructions);
    const bpPerSec = availBP / BP_RATE_BASE;
    const remaining = site.bpRequired - site.bpAccumulated;
    const eta = bpPerSec > 0 ? Math.ceil(remaining / bpPerSec) : Infinity;
    const pct = Math.min(100, Math.round((site.bpAccumulated / site.bpRequired) * 100));
    const typeName =
      site.type === 'city_defense' && site.defenseTowerType && site.defenseTowerTargetLevel
        ? `${DEFENSE_TOWER_DISPLAY_NAME[site.defenseTowerType]} L${site.defenseTowerTargetLevel}`
        : site.type === 'wall_section'
          ? `Wall section${site.wallBuildRing ? ` (ring ${site.wallBuildRing})` : ''}`
        : site.type.replace(/_/g, ' ');
    items.push({ key: site.id, label: typeName, pct, bpPerSec, etaSec: eta, q: site.q, r: site.r });
  }

  for (const road of humanRoads) {
    const avail = computeRoadAvailableBp(road, territory, cities);
    const bps = avail / BP_RATE_BASE;
    const rem = road.bpRequired - road.bpAccumulated;
    const eta = bps > 0 ? Math.ceil(rem / bps) : Infinity;
    const pct = Math.min(100, Math.round((road.bpAccumulated / road.bpRequired) * 100));
    items.push({ key: road.id, label: 'Road', pct, bpPerSec: bps, etaSec: eta, q: road.q, r: road.r });
  }

  return (
    <BuilderCottagePanel title={`Builder activity (${items.length})`} innerClassName="space-y-1.5 shadow-lg">
        {items.map(it => (
          <button
            key={it.key}
            type="button"
            onClick={() => selectHex(it.q, it.r)}
            className="w-full text-left group"
          >
            <div className="flex justify-between items-center text-[10px]">
              <span className="text-cottage-glow/90 capitalize group-hover:text-empire-gold/95 transition-colors truncate">
                {it.label}
              </span>
              <span className="text-cottage-brass/90 shrink-0 ml-1">
                {it.pct}% {it.etaSec < Infinity ? `~${it.etaSec}s` : 'stalled'}
              </span>
            </div>
            <div className="w-full h-1 bg-cottage-wood/80 rounded-full overflow-hidden mt-0.5">
              <div
                className={`h-full rounded-full transition-all ${it.bpPerSec > 0 ? 'bg-cottage-brass/90' : 'bg-red-500/50'}`}
                style={{ width: `${it.pct}%` }}
              />
            </div>
          </button>
        ))}
      </BuilderCottagePanel>
  );
}

function SiegeProgressPanel() {
  const cities = useGameStore(s => s.cities);
  const units = useGameStore(s => s.units);
  const gameMode = useGameStore(s => s.gameMode);
  const beginSiegeAssaultOnCity = useGameStore(s => s.beginSiegeAssaultOnCity);

  const rows = useMemo(() => {
    if (gameMode === 'bot_vs_bot' || gameMode === 'bot_vs_bot_4' || gameMode === 'spectate') return [];
    const byCity = new Map<string, number>();
    for (const u of units) {
      if (u.ownerId !== 'player_human' || u.hp <= 0 || !u.siegingCityId) continue;
      byCity.set(u.siegingCityId, (byCity.get(u.siegingCityId) ?? 0) + 1);
    }
    const out: { cityId: string; name: string; besiegers: number; starving: boolean }[] = [];
    for (const [cityId, besiegers] of byCity) {
      const c = cities.find(x => x.id === cityId);
      if (!c || c.ownerId === 'player_human') continue;
      out.push({
        cityId,
        name: c.name,
        besiegers,
        starving: c.storage.food <= 0,
      });
    }
    return out;
  }, [cities, units, gameMode]);

  if (rows.length === 0) return null;

  return (
    <div className="fixed top-20 left-1/2 -translate-x-1/2 z-30 pointer-events-auto flex flex-col gap-2 max-w-md w-[min(100%,22rem)]">
      {rows.map(row => (
        <div
          key={row.cityId}
          className="bg-empire-dark/95 border border-amber-600/40 rounded-lg px-3 py-2 shadow-xl"
        >
          <div className="text-amber-200 text-xs font-bold tracking-wide">Siege — {row.name}</div>
          <div className="text-[10px] text-empire-parchment/70 mt-1">
            Your forces outside the walls: <span className="text-empire-parchment">{row.besiegers}</span>
            {row.starving && <span className="text-red-400 ml-2">Enemy city starving (no food in stores)</span>}
            {!row.starving && <span className="text-empire-parchment/45 ml-2">Encircle and wait for attrition, or assault.</span>}
          </div>
          <button
            type="button"
            onClick={() => beginSiegeAssaultOnCity(row.cityId)}
            className="mt-2 w-full px-2 py-1.5 text-[11px] font-bold rounded border border-red-500/60 bg-red-950/40 text-red-200 hover:bg-red-900/50"
          >
            Begin assault (charge the center)
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── Tactical Panel (map stacks = selection; armies = player-created only) ─

const ARMY_DRAG_MIME = 'application/x-fallen-empire-army';
const BUILDER_SLOT_DRAG_MIME = 'application/x-fallen-empire-builder-slot';

function parseArmyDragPayload(
  e: React.DragEvent,
): { kind: 'unitStack'; stackId: string } | { kind: 'mapHex'; q: number; r: number } | null {
  let raw = e.dataTransfer.getData(ARMY_DRAG_MIME);
  if (!raw) raw = e.dataTransfer.getData('text/plain');
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as { kind?: string; stackId?: string; q?: number; r?: number };
    if (p.kind === 'unitStack' && typeof p.stackId === 'string') return { kind: 'unitStack', stackId: p.stackId };
    if (p.kind === 'mapHex' && typeof p.q === 'number' && typeof p.r === 'number') return { kind: 'mapHex', q: p.q, r: p.r };
  } catch {
    /* ignore */
  }
  return null;
}

function parseBuilderSlotDrag(e: React.DragEvent): { cityId: string; slotIndex: number } | null {
  let raw = e.dataTransfer.getData(BUILDER_SLOT_DRAG_MIME);
  if (!raw) raw = e.dataTransfer.getData('text/plain');
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as { kind?: string; cityId?: string; slotIndex?: number };
    if (p.kind === 'builderSlot' && typeof p.cityId === 'string' && typeof p.slotIndex === 'number') {
      return { cityId: p.cityId, slotIndex: p.slotIndex };
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Readable labels for human stacks — city garrison vs field vs fleet, with coords. */
function playerStackLocationLabel(
  q: number,
  r: number,
  cities: import('@/types/game').City[],
  isNavalStack: boolean,
): { role: string; place: string; coord: string } {
  const city = cities.find(c => c.ownerId === 'player_human' && c.q === q && c.r === r);
  const coord = `${q}, ${r}`;
  if (isNavalStack) {
    return {
      role: 'Fleet',
      place: city ? `${city.name} (harbor)` : 'At sea',
      coord,
    };
  }
  if (city) {
    return { role: 'Garrison', place: city.name, coord };
  }
  return { role: 'Field', place: 'Open terrain', coord };
}

/** Commander shown on a map stack row (legacy anchor / city / field_army). */
function commanderOnMapStack(
  q: number,
  r: number,
  stackIds: Set<string>,
  commanders: Commander[],
  cities: City[],
  stackUnits: import('@/types/game').Unit[],
): Commander | undefined {
  for (const c of commanders) {
    if (c.ownerId !== 'player_human' || !c.assignment) continue;
    const a = c.assignment;
    if (a.kind === 'field_army') {
      if (stackUnits.some(u => u.armyId === a.armyId)) return c;
      continue;
    }
    if (a.kind === 'field' && stackIds.has(a.anchorUnitId)) return c;
    if (a.kind === 'city_defense') {
      const city = cities.find(ct => ct.id === a.cityId);
      if (city && city.q === q && city.r === r) return c;
    }
  }
  return undefined;
}

function commanderForOperationalArmy(armyId: string, commanders: Commander[]): Commander | undefined {
  return commanders.find(
    c => c.ownerId === 'player_human' && c.assignment?.kind === 'field_army' && c.assignment.armyId === armyId,
  );
}

/** Recruit new commanders instantly for gold (no city selection, no training time). */
function CommanderRecruitOptionsInPicker({
  onRecruited,
}: {
  onRecruited?: () => void;
}) {
  const players = useGameStore(s => s.players);
  const recruitCommanderInstant = useGameStore(s => s.recruitCommanderInstant);
  const human = players.find(p => p.isHuman);
  const gold = human?.gold ?? 0;
  const canAfford = gold >= COMMANDER_RECRUIT_GOLD;
  return (
    <div className="border-t border-violet-500/30 pt-1 mt-0.5">
      <button
        type="button"
        disabled={!canAfford}
        onClick={e => {
          e.stopPropagation();
          recruitCommanderInstant();
          onRecruited?.();
        }}
        className="w-full text-left text-[10px] px-1.5 py-1 rounded border border-violet-500/35 text-violet-100 hover:bg-violet-900/45 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Recruit new commander ({COMMANDER_RECRUIT_GOLD}g)
      </button>
    </div>
  );
}

function TacticalPanel() {
  const units = useGameStore(s => s.units);
  const cities = useGameStore(s => s.cities);
  const commanders = useGameStore(s => s.commanders);
  const pendingTacticalOrders = useGameStore(s => s.pendingTacticalOrders);
  const tacticalSelectedStackKeys = useGameStore(s => s.tacticalSelectedStackKeys);
  const toggleTacticalStack = useGameStore(s => s.toggleTacticalStack);
  const confirmTacticalOrders = useGameStore(s => s.confirmTacticalOrders);
  const cancelTacticalMode = useGameStore(s => s.cancelTacticalMode);
  const assignCommanderToFieldStack = useGameStore(s => s.assignCommanderToFieldStack);
  const assignCommanderToArmy = useGameStore(s => s.assignCommanderToArmy);
  const attachSelectedStacksToArmy = useGameStore(s => s.attachSelectedStacksToArmy);
  const unassignCommander = useGameStore(s => s.unassignCommander);
  const unitStacks = useGameStore(s => s.unitStacks);
  const operationalArmies = useGameStore(s => s.operationalArmies);
  const createArmy = useGameStore(s => s.createArmy);
  const addStackToArmy = useGameStore(s => s.addStackToArmy);
  const removeStackFromArmy = useGameStore(s => s.removeStackFromArmy);
  const selectStacksForArmy = useGameStore(s => s.selectStacksForArmy);
  const deleteArmy = useGameStore(s => s.deleteArmy);
  const attachHexStackToArmy = useGameStore(s => s.attachHexStackToArmy);
  const detachHexStackFromArmy = useGameStore(s => s.detachHexStackFromArmy);
  const setArmyMarchSpread = useGameStore(s => s.setArmyMarchSpread);
  const setTacticalOrderScope = useGameStore(s => s.setTacticalOrderScope);
  const tacticalOrderScope = useGameStore(s => s.tacticalOrderScope);
  const tacticalOrderScopeArmyId = useGameStore(s => s.tacticalOrderScopeArmyId);
  const tacticalStackUnitTypeFocus = useGameStore(s => s.tacticalStackUnitTypeFocus);
  const toggleTacticalStackUnitTypeFocus = useGameStore(s => s.toggleTacticalStackUnitTypeFocus);
  const scrollInventory = useGameStore(s => s.scrollInventory);
  const scrollAttachments = useGameStore(s => s.scrollAttachments);
  const assignScrollToArmy = useGameStore(s => s.assignScrollToArmy);
  const assignScrollToUnit = useGameStore(s => s.assignScrollToUnit);
  const unassignScrollFromUnit = useGameStore(s => s.unassignScrollFromUnit);
  const startSplitStack = useGameStore(s => s.startSplitStack);
  const cancelSplitStack = useGameStore(s => s.cancelSplitStack);
  const splitStackPendingStore = useGameStore(s => s.splitStackPending);
  const selectedHex = useGameStore(s => s.selectedHex);
  const [commanderPickArmyId, setCommanderPickArmyId] = useState<string | null>(null);
  const [commanderPickNavalStackKey, setCommanderPickNavalStackKey] = useState<string | null>(null);
  const [commanderPickLandStackKey, setCommanderPickLandStackKey] = useState<string | null>(null);
  const [stackSplitOpenKey, setStackSplitOpenKey] = useState<string | null>(null);
  const [stackSplitCountStr, setStackSplitCountStr] = useState('1');
  const [armyDropHover, setArmyDropHover] = useState<string | null>(null);
  const [marchTacticsOpen, setMarchTacticsOpen] = useState(false);
  const [armyOrgTab, setArmyOrgTabState] = useState<'stacks' | 'armies'>(() => {
    if (typeof window === 'undefined') return 'stacks';
    try {
      const v = sessionStorage.getItem('fe-army-org-tab');
      if (v === 'armies') return 'armies';
      if (v === 'stacks' || v === 'divisions') return 'stacks';
    } catch {
      /* */
    }
    return 'stacks';
  });
  const setArmyOrgTab = (t: 'stacks' | 'armies') => {
    setArmyOrgTabState(t);
    try {
      sessionStorage.setItem('fe-army-org-tab', t);
    } catch {
      /* */
    }
  };
  const [armyOrderIds, setArmyOrderIds] = useState<string[]>([]);
  const [pinnedArmyId, setPinnedArmyId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      return sessionStorage.getItem('fe-army-pinned');
    } catch {
      return null;
    }
  });
  const humanStacks = (() => {
    const byKey: Record<string, { q: number; r: number; units: import('@/types/game').Unit[] }> = {};
    for (const u of units) {
      if (u.ownerId !== 'player_human' || u.hp <= 0) continue;
      const key = tileKey(u.q, u.r);
      if (!byKey[key]) byKey[key] = { q: u.q, r: u.r, units: [] };
      byKey[key].units.push(u);
    }
    return Object.values(byKey);
  })();

  const friendlyCities = cities.filter(c => c.ownerId === 'player_human');
  const humanCommanderRoster = commanders.filter(c => c.ownerId === 'player_human');
  const landAssignableStacks = humanCommanderRoster.filter(c => (c.commanderKind ?? 'land') === 'land');

  const playerTrainingStacks = unitStacks.filter(d => d.ownerId === 'player_human');
  const totalStackGroups = playerTrainingStacks.length + humanStacks.length;

  const humanOpArmies = useMemo(
    () => operationalArmies.filter(f => f.ownerId === 'player_human'),
    [operationalArmies],
  );

  useEffect(() => {
    const ids = humanOpArmies.map(a => a.id);
    setArmyOrderIds(prev => {
      let next = prev.filter(id => ids.includes(id));
      for (const id of ids) {
        if (!next.includes(id)) next.push(id);
      }
      try {
        sessionStorage.setItem('fe-army-order', JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, [humanOpArmies]);

  const sortedArmies = useMemo(() => {
    const byId = new Map(humanOpArmies.map(a => [a.id, a]));
    const ordered = armyOrderIds.map(id => byId.get(id)).filter(Boolean) as typeof humanOpArmies;
    const rest = humanOpArmies.filter(a => !armyOrderIds.includes(a.id));
    let list = [...ordered, ...rest];
    if (pinnedArmyId) {
      const p = list.find(a => a.id === pinnedArmyId);
      if (p) list = [p, ...list.filter(a => a.id !== pinnedArmyId)];
    }
    return list;
  }, [humanOpArmies, armyOrderIds, pinnedArmyId]);

  const moveArmyInList = (armyId: string, dir: -1 | 1) => {
    setArmyOrderIds(prev => {
      const idx = prev.indexOf(armyId);
      if (idx < 0) return prev;
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[j]] = [next[j], next[idx]];
      try {
        sessionStorage.setItem('fe-army-order', JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const togglePinArmy = (id: string) => {
    setPinnedArmyId(cur => {
      const next = cur === id ? null : id;
      try {
        if (next) sessionStorage.setItem('fe-army-pinned', next);
        else sessionStorage.removeItem('fe-army-pinned');
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  /** Field command modal: one primary action (confirm), secondary army actions, tertiary extras */
  const fc = {
    primary:
      'flex-1 px-3 py-2 text-xs font-semibold rounded border border-teal-500/50 bg-teal-950/45 text-teal-100 hover:bg-teal-900/50 transition-colors',
    cancel:
      'px-3 py-2 text-xs rounded border border-maproom-ink/40 bg-transparent text-empire-parchment/70 hover:bg-maproom-ink/25 hover:text-empire-parchment/90 transition-colors',
    secondary:
      'w-full text-[10px] py-1.5 rounded border border-slate-500/45 bg-slate-950/40 text-slate-100/95 hover:bg-slate-900/45 hover:border-slate-400/50 transition-colors',
    tertiary:
      'w-full text-[10px] py-1.5 rounded border border-empire-stone/35 bg-black/25 text-empire-parchment/80 hover:bg-empire-stone/15 hover:border-empire-stone/50 transition-colors',
    tertiaryInline:
      'text-[9px] px-2 py-1 rounded border border-empire-stone/35 bg-black/25 text-empire-parchment/75 hover:bg-empire-stone/15',
    detailsSummary:
      'px-1.5 py-1 cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center justify-between gap-2 text-[9px] font-semibold text-sky-200/85 uppercase tracking-wide select-none',
  };

  return (
    <div className="absolute top-14 right-2 z-[35] w-[min(100%,26rem)] pointer-events-auto max-h-[85vh] overflow-y-auto pb-4 map-scroll">
      <MapRoomPanel
        title="Field command"
        headerRight={
          <button
            type="button"
            onClick={cancelTacticalMode}
            className="w-8 h-8 flex items-center justify-center rounded text-empire-parchment/50 hover:text-empire-parchment hover:bg-maproom-ink/40 text-lg leading-none shrink-0"
            aria-label="Close"
          >
            ×
          </button>
        }
        innerClassName="space-y-3 pb-28"
      >
        <p className="text-empire-parchment/55 text-[10px]">
          Bottom bar scope:{' '}
          <strong className="text-empire-parchment/85">
            {tacticalOrderScope === 'all' && 'All forces'}
            {tacticalOrderScope === 'selected' &&
              `Selected hex groups (${tacticalSelectedStackKeys.length})`}
            {tacticalOrderScope === 'army' &&
              (() => {
                const n = humanOpArmies.find(a => a.id === tacticalOrderScopeArmyId)?.name ?? '…';
                return `Field army: ${n}`;
              })()}
          </strong>
          {' · '}
          Highlighted hexes: {tacticalSelectedStackKeys.length === 0 ? 'none' : `${tacticalSelectedStackKeys.length}`}
        </p>
        <p className="text-empire-parchment/45 text-[10px] leading-snug -mt-1">
          Map: <strong className="text-empire-parchment/75">Shift+drag</strong> to box-select stacks;{' '}
          <strong className="text-empire-parchment/75">Alt+Shift+drag</strong> adds to the selection.
        </p>

        <div className="border-t border-empire-stone/30 pt-2 flex flex-col gap-1.5">
          <div className="flex items-stretch gap-1.5 min-h-[2rem]">
            <div className="flex flex-1 min-w-0 rounded border border-teal-800/40 overflow-hidden text-[10px]">
              <button
                type="button"
                className={`flex-1 py-1.5 font-cinzel uppercase tracking-wide transition-colors ${
                  armyOrgTab === 'stacks'
                    ? 'bg-teal-950/50 text-teal-100 border-b-2 border-teal-400/75'
                    : 'bg-black/20 text-empire-parchment/55 hover:text-empire-parchment/80'
                }`}
                onClick={() => setArmyOrgTab('stacks')}
              >
                Stacks ({totalStackGroups})
              </button>
              <button
                type="button"
                className={`flex-1 py-1.5 font-cinzel uppercase tracking-wide transition-colors ${
                  armyOrgTab === 'armies'
                    ? 'bg-teal-950/45 text-teal-50 border-b-2 border-empire-gold/55'
                    : 'bg-black/20 text-empire-parchment/55 hover:text-empire-parchment/80'
                }`}
                onClick={() => setArmyOrgTab('armies')}
              >
                Armies ({sortedArmies.length})
              </button>
            </div>
            {armyOrgTab === 'armies' && (
              <button type="button" onClick={() => createArmy()} className={`shrink-0 self-stretch ${fc.tertiaryInline}`}>
                + New army
              </button>
            )}
          </div>

          {armyOrgTab === 'stacks' && (
            <div className="space-y-2">
              <details open className="rounded border border-sky-600/25 bg-sky-950/15 group">
                <summary className="px-2 py-1.5 cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center justify-between gap-2 text-[9px] font-semibold text-sky-200/90 uppercase tracking-wide select-none">
                  <span>Your stacks ({totalStackGroups})</span>
                  <span className="text-empire-parchment/45 text-[8px] group-open:rotate-180 transition-transform">▼</span>
                </summary>
                <div className="px-2 pb-2 space-y-2 border-t border-empire-stone/20 pt-2">
                <p className="text-[9px] text-empire-parchment/50 leading-snug">
                  Barracks training groups and map hex groups are all stacks — drag either onto a field army or add from the army card.
                </p>
                <div className="space-y-1">
                  <span className="text-[8px] uppercase tracking-wide text-sky-300/55">Barracks (training)</span>
                  {playerTrainingStacks.length === 0 ? (
                    <p className="text-[9px] text-amber-200/75">None — create a template when recruiting at a Barracks.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                      {playerTrainingStacks.map(st => (
                        <div
                          key={st.id}
                          draggable
                          onDragStart={e => {
                            const payload = JSON.stringify({ kind: 'unitStack', stackId: st.id });
                            e.dataTransfer.setData(ARMY_DRAG_MIME, payload);
                            e.dataTransfer.setData('text/plain', payload);
                            e.dataTransfer.effectAllowed = 'copy';
                          }}
                          className="cursor-grab active:cursor-grabbing text-[10px] px-2 py-1 rounded border border-sky-600/35 bg-sky-950/25 text-sky-100/95 hover:border-sky-500/50"
                          title={`Drag to a field army: ${st.name}`}
                        >
                          {st.name}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="space-y-1.5 pt-1 border-t border-empire-stone/20">
                  <span className="text-[8px] uppercase tracking-wide text-cyan-300/55">Map</span>
          <div className="space-y-2 max-h-44 overflow-y-auto">
            {humanStacks.length === 0 ? (
              <p className="text-empire-parchment/50 text-[11px]">No units on the map.</p>
            ) : (
              humanStacks.map(({ q, r, units: stackUnits }) => {
                const stackKey = tileKey(q, r);
                const order = pendingTacticalOrders?.[stackKey];
                const isSelected = tacticalSelectedStackKeys.includes(stackKey);
                const isMapHexSelected = selectedHex?.q === q && selectedHex?.r === r;
                const stackIds = new Set(stackUnits.map(u => u.id));
                const isNavalStack =
                  stackUnits.length > 0 && stackUnits.every(u => isNavalUnitType(u.type));
                const loc = playerStackLocationLabel(q, r, cities, isNavalStack);
                const navalAssignable = humanCommanderRoster.filter(c => (c.commanderKind ?? 'land') === 'naval');
                const counts: Record<string, number> = {};
                let status = 'idle';
                for (const u of stackUnits) {
                  counts[u.type] = (counts[u.type] ?? 0) + 1;
                  if (u.status === 'fighting') status = 'fighting';
                  else if (u.status === 'moving' && status !== 'fighting') status = 'moving';
                }
                const cmdMap = commanderOnMapStack(q, r, stackIds, commanders, cities, stackUnits);
                const typeFocus = tacticalStackUnitTypeFocus[stackKey];
                return (
                  <div
                    key={stackKey}
                    className={`rounded border p-2 select-none transition-colors flex gap-1.5 items-start ${
                      isSelected
                        ? 'border-teal-300/70 bg-teal-950/45 ring-2 ring-teal-400/45 shadow-[0_0_16px_rgba(45,212,191,0.12)]'
                        : isMapHexSelected
                          ? 'border-amber-400/55 bg-amber-950/25 ring-1 ring-amber-400/40'
                          : 'border-maproom-ink/35 bg-black/20 hover:bg-maproom-ink/20'
                    }`}
                  >
                    {!isNavalStack && (
                      <span
                        draggable
                        onDragStart={e => {
                          const payload = JSON.stringify({ kind: 'mapHex', q, r });
                          e.dataTransfer.setData(ARMY_DRAG_MIME, payload);
                          e.dataTransfer.setData('text/plain', payload);
                          e.dataTransfer.effectAllowed = 'copy';
                        }}
                        onClick={e => e.stopPropagation()}
                        className="shrink-0 mt-0.5 text-[14px] leading-none text-empire-parchment/35 hover:text-empire-gold/90 cursor-grab active:cursor-grabbing px-0.5"
                        title="Drag onto an army card to attach these troops"
                        aria-hidden
                      >
                        ⠿
                      </span>
                    )}
                    <div
                      role="button"
                      tabIndex={0}
                      className="text-xs min-w-0 flex-1 cursor-pointer"
                      onClick={() => toggleTacticalStack(stackKey)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleTacticalStack(stackKey);
                        }
                      }}
                    >
                      <div className="flex items-start gap-2 min-w-0">
                        <span className="w-[4.25rem] shrink-0 text-[9px] font-cinzel font-semibold uppercase tracking-wide text-teal-400/95 leading-tight pt-0.5">
                          {loc.role}
                        </span>
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0 min-w-0">
                            <span className="text-empire-parchment font-medium truncate" title={loc.place}>
                              {loc.place}
                            </span>
                            <span className="text-empire-parchment/55 font-mono text-[10px] tabular-nums shrink-0">
                              ({loc.coord})
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-empire-parchment/55">
                            <span>
                              {stackUnits.length} unit{stackUnits.length !== 1 ? 's' : ''}
                            </span>
                            {isSelected && (
                              <span className="text-teal-300/90 font-medium">· Orders scope</span>
                            )}
                            {isMapHexSelected && !isSelected && (
                              <span className="text-amber-300/85 font-medium">· Map selected</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div
                        className="flex flex-wrap gap-1 mt-0.5"
                        onClick={e => e.stopPropagation()}
                        onKeyDown={e => e.stopPropagation()}
                      >
                        {Object.entries(counts).map(([t, n]) =>
                          n > 0 ? (
                            <button
                              key={t}
                              type="button"
                              className={`text-[10px] px-1.5 py-0.5 rounded border bg-black/25 text-empire-parchment/85 hover:border-teal-500/45 hover:bg-teal-950/20 ${
                                typeFocus === t
                                  ? 'border-teal-400/65 ring-1 ring-teal-400/30'
                                  : 'border-empire-stone/35'
                              }`}
                              title="Scope pending orders to this unit type on this hex (click again for whole stack)"
                              onClick={e => {
                                e.stopPropagation();
                                toggleTacticalStackUnitTypeFocus(stackKey, t as UnitType);
                              }}
                            >
                              {n}× {UNIT_DISPLAY_NAMES[t as UnitType]}
                            </button>
                          ) : null,
                        )}
                      </div>
                      {typeFocus && (
                        <p className="text-[9px] text-cyan-300/80 mt-0.5">
                          Orders: {UNIT_DISPLAY_NAMES[typeFocus]} only — click the type again to order the full stack.
                        </p>
                      )}
                      {splitStackPendingStore &&
                        splitStackPendingStore.fromQ === q &&
                        splitStackPendingStore.fromR === r && (
                          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1 rounded border border-cyan-600/35 bg-cyan-950/20 px-2 py-1">
                            <p className="text-[9px] text-cyan-300/90">
                              Splitting {splitStackPendingStore.count} unit(s) — adjacent land (armies) or water (fleets)
                            </p>
                            <button
                              type="button"
                              className="text-[9px] px-1.5 py-0.5 rounded border border-empire-stone/40 text-empire-parchment/80 hover:bg-empire-stone/20 shrink-0"
                              onClick={e => {
                                e.stopPropagation();
                                cancelSplitStack();
                                setStackSplitOpenKey(null);
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                      {!isNavalStack && stackUnits.length > 1 && (
                        <div
                          className="mt-1.5"
                          onClick={e => e.stopPropagation()}
                          onKeyDown={e => e.stopPropagation()}
                        >
                          {stackSplitOpenKey !== stackKey ? (
                            <button
                              type="button"
                              className="text-[9px] px-2 py-0.5 rounded border border-teal-600/45 bg-teal-950/30 text-teal-200/95 hover:bg-teal-900/35"
                              onClick={e => {
                                e.stopPropagation();
                                setStackSplitOpenKey(stackKey);
                                setStackSplitCountStr('1');
                              }}
                            >
                              Split off…
                            </button>
                          ) : (
                            <div className="flex flex-wrap items-center gap-1.5">
                              <label className="text-[9px] text-empire-parchment/60 flex items-center gap-1">
                                Move count
                                <input
                                  type="number"
                                  min={1}
                                  max={Math.max(1, stackUnits.length - 1)}
                                  value={stackSplitCountStr}
                                  onChange={e => setStackSplitCountStr(e.target.value)}
                                  className="w-12 px-1 py-0.5 rounded border border-empire-stone/35 bg-black/40 text-empire-parchment text-[10px]"
                                />
                              </label>
                              <button
                                type="button"
                                className="text-[9px] px-2 py-0.5 rounded border border-teal-500/50 bg-teal-950/40 text-teal-100"
                                onClick={e => {
                                  e.stopPropagation();
                                  const raw = parseInt(stackSplitCountStr, 10);
                                  const n = Math.max(1, Math.min(raw, stackUnits.length - 1));
                                  startSplitStack(n, q, r);
                                  setStackSplitOpenKey(null);
                                }}
                              >
                                Start split
                              </button>
                              <button
                                type="button"
                                className="text-[9px] px-2 py-0.5 rounded border border-empire-stone/35 text-empire-parchment/70"
                                onClick={e => {
                                  e.stopPropagation();
                                  setStackSplitOpenKey(null);
                                }}
                              >
                                Close
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                      {!isNavalStack && (
                        <div
                          className="mt-2 flex flex-wrap gap-2 items-end"
                          onClick={e => e.stopPropagation()}
                          onKeyDown={e => e.stopPropagation()}
                        >
                          <div className="flex flex-col items-center gap-0.5 max-w-[4.5rem] relative">
                            <button
                              type="button"
                              className={`w-11 h-11 rounded-md border-2 flex items-center justify-center overflow-hidden shrink-0 cursor-pointer transition-colors ${
                                cmdMap
                                  ? 'border-violet-400/60 bg-violet-950/35 hover:bg-violet-900/40'
                                  : 'border-dashed border-violet-600/45 bg-black/25 hover:border-violet-500/55 hover:bg-violet-950/20'
                              }`}
                              title={cmdMap ? `${cmdMap.name} — field commander` : 'Land commander'}
                              onClick={e => {
                                e.stopPropagation();
                                setCommanderPickLandStackKey(commanderPickLandStackKey === stackKey ? null : stackKey);
                              }}
                            >
                              {cmdMap?.portraitDataUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={cmdMap.portraitDataUrl}
                                  alt=""
                                  className="w-full h-full object-cover"
                                  style={{ imageRendering: 'pixelated' }}
                                />
                              ) : (
                                <span className="text-[9px] text-violet-500/45 text-center px-0.5">Empty</span>
                              )}
                            </button>
                            <span className="text-[8px] uppercase tracking-wide text-violet-300/50">Commander</span>
                            {commanderPickLandStackKey === stackKey && (
                              <div className="absolute left-0 top-full z-20 w-[min(14rem,calc(100vw-2rem))] mt-0.5 rounded border border-violet-500/40 bg-black/90 p-1 space-y-0.5 shadow-lg">
                                {landAssignableStacks.map(c => (
                                  <button
                                    key={c.id}
                                    type="button"
                                    className="w-full text-left text-[10px] px-1.5 py-1 rounded hover:bg-violet-900/50 text-violet-100"
                                    onClick={e => {
                                      e.stopPropagation();
                                      assignCommanderToFieldStack(c.id, q, r);
                                      setCommanderPickLandStackKey(null);
                                    }}
                                  >
                                    {c.name}
                                  </button>
                                ))}
                                <CommanderRecruitOptionsInPicker onRecruited={() => setCommanderPickLandStackKey(null)} />
                                {cmdMap && (
                                  <button
                                    type="button"
                                    className="w-full text-[9px] text-empire-parchment/50 px-1.5 py-1 hover:bg-empire-stone/20 rounded border-t border-violet-500/25 mt-0.5 pt-1"
                                    onClick={e => {
                                      e.stopPropagation();
                                      unassignCommander(cmdMap.id);
                                      setCommanderPickLandStackKey(null);
                                    }}
                                  >
                                    Clear commander
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                          {(() => {
                            const stackUnitIds = new Set(stackUnits.map(u => u.id));
                            const hexScrollAttachments = scrollAttachments.filter(
                              a => a.ownerId === 'player_human' && stackUnitIds.has(a.carrierUnitId),
                            );
                            const humanScrollInv = scrollInventory['player_human'] ?? [];
                            const assignScrollToThisStack = (scrollItemId: string) => {
                              const land = stackUnits.filter(
                                u => !isNavalUnitType(u.type) && u.type !== 'builder' && u.hp > 0,
                              );
                              const withArmy = land.find(u => u.armyId);
                              if (withArmy?.armyId) {
                                assignScrollToArmy(scrollItemId, withArmy.armyId);
                                return;
                              }
                              const carrier = land.find(u => !scrollAttachments.some(a => a.carrierUnitId === u.id));
                              if (carrier) assignScrollToUnit(scrollItemId, carrier.id);
                            };
                            return (
                              <FieldCommandScrollBoxes
                                inventory={humanScrollInv}
                                attachments={hexScrollAttachments}
                                onAssignFromInventory={assignScrollToThisStack}
                                onReturnAttachment={unassignScrollFromUnit}
                              />
                            );
                          })()}
                        </div>
                      )}
                      {isNavalStack && (
                        <div
                          className="mt-2 flex flex-wrap gap-1.5 items-end"
                          onClick={e => e.stopPropagation()}
                          onKeyDown={e => e.stopPropagation()}
                        >
                          <div className="flex flex-col items-center gap-0.5 max-w-[4.5rem] relative">
                            <button
                              type="button"
                              className={`w-11 h-11 rounded-md border-2 flex items-center justify-center overflow-hidden shrink-0 cursor-pointer transition-colors ${
                                cmdMap
                                  ? 'border-violet-400/60 bg-violet-950/35 hover:bg-violet-900/40'
                                  : 'border-dashed border-violet-600/45 bg-black/25 hover:border-violet-500/55 hover:bg-violet-950/20'
                              }`}
                              title={cmdMap ? `${cmdMap.name} — fleet commander` : 'Fleet commander'}
                              onClick={e => {
                                e.stopPropagation();
                                setCommanderPickNavalStackKey(commanderPickNavalStackKey === stackKey ? null : stackKey);
                              }}
                            >
                              {cmdMap?.portraitDataUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={cmdMap.portraitDataUrl}
                                  alt=""
                                  className="w-full h-full object-cover"
                                  style={{ imageRendering: 'pixelated' }}
                                />
                              ) : (
                                <span className="text-[9px] text-violet-500/45 text-center px-0.5">Empty</span>
                              )}
                            </button>
                            <span className="text-[8px] uppercase tracking-wide text-violet-300/50">Commander</span>
                            {commanderPickNavalStackKey === stackKey && (
                              <div className="absolute left-0 top-full z-20 w-[min(14rem,calc(100vw-2rem))] mt-0.5 rounded border border-violet-500/40 bg-black/90 p-1 space-y-0.5 shadow-lg">
                                {navalAssignable.map(c => (
                                  <button
                                    key={c.id}
                                    type="button"
                                    className="w-full text-left text-[10px] px-1.5 py-1 rounded hover:bg-violet-900/50 text-violet-100"
                                    onClick={e => {
                                      e.stopPropagation();
                                      assignCommanderToFieldStack(c.id, q, r);
                                      setCommanderPickNavalStackKey(null);
                                    }}
                                  >
                                    {c.name}
                                  </button>
                                ))}
                                <CommanderRecruitOptionsInPicker onRecruited={() => setCommanderPickNavalStackKey(null)} />
                                {cmdMap && (
                                  <button
                                    type="button"
                                    className="w-full text-[9px] text-empire-parchment/50 px-1.5 py-1 hover:bg-empire-stone/20 rounded border-t border-violet-500/25 mt-0.5 pt-1"
                                    onClick={e => {
                                      e.stopPropagation();
                                      unassignCommander(cmdMap.id);
                                      setCommanderPickNavalStackKey(null);
                                    }}
                                  >
                                    Clear commander
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                      <span
                        className={`text-[10px] block mt-1 ${status === 'fighting' ? 'text-red-400' : status === 'moving' ? 'text-green-400' : 'text-empire-parchment/50'}`}
                      >
                        Status: {status}
                      </span>
                    </div>
                    {order && (
                      <div className="text-[10px] text-empire-gold/80 mt-1">
                        {order.type === 'defend' && order.cityId
                          ? `Defend ${friendlyCities.find(c => c.id === order.cityId)?.name ?? 'city'}`
                          : order.type === 'city_defense' && order.cityId
                            ? `City defense ${order.mode === 'stagnant' ? '(walls) ' : '(patrol) '}${friendlyCities.find(c => c.id === order.cityId)?.name ?? 'city'}`
                            : order.type === 'patrol'
                              ? `Patrol (${order.centerQ},${order.centerR}) r${order.radius}`
                              : order.type === 'move' || order.type === 'intercept'
                                ? `→ (${order.toQ}, ${order.toR})`
                                : order.type === 'incorporate_village'
                                  ? `Incorporate → (${order.toQ}, ${order.toR})`
                                  : order.type === 'attack_city'
                                    ? (() => {
                                        const ec = cities.find(c => c.id === order.cityId);
                                        return `Attack ${ec?.name ?? 'city'} — ${order.attackStyle}${formatAttackCityWaveSummary(order)}`;
                                      })()
                                    : order.type === 'attack_building' && order.cityId
                                      ? `Raid building (${order.buildingQ},${order.buildingR}) — ${cities.find(c => c.id === order.cityId)?.name ?? 'city'}`
                                      : ''}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
                </div>
                </div>
              </details>
            </div>
          )}

          {armyOrgTab === 'armies' && (
            <div className="space-y-1.5">
          {sortedArmies.length === 0 ? (
            <p className="text-[11px] text-empire-parchment/45 py-1">No field armies yet — use + New army next to the tabs.</p>
          ) : (
            sortedArmies.map(fa => {
                const stackIds = fa.stackIds ?? [];
                const landInArmy = units.filter(
                  u =>
                    u.ownerId === 'player_human' &&
                    u.hp > 0 &&
                    u.armyId === fa.id &&
                    !u.aboardShipId &&
                    u.type !== 'builder' &&
                    !isNavalUnitType(u.type),
                );
                const cmd = commanderForOperationalArmy(fa.id, commanders);
                const landAssignable = humanCommanderRoster.filter(c => (c.commanderKind ?? 'land') === 'land');
                const byHex = new Map<string, import('@/types/game').Unit[]>();
                for (const u of landInArmy) {
                  const k = tileKey(u.q, u.r);
                  if (!byHex.has(k)) byHex.set(k, []);
                  byHex.get(k)!.push(u);
                }
                const hexEntries = [...byHex.entries()];
                const landSummary = (() => {
                  if (landInArmy.length === 0) return 'No land units — attach stacks from the map list';
                  if (hexEntries.length === 0) return `${landInArmy.length} land units`;
                  if (hexEntries.length === 1) {
                    const [k, us] = hexEntries[0]!;
                    const [hq, hr] = k.split(',').map(Number);
                    const cityAt = friendlyCities.find(c => c.q === hq && c.r === hr);
                    return cityAt
                      ? `${us.length} land unit${us.length !== 1 ? 's' : ''} · Garrison ${cityAt.name} (${hq}, ${hr})`
                      : `${us.length} land unit${us.length !== 1 ? 's' : ''} · Field (${hq}, ${hr})`;
                  }
                  return `${landInArmy.length} land units · ${hexEntries.length} map hexes`;
                })();
                const linkedParts: string[] = [];
                if (stackIds.length > 0) {
                  linkedParts.push(
                    `Training: ${stackIds.map(id => unitStacks.find(d => d.id === id)?.name ?? id).join(', ')}`,
                  );
                }
                if (byHex.size > 0) {
                  linkedParts.push(hexEntries.length === 1 ? 'Map: 1 hex' : `Map: ${hexEntries.length} hexes`);
                }
                const linkedLine = linkedParts.length === 0 ? '—' : linkedParts.join(' · ');
                const barracksLeft = playerTrainingStacks.some(d => !stackIds.includes(d.id));
                const mapLeft = humanStacks.some(({ units: stackUnits }) => {
                  const land = stackUnits.filter(
                    u =>
                      u.hp > 0 &&
                      !u.aboardShipId &&
                      u.type !== 'builder' &&
                      !isNavalUnitType(u.type),
                  );
                  if (land.length === 0) return false;
                  return !land.every(u => u.armyId === fa.id);
                });
                const canAttachMore = barracksLeft || mapLeft;
                const distinctLandHexKeys = [...new Set(landInArmy.map(u => tileKey(u.q, u.r)))];
                const showPendingHexLabel = distinctLandHexKeys.length > 1;
                const multiHex = hexEntries.length > 1;

                return (
                  <div
                    key={fa.id}
                    className={`rounded border px-2 py-1.5 space-y-1.5 transition-colors ${
                      armyDropHover === fa.id
                        ? 'border-empire-gold/70 bg-empire-gold/10 ring-1 ring-empire-gold/35'
                        : 'border-sky-500/25 bg-sky-950/15'
                    }`}
                    onDragOver={e => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'copy';
                    }}
                    onDragEnter={e => {
                      e.preventDefault();
                      setArmyDropHover(fa.id);
                    }}
                    onDragLeave={e => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) setArmyDropHover(null);
                    }}
                    onDrop={e => {
                      e.preventDefault();
                      setArmyDropHover(null);
                      const p = parseArmyDragPayload(e);
                      if (!p) return;
                      if (p.kind === 'unitStack') addStackToArmy(fa.id, p.stackId);
                      else attachHexStackToArmy(fa.id, p.q, p.r);
                    }}
                  >
                    <div className="flex justify-between items-center gap-2">
                      <span className="text-[11px] text-empire-parchment font-medium">{fa.name}</span>
                      <button
                        type="button"
                        className="text-[9px] text-red-300/80 hover:underline"
                        onClick={() => deleteArmy(fa.id)}
                      >
                        Disband
                      </button>
                    </div>
                    <div className="text-[9px] text-empire-parchment/60 leading-snug">{landSummary}</div>
                    <button
                      type="button"
                      onClick={() => selectStacksForArmy(fa.id)}
                      className={fc.secondary}
                    >
                      Select stacks for army (orders)
                    </button>
                    <button type="button" onClick={() => setMarchTacticsOpen(true)} className={fc.tertiary}>
                      Default formation & tactics…
                    </button>
                    <label className="block text-[9px] text-empire-parchment/55">
                      <span className="block mb-0.5">This army’s land marches</span>
                      <select
                        className="w-full text-[9px] px-1 py-0.5 rounded border border-empire-stone/40 bg-black/40"
                        value={fa.marchSpread ?? 'inherit'}
                        onChange={e =>
                          setArmyMarchSpread(fa.id, e.target.value as ArmyMarchSpreadMode)
                        }
                      >
                        <option value="inherit">Session default (modal above)</option>
                        <option value="spread">Always spread (needs 2+ military)</option>
                        <option value="stack">Always stacked</option>
                      </select>
                    </label>

                    <details open className="rounded border border-sky-800/30 bg-black/15">
                      <summary className={`${fc.detailsSummary} rounded-t`}>
                        <span>Attached stacks</span>
                        <span className="text-empire-parchment/35 text-[8px] normal-case">▼</span>
                      </summary>
                      <div className="px-1.5 pb-1.5 space-y-1 border-t border-empire-stone/20 pt-1.5">
                        <div className="text-[9px] text-empire-parchment/50 leading-snug">
                          Linked: {linkedLine}
                        </div>
                        <select
                          key={`add-stack-${fa.id}-${stackIds.join('|')}-${[...byHex.keys()].join(';')}-${playerTrainingStacks.length}`}
                          className="w-full text-[9px] px-1 py-0.5 rounded border border-empire-stone/40 bg-black/40"
                          defaultValue=""
                          onChange={e => {
                            const v = e.currentTarget.value;
                            if (!v) return;
                            if (v.startsWith('us:')) addStackToArmy(fa.id, v.slice(3));
                            else if (v.startsWith('hex:')) {
                              const [qs, rs] = v.slice(4).split(',');
                              const q = Number(qs);
                              const r = Number(rs);
                              if (!Number.isFinite(q) || !Number.isFinite(r)) return;
                              attachHexStackToArmy(fa.id, q, r);
                            }
                            e.currentTarget.value = '';
                          }}
                        >
                          <option value="">+ Add stack…</option>
                          {playerTrainingStacks.length > 0 && (
                            <optgroup label="Barracks (training)">
                              {playerTrainingStacks.map(d => (
                                <option key={d.id} value={`us:${d.id}`} disabled={stackIds.includes(d.id)}>
                                  {d.name}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {(() => {
                            const mapOpts = humanStacks
                              .map(({ q, r, units: stackUnits }) => {
                                const land = stackUnits.filter(
                                  su =>
                                    su.hp > 0 &&
                                    !su.aboardShipId &&
                                    su.type !== 'builder' &&
                                    !isNavalUnitType(su.type),
                                );
                                if (land.length === 0) return null;
                                if (land.every(su => su.armyId === fa.id)) return null;
                                const cityAt = friendlyCities.find(c => c.q === q && c.r === r);
                                return { q, r, n: land.length, cityAt };
                              })
                              .filter((x): x is { q: number; r: number; n: number; cityAt: import('@/types/game').City | undefined } => x !== null);
                            if (mapOpts.length === 0) return null;
                            return (
                              <optgroup label="Map (hex)">
                                {mapOpts.map(({ q, r, n, cityAt }) => (
                                  <option key={`hex-${q},${r}`} value={`hex:${q},${r}`}>
                                    {cityAt
                                      ? `Garrison · ${cityAt.name} · (${q}, ${r}) — ${n} land`
                                      : `Field · (${q}, ${r}) — ${n} land`}
                                  </option>
                                ))}
                              </optgroup>
                            );
                          })()}
                        </select>
                        <p className="text-[8px] text-empire-parchment/45 leading-snug">
                          {canAttachMore
                            ? 'Pick a training group or map hex from the list to attach.'
                            : 'Nothing left to attach — train more at a Barracks or move troops on the map.'}
                        </p>
                        {stackIds.map(sid => (
                          <div key={sid} className="flex justify-between text-[9px] text-empire-parchment/70">
                            <span>Training: {unitStacks.find(d => d.id === sid)?.name ?? sid}</span>
                            <button type="button" className="text-red-300/70" onClick={() => removeStackFromArmy(fa.id, sid)}>
                              ×
                            </button>
                          </div>
                        ))}
                        {[...byHex.entries()].map(([k, us]) => {
                          const [hq, hr] = k.split(',').map(Number);
                          const cityAtHex = friendlyCities.find(c => c.q === hq && c.r === hr);
                          const rowLabel = cityAtHex
                            ? `Garrison · ${cityAtHex.name} · (${hq}, ${hr}) — ${us.length} unit${us.length !== 1 ? 's' : ''}`
                            : hexEntries.length === 1
                              ? `Field stack · (${hq}, ${hr}) — ${us.length} unit${us.length !== 1 ? 's' : ''}`
                              : `Field · (${hq}, ${hr}) — ${us.length} unit${us.length !== 1 ? 's' : ''}`;
                          return (
                            <div key={`maplnk-${fa.id}-${k}`} className="flex justify-between gap-2 text-[9px] text-empire-parchment/80 items-start">
                              <span className="text-left leading-snug min-w-0">{rowLabel}</span>
                              <button
                                type="button"
                                className="text-red-300/70 shrink-0"
                                onClick={() => detachHexStackFromArmy(fa.id, hq, hr)}
                              >
                                ×
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </details>

                    <details open className="rounded border border-violet-900/35 bg-black/15">
                      <summary className={`${fc.detailsSummary} rounded-t text-violet-200/90`}>
                        <span>Commander & scrolls</span>
                        <span className="text-empire-parchment/35 text-[8px] normal-case">▼</span>
                      </summary>
                      <div
                        className="flex flex-wrap gap-2 items-end px-1.5 pb-1.5 pt-1 border-t border-violet-900/25"
                        onClick={e => e.stopPropagation()}
                        onKeyDown={e => e.stopPropagation()}
                      >
                        <div className="flex flex-col items-center gap-0.5 max-w-[4.5rem] relative">
                          <button
                            type="button"
                            className={`w-11 h-11 rounded-md border-2 flex items-center justify-center overflow-hidden shrink-0 cursor-pointer transition-colors ${
                              cmd
                                ? 'border-violet-400/60 bg-violet-950/35 hover:bg-violet-900/40'
                                : 'border-dashed border-violet-600/45 bg-black/25 hover:border-violet-500/55 hover:bg-violet-950/20'
                            }`}
                            title={cmd ? `${cmd.name} — click to change` : 'Commander — attach units first'}
                            onClick={e => {
                              e.stopPropagation();
                              setCommanderPickArmyId(commanderPickArmyId === fa.id ? null : fa.id);
                            }}
                          >
                            {cmd?.portraitDataUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={cmd.portraitDataUrl} alt="" className="w-full h-full object-cover" style={{ imageRendering: 'pixelated' }} />
                            ) : (
                              <span className="text-[9px] text-violet-500/45 text-center px-0.5">Empty</span>
                            )}
                          </button>
                          <span className="text-[8px] uppercase tracking-wide text-violet-300/50">Commander</span>
                          {cmd && (
                            <span className="text-[9px] text-violet-200/90 text-center leading-tight line-clamp-2 w-full">{cmd.name}</span>
                          )}
                          {commanderPickArmyId === fa.id && (
                            <div className="absolute left-0 top-full z-20 w-[min(14rem,calc(100vw-2rem))] mt-0.5 rounded border border-violet-500/40 bg-black/90 p-1 space-y-0.5 shadow-lg">
                              {landAssignable.length > 0 && (
                                <div className="text-[9px] font-semibold text-violet-300/80 px-1">Assign to army</div>
                              )}
                              {landAssignable.map(c => (
                                <button
                                  key={c.id}
                                  type="button"
                                  className="w-full text-left text-[10px] px-1.5 py-1 rounded hover:bg-violet-900/50 text-violet-100"
                                  onClick={e => {
                                    e.stopPropagation();
                                    assignCommanderToArmy(c.id, fa.id);
                                    setCommanderPickArmyId(null);
                                  }}
                                >
                                  {c.name}
                                </button>
                              ))}
                              <CommanderRecruitOptionsInPicker onRecruited={() => setCommanderPickArmyId(null)} />
                              {cmd && (
                                <button
                                  type="button"
                                  className="w-full text-[9px] text-empire-parchment/50 px-1.5 py-1 hover:bg-empire-stone/20 rounded border-t border-violet-500/25 mt-0.5 pt-1"
                                  onClick={e => {
                                    e.stopPropagation();
                                    unassignCommander(cmd.id);
                                    setCommanderPickArmyId(null);
                                  }}
                                >
                                  Clear commander
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                        {(() => {
                          const humanInv = scrollInventory['player_human'] ?? [];
                          const armyUnitIds = new Set(landInArmy.map(u => u.id));
                          const armyAttachments = scrollAttachments.filter(
                            a =>
                              a.ownerId === 'player_human' &&
                              (a.armyId === fa.id || armyUnitIds.has(a.carrierUnitId)),
                          );
                          return (
                            <FieldCommandScrollBoxes
                              inventory={humanInv}
                              attachments={armyAttachments}
                              onAssignFromInventory={sid => assignScrollToArmy(sid, fa.id)}
                              onReturnAttachment={unassignScrollFromUnit}
                            />
                          );
                        })()}
                      </div>
                    </details>

                    <details open className="rounded border border-empire-stone/30 bg-black/15">
                      <summary className={`${fc.detailsSummary} rounded-t text-empire-parchment/75`}>
                        <span>Unit orders & pending</span>
                        <span className="text-empire-parchment/35 text-[8px] normal-case">▼</span>
                      </summary>
                      <div className="px-1.5 pb-1.5 space-y-1.5 border-t border-empire-stone/20 pt-1.5">
                        {[...byHex.entries()].map(([stackKey, stackUnits]) => {
                          if (stackUnits.length <= 1) return null;
                          const q = stackUnits[0]!.q;
                          const r = stackUnits[0]!.r;
                          const typeCounts: Record<string, number> = {};
                          for (const u of stackUnits) {
                            typeCounts[u.type] = (typeCounts[u.type] ?? 0) + 1;
                          }
                          const typeFocus = tacticalStackUnitTypeFocus[stackKey];
                          return (
                            <div
                              key={`${fa.id}-${stackKey}`}
                              className="rounded border border-empire-stone/25 bg-empire-stone/8 px-1.5 py-1"
                              onClick={e => e.stopPropagation()}
                              onKeyDown={e => e.stopPropagation()}
                            >
                              <div className="text-[9px] mb-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                {(() => {
                                  const loc = playerStackLocationLabel(q, r, cities, false);
                                  return (
                                    <>
                                      <span className="font-cinzel uppercase text-[8px] text-teal-400/90 w-[4.25rem] shrink-0">
                                        {loc.role}
                                      </span>
                                      <span className="text-empire-parchment/85 font-medium truncate min-w-0">{loc.place}</span>
                                      <span className="text-empire-parchment/45 font-mono tabular-nums shrink-0">
                                        ({loc.coord})
                                      </span>
                                    </>
                                  );
                                })()}
                                <span className="text-empire-parchment/45 w-full sm:w-auto">
                                  {multiHex ? '· click a type to scope' : '· click a type to scope orders'}
                                </span>
                              </div>
                              <div className="flex flex-wrap gap-1">
                                {Object.entries(typeCounts).map(([t, n]) =>
                                  n > 0 ? (
                                    <button
                                      key={t}
                                      type="button"
                                      className={`text-[9px] px-1.5 py-0.5 rounded border bg-black/25 text-empire-parchment/85 hover:border-cyan-500/50 ${
                                        typeFocus === t
                                          ? 'border-cyan-400/70 ring-1 ring-cyan-400/35'
                                          : 'border-empire-stone/35'
                                      }`}
                                      title="Scope pending orders to this unit type (click again for whole stack)"
                                      onClick={() => toggleTacticalStackUnitTypeFocus(stackKey, t as UnitType)}
                                    >
                                      {n}× {UNIT_DISPLAY_NAMES[t as UnitType]}
                                    </button>
                                  ) : null,
                                )}
                              </div>
                              {typeFocus && (
                                <p className="text-[8px] text-cyan-300/75 mt-0.5">
                                  Orders: {UNIT_DISPLAY_NAMES[typeFocus]} only
                                </p>
                              )}
                            </div>
                          );
                        })}
                        {landInArmy.length > 0 &&
                          distinctLandHexKeys.map(sk => {
                            const order = pendingTacticalOrders?.[sk];
                            if (!order) return null;
                            const [pq, pr] = sk.split(',').map(Number);
                            const pendingLead = showPendingHexLabel ? `Pending (${pq},${pr})` : 'Pending';
                            return (
                              <div key={`${fa.id}-ord-${sk}`} className="text-[10px] text-empire-gold/80">
                                {pendingLead}:{' '}
                                {order.type === 'defend' && order.cityId
                                  ? `Defend ${friendlyCities.find(c => c.id === order.cityId)?.name ?? 'city'}`
                                  : order.type === 'city_defense' && order.cityId
                                    ? `City defense ${order.mode === 'stagnant' ? '(walls) ' : '(patrol) '}${friendlyCities.find(c => c.id === order.cityId)?.name ?? 'city'}`
                                    : order.type === 'patrol'
                                      ? `Patrol (${order.centerQ},${order.centerR}) r${order.radius}`
                                      : order.type === 'move' || order.type === 'intercept'
                                        ? `→ (${order.toQ}, ${order.toR})`
                                        : order.type === 'incorporate_village'
                                          ? `Incorporate → (${order.toQ}, ${order.toR})`
                                          : order.type === 'attack_city'
                                            ? (() => {
                                                const ec = cities.find(c => c.id === order.cityId);
                                                return `Attack ${ec?.name ?? 'city'} — ${order.attackStyle}${formatAttackCityWaveSummary(order)}`;
                                              })()
                                            : order.type === 'attack_building' && order.cityId
                                              ? `Raid building (${order.buildingQ},${order.buildingR}) — ${cities.find(c => c.id === order.cityId)?.name ?? 'city'}`
                                              : ''}
                              </div>
                            );
                          })}
                      </div>
                    </details>
                  </div>
                );
              })
          )}
            </div>
          )}
        </div>

        <div className="flex gap-2 pt-2 border-t border-maproom-ink/30">
          <button type="button" onClick={confirmTacticalOrders} className={fc.primary}>
            Confirm orders
          </button>
          <button type="button" onClick={cancelTacticalMode} className={fc.cancel}>
            Cancel
          </button>
        </div>
      </MapRoomPanel>
      <MarchTacticsModal open={marchTacticsOpen} onClose={() => setMarchTacticsOpen(false)} />
    </div>
  );
}

// ─── Army orders bottom bar (when Army panel is open) ──────────────

function TacticalBottomBar() {
  const pendingTacticalOrders = useGameStore(s => s.pendingTacticalOrders);
  const cities = useGameStore(s => s.cities);
  const tacticalSelectedStackKeys = useGameStore(s => s.tacticalSelectedStackKeys);
  const tacticalOrderScope = useGameStore(s => s.tacticalOrderScope);
  const tacticalOrderScopeArmyId = useGameStore(s => s.tacticalOrderScopeArmyId);
  const operationalArmies = useGameStore(s => s.operationalArmies);
  const setTacticalOrderScope = useGameStore(s => s.setTacticalOrderScope);
  const confirmTacticalOrders = useGameStore(s => s.confirmTacticalOrders);
  const cancelTacticalMode = useGameStore(s => s.cancelTacticalMode);
  const assigningTacticalForSelectedStacks = useGameStore(s => s.assigningTacticalForSelectedStacks);
  const startTacticalOrderForSelected = useGameStore(s => s.startTacticalOrderForSelected);
  const clearTacticalOrdersForSelected = useGameStore(s => s.clearTacticalOrdersForSelected);
  const tacticalCityDefenseMode = useGameStore(s => s.tacticalCityDefenseMode);
  const setTacticalCityDefenseMode = useGameStore(s => s.setTacticalCityDefenseMode);
  const tacticalPatrolPaintHexKeys = useGameStore(s => s.tacticalPatrolPaintHexKeys);
  const finishTacticalPatrolFromPaint = useGameStore(s => s.finishTacticalPatrolFromPaint);
  const clearTacticalPatrolPaint = useGameStore(s => s.clearTacticalPatrolPaint);
  const startTacticalPatrolCenterOnly = useGameStore(s => s.startTacticalPatrolCenterOnly);

  if (pendingTacticalOrders === null) return null;

  const friendlyCities = cities.filter(c => c.ownerId === 'player_human');
  const humanArmies = operationalArmies.filter(o => o.ownerId === 'player_human');
  const isAssigningDestination = assigningTacticalForSelectedStacks !== null;
  const selectedCount = tacticalSelectedStackKeys.length;

  const assignHint = (() => {
    if (!assigningTacticalForSelectedStacks) return '';
    const n = assigningTacticalForSelectedStacks.stackKeys.length;
    const ot = assigningTacticalForSelectedStacks.orderType;
    if (ot === 'intercept') return `Attack (hex): click land tile (${n} stack(s))`;
    if (ot === 'move') return `Move: click land tile (${n} stack(s))`;
    if (ot === 'incorporate_village') return `Incorporate: click neutral village (${n} stack(s))`;
    if (ot === 'attack_city') return `Attack city: click enemy city center (${n} stack(s))`;
    if (ot === 'attack_building_pick') {
      return `Raid building: click an enemy district building (${n} stack(s))`;
    }
    if (ot === 'defend_pick' || ot === 'city_defense_pick') {
      return `City defense (${tacticalCityDefenseMode === 'stagnant' ? 'walls' : 'patrol'}): click your city center (${n} stack(s))`;
    }
    if (ot === 'patrol_pick') return `Patrol: click a hex for center + default radius (${n} stack(s))`;
    if (ot === 'patrol_paint') return `Patrol zone: click hexes or drag across land — Done when ready (${n} stack(s))`;
    return '';
  })();

  const assignOt = assigningTacticalForSelectedStacks?.orderType;
  const pendingOrderTypes = (() => {
    const s = new Set<string>();
    for (const o of Object.values(pendingTacticalOrders)) {
      if (o) s.add(o.type);
    }
    return s;
  })();

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[85] pointer-events-auto px-1 sm:px-2 pb-0">
      <div className="panel-map rounded-t-xl rounded-b-none">
        <div className="panel-map-inner px-3 sm:px-4 py-2 sm:py-3 flex flex-col gap-2 border-t border-teal-800/35">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-maproom-ink/35 pb-2">
        <span className="text-[9px] text-maproom-parchment/55 uppercase tracking-wide shrink-0 w-full sm:w-auto font-cinzel">
          Who receives orders
        </span>
        <button
          type="button"
          onClick={() => setTacticalOrderScope('all')}
          className={`px-2 py-1 text-[10px] sm:text-xs rounded border transition-colors ${
            tacticalOrderScope === 'all'
              ? 'border-teal-400/65 bg-teal-950/50 text-teal-100 ring-1 ring-teal-500/25'
              : 'border-maproom-ink/45 text-empire-parchment/75 hover:bg-maproom-ink/30'
          }`}
          title="Every human hex group — ignores hex list selection"
        >
          All forces
        </button>
        <button
          type="button"
          onClick={() => setTacticalOrderScope('selected')}
          className={`px-2 py-1 text-[10px] sm:text-xs rounded border transition-colors ${
            tacticalOrderScope === 'selected'
              ? 'border-teal-400/65 bg-teal-950/50 text-teal-100 ring-1 ring-teal-500/25'
              : 'border-maproom-ink/45 text-empire-parchment/75 hover:bg-maproom-ink/30'
          }`}
          title="Only highlighted hex groups in the Army panel"
        >
          Selected hex groups
        </button>
        <div className="flex items-center gap-1">
          <span className="text-[9px] text-maproom-parchment/50 hidden sm:inline">Field army</span>
          <select
            className="text-[10px] sm:text-xs px-1.5 py-1 rounded border border-teal-600/45 bg-teal-950/35 text-teal-50 max-w-[9rem] sm:max-w-[14rem]"
            value={tacticalOrderScope === 'army' ? tacticalOrderScopeArmyId ?? '' : ''}
            onChange={e => {
              const v = e.target.value;
              if (!v) setTacticalOrderScope('all');
              else setTacticalOrderScope('army', v);
            }}
            title="Only land troops assigned to this field army"
          >
            <option value="">— Field army —</option>
            {humanArmies.map(a => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <span className="flex-1 min-w-[1rem]" />
        <button
          type="button"
          onClick={() => confirmTacticalOrders()}
          className="px-3 py-1.5 text-[10px] sm:text-xs font-bold rounded border border-green-500/55 bg-green-900/35 text-green-200 hover:bg-green-800/45"
        >
          Confirm orders
        </button>
        <button
          type="button"
          onClick={() => cancelTacticalMode()}
          className="px-2 py-1.5 text-[10px] sm:text-xs rounded border border-empire-stone/45 text-empire-parchment/85 hover:bg-empire-stone/15"
        >
          Close panel
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="map-title text-xs sm:text-sm shrink-0">Orders</span>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => startTacticalOrderForSelected('move')}
            disabled={isAssigningDestination}
            className={`px-3 py-2 text-sm rounded border font-medium transition-colors text-green-300 hover:bg-green-800/40 disabled:opacity-50 disabled:cursor-not-allowed ${
              assignOt === 'move'
                ? 'ring-2 ring-green-300/80 border-green-400/90 bg-green-800/45'
                : 'border-green-500/50 bg-green-900/20'
            } ${pendingOrderTypes.has('move') ? 'border-emerald-400 bg-green-950/50 shadow-[inset_0_0_10px_rgba(52,211,153,0.25)]' : ''}`}
          >
            Move
          </button>
          <button
            type="button"
            onClick={() => startTacticalOrderForSelected('intercept')}
            disabled={isAssigningDestination}
            className={`px-3 py-2 text-sm rounded border font-medium transition-colors text-amber-300 hover:bg-amber-800/40 disabled:opacity-50 disabled:cursor-not-allowed ${
              assignOt === 'intercept'
                ? 'ring-2 ring-amber-300/80 border-amber-400/90 bg-amber-900/45'
                : 'border-amber-500/50 bg-amber-900/20'
            } ${pendingOrderTypes.has('intercept') ? 'border-amber-400 bg-amber-950/50 shadow-[inset_0_0_10px_rgba(251,191,36,0.2)]' : ''}`}
            title="March to a land hex; fight if enemies occupy it"
          >
            Attack hex
          </button>
          <button
            type="button"
            onClick={() => startTacticalOrderForSelected('incorporate_village')}
            disabled={isAssigningDestination}
            className={`px-3 py-2 text-sm rounded border font-medium transition-colors text-cyan-200 hover:bg-cyan-900/40 disabled:opacity-50 disabled:cursor-not-allowed ${
              assignOt === 'incorporate_village'
                ? 'ring-2 ring-cyan-300/70 border-cyan-400/90 bg-cyan-900/40'
                : 'border-cyan-500/50 bg-cyan-900/20'
            } ${pendingOrderTypes.has('incorporate_village') ? 'border-emerald-400 bg-emerald-950/40 shadow-[inset_0_0_10px_rgba(16,185,129,0.25)]' : ''}`}
            title="Land armies march to the village; on arrival, gold is spent and the village incorporates if legal"
          >
            Incorporate village
          </button>
          <button
            type="button"
            onClick={() => startTacticalOrderForSelected('attack_city')}
            disabled={isAssigningDestination}
            className={`px-3 py-2 text-sm rounded border font-medium transition-colors text-red-200 hover:bg-red-900/40 disabled:opacity-50 disabled:cursor-not-allowed ${
              assignOt === 'attack_city'
                ? 'ring-2 ring-red-400/70 border-red-400/90 bg-red-950/45'
                : 'border-red-500/50 bg-red-900/20'
            } ${pendingOrderTypes.has('attack_city') ? 'border-red-400 bg-red-950/55 shadow-[inset_0_0_10px_rgba(248,113,113,0.2)]' : ''}`}
            title="Click an enemy city, then set unit counts, waves, and attack type in the popup"
          >
            Attack city
          </button>
          <button
            type="button"
            onClick={() => startTacticalOrderForSelected('attack_building_pick')}
            disabled={isAssigningDestination}
            className={`px-3 py-2 text-sm rounded border font-medium transition-colors text-orange-200 hover:bg-orange-950/50 disabled:opacity-50 disabled:cursor-not-allowed ${
              assignOt === 'attack_building_pick'
                ? 'ring-2 ring-orange-300/70 border-orange-400/90 bg-orange-950/45'
                : 'border-orange-500/50 bg-orange-950/20'
            } ${pendingOrderTypes.has('attack_building') ? 'border-orange-400 bg-orange-950/55 shadow-[inset_0_0_10px_rgba(251,146,60,0.2)]' : ''}`}
            title="March on a specific enemy building (farm, barracks, market, …) and tear it down"
          >
            Raid building
          </button>
          {friendlyCities.length > 0 && (
            <button
              type="button"
              onClick={() => startTacticalOrderForSelected('city_defense_pick')}
              disabled={isAssigningDestination}
              className={`px-3 py-2 text-sm rounded border font-medium transition-colors text-blue-300 hover:bg-blue-900/40 disabled:opacity-50 disabled:cursor-not-allowed ${
                assignOt === 'city_defense_pick'
                  ? 'ring-2 ring-blue-300/70 border-blue-400/90 bg-blue-950/45'
                  : 'border-blue-500/50 bg-blue-900/20'
              } ${pendingOrderTypes.has('city_defense') ? 'border-sky-400 bg-blue-950/55 shadow-[inset_0_0_10px_rgba(56,189,248,0.2)]' : ''}`}
              title="Choose mode below, then click your city center"
            >
              City defense
            </button>
          )}
          <button
            type="button"
            onClick={() => startTacticalOrderForSelected('patrol_pick')}
            disabled={isAssigningDestination}
            className={`px-3 py-2 text-sm rounded border font-medium transition-colors text-teal-300 hover:bg-teal-900/40 disabled:opacity-50 disabled:cursor-not-allowed ${
              assignOt === 'patrol_pick'
                ? 'ring-2 ring-teal-300/70 border-teal-400/90 bg-teal-950/45'
                : 'border-teal-500/50 bg-teal-900/20'
            } ${pendingOrderTypes.has('patrol') ? 'border-teal-400 bg-teal-950/55 shadow-[inset_0_0_10px_rgba(45,212,191,0.2)]' : ''}`}
            title="Click map hex for patrol center (default radius)"
          >
            Patrol
          </button>
          <button
            type="button"
            onClick={clearTacticalOrdersForSelected}
            className="px-3 py-2 text-sm rounded border border-empire-stone/40 text-empire-parchment/80 hover:bg-empire-stone/20 disabled:opacity-50"
            disabled={selectedCount === 0}
          >
            Clear selected
          </button>
        </div>
        {isAssigningDestination && (
          <span className="text-amber-300 text-sm font-medium animate-pulse">
            → {assignHint}
          </span>
        )}
      </div>

      {assignOt === 'city_defense_pick' && friendlyCities.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 pl-1 border-t border-empire-stone/25 pt-2 mt-1">
          <span className="text-[11px] text-empire-parchment/75 font-medium">City defense mode</span>
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <button
              type="button"
              className={`px-2 py-1 rounded border ${tacticalCityDefenseMode === 'auto_engage' ? 'border-cyan-400 bg-cyan-950/50 text-cyan-100' : 'border-empire-stone/40 text-empire-parchment/80'}`}
              onClick={() => setTacticalCityDefenseMode('auto_engage')}
            >
              Active (patrol territory)
            </button>
            <button
              type="button"
              className={`px-2 py-1 rounded border ${tacticalCityDefenseMode === 'stagnant' ? 'border-amber-400 bg-amber-950/50 text-amber-100' : 'border-empire-stone/40 text-empire-parchment/80'}`}
              onClick={() => setTacticalCityDefenseMode('stagnant')}
            >
              Passive (hold walls)
            </button>
          </div>
          <p className="text-[10px] text-empire-parchment/55 max-w-xl">
            Active sends stacks to intercept enemies inside your territory; passive keeps units on the city tile as a compact garrison.
          </p>
        </div>
      )}

      {assignOt === 'patrol_pick' && (
        <div className="pl-1 border-t border-empire-stone/25 pt-2 mt-1 text-[10px] text-empire-parchment/60">
          Click a land hex for patrol center (default radius). Cancel with the Army panel or change order.
        </div>
      )}

      {assignOt === 'patrol_paint' && (
        <div className="flex flex-wrap items-center gap-2 pl-1 border-t border-empire-stone/25 pt-2 mt-1">
          <span className="text-[11px] text-teal-200/90 font-medium">Patrol zone</span>
          <span className="text-[10px] text-empire-parchment/55">
            {(tacticalPatrolPaintHexKeys?.length ?? 0)} hex{(tacticalPatrolPaintHexKeys?.length ?? 0) !== 1 ? 'es' : ''} selected
          </span>
          <button
            type="button"
            onClick={() => finishTacticalPatrolFromPaint()}
            className="px-2 py-1 text-[11px] rounded border border-teal-500/50 bg-teal-950/40 text-teal-100 hover:bg-teal-900/50"
          >
            Done painting
          </button>
          <button
            type="button"
            onClick={() => clearTacticalPatrolPaint()}
            className="px-2 py-1 text-[11px] rounded border border-empire-stone/40 text-empire-parchment/75 hover:bg-empire-stone/15"
          >
            Clear selection
          </button>
          <button
            type="button"
            onClick={() => startTacticalPatrolCenterOnly()}
            className="px-2 py-1 text-[11px] rounded border border-empire-stone/35 text-empire-parchment/80 hover:bg-empire-stone/15"
          >
            Center + radius instead
          </button>
        </div>
      )}
        </div>
      </div>
    </div>
  );
}

// ─── Side Panel ────────────────────────────────────────────────────

function SidePanel() {
  const selectedHex = useGameStore(s => s.selectedHex);
  const pendingTacticalOrders = useGameStore(s => s.pendingTacticalOrders);
  const uiMode = useGameStore(s => s.uiMode);
  const allUnits = useGameStore(s => s.units);
  const players = useGameStore(s => s.players);
  const territory = useGameStore(s => s.territory);
  const cities = useGameStore(s => s.cities);
  const getSelectedCity = useGameStore(s => s.getSelectedCity);
  const getSelectedUnits = useGameStore(s => s.getSelectedUnits);
  const getEnemyCityAt = useGameStore(s => s.getEnemyCityAt);
  const getBarracksCityAt = useGameStore(s => s.getBarracksCityAt);
  const getSiegeWorkshopCityAt = useGameStore(s => s.getSiegeWorkshopCityAt);
  const getFactoryAt = useGameStore(s => s.getFactoryAt);
  const getAcademyAt = useGameStore(s => s.getAcademyAt);
  const getUniversityBuildingAt = useGameStore(s => s.getUniversityBuildingAt);
  const getQuarryMineAt = useGameStore(s => s.getQuarryMineAt);
  const getJobBuildingAt = useGameStore(s => s.getJobBuildingAt);
  const getTile = useGameStore(s => s.getTile);
  const isInPlayerTerritory = useGameStore(s => s.isInPlayerTerritory);
  const getCityAt = useGameStore(s => s.getCityAt);
  const hasBuildingAt = useGameStore(s => s.hasBuildingAt);
  const incorporateVillage = useGameStore(s => s.incorporateVillage);
  const getConstructionAt = useGameStore(s => s.getConstructionAt);
  const constructions = useGameStore(s => s.constructions);
  const defenseInstallations = useGameStore(s => s.defenseInstallations);
  const startCityDefenseTowerBuild = useGameStore(s => s.startCityDefenseTowerBuild);
  const startBuilderBuild = useGameStore(s => s.startBuilderBuild);
  const cancelBuilderBuild = useGameStore(s => s.cancelBuilderBuild);
  const isHexVisible = useGameStore(s => s.isHexVisible);
  const isHexScouted = useGameStore(s => s.isHexScouted);
  const getScoutMissionAt = useGameStore(s => s.getScoutMissionAt);
  const sendScout = useGameStore(s => s.sendScout);
  const operationalArmies = useGameStore(s => s.operationalArmies);
  const deselectAll = useGameStore(s => s.deselectAll);
  const pendingMove = useGameStore(s => s.pendingMove);
  const scrollRegionClaimed = useGameStore(s => s.scrollRegionClaimed);
  const scrollRelics = useGameStore(s => s.scrollRelics);
  const scrollRelicClusters = useGameStore(s => s.scrollRelicClusters);
  const scrollSearchVisited = useGameStore(s => s.scrollSearchVisited);
  const openSpecialRegionSearchGuideModal = useGameStore(s => s.openSpecialRegionSearchGuideModal);
  const scrollInventory = useGameStore(s => s.scrollInventory);
  const assignScrollToArmy = useGameStore(s => s.assignScrollToArmy);
  const addNotification = useGameStore(s => s.addNotification);
  const commanders = useGameStore(s => s.commanders);
  const assignCommanderToCityDefense = useGameStore(s => s.assignCommanderToCityDefense);
  const assignCommanderToFieldAtSelectedHex = useGameStore(s => s.assignCommanderToFieldAtSelectedHex);
  const unassignCommander = useGameStore(s => s.unassignCommander);
  const openCityLogistics = useGameStore(s => s.openCityLogistics);
  const gameMode = useGameStore(s => s.gameMode);

  if (pendingTacticalOrders !== null) return <TacticalPanel />;
  if (!selectedHex) return null;

  // City defenses use the selected hex.
  const defenseHexQ = selectedHex.q;
  const defenseHexR = selectedHex.r;
  const inTerritoryForDefense = isInPlayerTerritory(defenseHexQ, defenseHexR);
  const hasDefenseAtDefenseHex = defenseInstallations.some(d => d.q === defenseHexQ && d.r === defenseHexR);
  const cityAtDefenseHex = getCityAt(defenseHexQ, defenseHexR);
  const defenseTile = getTile(defenseHexQ, defenseHexR);

  const city = getSelectedCity();
  const units = getSelectedUnits();
  const cityAtHex = getCityAt(selectedHex.q, selectedHex.r);
  const enemyCity = getEnemyCityAt(selectedHex.q, selectedHex.r);
  const barracksCity = getBarracksCityAt(selectedHex.q, selectedHex.r);
  const siegeWorkshopCity = getSiegeWorkshopCityAt(selectedHex.q, selectedHex.r);
  const factoryInfo = getFactoryAt(selectedHex.q, selectedHex.r);
  const academyInfo = getAcademyAt(selectedHex.q, selectedHex.r);
  const universityBuildingInfo = getUniversityBuildingAt(selectedHex.q, selectedHex.r);
  const quarryMineInfo = getQuarryMineAt(selectedHex.q, selectedHex.r);
  const jobBuildingInfo = getJobBuildingAt(selectedHex.q, selectedHex.r);
  const inTerritory = isInPlayerTerritory(selectedHex.q, selectedHex.r);
  const hasBuilding = hasBuildingAt(selectedHex.q, selectedHex.r);
  const construction = getConstructionAt(selectedHex.q, selectedHex.r);
  const tile = getTile(selectedHex.q, selectedHex.r);
  const isVillage = tile?.hasVillage ?? false;

  // Military units at hex (not legacy builder units) — for village incorporation
  const militaryHere = allUnits.filter(
    u => u.q === selectedHex.q && u.r === selectedHex.r && u.ownerId === 'player_human' && u.hp > 0 && u.type !== 'builder'
  );
  const landMilHere = militaryHere.filter(u => !isNavalUnitType(u.type));
  const fieldArmyIdsAtHex = [...new Set(landMilHere.map(u => u.armyId).filter((x): x is string => Boolean(x)))];
  const fieldArmyNamesAtHex = fieldArmyIdsAtHex
    .map(aid => operationalArmies.find(o => o.id === aid)?.name)
    .filter(Boolean) as string[];

  const hasUniversity = cities.some(
    c => c.ownerId === 'player_human' && c.buildings.some(b => b.type === 'academy'),
  );
  const terrEntry = territory.get(tileKey(selectedHex.q, selectedHex.r));
  const territoryCityForHex = terrEntry ? cities.find(c => c.id === terrEntry.cityId) : undefined;
  const academyForHex = territoryCityForHex?.buildings.find(b => b.type === 'academy');
  const builderHutSlotsAtHex = getUniversityBuilderSlots(academyForHex);
  const buildersHere = builderHutSlotsAtHex;
  const defenseUsesMoveDestination = false;
  const canBuildHere = inTerritory && !hasBuilding && !cityAtHex;

  let availBP = 0;
  if (inTerritory) {
    availBP += CITY_BUILDING_POWER;
    availBP += builderHutSlotsAtHex * BUILDER_POWER;
  }

  // Detect active battle at this hex
  const allUnitsAtHex = allUnits.filter(u => u.q === selectedHex.q && u.r === selectedHex.r && u.hp > 0);
  const ownerIds = new Set(allUnitsAtHex.map(u => u.ownerId));
  const isBattle = ownerIds.size >= 2;
  const friendlyInBattle = allUnitsAtHex.filter(u => u.ownerId === 'player_human');
  const enemyInBattle = allUnitsAtHex.filter(u => u.ownerId !== 'player_human');

  // Enemy units at hex (no friendly present — pure enemy hex)
  const enemyOnlyUnits = !isBattle ? allUnitsAtHex.filter(u => u.ownerId !== 'player_human') : [];
  const hasEnemyOnly = enemyOnlyUnits.length > 0 && units.length === 0;
  const hexVisible = isHexVisible(selectedHex.q, selectedHex.r);
  const hexScouted = isHexScouted(selectedHex.q, selectedHex.r);
  const activeScoutMission = getScoutMissionAt(selectedHex.q, selectedHex.r);
  const canSeeEnemyInfo = hexVisible || hexScouted;

  // City that owns this hex (for wall ring build) — only when in own territory
  const human = players.find(p => p.isHuman);
  const humanScrollInventory = human ? (scrollInventory[human.id] ?? []) : [];
  const hasDefenseHere = defenseInstallations.some(d => d.q === selectedHex.q && d.r === selectedHex.r);
  const canBuildTrebuchetHere =
    hasUniversity &&
    !cityAtHex &&
    !construction &&
    !hasDefenseHere &&
    tile?.biome !== 'water' &&
    tile?.biome !== 'mountain';
  let shipyardInfo: { city: import('@/types/game').City; building: import('@/types/game').CityBuilding } | null = null;
  for (const c of cities) {
    if (c.ownerId !== 'player_human') continue;
    const b = c.buildings.find(x => x.type === 'shipyard' && x.q === selectedHex.q && x.r === selectedHex.r);
    if (b) {
      shipyardInfo = { city: c, building: b };
      break;
    }
  }

  return (
    <div className="absolute top-14 right-2 w-72 pointer-events-auto max-h-[85vh] overflow-y-auto">
      <div className={`bg-empire-dark/90 backdrop-blur-sm border ${isBattle ? 'border-red-500/50' : 'border-empire-stone/30'} rounded-lg p-3 space-y-3`}>
        <div className="flex justify-between items-center gap-2 shrink-0">
          <span className="text-xs text-empire-parchment/50 truncate min-w-0">
            {isBattle && <span className="text-red-400 mr-1">&#9876;</span>}
            Hex ({selectedHex.q}, {selectedHex.r})
            {isBattle && <span className="text-red-400 ml-1 font-bold">— BATTLE</span>}
          </span>
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); deselectAll(); }}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded text-empire-parchment/50 hover:text-empire-parchment hover:bg-empire-stone/20 text-lg leading-none cursor-pointer"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {human && fieldArmyNamesAtHex.length > 0 && (
          <div className="text-[10px] text-sky-100/95 px-2 py-1.5 rounded border border-sky-500/35 bg-sky-950/30 leading-snug">
            <span className="text-sky-300/80 uppercase tracking-wide text-[9px]">Field army</span>{' '}
            <span className="font-medium">{fieldArmyNamesAtHex.join(', ')}</span>
          </div>
        )}
        {human && fieldArmyIdsAtHex.length > 0 && (
          <div className="px-2 py-2 rounded border border-violet-500/35 bg-violet-950/25 space-y-1.5">
            <div className="text-[10px] text-violet-200/85 uppercase tracking-wide">Assign scroll to army</div>
            {humanScrollInventory.length === 0 ? (
              <p className="text-[10px] text-empire-parchment/50">No discovered scrolls in inventory yet.</p>
            ) : (
              <div className="space-y-1">
                {fieldArmyIdsAtHex.map((aid) => {
                  const armyName = operationalArmies.find(a => a.id === aid)?.name ?? 'Army';
                  return (
                    <div key={`scr-army-${aid}`} className="space-y-1">
                      <div className="text-[10px] text-empire-parchment/70">{armyName}</div>
                      <div className="flex flex-wrap gap-1">
                        {humanScrollInventory.map(si => (
                          <button
                            key={`${aid}-${si.id}`}
                            type="button"
                            onClick={() => assignScrollToArmy(si.id, aid)}
                            className="px-2 py-1 rounded border border-violet-500/45 bg-violet-900/30 text-violet-100 hover:bg-violet-900/45 text-[10px]"
                          >
                            {scrollItemDisplayName(si)}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {cityAtHex &&
          (cityAtHex.ownerId === 'player_human' ||
            gameMode === 'bot_vs_bot' ||
            gameMode === 'bot_vs_bot_4' ||
            gameMode === 'spectate') && (
          <div className="px-2 py-2 bg-empire-gold/10 border border-empire-gold/35 rounded space-y-1.5">
            <div className="text-xs text-empire-gold font-semibold">{cityAtHex.name}</div>
            <button
              type="button"
              onClick={() => openCityLogistics()}
              className="w-full px-2 py-1.5 text-[11px] rounded border border-empire-gold/50 text-empire-gold hover:bg-empire-gold/15"
            >
              City logistics & management
            </button>
          </div>
        )}

        {/* Tile description — every tile clickable with what it is */}
        {tile && (
          <div className="px-2 py-1.5 bg-empire-stone/10 border border-empire-stone/20 rounded text-xs space-y-1">
            <div className="font-medium text-empire-parchment/90 capitalize">{tile.biome}</div>
            <div className="text-empire-parchment/60 flex flex-wrap gap-x-2 gap-y-0.5">
              {tile.hasRoad && <span>Road</span>}
              {tile.hasRuins && <span>Ruins</span>}
              {tile.hasVillage && <span>Village</span>}
              {tile.isProvinceCenter && <span>Province center</span>}
              {tile.hasQuarryDeposit && <span>Stone deposit</span>}
              {tile.hasMineDeposit && <span>Iron deposit</span>}
              {tile.hasWoodDeposit && <span>Wood deposit</span>}
              {tile.hasGoldMineDeposit && <span>Gold deposit</span>}
              {tile.hasAncientCity && <span>Ancient city</span>}
              {!tile.hasRoad && !tile.hasRuins && !tile.hasVillage && !tile.isProvinceCenter && !tile.hasQuarryDeposit && !tile.hasMineDeposit && !tile.hasWoodDeposit && !tile.hasGoldMineDeposit && !tile.hasAncientCity && (
                <span className="text-empire-parchment/40">—</span>
              )}
            </div>
          </div>
        )}

        {tile?.specialTerrainKind && (() => {
          const terrainName = SPECIAL_REGION_DISPLAY_NAME[tile.specialTerrainKind];
          const rk = tile.specialTerrainKind;
          const hid = human?.id ?? '';
          const claimed = hid ? (scrollRegionClaimed[rk] ?? []).includes(hid) : false;
          const relicOnHex = scrollRelics.some(r => r.q === selectedHex.q && r.r === selectedHex.r && r.regionKind === rk);
          const cluster = scrollRelicClusters[rk] ?? [];
          const visited = scrollSearchVisited[hid]?.[rk] ?? [];
          const vis = new Set(visited);
          const explored = cluster.filter(k => vis.has(k)).length;
          const total = cluster.length;
          const searchComplete = total > 0 && cluster.every(k => vis.has(k));
          return (
            <div className="px-2 py-1.5 bg-teal-950/40 border border-teal-600/35 rounded text-xs space-y-1.5">
              <div className="font-medium text-teal-200/95">{terrainName}</div>
              <div className="text-teal-100/70 text-[10px] leading-snug">
                {claimed
                  ? `You claimed ${SCROLL_REGION_ITEM_NAME[rk]}. Assign it from the army section or inventory.`
                  : 'March a qualifying army across every hex of this wilds patch, then step on the relic tile to reveal the scroll.'}
              </div>
              {!claimed && total > 1 && (
                <div className="text-teal-200/85 text-[10px] font-mono">
                  Search: {explored}/{total} hexes
                  {searchComplete ? ' — ready to claim relic.' : ''}
                </div>
              )}
              {!claimed && (
                <button
                  type="button"
                  onClick={() => openSpecialRegionSearchGuideModal(selectedHex.q, selectedHex.r)}
                  className="w-full px-2 py-1.5 text-[11px] rounded border border-teal-500/50 text-teal-100 hover:bg-teal-900/35 font-medium"
                >
                  Send army to search…
                </button>
              )}
              {relicOnHex && !claimed && (
                <div className="text-amber-200/80 text-[10px]">Relic hex — claim after search is complete.</div>
              )}
            </div>
          );
        })()}

        {/* Battle panel — show both sides */}
        {isBattle && (
          <BattlePanel friendly={friendlyInBattle} enemy={enemyInBattle} />
        )}

        {/* Enemy unit panel — when clicking a hex with only enemy units */}
        {hasEnemyOnly && (
          <EnemyUnitPanel
            enemies={enemyOnlyUnits}
            canSeeInfo={canSeeEnemyInfo}
            scoutMission={activeScoutMission ?? null}
            onSendScout={() => sendScout(selectedHex.q, selectedHex.r)}
            gold={players.find(p => p.isHuman)?.gold ?? 0}
          />
        )}

        {commanders
          .filter(c => c.q === selectedHex.q && c.r === selectedHex.r && c.ownerId === 'player_human')
          .map(c => (
            <div
              key={c.id}
              className="flex flex-col gap-1.5 px-2 py-2 bg-violet-950/30 border border-violet-500/35 rounded text-[11px] text-empire-parchment/90"
            >
              <div className="flex gap-2 items-start">
                {c.portraitDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={c.portraitDataUrl}
                    width={40}
                    height={40}
                    alt=""
                    className="rounded border border-violet-500/40 shrink-0"
                    style={{ imageRendering: 'pixelated' }}
                  />
                ) : (
                  <div className="w-10 h-10 rounded bg-empire-stone/30 border border-violet-500/30 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-violet-200 flex flex-wrap items-center gap-1.5">
                    {c.name}
                    {(c.commanderKind ?? 'land') === 'naval' && (
                      <span className="text-[9px] font-bold uppercase tracking-wide text-sky-300/90 border border-sky-500/40 rounded px-1 py-0">
                        Naval
                      </span>
                    )}
                  </div>
                  <p className="text-empire-parchment/55 mt-0.5 leading-snug">{c.backstory}</p>
                  <p className="text-violet-300/80 mt-1">
                    {c.traitIds.map(tid => COMMANDER_TRAIT_INFO[tid].label).join(' · ')}
                  </p>
                  <p className="text-[10px] text-empire-parchment/45 mt-0.5">
                    {c.traitIds.map(tid => COMMANDER_TRAIT_INFO[tid].desc).join(' ')}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {cityAtHex?.ownerId === 'player_human' && (c.commanderKind ?? 'land') !== 'naval' && (
                  <button
                    type="button"
                    onClick={() => assignCommanderToCityDefense(c.id, cityAtHex.id)}
                    className="px-2 py-0.5 rounded bg-violet-800/50 text-violet-100 text-[10px] hover:bg-violet-700/55"
                  >
                    Defend {cityAtHex.name}
                  </button>
                )}
                {militaryHere.length > 0 &&
                  (((c.commanderKind ?? 'land') === 'naval' &&
                    militaryHere.some(u => isNavalUnitType(u.type))) ||
                    ((c.commanderKind ?? 'land') !== 'naval' &&
                      militaryHere.some(u => !isNavalUnitType(u.type)))) && (
                  <button
                    type="button"
                    onClick={() => assignCommanderToFieldAtSelectedHex(c.id)}
                    className="px-2 py-0.5 rounded bg-slate-800/60 text-slate-100 text-[10px] hover:bg-slate-700/55"
                  >
                    {(c.commanderKind ?? 'land') === 'naval' ? 'Lead fleet here' : 'Lead stack here'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => unassignCommander(c.id)}
                  className="px-2 py-0.5 rounded border border-empire-stone/40 text-empire-parchment/60 text-[10px] hover:bg-empire-stone/20"
                >
                  Clear orders
                </button>
              </div>
            </div>
          ))}

        {/* Resource deposit indicator */}
        {tile?.hasQuarryDeposit && !hasBuilding && (
          <div className="flex items-center gap-2 px-2 py-1.5 bg-stone-800/30 border border-stone-500/30 rounded text-xs">
            <span className="text-stone-400 text-sm">&#9830;</span>
            <div>
              <span className="text-stone-300 font-semibold">Stone Deposit</span>
              <span className="text-stone-400/70 ml-1.5">— {allUnitsAtHex.some(u => u.ownerId === 'player_human') ? 'Build a Quarry here' : 'Send units here to build'}</span>
            </div>
          </div>
        )}
        {tile?.hasMineDeposit && !hasBuilding && (
          <div className="flex items-center gap-2 px-2 py-1.5 bg-amber-900/20 border border-amber-700/30 rounded text-xs">
            <span className="text-amber-500 text-sm">&#9830;</span>
            <div>
              <span className="text-amber-400 font-semibold">Iron Ore Deposit</span>
              <span className="text-amber-500/70 ml-1.5">— {allUnitsAtHex.some(u => u.ownerId === 'player_human') ? 'Build a Mine here' : 'Send units here to build'}</span>
            </div>
          </div>
        )}
        {tile?.hasGoldMineDeposit && !hasBuilding && (
          <div className="flex items-center gap-2 px-2 py-1.5 bg-yellow-900/20 border border-yellow-600/30 rounded text-xs">
            <span className="text-yellow-500 text-sm">&#9830;</span>
            <div>
              <span className="text-yellow-400 font-semibold">Gold Deposit</span>
              <span className="text-yellow-500/70 ml-1.5">— Builder: build Gold mine (20g + 20 iron)</span>
            </div>
          </div>
        )}
        {tile?.hasAncientCity && (
          <div className="flex items-center gap-2 px-2 py-1.5 bg-purple-900/25 border border-purple-500/40 rounded text-xs">
            <span className="text-purple-400 text-sm">&#9962;</span>
            <div>
              <span className="text-purple-300 font-semibold">Ancient City</span>
              <span className="text-purple-400/70 ml-1.5">— Hold with a unit (cycles 1–5) for 50 gold/cycle. No reward if combat here.</span>
            </div>
          </div>
        )}

        {/* Construction progress */}
        {construction && (
          <ConstructionProgress
            site={construction}
            availBP={computeConstructionAvailableBp(construction, territory, cities, constructions)}
          />
        )}

        {(() => {
          const od = defenseInstallations.find(
            d => d.q === selectedHex.q && d.r === selectedHex.r && d.ownerId === 'player_human',
          );
          if (!od) return null;
          const payCity = cities.find(c => c.id === od.cityId);
          const nextL = (od.level + 1) as DefenseTowerLevel;
          const canUpgrade =
            od.level < 5 &&
            !construction &&
            canAffordDefenseHud(human?.gold ?? 0, payCity, nextL);
          const dHp = defenseInstallationCurrentHp(od);
          const dMax = od.maxHp ?? defenseInstallationMaxHp(od.level);
          const hpPct = dMax > 0 ? Math.round((100 * dHp) / dMax) : 0;
          return (
            <div className="bg-cottage-wood/35 border border-cottage-brass/25 rounded px-3 py-2 space-y-1.5 text-xs">
              <div className="text-cottage-glow font-bold">
                {DEFENSE_TOWER_DISPLAY_NAME[od.type]} — L{od.level}
              </div>
              <div className="space-y-0.5">
                <div className="flex justify-between text-[10px] text-empire-parchment/70">
                  <span>Structure</span>
                  <span>
                    {dHp}/{dMax} ({hpPct}%)
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-black/40 overflow-hidden border border-empire-stone/20">
                  <div
                    className="h-full bg-amber-600/90 rounded-full transition-[width]"
                    style={{ width: `${hpPct}%` }}
                  />
                </div>
              </div>
              <p className="text-[10px] text-empire-parchment/55">
                Siege engines and enemy armies in this hex reduce structure HP; at 0 the tower is destroyed. Mortar splashes adjacent hexes (same range as trebuchet). Archer tower and ballista shoot each combat tick (r3); ballista fires twice.
              </p>
              {construction ? (
                <p className="text-[10px] text-amber-200/80">Construction in progress on this hex.</p>
              ) : od.level < 5 ? (
                <button
                  type="button"
                  disabled={!canUpgrade}
                  title={canUpgrade ? formatDefenseLevelCost(nextL) : undefined}
                  onClick={() => startCityDefenseTowerBuild(selectedHex.q, selectedHex.r, od.type, nextL, od.cityId)}
                  className={`w-full px-2 py-1.5 rounded border text-[11px] font-medium transition-colors ${
                    canUpgrade
                      ? 'border-empire-stone/40 bg-empire-stone/10 text-empire-parchment hover:bg-empire-stone/20'
                      : 'border-empire-stone/20 bg-transparent text-empire-parchment/30 cursor-not-allowed'
                  }`}
                >
                  Upgrade to L{nextL} — {formatDefenseLevelCost(nextL)}
                </button>
              ) : (
                <p className="text-[10px] text-emerald-400/80">Max level.</p>
              )}
            </div>
          );
        })()}

        {(() => {
          const ed = defenseInstallations.find(
            d => d.q === selectedHex.q && d.r === selectedHex.r && d.ownerId !== 'player_human',
          );
          if (!ed || !canSeeEnemyInfo) return null;
          const dHp = defenseInstallationCurrentHp(ed);
          const dMax = ed.maxHp ?? defenseInstallationMaxHp(ed.level);
          const hpPct = dMax > 0 ? Math.round((100 * dHp) / dMax) : 0;
          return (
            <div className="bg-red-950/40 border border-red-500/35 rounded px-3 py-2 space-y-1 text-xs">
              <div className="text-red-200 font-bold">
                Enemy {DEFENSE_TOWER_DISPLAY_NAME[ed.type]} — L{ed.level}
              </div>
              <div className="h-1.5 rounded-full bg-black/40 overflow-hidden border border-red-900/40">
                <div className="h-full bg-red-600/85 rounded-full" style={{ width: `${hpPct}%` }} />
              </div>
              <p className="text-[10px] text-empire-parchment/60">
                Structure {dHp}/{dMax}. Destroy with siege units in range or land armies on this hex.
              </p>
            </div>
          );
        })()}

        {/* City details shown in CityModal when city hex clicked */}

        {/* Field engineering: mine / quarry / gold mine on deposits — when you have a Builder's Hut */}
        {hasUniversity && !city && !cityAtHex && !barracksCity && !siegeWorkshopCity && !academyInfo && !factoryInfo && !quarryMineInfo && !construction && (
          <BuilderBuildMenu
            uiMode={uiMode}
            startBuilderBuild={startBuilderBuild}
            cancelBuilderBuild={cancelBuilderBuild}
            hasBuildingOnHex={hasBuilding}
            hasCityAtHex={!!cityAtDefenseHex}
            tileHasMineDeposit={tile?.hasMineDeposit}
            tileHasQuarryDeposit={tile?.hasQuarryDeposit}
            tileHasGoldMineDeposit={tile?.hasGoldMineDeposit}
          />
        )}

        {units.length > 0 && <ArmyPanel units={units} />}

        {shipyardInfo && !city && !siegeWorkshopCity && selectedHex && (
          <ShipyardPanel city={shipyardInfo.city} shipyardQ={selectedHex.q} shipyardR={selectedHex.r} />
        )}

        {/* Barracks recruit panel — shown when clicking a barracks hex */}
        {barracksCity && !city && !academyInfo && !siegeWorkshopCity && selectedHex && <BarracksPanel city={barracksCity} barracksQ={selectedHex.q} barracksR={selectedHex.r} />}

        {siegeWorkshopCity && !city && selectedHex && (
          <SiegeWorkshopPanel city={siegeWorkshopCity} workshopQ={selectedHex.q} workshopR={selectedHex.r} />
        )}

        {/* Builder's Hut panel — shown when clicking an academy hex (workforce tasks) */}
        {academyInfo && !city && selectedHex && <AcademyPanel city={academyInfo.city} academyQ={selectedHex.q} academyR={selectedHex.r} />}

        {/* University panel — shown when clicking a university building hex */}
        {universityBuildingInfo && !city && !academyInfo && selectedHex && (
          <UniversityBuildingPanel city={universityBuildingInfo.city} buildingQ={selectedHex.q} buildingR={selectedHex.r} />
        )}

        {/* Factory info panel — shown when clicking a factory hex */}
        {factoryInfo && !city && !barracksCity && !siegeWorkshopCity && !academyInfo && selectedHex && <FactoryPanel city={factoryInfo.city} factoryQ={selectedHex.q} factoryR={selectedHex.r} />}

        {/* Quarry / Mine worker panel — shown when clicking a quarry or mine hex */}
        {quarryMineInfo && !city && !siegeWorkshopCity && selectedHex && <QuarryMinePanel city={quarryMineInfo.city} building={quarryMineInfo.building} />}

        {/* Farm / Factory / Market worker panel — shown when clicking farm, factory, or market hex */}
        {jobBuildingInfo && !city && !barracksCity && !siegeWorkshopCity && !academyInfo && !factoryInfo && !quarryMineInfo && !shipyardInfo && selectedHex && ['farm', 'banana_farm', 'market', 'fishery', 'sawmill', 'logging_hut', 'port', 'social_bar'].includes(jobBuildingInfo.building.type) && (
          <JobBuildingPanel city={jobBuildingInfo.city} building={jobBuildingInfo.building} />
        )}

        {/* Incorporate Village — when military units are on a village hex */}
        {isVillage && militaryHere.length > 0 && !city && !cityAtHex && (() => {
          const human = players.find(p => p.isHuman);
          const canAfford = (human?.gold ?? 0) >= VILLAGE_INCORPORATE_COST;
          return (
            <div className="space-y-2">
              <div className="flex items-center gap-2 px-2 py-1.5 bg-amber-900/20 border border-amber-500/30 rounded">
                <span className="text-amber-400 text-sm">&#127969;</span>
                <span className="text-amber-300 text-xs font-semibold">VILLAGE</span>
              </div>
              <div className="text-[10px] text-empire-parchment/60 space-y-0.5">
                <p>A neutral village that can be incorporated into your empire.</p>
                <p>Creates a small city (Pop 3) with territory expansion.</p>
              </div>
              <button
                onClick={() => incorporateVillage(selectedHex.q, selectedHex.r)}
                disabled={!canAfford}
                className={`w-full px-3 py-2 text-xs font-semibold rounded border transition-colors ${
                  canAfford
                    ? 'bg-amber-900/30 border-amber-500/50 text-amber-300 hover:bg-amber-900/50'
                    : 'bg-empire-stone/10 border-empire-stone/20 text-empire-parchment/30 cursor-not-allowed'
                }`}
              >
                Incorporate Village — {VILLAGE_INCORPORATE_COST} Gold
              </button>
              {!canAfford && (
                <p className="text-red-400/60 text-[10px]">Not enough gold ({human?.gold ?? 0}/{VILLAGE_INCORPORATE_COST})</p>
              )}
            </div>
          );
        })()}

        {/* Burn / Capture enemy city */}
        {enemyCity && units.length > 0 && <EnemyCityActions city={enemyCity} />}

        {/* Build menu: in your territory (University workforce + city building power) */}
        {!city && !cityAtHex && !barracksCity && !siegeWorkshopCity && !academyInfo && !factoryInfo && canBuildHere && !construction && uiMode === 'normal' && (
          <BuildMenu
            q={selectedHex.q}
            r={selectedHex.r}
            inTerritory={inTerritory ?? false}
            buildersHere={buildersHere}
            tile={tile}
            hasConstructionAt={(q, r) => !!getConstructionAt(q, r)}
            hasCityAt={(q, r) => !!getCityAt(q, r)}
          />
        )}

        {!city && !inTerritory && !hasUniversity && units.length === 0 && !enemyCity && !barracksCity && !siegeWorkshopCity && !academyInfo && !factoryInfo && !construction && (
          <p className="text-empire-parchment/40 text-xs">Outside your territory — expand borders or build a Builder&apos;s Hut for workforce projects</p>
        )}
      </div>
    </div>
  );
}

// ─── Population mechanics popover (click Population to open) ───────

function forecastPopulation(
  startPop: number,
  startKExpected: number,
  foodProducedPerCycle: number,
  cycles: number,
): { cycle: number; pop: number; kExpected: number; births: number; deaths: number; net: number }[] {
  const K_actual = Math.max(10, foodProducedPerCycle * POP_CARRYING_CAPACITY_PER_FOOD);
  let P = startPop;
  let K = startKExpected;
  const rows: { cycle: number; pop: number; kExpected: number; births: number; deaths: number; net: number }[] = [];
  for (let c = 1; c <= cycles; c++) {
    const births = P > 0 && K > 0 ? Math.max(0, Math.floor(POP_BIRTH_RATE * P * (1 - P / K))) : 0;
    const deaths = POP_NATURAL_DEATHS;
    const net = births - deaths;
    rows.push({ cycle: c, pop: P, kExpected: Math.round(K), births, deaths, net });
    P = Math.max(1, P + net);
    K = Math.max(10, Math.floor((1 - POP_EXPECTED_K_ALPHA) * K + POP_EXPECTED_K_ALPHA * K_actual));
  }
  return rows;
}

function PopulationMechanicsPopover({
  city,
  foodProducedPerCycle,
  onClose,
}: {
  city: import('@/types/game').City;
  foodProducedPerCycle: number;
  onClose: () => void;
}) {
  const K_actual = Math.max(10, foodProducedPerCycle * POP_CARRYING_CAPACITY_PER_FOOD);
  const K_expected = city.expectedCarryingCapacity ?? K_actual;
  const forecast = forecastPopulation(city.population, K_expected, foodProducedPerCycle, 10);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 pointer-events-auto" onClick={onClose}>
      <div
        className="bg-empire-dark border border-empire-gold/50 rounded-xl p-4 max-w-lg w-full mx-4 max-h-[85vh] overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-empire-gold font-bold text-sm">Population growth — {city.name}</h3>
          <button onClick={onClose} className="text-empire-parchment/50 hover:text-empire-parchment text-lg leading-none">×</button>
        </div>
        <div className="space-y-3 text-xs text-empire-parchment/80">
          <div>
            <p className="text-empire-gold/90 font-semibold mb-1">How it works</p>
            <ul className="list-disc list-inside space-y-0.5 text-empire-parchment/70">
              <li><strong>Expected capacity (K)</strong> — smoothed over ~2–4 cycles. People have kids based on this, not this cycle’s harvest.</li>
              <li><strong>Births</strong> = floor(0.25 × P × (1 − P/K)). More when P is below K.</li>
              <li><strong>Natural deaths</strong> = {POP_NATURAL_DEATHS} per cycle. <strong>Starvation</strong> = +{STARVATION_DEATHS} per cycle when grain storage is empty.</li>
              <li>Civilians consume <strong>0.25 grain per pop</strong> per cycle (empire-wide pool).</li>
            </ul>
          </div>
          <div>
            <p className="text-empire-gold/90 font-semibold mb-1">Current</p>
            <p className="text-empire-parchment/70">Pop {city.population} · K (expected) {K_expected} · K (from current production) {K_actual}</p>
          </div>
          <div>
            <p className="text-empire-gold/90 font-semibold mb-1">Forecast (next 10 cycles)</p>
            <p className="text-empire-parchment/50 text-[10px] mb-1">Assumes production and consumption stay constant; no starvation. Migration not included.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-[10px] border-collapse">
                <thead>
                  <tr className="border-b border-empire-stone/40">
                    <th className="text-left py-1 pr-2 text-empire-parchment/60">Cycle</th>
                    <th className="text-right py-1 px-1 text-empire-parchment/60">Pop</th>
                    <th className="text-right py-1 px-1 text-empire-parchment/60">K</th>
                    <th className="text-right py-1 px-1 text-empire-parchment/60">Births</th>
                    <th className="text-right py-1 px-1 text-empire-parchment/60">Deaths</th>
                    <th className="text-right py-1 pl-1 text-empire-parchment/60">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {forecast.map(({ cycle, pop, kExpected, births, deaths, net }) => (
                    <tr key={cycle} className="border-b border-empire-stone/20">
                      <td className="py-0.5 pr-2">{cycle}</td>
                      <td className="text-right px-1">{pop}</td>
                      <td className="text-right px-1">{kExpected}</td>
                      <td className="text-right px-1">{births}</td>
                      <td className="text-right px-1">{deaths}</td>
                      <td className={`text-right pl-1 font-medium ${net >= 0 ? 'text-green-400/90' : 'text-red-400/90'}`}>{net >= 0 ? '+' : ''}{net}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── City Panel ────────────────────────────────────────────────────

function CityPanel({ city }: { city: import('@/types/game').City }) {
  const [showPopulationMechanics, setShowPopulationMechanics] = useState(false);
  const setFoodPriority = useGameStore(s => s.setFoodPriority);
  const setTaxRate = useGameStore(s => s.setTaxRate);
  const players = useGameStore(s => s.players);
  const cities = useGameStore(s => s.cities);
  const tiles = useGameStore(s => s.tiles);
  const territory = useGameStore(s => s.territory);
  const units = useGameStore(s => s.units);
  const activeWeather = useGameStore(s => s.activeWeather);
  const human = players.find(p => p.isHuman);

  const harvestMult = getWeatherHarvestMultiplier(activeWeather);
  const localProd = computeCityProductionRate(city, tiles, territory, harvestMult);
  const empireCities = human ? cities.filter(c => c.ownerId === human.id) : [];
  const empireTotal = empireCities.reduce(
    (acc, c) => {
      const p = computeCityProductionRate(c, tiles, territory, harvestMult);
      return { food: acc.food + p.food, guns: acc.guns + p.guns };
    },
    { food: 0, guns: 0 },
  );
  const fromNetwork = {
    food: Math.max(0, empireTotal.food - localProd.food),
    guns: Math.max(0, empireTotal.guns - localProd.guns),
  };
  const isIsolated = empireCities.length <= 1;

  return (
    <div className="space-y-3">
      {showPopulationMechanics && (
        <PopulationMechanicsPopover
          city={city}
          foodProducedPerCycle={localProd.food}
          onClose={() => setShowPopulationMechanics(false)}
        />
      )}
      <h3 className="text-empire-gold font-bold text-sm">{city.name}</h3>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <button type="button" onClick={() => setShowPopulationMechanics(true)} className="col-span-2 grid grid-cols-2 gap-x-3 text-left rounded hover:bg-empire-stone/20 transition-colors cursor-pointer py-0.5 -mx-0.5" title="Click for growth mechanics">
          <span className="text-empire-parchment/50">Population</span>
          <span className="text-empire-parchment font-medium">{city.population}</span>
        </button>
        <span className="text-empire-parchment/50" title="Smoothed carrying capacity — population has kids based on this (lags actual production by a few cycles)">Expected capacity (K)</span>
        <span className="text-empire-parchment">{city.expectedCarryingCapacity ?? '—'}</span>
        <span className="text-empire-parchment/50">Morale</span>
        <MoraleBar value={city.morale} />
        <span className="text-empire-parchment/50">Food</span>
        <span className="text-empire-parchment">{city.storage.food} / {city.storageCap.food}</span>
        <span className="text-empire-parchment/50">Guns</span>
        <span className="text-empire-parchment">{city.storage.guns} / {city.storageCap.guns}</span>
        <span className="text-empire-parchment/50">L2 Arms</span>
        <span className="text-empire-parchment">{city.storage.gunsL2 ?? 0} / {city.storageCap.gunsL2 ?? 100}</span>
        <span className="text-empire-parchment/50">Stone</span>
        <span className="text-empire-parchment">{city.storage.stone ?? 0} / {city.storageCap.stone ?? 50}</span>
        <span className="text-empire-parchment/50">Iron</span>
        <span className="text-empire-parchment">{city.storage.iron ?? 0} / {city.storageCap.iron ?? 50}</span>
        <span className="text-empire-parchment/50">Wood</span>
        <span className="text-empire-parchment">{city.storage.wood ?? 0} / {city.storageCap.wood ?? 50}</span>
        <span className="text-empire-parchment/50">Refined wood</span>
        <span className="text-empire-parchment">{city.storage.refinedWood ?? 0} / {city.storageCap.refinedWood ?? 50}</span>
        <span className="text-empire-parchment/50">Buildings</span>
        <span className="text-empire-parchment">{city.buildings.length}</span>
      </div>

      {/* Logistics: flow of goods */}
      <div className="border-t border-empire-stone/30 pt-2 mt-1">
        <p className="text-empire-gold/80 text-[10px] font-semibold uppercase tracking-wide mb-1">Resource flow (per cycle)</p>
        {isIsolated ? (
          <p className="text-empire-parchment/50 text-[10px] mb-1">Cut off from network — local production only</p>
        ) : null}
        <div className="grid grid-cols-[auto_1fr_1fr] gap-x-3 gap-y-0.5 text-[10px] items-center">
          <span className="text-empire-parchment/50 col-span-1">Food</span>
          <span className="text-empire-parchment">Local +{localProd.food}/c</span>
          {!isIsolated && fromNetwork.food > 0 ? (
            <span className="text-green-400/80">+{fromNetwork.food}/c network</span>
          ) : <span />}
          <span className="text-empire-parchment/50">Arms</span>
          <span className="text-empire-parchment">Local +{localProd.guns}/c</span>
          {!isIsolated && fromNetwork.guns > 0 ? (
            <span className="text-green-400/80">+{fromNetwork.guns}/c network</span>
          ) : <span />}
          <span className="text-empire-parchment/50">Wood</span>
          <span className="text-empire-parchment">+{localProd.wood}/c</span>
          <span />
          <span className="text-empire-parchment/50">Refined</span>
          <span className="text-empire-parchment">+{localProd.refinedWood}/c</span>
          <span />
        </div>
      </div>

      <div>
        <label className="text-xs text-empire-parchment/50 block mb-1">Food Priority</label>
        <div className="flex gap-1">
          {(['civilian', 'military'] as const).map(p => (
            <button key={p} onClick={() => setFoodPriority(p)}
              className={`flex-1 px-2 py-1 text-xs rounded border transition-colors ${
                human?.foodPriority === p
                  ? 'border-empire-gold/60 bg-empire-gold/20 text-empire-gold'
                  : 'border-empire-stone/30 text-empire-parchment/50 hover:border-empire-stone/50'
              }`}>
              {p === 'civilian' ? 'Feed People' : 'Feed Army'}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs text-empire-parchment/50 block mb-1">Tax Rate: {Math.round((human?.taxRate ?? 0) * 100)}%</label>
        <input type="range" min="0" max="100" step="10"
          value={(human?.taxRate ?? 0.3) * 100}
          onChange={e => setTaxRate(Number(e.target.value) / 100)}
          className="w-full h-1 bg-empire-stone/30 rounded-lg appearance-none cursor-pointer accent-empire-gold" />
      </div>

      <p className="text-empire-parchment/40 text-[10px]">Barracks: military. Builder&apos;s Hut: workforce tasks & upgrades.</p>
    </div>
  );
}

function MoraleBar({ value }: { value: number }) {
  const color = value > 60 ? 'bg-green-500' : value > 30 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 h-1.5 bg-empire-stone/30 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-empire-parchment text-[10px] w-6 text-right">{value}</span>
    </div>
  );
}

// ─── Barracks Panel (Click barracks → recruit military units) ──────

type MilitaryRecruitRow = {
  type: UnitType;
  maintain: string;
  desc: string;
  l2BarracksOnly?: boolean;
  l3BarracksOnly?: boolean;
  kingdomOnly?: KingdomId;
  fixedLevel?: 1 | 2 | 3;
};

const MILITARY_RECRUIT_INFO: MilitaryRecruitRow[] = [
  { type: 'infantry', maintain: '1 grain/cycle', desc: 'Melee. Cheap and sturdy.' },
  { type: 'cavalry', maintain: '2 grain/cycle', desc: 'Fast melee. 1.5x speed.' },
  { type: 'ranged', maintain: '1 grain/cycle', desc: 'Archer. Attacks from 2 hex.' },
  { type: 'defender', maintain: '1 grain/cycle', desc: 'Tank. L3 only, iron only. High HP, damage resist.', l2BarracksOnly: true },
];

const SIEGE_RECRUIT_INFO: MilitaryRecruitRow[] = [
  { type: 'trebuchet', maintain: '2 grain/cycle', desc: 'Siege. Range 3 vs walls/buildings.' },
  { type: 'battering_ram', maintain: '2 grain/cycle', desc: 'Siege. Melee vs walls. Low HP, defend well.' },
];

const KINGDOM_MILITARY_ROWS: MilitaryRecruitRow[] = [
  { type: 'horse_archer', maintain: '2 grain/cycle', desc: 'Mongol horse archer. Range 2, fast.', kingdomOnly: 'mongols' },
  {
    type: 'crusader_knight',
    maintain: '2 grain/cycle',
    desc: 'Grand Crusader. Best infantry; high iron cost. L3 barracks.',
    kingdomOnly: 'crusaders',
    fixedLevel: 3,
    l3BarracksOnly: true,
  },
];

function ShipyardPanel({ city, shipyardQ, shipyardR }: { city: import('@/types/game').City; shipyardQ: number; shipyardR: number }) {
  const recruitShip = useGameStore(s => s.recruitShip);
  const players = useGameStore(s => s.players);
  const human = players.find(p => p.isHuman);
  const gold = human?.gold ?? 0;
  const wood = city.storage.wood ?? 0;
  const rw = city.storage.refinedWood ?? 0;
  const shipTypes =
    human?.kingdomId === 'fishers'
      ? (['scout_ship', 'warship', 'transport_ship', 'fisher_transport', 'capital_ship'] as const)
      : (['scout_ship', 'warship', 'transport_ship', 'capital_ship'] as const);
  return (
    <div className="space-y-2">
      <h3 className="text-sky-400 text-xs font-semibold uppercase tracking-wide">Shipyard — {city.name}</h3>
      <p className="text-empire-parchment/50 text-[10px]">Costs gold + wood or refined wood from this city. Ship spawns on adjacent water.</p>
      <div className="space-y-1.5">
        {shipTypes.map(t => {
          const c = SHIP_RECRUIT_COSTS[t];
          const ok = gold >= c.gold && wood >= (c.wood ?? 0) && rw >= (c.refinedWood ?? 0);
          const costBits = [
            c.gold > 0 ? `${c.gold}g` : '',
            c.wood != null ? `${c.wood} wood` : '',
            c.refinedWood != null ? `${c.refinedWood} ref.` : '',
          ].filter(Boolean).join(', ');
          return (
            <button
              key={t}
              type="button"
              disabled={!ok}
              onClick={() => recruitShip(city.id, shipyardQ, shipyardR, t)}
              className={`w-full text-left px-2.5 py-2 rounded border text-xs transition-colors ${
                ok ? 'border-sky-500/40 bg-sky-950/30 text-sky-200 hover:bg-sky-900/40' : 'border-empire-stone/20 text-empire-parchment/30 cursor-not-allowed'
              }`}
            >
              <div className="flex justify-between gap-2">
                <span className="font-medium">{UNIT_DISPLAY_NAMES[t]}</span>
                <span>{costBits}</span>
              </div>
              {getShipMaxCargo(t) > 0 && (
                <div className="text-[10px] text-empire-parchment/40">Cargo cap: {getShipMaxCargo(t)} land units</div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function BarracksPanel({ city, barracksQ, barracksR }: { city: import('@/types/game').City; barracksQ: number; barracksR: number }) {
  const recruitUnit = useGameStore(s => s.recruitUnit);
  const recruitCommanderInstant = useGameStore(s => s.recruitCommanderInstant);
  const upgradeBarracks = useGameStore(s => s.upgradeBarracks);
  const players = useGameStore(s => s.players);
  const pendingRecruits = useGameStore(s => s.pendingRecruits);
  const units = useGameStore(s => s.units);
  const human = players.find(p => p.isHuman);
  const gold = human?.gold ?? 0;
  const cities = useGameStore(s => s.cities);
  const barracks = city.buildings.find(b => b.type === 'barracks' && b.q === barracksQ && b.r === barracksR);
  const barracksLvl = barracks?.level ?? 1;
  const totalGunsL2 = cities.filter(c => c.ownerId === human?.id).reduce((s, c) => s + (c.storage.gunsL2 ?? 0), 0);
  const humanCities = cities.filter(c => c.ownerId === human?.id);
  const totalPop = humanCities.reduce((s, c) => s + c.population, 0);
  const livingTroops = units.filter(u => u.ownerId === human?.id && u.hp > 0).length;
  const troopSlotsLeft = Math.max(0, totalPop - livingTroops);
  const canRecruitCommander = gold >= COMMANDER_RECRUIT_GOLD;

  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [levels, setLevels] = useState<Record<string, 1 | 2 | 3>>({});
  const getQty = (type: string) => quantities[type] ?? 1;
  const setQty = (type: string, val: number) => setQuantities(prev => ({ ...prev, [type]: val }));
  const getLevel = (type: string): 1 | 2 | 3 => {
    if (type === 'defender' || type === 'crusader_knight') return 3;
    const l = levels[type] ?? 1;
    return (barracksLvl >= 2 ? (l as 1 | 2 | 3) : 1) as 1 | 2 | 3;
  };
  const setLevel = (type: string, l: 1 | 2 | 3) => setLevels(prev => ({ ...prev, [type]: l }));

  const handleBatchRecruit = (type: import('@/types/game').UnitType, qty: number, armsLevel: 1 | 2 | 3) => {
    for (let i = 0; i < qty; i++) recruitUnit(city.id, type, armsLevel);
  };

  return (
    <MapRoomPanel title={`Barracks — ${city.name}`} innerClassName="space-y-1.5">
      {barracksLvl < 2 && (
        <button
          onClick={() => upgradeBarracks(city.id, barracksQ, barracksR)}
          disabled={gold < BARACKS_UPGRADE_COST}
          className="w-full px-2 py-1.5 text-xs bg-empire-stone/20 border border-empire-gold/45 rounded text-empire-gold hover:bg-empire-stone/35 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Upgrade barracks (L2) — {BARACKS_UPGRADE_COST}g
        </button>
      )}
      {barracksLvl === 2 && (
        <button
          onClick={() => upgradeBarracks(city.id, barracksQ, barracksR)}
          disabled={gold < BARACKS_L3_UPGRADE_COST}
          className="w-full px-2 py-1.5 text-xs bg-empire-stone/20 border border-amber-800/50 rounded text-empire-parchment hover:bg-empire-stone/35 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Upgrade barracks (L3) — {BARACKS_L3_UPGRADE_COST}g
        </button>
      )}
      <p className="text-empire-parchment/50 text-[10px]">Troops: {livingTroops} / {totalPop} (1 per pop; pop lost when unit dies)</p>

      <div className="space-y-1.5">
        {[...MILITARY_RECRUIT_INFO, ...KINGDOM_MILITARY_ROWS].filter((row) => {
          if (row.kingdomOnly && human?.kingdomId !== row.kingdomOnly) return false;
          if (row.l2BarracksOnly && barracksLvl < 2) return false;
          if (row.l3BarracksOnly && barracksLvl < 3) return false;
          return true;
        }).map(({ type, maintain, desc, fixedLevel }) => {
          const liveCity = cities.find(c => c.id === city.id) ?? city;
          const lvl = (fixedLevel ?? getLevel(type)) as 1 | 2 | 3;
          const goldCost = lvl === 3 ? UNIT_L3_COSTS[type].gold : lvl === 2 ? UNIT_L2_COSTS[type].gold : UNIT_COSTS[type].gold;
          const stoneCost = lvl === 2 ? (UNIT_L2_COSTS[type].stone ?? 0) : 0;
          const ironCost = lvl === 3 ? (UNIT_L3_COSTS[type].iron ?? 0) : 0;
          const refinedWoodCost =
            lvl === 3 ? (UNIT_L3_COSTS[type].refinedWood ?? 0) : lvl === 2 ? (UNIT_L2_COSTS[type].refinedWood ?? 0) : (UNIT_COSTS[type].refinedWood ?? 0);
          const rangedRv: RangedVariant | undefined =
            type === 'ranged' && lvl === 3
              ? liveCity.archerDoctrineL3 === 'longbowman'
                ? 'longbowman'
                : 'marksman'
              : undefined;
          const stats = getUnitStats({
            type,
            armsLevel: lvl,
            ...(type === 'ranged' && lvl === 3 ? { rangedVariant: rangedRv } : {}),
          });
          const displayName = getUnitDisplayName(type, lvl, type === 'ranged' && lvl === 3 ? rangedRv : undefined);
          const tierShort = ARMS_TIER_LABELS[lvl];
          const gunL2Upkeep = (stats as { gunL2Upkeep?: number }).gunL2Upkeep ?? 0;
          const upkeepText = gunL2Upkeep > 0 ? `L2 arms. +${gunL2Upkeep} L2 arms/cycle` : maintain;
          const qty = getQty(type);
          const totalGold = goldCost * qty;
          const totalStone = stoneCost * qty;
          const totalIron = ironCost * qty;
          const totalRefinedWood = refinedWoodCost * qty;
          const cityStone = city.storage.stone ?? 0;
          const cityIron = city.storage.iron ?? 0;
          const cityRefinedWood = city.storage.refinedWood ?? 0;
          const maxByGold = goldCost > 0 ? Math.floor(gold / goldCost) : 999;
          const maxByStone = stoneCost > 0 ? Math.floor(cityStone / stoneCost) : 999;
          const maxByIron = ironCost > 0 ? Math.floor(cityIron / ironCost) : 999;
          const maxByRefinedWood = refinedWoodCost > 0 ? Math.floor(cityRefinedWood / refinedWoodCost) : 999;
          const maxQty = Math.max(1, Math.min(maxByGold, maxByStone, maxByIron, maxByRefinedWood, troopSlotsLeft, 20));
          const canAffordL2Arms = gunL2Upkeep === 0 || totalGunsL2 >= gunL2Upkeep * qty;
          const doctrineBlocked =
            type === 'ranged' &&
            lvl === 3 &&
            barracksLvl >= 3 &&
            liveCity.archerDoctrineL3 !== 'marksman' &&
            liveCity.archerDoctrineL3 !== 'longbowman';
          const canAfford =
            gold >= totalGold &&
            cityStone >= totalStone &&
            cityIron >= totalIron &&
            cityRefinedWood >= totalRefinedWood &&
            livingTroops + qty <= totalPop &&
            canAffordL2Arms &&
            !doctrineBlocked;
          const isL2 = lvl === 2;
          const isL3 = lvl === 3;
          const costLabelParts: string[] = [];
          if (goldCost > 0) costLabelParts.push(`${goldCost}g`);
          if (stoneCost > 0) costLabelParts.push(`${stoneCost} stone`);
          if (ironCost > 0) costLabelParts.push(`${ironCost} iron`);
          if (refinedWoodCost > 0) costLabelParts.push(`${refinedWoodCost} ref.`);
          const costLabel = costLabelParts.join(', ');
          return (
            <div key={type} className={`px-2.5 py-2 rounded border transition-colors ${
              canAfford
                ? isL3
                  ? 'border-amber-700/45 bg-amber-950/25 text-empire-parchment'
                  : isL2
                    ? 'border-empire-gold/40 bg-empire-gold/10 text-empire-parchment'
                    : 'border-empire-stone/40 bg-empire-stone/15 text-empire-parchment'
                : 'border-empire-stone/20 bg-transparent text-empire-parchment/30'
            }`}>
              <div className="flex justify-between items-center gap-2 mb-0.5">
                <span className={`font-bold text-xs ${isL3 ? 'text-amber-200' : isL2 ? 'text-empire-gold' : 'text-empire-parchment'}`}>
                  {tierShort} {displayName}
                </span>
                <span className={`text-xs font-mono ${canAfford ? 'text-yellow-400' : 'text-red-400/50'}`}>{costLabel} ea</span>
              </div>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[10px] text-empire-parchment/50">{desc}</span>
                {type !== 'defender' && type !== 'crusader_knight' && (
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => setLevel(type, 1)} disabled={lvl === 1} className="w-5 h-5 rounded bg-empire-stone/30 text-empire-parchment/80 text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-empire-stone/50" aria-label="L1">−</button>
                    <span className="text-[10px] font-mono text-orange-300 w-5 text-center">{lvl}</span>
                    <button type="button" onClick={() => setLevel(type, 2)} disabled={lvl === 2 || lvl === 3 || barracksLvl < 2} className="w-5 h-5 rounded bg-empire-stone/30 text-empire-parchment/80 text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-empire-stone/50" aria-label="L2">+</button>
                    <button type="button" onClick={() => setLevel(type, 3)} disabled={lvl === 3 || barracksLvl < 2} className="w-5 h-5 rounded bg-empire-stone/30 text-empire-parchment/80 text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-empire-stone/50" aria-label="L3">++</button>
                  </div>
                )}
                {(type === 'defender' || type === 'crusader_knight') && <span className="text-[10px] font-mono text-amber-300">Iron-forged only</span>}
              </div>
              {type === 'ranged' && lvl === 3 && barracksLvl >= 3 && (liveCity.archerDoctrineL3 === 'marksman' || liveCity.archerDoctrineL3 === 'longbowman') && (
                <p className="text-[10px] text-empire-parchment/45 mt-0.5">
                  Archer doctrine: {liveCity.archerDoctrineL3 === 'longbowman' ? 'Longbowman' : 'Marksman'} (locked)
                </p>
              )}
              {doctrineBlocked && (
                <p className="text-[10px] text-red-400/80 mt-0.5">Choose archer doctrine (popup after L3 barracks upgrade, or try recruiting).</p>
              )}
              <div className="flex justify-between text-[10px] mt-0.5 mb-1.5">
                <span className={isL3 ? 'text-amber-200/90' : isL2 ? 'text-empire-gold/90' : 'text-empire-parchment/40'}>HP {stats.maxHp} | ATK {stats.attack} | Rng {stats.range}</span>
                <span className="text-empire-parchment/55">{upkeepText}</span>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={1}
                  max={maxQty}
                  value={Math.min(qty, maxQty)}
                  onChange={e => setQty(type, Number(e.target.value))}
                  className="flex-1 h-1 bg-empire-stone/30 rounded-lg appearance-none cursor-pointer accent-empire-gold"
                />
                <span className="text-xs font-mono text-empire-gold/90 w-6 text-right">{qty}</span>
              </div>

              <div className="flex justify-between items-center mt-1">
                <span className="text-[10px] text-empire-parchment/40">
                  Total: {totalGold > 0 && <span className={canAfford ? 'text-yellow-400' : 'text-red-400'}>{totalGold}g</span>}
                  {totalStone > 0 && <span className={canAfford ? 'text-empire-parchment' : 'text-red-400'}> {totalStone} stone</span>}
                  {totalIron > 0 && <span className={canAfford ? 'text-empire-parchment' : 'text-red-400'}> {totalIron} iron</span>}
                  {totalRefinedWood > 0 && <span className={canAfford ? 'text-teal-300' : 'text-red-400'}> {totalRefinedWood} ref.</span>}
                  {' · '}{qty} pop
                </span>
                <button
                  onClick={() => handleBatchRecruit(type, qty, lvl as 1 | 2 | 3)}
                  disabled={!canAfford}
                  className={`px-2.5 py-1 text-[10px] font-bold rounded transition-colors ${
                    canAfford
                      ? isL3
                        ? 'bg-amber-800/45 text-amber-100 hover:bg-amber-800/60'
                        : isL2
                          ? 'bg-empire-gold/25 text-empire-parchment hover:bg-empire-gold/35'
                          : 'bg-empire-stone/30 text-empire-parchment hover:bg-empire-stone/45'
                      : 'bg-empire-stone/10 text-empire-parchment/20 cursor-not-allowed'
                  }`}
                >
                  Recruit {qty} {tierShort}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => recruitCommanderInstant()}
        disabled={!canRecruitCommander}
        className="w-full px-2 py-1.5 text-xs bg-empire-stone/25 border border-empire-gold/35 rounded text-empire-parchment hover:bg-empire-stone/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Recruit commander ({COMMANDER_RECRUIT_GOLD}g) — ~25% naval; assign in City tab or Army panel
      </button>
    </MapRoomPanel>
  );
}

function SiegeWorkshopPanel({ city, workshopQ, workshopR }: { city: import('@/types/game').City; workshopQ: number; workshopR: number }) {
  const recruitUnit = useGameStore(s => s.recruitUnit);
  const players = useGameStore(s => s.players);
  const units = useGameStore(s => s.units);
  const cities = useGameStore(s => s.cities);
  const human = players.find(p => p.isHuman);
  const gold = human?.gold ?? 0;
  const ws = city.buildings.find(b => b.type === 'siege_workshop' && b.q === workshopQ && b.r === workshopR);
  const totalGunsL2 = cities.filter(c => c.ownerId === human?.id).reduce((s, c) => s + (c.storage.gunsL2 ?? 0), 0);
  const humanCities = cities.filter(c => c.ownerId === human?.id);
  const totalPop = humanCities.reduce((s, c) => s + c.population, 0);
  const livingTroops = units.filter(u => u.ownerId === human?.id && u.hp > 0).length;
  const troopSlotsLeft = Math.max(0, totalPop - livingTroops);

  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const getQty = (type: string) => quantities[type] ?? 1;
  const setQty = (type: string, val: number) => setQuantities(prev => ({ ...prev, [type]: val }));

  const handleBatchRecruit = (unitType: import('@/types/game').UnitType, qty: number) => {
    for (let i = 0; i < qty; i++) recruitUnit(city.id, unitType, 1);
  };

  if (!ws) return null;

  return (
    <div className="space-y-1.5">
      <h3 className="text-amber-600 text-xs font-semibold uppercase tracking-wide">Siege workshop — {city.name}</h3>
      <p className="text-empire-parchment/50 text-[10px]">Trebuchet and battering ram (L1). Troops: {livingTroops} / {totalPop}</p>
      <div className="space-y-1.5">
        {SIEGE_RECRUIT_INFO.map(({ type, maintain, desc }) => {
          const lvl = 1 as const;
          const goldCost = UNIT_COSTS[type].gold;
          const refinedWoodCost = UNIT_COSTS[type].refinedWood ?? 0;
          const stats = getUnitStats({ type, armsLevel: lvl });
          const gunL2Upkeep = (stats as { gunL2Upkeep?: number }).gunL2Upkeep ?? 0;
          const upkeepText = gunL2Upkeep > 0 ? `L2 arms. +${gunL2Upkeep} L2 arms/cycle` : maintain;
          const qty = getQty(type);
          const totalGold = goldCost * qty;
          const totalRefinedWood = refinedWoodCost * qty;
          const cityRefinedWood = city.storage.refinedWood ?? 0;
          const maxByGold = goldCost > 0 ? Math.floor(gold / goldCost) : 999;
          const maxByRefinedWood = refinedWoodCost > 0 ? Math.floor(cityRefinedWood / refinedWoodCost) : 999;
          const maxQty = Math.max(1, Math.min(maxByGold, maxByRefinedWood, troopSlotsLeft, 20));
          const canAffordL2Arms = gunL2Upkeep === 0 || totalGunsL2 >= gunL2Upkeep * qty;
          const canAfford =
            gold >= totalGold &&
            cityRefinedWood >= totalRefinedWood &&
            livingTroops + qty <= totalPop &&
            canAffordL2Arms;
          const costLabelParts: string[] = [];
          if (goldCost > 0) costLabelParts.push(`${goldCost}g`);
          if (refinedWoodCost > 0) costLabelParts.push(`${refinedWoodCost} ref.`);
          const costLabel = costLabelParts.join(', ');
          return (
            <div
              key={type}
              className={`px-2.5 py-2 rounded border transition-colors ${
                canAfford
                  ? 'border-amber-600/35 bg-amber-950/20 text-empire-parchment'
                  : 'border-empire-stone/20 bg-transparent text-empire-parchment/30'
              }`}
            >
              <div className="flex justify-between items-center gap-2 mb-0.5">
                <span className="font-bold text-xs">{UNIT_DISPLAY_NAMES[type]}</span>
                <span className={`text-xs font-mono ${canAfford ? 'text-yellow-400' : 'text-red-400/50'}`}>{costLabel} ea</span>
              </div>
              <div className="flex justify-between items-center gap-2 flex-wrap">
                <span className="text-[10px] text-empire-parchment/50">{desc}</span>
              </div>
              <div className="flex justify-between text-[10px] mt-0.5 mb-1.5">
                <span className="text-empire-parchment/40">HP {stats.maxHp} | ATK {stats.attack} | Rng {stats.range}</span>
                <span className="text-amber-300/60">{upkeepText}</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={1}
                  max={maxQty}
                  value={Math.min(qty, maxQty)}
                  onChange={e => setQty(type, Number(e.target.value))}
                  className="flex-1 h-1 bg-empire-stone/30 rounded-lg appearance-none cursor-pointer accent-amber-600"
                />
                <span className="text-xs font-mono text-amber-300 w-6 text-right">{qty}</span>
              </div>
              <div className="flex justify-between items-center mt-1">
                <span className="text-[10px] text-empire-parchment/40">
                  Total: {totalGold > 0 && <span className={canAfford ? 'text-yellow-400' : 'text-red-400'}>{totalGold}g</span>}
                  {totalRefinedWood > 0 && <span className={canAfford ? 'text-teal-300' : 'text-red-400'}> {totalRefinedWood} ref.</span>}
                  {' · '}{qty} pop
                </span>
                <button
                  type="button"
                  onClick={() => handleBatchRecruit(type, qty)}
                  disabled={!canAfford}
                  className={`px-2.5 py-1 text-[10px] font-bold rounded transition-colors ${
                    canAfford
                      ? 'bg-amber-700/40 text-amber-100 hover:bg-amber-700/55'
                      : 'bg-empire-stone/10 text-empire-parchment/20 cursor-not-allowed'
                  }`}
                >
                  Recruit {qty}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Academy Panel (Builder's Hut — workforce & tasks) ────────────

function AcademyPanel({ city, academyQ, academyR }: { city: import('@/types/game').City; academyQ: number; academyR: number }) {
  const setUniversityBuilderTask = useGameStore(s => s.setUniversityBuilderTask);
  const setUniversityBuilderSlotTask = useGameStore(s => s.setUniversityBuilderSlotTask);
  const upgradeUniversity = useGameStore(s => s.upgradeUniversity);
  const buildWallRing = useGameStore(s => s.buildWallRing);
  const wallSections = useGameStore(s => s.wallSections);
  const players = useGameStore(s => s.players);
  const constructions = useGameStore(s => s.constructions);
  const roadConstructions = useGameStore(s => s.roadConstructions);
  const tiles = useGameStore(s => s.tiles);
  const territory = useGameStore(s => s.territory);
  const cities = useGameStore(s => s.cities);
  const human = players.find(p => p.isHuman);
  const gold = human?.gold ?? 0;

  const liveCity = useGameStore(s => s.cities.find(c => c.id === city.id)) ?? city;
  const academy = liveCity.buildings.find(b => b.type === 'academy' && b.q === academyQ && b.r === academyR);
  const lvl = academy?.level ?? 1;
  const slots = getUniversityBuilderSlots(academy);
  const slotTasks = getUniversitySlotTasks(liveCity, academy);
  const [dragOverTask, setDragOverTask] = useState<BuilderTask | null>(null);
  const upgradeCost = lvl < 5 ? UNIVERSITY_UPGRADE_COSTS[lvl - 1] : undefined;
  const canUpgrade = upgradeCost !== undefined && gold >= upgradeCost;
  const workforceBP = slots * BUILDER_POWER;
  const bpPerSec = (workforceBP / BP_RATE_BASE).toFixed(1);

  const cityConstructions = constructions.filter(c => c.cityId === city.id && c.ownerId === 'player_human');
  const cityRoads = roadConstructions.filter(r => {
    const terr = territory.get(tileKey(r.q, r.r));
    return terr && terr.cityId === city.id && r.ownerId === 'player_human';
  });

  const TASKS: { id: BuilderTask; label: string; desc: string; color: string }[] = [
    { id: 'expand_quarries', label: 'Quarries', desc: 'Quarry construction', color: 'stone' },
    { id: 'expand_iron_mines', label: 'Mining', desc: 'Iron mine & gold mine construction', color: 'amber' },
    { id: 'expand_forestry', label: 'Forestry', desc: 'Logging hut & sawmill construction', color: 'emerald' },
    { id: 'city_defenses', label: 'Walls', desc: 'Wall sections around your city', color: 'rose' },
  ];

  return (
    <MapRoomPanel title={`Builder's Hut — ${city.name}`} innerClassName="space-y-3">

      {/* Builder count — prominent visual */}
      {(() => {
        const TASK_COLORS: Record<string, { border: string; bg: string; text: string; ring: string }> = {
          expand_quarries:    { border: 'border-stone-500/65', bg: 'bg-stone-900/55', text: 'text-stone-100', ring: 'ring-stone-500/25' },
          expand_iron_mines:  { border: 'border-amber-600/60', bg: 'bg-amber-950/50', text: 'text-amber-100', ring: 'ring-amber-500/25' },
          expand_forestry:    { border: 'border-emerald-600/55', bg: 'bg-emerald-950/45', text: 'text-emerald-100', ring: 'ring-emerald-500/25' },
          city_defenses:      { border: 'border-rose-500/55', bg: 'bg-rose-950/45', text: 'text-rose-100', ring: 'ring-rose-500/25' },
          idle:               { border: 'border-slate-500/45', bg: 'bg-slate-950/50', text: 'text-slate-300', ring: 'ring-slate-500/20' },
        };
        const TASK_SHORT_LABEL: Record<string, string> = {
          expand_quarries: 'Qry',
          expand_iron_mines: 'Mine',
          expand_forestry: 'For',
          city_defenses: 'Wal',
          idle: 'Off',
        };
        return (
          <div className="bg-empire-stone/20 border border-empire-stone/40 rounded-md px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <div className="flex items-center justify-between mb-2">
              <span className="font-cinzel text-empire-gold text-xs font-bold tracking-wide">Workforce</span>
              <span className="text-empire-parchment/90 text-xs font-medium">Level {lvl}</span>
            </div>
            <div className="flex items-center gap-1.5 mb-1.5">
              {Array.from({ length: 5 }, (_, i) => {
                const task = i < slots ? slotTasks[i] : undefined;
                const tc = task ? TASK_COLORS[task] : undefined;
                return (
                  <div
                    key={i}
                    draggable={i < slots}
                    onDragStart={e => {
                      if (i >= slots) return;
                      const payload = JSON.stringify({
                        kind: 'builderSlot',
                        cityId: liveCity.id,
                        slotIndex: i,
                      });
                      e.dataTransfer.setData(BUILDER_SLOT_DRAG_MIME, payload);
                      e.dataTransfer.setData('text/plain', payload);
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    title={i < slots ? `Builder ${i + 1}: ${BUILDER_TASK_LABELS[task!] ?? task} — drag to reassign` : 'Locked — upgrade to unlock'}
                    className={`w-9 h-9 rounded border-2 flex flex-col items-center justify-center transition-colors select-none ${
                      i < slots
                        ? `${tc?.border ?? 'border-empire-gold/50'} ${tc?.bg ?? 'bg-empire-stone/40'} ${tc?.text ?? 'text-empire-gold'} ring-1 ${tc?.ring ?? 'ring-empire-gold/20'} cursor-grab active:cursor-grabbing`
                        : 'border-dashed border-empire-stone/25 bg-black/20 text-empire-parchment/15'
                    }`}
                  >
                    {i < slots ? (
                      <>
                        <span className="text-sm font-bold leading-none">{'\u2692'}</span>
                        <span className="text-[7px] font-semibold leading-none mt-0.5 opacity-80">{TASK_SHORT_LABEL[task!] ?? '?'}</span>
                      </>
                    ) : (
                      <span className="text-[9px] leading-none">🔒</span>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-empire-parchment/55">
                {slots} builder{slots !== 1 ? 's' : ''} active
              </span>
              <span className="text-empire-gold/85">+{bpPerSec} BP/sec total workforce</span>
            </div>
          </div>
        );
      })()}

      {/* Upgrade */}
      {lvl < 5 && upgradeCost !== undefined && (
        <button
          type="button"
          onClick={() => upgradeUniversity(city.id, academyQ, academyR)}
          disabled={!canUpgrade}
          className="w-full px-2 py-1.5 text-xs bg-empire-stone/25 border border-empire-gold/40 rounded text-empire-gold hover:bg-empire-stone/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Upgrade to L{lvl + 1} — {upgradeCost}g (+1 builder)
        </button>
      )}

      {/* Task assignment — drag a hammer from Workforce onto a task (parallel assignments). */}
      <div>
        <p className="text-[10px] text-empire-gold/90 mb-1.5 font-cinzel font-semibold uppercase tracking-wide">
          Assign builders to
        </p>
        <p className="text-[9px] text-empire-parchment/50 mb-1.5 leading-snug">
          Drag a builder from the row above onto a task. Each slot adds {BUILDER_POWER} BP per tick to matching sites only.
          Drag onto Unassigned to clear that slot.
        </p>
        <div
          role="group"
          onDragOver={e => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }}
          onDragEnter={e => {
            e.preventDefault();
            setDragOverTask('idle');
          }}
          onDragLeave={e => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverTask(null);
          }}
          onDrop={e => {
            e.preventDefault();
            setDragOverTask(null);
            const p = parseBuilderSlotDrag(e);
            if (!p || p.cityId !== liveCity.id) return;
            setUniversityBuilderSlotTask(liveCity.id, p.slotIndex, 'idle');
          }}
          className={`mb-1.5 px-2.5 py-2 rounded border border-dashed text-[11px] transition-colors ${
            dragOverTask === 'idle'
              ? 'border-slate-400/55 bg-slate-950/40 ring-2 ring-slate-400/25 text-empire-parchment'
              : 'border-slate-500/35 bg-black/20 text-empire-parchment/70'
          }`}
        >
          <span className="font-medium text-slate-200/95">Unassigned</span>
          <span className="block text-[9px] text-empire-parchment/45 mt-0.5">Drop a builder here to remove their task (no extra BP).</span>
        </div>
        <div className="flex flex-col gap-1">
          {TASKS.map(t => {
            const assignedHere = slotTasks.filter(st => st === t.id).length;
            const matching = cityConstructions.filter(c => {
              switch (t.id) {
                case 'expand_quarries': return c.type === 'quarry';
                case 'expand_iron_mines': return c.type === 'mine' || c.type === 'gold_mine';
                case 'expand_forestry': return c.type === 'logging_hut' || c.type === 'sawmill';
                case 'city_defenses': return c.type === 'wall_section';
                default: return false;
              }
            });
            return (
              <div
                key={t.id}
                role="group"
                onDragOver={e => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'copy';
                }}
                onDragEnter={e => {
                  e.preventDefault();
                  setDragOverTask(t.id);
                }}
                onDragLeave={e => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverTask(null);
                }}
                onDrop={e => {
                  e.preventDefault();
                  setDragOverTask(null);
                  const p = parseBuilderSlotDrag(e);
                  if (!p || p.cityId !== liveCity.id) return;
                  setUniversityBuilderSlotTask(liveCity.id, p.slotIndex, t.id);
                }}
                className={`text-left px-2.5 py-2 rounded border text-[11px] transition-colors ${
                  dragOverTask === t.id
                    ? 'border-empire-gold/55 bg-empire-stone/30 ring-2 ring-empire-gold/25 text-empire-parchment'
                    : assignedHere > 0
                      ? 'border-empire-stone/45 bg-empire-stone/20 text-empire-parchment/90'
                      : 'border-empire-stone/25 bg-black/15 text-empire-parchment/75'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="font-medium">{t.label}</span>
                  <div className="flex flex-wrap items-center justify-end gap-1">
                    {assignedHere > 0 && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-empire-gold/15 text-empire-gold whitespace-nowrap border border-empire-gold/35">
                        {assignedHere} builder{assignedHere !== 1 ? 's' : ''}
                      </span>
                    )}
                    {matching.length > 0 && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-empire-stone/15 text-empire-parchment/45 whitespace-nowrap">
                        {matching.length} active site{matching.length !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-[9px] text-empire-parchment/40 mt-0.5">{t.desc}</div>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          <span className="text-[9px] text-empire-parchment/50">All slots:</span>
          {TASKS.map(t => (
            <button
              key={`all-${t.id}`}
              type="button"
              onClick={() => setUniversityBuilderTask(liveCity.id, t.id)}
              className="text-[9px] px-1.5 py-0.5 rounded border border-empire-stone/35 text-empire-parchment/75 hover:bg-empire-stone/30 hover:border-empire-gold/45 transition-colors"
            >
              {t.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setUniversityBuilderTask(liveCity.id, 'idle')}
            className="text-[9px] px-1.5 py-0.5 rounded border border-empire-stone/40 text-empire-parchment/70 hover:bg-empire-stone/25 hover:border-empire-stone/55 transition-colors"
          >
            Unassign all
          </button>
        </div>
      </div>

      {/* Walls — tower placement is gold via territory build menu; workforce “Walls” task builds wall sections only */}
      {(() => {
        const wallsUnlocked = slotTasks.some(st => st === 'city_defenses');
        const cityStone = liveCity.storage.stone ?? 0;
        const queuedWallKeys = new Set(
          constructions
            .filter(c => c.ownerId === human?.id && c.type === 'wall_section')
            .map(c => tileKey(c.q, c.r)),
        );
        const ringStatus = (ring: 1 | 2) => {
          const ringHexes = getHexRing(liveCity.q, liveCity.r, ring).filter(({ q, r }) => {
            const t = tiles.get(tileKey(q, r));
            return !!t && t.biome !== 'water';
          });
          const built = ringHexes.filter(({ q, r }) => wallSections.some(
            w => w.ownerId === human?.id && w.q === q && w.r === r,
          )).length;
          const queued = ringHexes.filter(({ q, r }) => queuedWallKeys.has(tileKey(q, r))).length;
          const missing = Math.max(0, ringHexes.length - built - queued);
          return { target: ringHexes.length, built, queued, missing };
        };
        const ring1 = ringStatus(1);
        const ring2 = ringStatus(2);
        const totalMissing = ring1.missing + ring2.missing;
        const wallSlots = countDefensesTaskSlots(liveCity);
        const stonePerCycle = wallSlots * WALL_BUILDER_STONE_PER_CYCLE_PER_SLOT;
        const hasWallBuilding = constructions.some(c => c.cityId === liveCity.id && c.type === 'wall_section');
        const canQueueNext =
          wallsUnlocked &&
          totalMissing > 0 &&
          !hasWallBuilding &&
          (wallSlots <= 0 || cityStone >= stonePerCycle);
        return (
          <div className="space-y-2 border border-rose-500/35 rounded-md px-2.5 py-2 bg-gradient-to-b from-rose-950/25 to-empire-stone/15 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
            <p className="font-cinzel text-rose-200/95 text-[11px] font-semibold tracking-wide">Walls</p>
            {!wallsUnlocked && (
              <p className="text-[10px] text-amber-200/85 leading-snug border border-amber-500/30 rounded px-2 py-1.5 bg-amber-950/20">
                Drag a Workforce slot onto <span className="text-amber-100/90">Walls</span> (or &quot;All slots: Walls&quot;) to unlock wall projects for {liveCity.name}. Defense towers are bought with gold from the <span className="text-amber-100/90">build menu</span> on a territory hex.
              </p>
            )}
            <p className="text-[9px] text-empire-parchment/45">
              Sections build one at a time: <span className="text-empire-parchment/70">inner ring first</span>, then outer. On the map, walls rise as builders work. Each economy cycle costs{' '}
              <span className="text-rose-200/90">{WALL_BUILDER_STONE_PER_CYCLE_PER_SLOT} stone per Walls slot</span> while a section is under construction (stalls if you cannot pay).
            </p>
            <div className="text-[9px] text-empire-parchment/55 space-y-0.5">
              <div>Ring 1: {ring1.built + ring1.queued}/{ring1.target}{ring1.missing <= 0 ? ' ✓' : ''}</div>
              <div>Ring 2: {ring2.built + ring2.queued}/{ring2.target}{ring2.missing <= 0 ? ' ✓' : ''}</div>
            </div>
            <button
              type="button"
              onClick={() => buildWallRing(liveCity.id, 1)}
              disabled={!canQueueNext}
              className={`w-full text-left px-2 py-1.5 rounded border text-[11px] transition-colors ${
                totalMissing <= 0
                  ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-300/70 cursor-default'
                  : !canQueueNext
                    ? 'border-empire-stone/20 text-empire-parchment/25 cursor-not-allowed'
                    : 'border-rose-500/40 bg-rose-950/30 text-rose-200 hover:bg-rose-900/35'
              }`}
            >
              <div className="flex justify-between gap-2">
                <span>
                  {totalMissing <= 0
                    ? 'Walls complete'
                    : hasWallBuilding
                      ? 'Section under construction…'
                      : 'Queue next wall section'}
                </span>
                {totalMissing > 0 && !hasWallBuilding && (
                  <span className={cityStone >= stonePerCycle ? 'text-rose-300/80 shrink-0' : 'text-red-400/60 shrink-0'}>
                    {stonePerCycle > 0 ? `${stonePerCycle} stone/c` : '—'}
                  </span>
                )}
              </div>
            </button>
          </div>
        );
      })()}

      {/* Active constructions for this city */}
      {(cityConstructions.length > 0 || cityRoads.length > 0) && (
        <div>
          <p className="text-[10px] text-empire-gold/90 mb-1 font-cinzel font-semibold uppercase tracking-wide">
            Active projects ({cityConstructions.length + cityRoads.length})
          </p>
          <div className="flex flex-col gap-1 max-h-32 overflow-y-auto map-scroll pr-0.5">
            {cityConstructions.map(site => {
              const availBP = computeConstructionAvailableBp(site, territory, cities, constructions);
              const pct = Math.min(100, Math.round((site.bpAccumulated / site.bpRequired) * 100));
              const gettingBoost = slotTasks.some(tt => universityTaskMatchesSiteType(tt, site.type));
              const typeName = site.type === 'city_defense' && site.defenseTowerType && site.defenseTowerTargetLevel
                ? `${DEFENSE_TOWER_DISPLAY_NAME[site.defenseTowerType]} L${site.defenseTowerTargetLevel}`
                : site.type === 'wall_section'
                  ? `Wall section${site.wallBuildRing ? ` (ring ${site.wallBuildRing})` : ''}`
                  : site.type.replace(/_/g, ' ');
              return (
                <div key={site.id} className="bg-empire-stone/20 border border-empire-stone/35 rounded px-2 py-1.5">
                  <div className="flex justify-between items-center text-[10px]">
                    <span className="capitalize text-empire-parchment/85">
                      {gettingBoost && <span className="text-empire-gold mr-0.5" title="Boosted by workforce">\u2692</span>}
                      {typeName}
                    </span>
                    <span className="text-empire-parchment/55">{pct}% · {availBP} BP</span>
                  </div>
                  <div className="w-full h-1 bg-empire-stone/50 rounded-full overflow-hidden mt-1">
                    <div
                      className={`h-full rounded-full transition-all ${gettingBoost ? 'bg-empire-gold/70' : 'bg-teal-800/55'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
            {cityRoads.map(road => {
              const pct = Math.min(100, Math.round((road.bpAccumulated / road.bpRequired) * 100));
              return (
                <div key={road.id} className="bg-empire-stone/20 border border-empire-stone/35 rounded px-2 py-1.5">
                  <div className="flex justify-between items-center text-[10px]">
                    <span className="text-empire-parchment/85">
                      <span className="text-empire-gold mr-0.5" title="Uses workforce">\u2692</span>
                      Road ({road.q},{road.r})
                    </span>
                    <span className="text-empire-parchment/55">{pct}%</span>
                  </div>
                  <div className="w-full h-1 bg-empire-stone/50 rounded-full overflow-hidden mt-1">
                    <div className="h-full bg-teal-800/55 rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p className="text-[10px] text-empire-parchment/45 leading-snug border-t border-empire-stone/30 pt-2 mt-1">
        All territory buildings get {CITY_BUILDING_POWER} base BP. Each workforce slot adds {BUILDER_POWER} BP to sites that match that slot&apos;s task (parallel builds). Roads and field trebuchets still use total workforce from this city.
      </p>
    </MapRoomPanel>
  );
}

// ─── University Building Panel (new — research, specialization, graduates) ─

function UniversityBuildingPanel({ city, buildingQ, buildingR }: { city: City; buildingQ: number; buildingR: number }) {
  const setSpec = useGameStore(s => s.setUniversitySpecialization);
  const upgradeUni = useGameStore(s => s.upgradeUniversityBuilding);
  const human = useGameStore(s => s.players).find(p => p.isHuman);
  const politicians = useGameStore(s => s.politicians);
  const commanders = useGameStore(s => s.commanders);
  const liveCity = useGameStore(s => s.cities.find(c => c.id === city.id)) ?? city;
  const building = liveCity.buildings.find(b => b.type === 'university' && b.q === buildingQ && b.r === buildingR);
  if (!building || !human) return null;

  const lvl = building.level ?? 1;
  const spec = building.universitySpecialization ?? 'general';
  const gold = human.gold;
  const upgradeCost = lvl < 5 ? UNIVERSITY_BUILDING_UPGRADE_COSTS[lvl - 1] : undefined;
  const canUpgrade = upgradeCost !== undefined && gold >= upgradeCost;

  const cityPoliticians = politicians.filter(p => p.ownerId === human.id);
  const cityCmdrs = commanders.filter(c => c.ownerId === human.id && c.q === liveCity.q && c.r === liveCity.r);

  return (
    <MapRoomPanel title={`University — ${liveCity.name}`} innerClassName="space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-cinzel text-indigo-200 text-xs font-bold tracking-wide">Level {lvl}</span>
        <span className="text-[10px] text-empire-parchment/50">3 jobs</span>
      </div>

      {/* Specialization selector */}
      <div>
        <p className="text-[10px] text-indigo-300/80 font-semibold uppercase tracking-wide mb-1.5">Specialization</p>
        <div className="grid grid-cols-2 gap-1.5">
          {(['military', 'economics', 'research', 'general'] as const).map(s => {
            const info = UNIVERSITY_SPECIALIZATION_INFO[s];
            const active = spec === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setSpec(liveCity.id, buildingQ, buildingR, s)}
                className={`text-left px-2 py-1.5 rounded border text-[10px] transition-colors ${
                  active
                    ? 'border-indigo-400/50 bg-indigo-950/40 text-indigo-200'
                    : 'border-empire-stone/25 text-empire-parchment/55 hover:border-indigo-500/30 hover:bg-indigo-950/20'
                }`}
              >
                <div className="font-semibold">{info.label}</div>
                <div className="text-[9px] text-empire-parchment/40 leading-snug">{info.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Upgrade */}
      {lvl < 5 && upgradeCost !== undefined && (
        <button
          type="button"
          onClick={() => upgradeUni(liveCity.id, buildingQ, buildingR)}
          disabled={!canUpgrade}
          className="w-full px-2 py-1.5 text-xs bg-empire-stone/25 border border-indigo-400/40 rounded text-indigo-200 hover:bg-empire-stone/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Upgrade to L{lvl + 1} — {upgradeCost}g
        </button>
      )}
      {lvl >= 5 && (
        <div className="text-[11px] text-green-400/80 text-center">University at max level.</div>
      )}

      {/* Graduates summary */}
      <div className="border-t border-empire-stone/20 pt-2">
        <p className="text-[10px] text-empire-parchment/50 leading-snug">
          Each cycle this university has a <span className="text-indigo-300/80 font-semibold">{Math.round((0.08 * lvl) * 100)}%</span> chance to produce a graduate.
          {spec === 'military' && ' Favors commanders (75%).'}
          {spec === 'economics' && ' Favors politicians (75%).'}
          {spec === 'research' && ' Balanced; faster tech progress.'}
          {spec === 'general' && ' Equal chance; extra education bonus.'}
        </p>
        <div className="flex gap-3 mt-1.5 text-[10px]">
          <span className="text-indigo-300/70">Politicians: <span className="text-indigo-200 font-semibold">{cityPoliticians.length}</span></span>
          <span className="text-red-300/70">Commanders at city: <span className="text-red-200 font-semibold">{cityCmdrs.length}</span></span>
        </div>
      </div>

      <p className="text-[9px] text-empire-parchment/35 leading-snug">
        Universities boost national literacy and research speed. Assign graduates to the National Council via the Civilian panel.
      </p>
    </MapRoomPanel>
  );
}

// ─── Factory Panel ──────────────────────────────────────────────────

function FactoryPanel({ city, factoryQ, factoryR }: { city: import('@/types/game').City; factoryQ: number; factoryR: number }) {
  const upgradeFactory = useGameStore(s => s.upgradeFactory);
  const adjustWorkers = useGameStore(s => s.adjustWorkers);
  const human = useGameStore(s => s.players).find(p => p.isHuman);
  const gold = human?.gold ?? 0;
  const factory = city.buildings.find(b => b.type === 'factory' && b.q === factoryQ && b.r === factoryR);
  const factoryLvl = factory?.level ?? 1;
  const l2FactoryCount = city.buildings.filter(b => b.type === 'factory' && (b.level ?? 1) >= 2).length;
  const factoryCount = city.buildings.filter(b => b.type === 'factory').length;
  const moraleMod = city.morale / 100;
  const armsPerFactory = BUILDING_PRODUCTION.factory.guns;
  const staffedFactories = city.buildings.filter(b => b.type === 'factory' && ((b as import('@/types/game').CityBuilding).assignedWorkers ?? 0) >= BUILDING_JOBS.factory).length;
  const totalArms = Math.round(armsPerFactory * staffedFactories * moraleMod);

  return (
    <div className="space-y-2">
      <h3 className="text-cyan-400 text-xs font-semibold uppercase tracking-wide">Factory — {city.name}</h3>
      {factoryLvl < 2 && (
        <button
          onClick={() => upgradeFactory(city.id, factoryQ, factoryR)}
          disabled={gold < FACTORY_UPGRADE_COST}
          className="w-full px-2 py-1.5 text-xs bg-cyan-900/30 border border-cyan-500/40 rounded text-cyan-300 hover:bg-cyan-900/50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Upgrade Factory (L2) — {FACTORY_UPGRADE_COST}g — 1 iron &rarr; 10 L2 arms/cycle
        </button>
      )}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <span className="text-empire-parchment/50">Factories in city</span>
        <span className="text-empire-parchment font-medium">{factoryCount}</span>

        <span className="text-empire-parchment/50">Arms / factory / cycle</span>
        <span className="text-orange-300 font-medium">+{armsPerFactory}</span>

        <span className="text-empire-parchment/50">City morale modifier</span>
        <span className="text-empire-parchment font-medium">{Math.round(moraleMod * 100)}%</span>
      </div>

      <div className="border-t border-empire-stone/20 pt-2 space-y-1">
        <div className="flex justify-between text-xs">
          <span className="text-empire-parchment/60">Total Arms production</span>
          <span className="text-orange-300 font-bold">+{totalArms} / cycle</span>
        </div>
        {l2FactoryCount > 0 && (
          <div className="flex justify-between text-xs">
            <span className="text-empire-parchment/60">L2 Arms (1 iron &rarr; 10)</span>
            <span className="text-cyan-300 font-bold">+{l2FactoryCount * 10} / cycle (uses iron)</span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-empire-stone/20 pt-2">
        <span className="text-empire-parchment/60 text-xs">Workers</span>
        <div className="flex items-center gap-1">
          <button onClick={() => adjustWorkers(city.id, factoryQ, factoryR, -1)} disabled={(factory?.assignedWorkers ?? 0) <= 0}
            className="w-6 h-6 rounded bg-empire-stone/20 border border-empire-stone/40 text-empire-parchment hover:bg-empire-stone/30 disabled:opacity-40 disabled:cursor-not-allowed text-xs">−</button>
          <span className="text-empire-parchment font-medium text-xs min-w-[3ch] text-center">{(factory?.assignedWorkers ?? 0)} / {BUILDING_JOBS.factory}</span>
          <button onClick={() => adjustWorkers(city.id, factoryQ, factoryR, 1)} disabled={(factory?.assignedWorkers ?? 0) >= BUILDING_JOBS.factory || (city.population - city.buildings.reduce((s, b) => s + ((b as import('@/types/game').CityBuilding).assignedWorkers ?? 0), 0)) <= 0}
            className="w-6 h-6 rounded bg-empire-stone/20 border border-empire-stone/40 text-empire-parchment hover:bg-empire-stone/30 disabled:opacity-40 disabled:cursor-not-allowed text-xs">+</button>
        </div>
      </div>

      <div className="bg-empire-stone/10 border border-empire-stone/20 rounded px-2 py-1.5">
        <p className="text-empire-parchment/40 text-[10px]">
          City storage: {city.storage.guns} / {city.storageCap.guns} arms
          {l2FactoryCount > 0 && ` &bull; ${city.storage.gunsL2 ?? 0} / ${city.storageCap.gunsL2 ?? 100} L2 arms &bull; ${city.storage.iron ?? 0} iron`}
        </p>
      </div>
    </div>
  );
}

// ─── Job Building Panel (farm, market worker assignment) ───

function JobBuildingPanel({ city, building }: { city: import('@/types/game').City; building: import('@/types/game').CityBuilding }) {
  const adjustWorkers = useGameStore(s => s.adjustWorkers);
  const upgradeFarm = useGameStore(s => s.upgradeFarm);
  const upgradeSocialBar = useGameStore(s => s.upgradeSocialBar);
  const gold = useGameStore(s => s.players.find(p => p.isHuman)?.gold ?? 0);
  const cities = useGameStore(s => s.cities);
  const tiles = useGameStore(s => s.tiles);
  const territory = useGameStore(s => s.territory);
  const units = useGameStore(s => s.units);
  const maxW = getBuildingJobs(building);
  const assigned = building.assignedWorkers ?? 0;
  const lvl = building.level ?? 1;
  const marketGoldPreview = useMemo(() => {
    if (building.type !== 'market') return null;
    const villageCount = countVillagesInPlayerTerritory(city.ownerId, cities, territory, tiles);
    const jobs = BUILDING_JOBS.market;
    const staffRatio = jobs > 0 ? Math.min(1, assigned / jobs) : 0;
    const moraleMod = city.morale / 100;
    const goldPerCycle = Math.floor(MARKET_GOLD_PER_VILLAGE * villageCount * moraleMod * staffRatio);
    return { villageCount, goldPerCycle };
  }, [building.type, assigned, city.ownerId, city.morale, cities, tiles, territory]);
  const isFarm = building.type === 'farm' || building.type === 'banana_farm';
  const farmFoodPerCycle = isFarm
    ? (lvl >= 2 ? FARM_L2_FOOD_PER_CYCLE : (BUILDING_PRODUCTION[building.type].food ?? 0) * lvl)
    : 0;
  const label = building.type.charAt(0).toUpperCase() + building.type.slice(1).replace(/_/g, ' ');
  const titleLabel =
    building.type === 'banana_farm'
      ? `Banana farm L${lvl}`
      : isFarm
        ? `Farm L${lvl}`
        : building.type === 'social_bar'
          ? `Social hall L${lvl}`
          : label;

  return (
    <div className="space-y-2">
      <h3 className="text-empire-gold/90 text-xs font-semibold uppercase tracking-wide">{titleLabel} — {city.name}</h3>
      {isFarm && (
        <div className="flex justify-between text-xs">
          <span className="text-empire-parchment/50">Production</span>
          <span className="text-cyan-300">+{farmFoodPerCycle} grain/cycle</span>
        </div>
      )}
      {building.type === 'market' && marketGoldPreview && (
        <div className="space-y-1">
          <div
            className="flex justify-between text-xs gap-2"
            title={`${MARKET_GOLD_PER_VILLAGE} gold per incorporated village × ${marketGoldPreview.villageCount} empire villages × staffing × city morale. Same formula as economy tick.`}
          >
            <span className="text-empire-parchment/50">Production</span>
            <span className="text-amber-300 font-medium">+{marketGoldPreview.goldPerCycle} gold/cycle</span>
          </div>
          <p className="text-[10px] text-empire-parchment/55 leading-snug">
            {MARKET_GOLD_PER_VILLAGE}g per incorporated village in your empire ({marketGoldPreview.villageCount} villages). Scales with workers and morale ({Math.round(city.morale)}%).
          </p>
        </div>
      )}
      {building.type === 'fishery' && (
        <div className="flex justify-between text-xs">
          <span className="text-empire-parchment/50">Production</span>
          <span className="text-cyan-300">+{BUILDING_PRODUCTION.fishery.food} grain/cycle (when staffed)</span>
        </div>
      )}
      {building.type === 'logging_hut' && (
        <div className="flex justify-between text-xs">
          <span className="text-empire-parchment/50">Production</span>
          <span className="text-amber-200/90">+{BUILDING_PRODUCTION.logging_hut.wood} wood/cycle (when staffed)</span>
        </div>
      )}
      {building.type === 'sawmill' && (() => {
        const preview = computeSawmillBuildingPreview(city, building);
        if (!preview) return null;
        const { refinedPerCycle, rawWoodConsumedPerCycle, staffCappedRefined, cityRawWood } = preview;
        const lvl = building.level ?? 1;
        const maxRefinedIfStocked = (BUILDING_PRODUCTION.sawmill.refinedWood ?? 0) * lvl;
        const limitedByWood = assigned > 0 && staffCappedRefined > 0
          && Math.floor(cityRawWood / SAWMILL_WOOD_PER_REFINED) < staffCappedRefined;
        return (
          <div className="space-y-1.5">
            <div
              className="flex justify-between text-xs gap-2"
              title={`Includes city morale (${city.morale}%). Wood cost is not reduced by morale.`}
            >
              <span className="text-empire-parchment/50">Production</span>
              <span className="text-teal-300 font-medium text-right">+{refinedPerCycle} refined wood/cycle</span>
            </div>
            <div className="flex justify-between text-xs gap-2">
              <span className="text-empire-parchment/50">Input</span>
              <span className="text-amber-200/90 font-medium text-right">
                −{rawWoodConsumedPerCycle} raw wood/cycle
                <span className="text-empire-parchment/45 font-normal"> (city storage)</span>
              </span>
            </div>
            <p className="text-[10px] text-empire-parchment/55 leading-snug">
              Requires <span className="text-amber-200/80">{SAWMILL_WOOD_PER_REFINED} raw wood</span> per refined wood produced.
              At full staff: up to +{maxRefinedIfStocked}/cycle if storage has enough raw wood.
              {' '}Stockpile now: <span className="text-emerald-300/90">{cityRawWood}</span> raw wood.
              {limitedByWood && (
                <span className="text-amber-400/80"> Output limited by raw wood.</span>
              )}
            </p>
          </div>
        );
      })()}
      {building.type === 'port' && (
        <div className="text-[10px] text-empire-parchment/55">
          Coastal access for ships — embark, naval routes, and sea trade (economy is pooled empire-wide).
        </div>
      )}
      {building.type === 'social_bar' && (
        <div className="space-y-1">
          <p className="text-[10px] text-empire-parchment/60 leading-snug">
            Boosts natural population growth: each birth tick is multiplied by{' '}
            <span className="text-violet-200/90 font-medium">
              1 + L × {Math.round(SOCIAL_BAR_BIRTH_MULT_PER_LEVEL * 100)}%
            </span>{' '}
            (max L3). One hall per settlement.
          </p>
          {lvl < 3 && (
            <button
              type="button"
              onClick={() => upgradeSocialBar(city.id, building.q, building.r)}
              disabled={gold < (SOCIAL_BAR_UPGRADE_COSTS[lvl - 1] ?? Infinity)}
              className="w-full px-2 py-1.5 text-xs rounded border border-violet-600/45 bg-violet-950/25 text-violet-200 hover:bg-violet-950/35 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Upgrade Social hall (L{lvl}→L{lvl + 1}) — {SOCIAL_BAR_UPGRADE_COSTS[lvl - 1] ?? '—'}g
            </button>
          )}
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-empire-parchment/60 text-xs">Workers</span>
        <div className="flex items-center gap-1">
          <button onClick={() => adjustWorkers(city.id, building.q, building.r, -1)} disabled={assigned <= 0}
            className="w-6 h-6 rounded bg-empire-stone/20 border border-empire-stone/40 text-empire-parchment hover:bg-empire-stone/30 disabled:opacity-40 disabled:cursor-not-allowed text-xs">−</button>
          <span className="text-empire-parchment font-medium text-xs min-w-[3ch] text-center">{assigned} / {maxW}</span>
          <button onClick={() => adjustWorkers(city.id, building.q, building.r, 1)} disabled={assigned >= maxW || (city.population - city.buildings.reduce((s, b) => s + ((b as import('@/types/game').CityBuilding).assignedWorkers ?? 0), 0)) <= 0}
            className="w-6 h-6 rounded bg-empire-stone/20 border border-empire-stone/40 text-empire-parchment hover:bg-empire-stone/30 disabled:opacity-40 disabled:cursor-not-allowed text-xs">+</button>
        </div>
      </div>
      {isFarm && lvl < 2 && (
        <button
          onClick={() => upgradeFarm(city.id, building.q, building.r)}
          disabled={gold < FARM_UPGRADE_COST}
          className="w-full px-2 py-1.5 text-xs rounded border border-amber-600/40 bg-amber-900/20 text-amber-300 hover:bg-amber-900/30 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {building.type === 'banana_farm' ? 'Upgrade banana farm (L2)' : 'Upgrade Farm (L2)'} — {FARM_UPGRADE_COST}g
        </button>
      )}
      {assigned > 0 && (
        <button onClick={() => adjustWorkers(city.id, building.q, building.r, -assigned)}
          className="w-full px-2 py-1 text-[10px] bg-empire-stone/20 border border-empire-stone/30 rounded text-empire-parchment/70 hover:bg-empire-stone/30">
          Recall all workers
        </button>
      )}
    </div>
  );
}

// ─── Quarry / Mine Worker Panel ────────────────────────────────────

function QuarryMinePanel({ city, building }: { city: import('@/types/game').City; building: import('@/types/game').CityBuilding }) {
  const adjustWorkers = useGameStore(s => s.adjustWorkers);
  const upgradeResourceMine = useGameStore(s => s.upgradeResourceMine);
  const gold = useGameStore(s => s.players.find(p => p.isHuman)?.gold ?? 0);
  const maxW = getBuildingJobs(building);
  const assigned = building.assignedWorkers ?? 0;
  const staffRatio = maxW > 0 ? assigned / maxW : 0;
  /** Matches productionPhase / computeCityProductionRate for quarry & mine. */
  const activeMult =
    building.type === 'quarry' || building.type === 'mine' || building.type === 'logging_hut'
      ? staffRatio > MIN_STAFFING_RATIO
        ? staffRatio
        : 0
      : staffRatio;
  const lvl = building.level ?? 1;
  const prod = building.type === 'quarry'
    ? (BUILDING_PRODUCTION.quarry.stone ?? 0) * lvl
    : building.type === 'gold_mine'
      ? (BUILDING_PRODUCTION.gold_mine.gold ?? 0) * lvl
      : (BUILDING_PRODUCTION.mine.iron ?? 0) * lvl;
  const rawPerCycle =
    building.type === 'quarry' || building.type === 'mine'
      ? prod * activeMult
      : building.type === 'gold_mine'
        ? prod * (staffRatio > MIN_STAFFING_RATIO ? staffRatio : 0)
        : 0;
  const moraleMod = city.morale / 100;
  const effectiveProd = Math.floor(rawPerCycle * moraleMod);
  const staffColor = staffRatio > 0.8 ? 'text-green-400' : staffRatio > MIN_STAFFING_RATIO ? 'text-yellow-400' : 'text-red-400';
  const mineOrQuarry = building.type === 'quarry' || building.type === 'mine';
  const zeroFromMorale = mineOrQuarry && assigned > 0 && staffRatio > MIN_STAFFING_RATIO && rawPerCycle > 0 && effectiveProd === 0;
  const label = building.type === 'quarry' ? 'Quarry' : building.type === 'gold_mine' ? 'Gold mine' : 'Mine';

  return (
    <div className="space-y-2">
      <h3 className="text-stone-400 text-xs font-semibold uppercase tracking-wide">{label} L{lvl} — {city.name}</h3>
      <div className="flex items-center justify-between gap-2">
        <span className="text-empire-parchment/60 text-xs">Workers</span>
        <div className="flex items-center gap-1">
          <button onClick={() => adjustWorkers(city.id, building.q, building.r, -1)} disabled={assigned <= 0}
            className="w-6 h-6 rounded bg-empire-stone/20 border border-empire-stone/40 text-empire-parchment hover:bg-empire-stone/30 disabled:opacity-40 disabled:cursor-not-allowed text-xs">−</button>
          <span className="text-empire-parchment font-medium text-xs min-w-[3ch] text-center">{assigned} / {maxW}</span>
          <button onClick={() => adjustWorkers(city.id, building.q, building.r, 1)} disabled={assigned >= maxW || (city.population - city.buildings.reduce((s, b) => s + ((b as import('@/types/game').CityBuilding).assignedWorkers ?? 0), 0)) <= 0}
            className="w-6 h-6 rounded bg-empire-stone/20 border border-empire-stone/40 text-empire-parchment hover:bg-empire-stone/30 disabled:opacity-40 disabled:cursor-not-allowed text-xs">+</button>
        </div>
      </div>
      <div className="flex justify-between text-xs">
        <span className="text-empire-parchment/50">Staffing</span>
        <span className={staffColor}>{Math.round(staffRatio * 100)}%</span>
      </div>
      <div className="flex justify-between text-xs">
        <span className="text-empire-parchment/50">Production</span>
        <span className="text-cyan-300">+{effectiveProd} {building.type === 'quarry' ? 'stone' : building.type === 'gold_mine' ? 'gold' : 'iron'}/cycle</span>
      </div>
      {mineOrQuarry && (
        <p className="text-[10px] text-empire-parchment/45 leading-snug">
          Shown rate includes city morale ({Math.round(city.morale)}%). Same formula as economy tick.
        </p>
      )}
      {zeroFromMorale && (
        <p className="text-[10px] text-amber-400/90 leading-snug">
          Morale is low enough that iron/stone rounds down to 0 per cycle. Raise morale (food, tax, employment) to restore output.
        </p>
      )}
      {lvl < 2 && (
        <button
          type="button"
          onClick={() => upgradeResourceMine(city.id, building.q, building.r)}
          disabled={gold < RESOURCE_MINE_UPGRADE_COST}
          className="w-full px-2 py-1.5 text-xs rounded border border-cyan-700/45 bg-cyan-950/25 text-cyan-200 hover:bg-cyan-950/35 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Upgrade {label} (L2) — {RESOURCE_MINE_UPGRADE_COST}g — doubles base yield per cycle
        </button>
      )}
      {assigned > 0 && (
        <button onClick={() => adjustWorkers(city.id, building.q, building.r, -assigned)}
          className="w-full px-2 py-1 text-[10px] bg-empire-stone/20 border border-empire-stone/30 rounded text-empire-parchment/70 hover:bg-empire-stone/30">
          Recall all workers
        </button>
      )}
    </div>
  );
}

// ─── Enemy Unit Panel ──────────────────────────────────────────────

function EnemyUnitPanel({
  enemies, canSeeInfo, scoutMission, onSendScout, gold,
}: {
  enemies: import('@/types/game').Unit[];
  canSeeInfo: boolean;
  scoutMission: import('@/types/game').ScoutMission | null;
  onSendScout: () => void;
  gold: number;
}) {
  const [now, setNow] = useState(Date.now());
  const isScouting = !!scoutMission;

  useEffect(() => {
    if (!isScouting) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isScouting]);

  const counts: Record<string, number> = {};
  let totalHp = 0, totalMaxHp = 0;
  for (const u of enemies) {
    counts[u.type] = (counts[u.type] || 0) + 1;
    totalHp += u.hp;
    totalMaxHp += u.maxHp;
  }
  const hpPct = totalMaxHp > 0 ? (totalHp / totalMaxHp) * 100 : 0;
  const canAffordScout = gold >= SCOUT_MISSION_COST;

  return (
    <div className="space-y-2 p-2 bg-red-950/20 border border-red-500/30 rounded">
      <div className="flex items-center gap-2">
        <span className="text-red-400 text-sm">&#9876;</span>
        <span className="text-red-400 text-xs font-bold">ENEMY FORCES ({enemies.length})</span>
      </div>

      {canSeeInfo ? (
        <>
          {/* Full intel — in vision range or scouted */}
          <div className="flex gap-1.5 text-[10px] flex-wrap">
            {Object.entries(counts).map(([type, count]) => (
              <span key={type} className="text-empire-parchment/70 capitalize">{count} {type}</span>
            ))}
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-empire-parchment/50">HP</span>
            <div className="flex-1 h-1.5 bg-empire-stone/30 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${hpPct > 50 ? 'bg-green-500' : hpPct > 25 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${hpPct}%` }} />
            </div>
            <span className="text-empire-parchment text-[10px]">{totalHp}/{totalMaxHp}</span>
          </div>

          <div className="space-y-0.5 max-h-24 overflow-y-auto">
            {enemies.map(u => (
              <div key={u.id} className="flex items-center justify-between text-[10px]">
                <span className="text-empire-parchment capitalize">
                  {u.type} {u.level > 0 && <span className="text-yellow-400">Lv{u.level}</span>}
                </span>
                <div className="flex gap-2">
                  <span className={u.hp < u.maxHp * 0.3 ? 'text-red-400' : 'text-red-300'}>HP {u.hp}/{u.maxHp}</span>
                  <span className="text-empire-parchment/40 capitalize">{u.stance}</span>
                </div>
              </div>
            ))}
          </div>

          <p className="text-green-400/50 text-[10px]">Intel available — in vision range or scouted</p>
        </>
      ) : (
        <>
          {/* No intel — hidden */}
          <div className="text-center py-2">
            <p className="text-empire-parchment/40 text-xs mb-1">&#10067; Unknown forces</p>
            <p className="text-empire-parchment/30 text-[10px]">
              {enemies.length} unit{enemies.length !== 1 ? 's' : ''} detected but details are hidden.
            </p>
            <p className="text-empire-parchment/30 text-[10px]">
              Move troops nearby or send a scout for intel.
            </p>
          </div>

          {isScouting ? (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-cyan-400 font-semibold">Scout en route...</span>
                <span className="text-cyan-300 font-mono text-[10px]">
                  {Math.max(0, Math.ceil((scoutMission!.completesAt - now) / 1000))}s
                </span>
              </div>
              <div className="w-full h-1.5 bg-empire-stone/30 rounded-full overflow-hidden">
                <div
                  className="h-full bg-cyan-500/70 rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, Math.max(0, (1 - (scoutMission!.completesAt - now) / 30000) * 100))}%`,
                  }}
                />
              </div>
            </div>
          ) : (
            <button
              onClick={onSendScout}
              disabled={!canAffordScout}
              className={`w-full px-3 py-2 text-xs font-semibold rounded border transition-colors ${
                canAffordScout
                  ? 'bg-cyan-900/30 border-cyan-500/50 text-cyan-300 hover:bg-cyan-900/50'
                  : 'bg-empire-stone/10 border-empire-stone/20 text-empire-parchment/30 cursor-not-allowed'
              }`}
            >
              Send Scout — {SCOUT_MISSION_COST} Gold (30s)
            </button>
          )}
          {!canAffordScout && !isScouting && (
            <p className="text-red-400/60 text-[10px]">Not enough gold ({gold}/{SCOUT_MISSION_COST})</p>
          )}
        </>
      )}
    </div>
  );
}

// ─── Battle Panel (Both Sides) ─────────────────────────────────────

function BattleSide({ label, units, color }: { label: string; units: import('@/types/game').Unit[]; color: string }) {
  const counts: Record<string, number> = {};
  let totalHp = 0, totalMaxHp = 0;
  for (const u of units) {
    counts[u.type] = (counts[u.type] || 0) + 1;
    totalHp += u.hp;
    totalMaxHp += u.maxHp;
  }
  const hpPct = totalMaxHp > 0 ? (totalHp / totalMaxHp) * 100 : 0;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className={`text-xs font-bold ${color}`}>{label} ({units.length})</span>
        <span className="text-[10px] text-empire-parchment/50">{totalHp}/{totalMaxHp} HP</span>
      </div>
      <div className="flex gap-1.5 text-[10px] flex-wrap">
        {Object.entries(counts).map(([type, count]) => (
          <span key={type} className="text-empire-parchment/70 capitalize">{count} {type}</span>
        ))}
      </div>
      <div className="w-full h-1.5 bg-empire-stone/30 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${hpPct > 50 ? 'bg-green-500' : hpPct > 25 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${hpPct}%` }} />
      </div>
      <div className="space-y-0.5 max-h-20 overflow-y-auto">
        {units.map(u => (
          <div key={u.id} className="flex items-center justify-between text-[10px]">
            <span className="text-empire-parchment capitalize">
              {u.type} {u.level > 0 && <span className="text-yellow-400">Lv{u.level}</span>}
            </span>
            <span className={u.hp < u.maxHp * 0.3 ? 'text-red-400' : 'text-red-300'}>
              {u.hp}/{u.maxHp}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BattlePanel({ friendly, enemy }: { friendly: import('@/types/game').Unit[]; enemy: import('@/types/game').Unit[] }) {
  const killFeed = useGameStore(s => s.combatKillFeed);
  const moraleState = useGameStore(s => s.combatMoraleState);
  const selectedHex = useGameStore(s => s.selectedHex);

  const hexKey = selectedHex ? tileKey(selectedHex.q, selectedHex.r) : '';
  const friendlyOwner = friendly[0]?.ownerId;
  const enemyOwner = enemy[0]?.ownerId;

  const friendlyMorale = friendlyOwner ? (moraleState.get(`${hexKey}:${friendlyOwner}`)?.morale ?? 100) : 100;
  const enemyMorale = enemyOwner ? (moraleState.get(`${hexKey}:${enemyOwner}`)?.morale ?? 100) : 100;

  const recentKills = killFeed.filter(k => k.hexKey === hexKey).slice(-5);

  return (
    <div className="space-y-2 p-2 bg-red-950/30 border border-red-500/30 rounded">
      <div className="text-center text-red-400 text-xs font-bold tracking-wider">{'\u2694'} ACTIVE COMBAT {'\u2694'}</div>

      <div className="flex justify-between text-[10px]">
        <span className="text-blue-400">Morale: {Math.round(friendlyMorale)}</span>
        <span className="text-red-400">Morale: {Math.round(enemyMorale)}</span>
      </div>
      <div className="flex gap-1 h-1.5">
        <div className="flex-1 bg-empire-stone/20 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all ${friendlyMorale > 30 ? 'bg-blue-500' : friendlyMorale > 15 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${friendlyMorale}%` }} />
        </div>
        <div className="flex-1 bg-empire-stone/20 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all ${enemyMorale > 30 ? 'bg-red-500' : enemyMorale > 15 ? 'bg-amber-500' : 'bg-red-700'}`} style={{ width: `${enemyMorale}%` }} />
        </div>
      </div>

      <BattleSide label="YOUR FORCES" units={friendly} color="text-blue-400" />
      <div className="border-t border-red-500/20 my-1" />
      <BattleSide label="ENEMY FORCES" units={enemy} color="text-red-400" />

      {recentKills.length > 0 && (
        <div className="border-t border-red-500/15 pt-1">
          <p className="text-[9px] text-empire-parchment/40 mb-0.5">Kill feed</p>
          {recentKills.map((k, i) => (
            <div key={i} className="text-[9px] text-empire-parchment/60">
              <span className={k.killerOwner.includes('human') ? 'text-blue-400' : 'text-red-400'}>
                {UNIT_DISPLAY_NAMES[k.killerType as UnitType] ?? k.killerType}
              </span>
              {' killed '}
              <span className={k.victimOwner.includes('human') ? 'text-blue-400' : 'text-red-400'}>
                {UNIT_DISPLAY_NAMES[k.victimType as UnitType] ?? k.victimType}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Army Panel (Stack Composition) ────────────────────────────────

function ArmyPanel({ units }: { units: import('@/types/game').Unit[] }) {
  const [showUnitList, setShowUnitList] = useState(false);
  const startSplitStackByUnitType = useGameStore(s => s.startSplitStackByUnitType);
  const cancelSplitStack = useGameStore(s => s.cancelSplitStack);
  const boardAdjacentShip = useGameStore(s => s.boardAdjacentShip);
  const disembarkShip = useGameStore(s => s.disembarkShip);
  const activateAbility = useGameStore(s => s.activateAbility);
  const cities = useGameStore(s => s.cities);
  const selectedHex = useGameStore(s => s.selectedHex);
  const splitStackPending = useGameStore(s => s.splitStackPending);

  const counts: Record<UnitType, number> = {
    infantry: 0, cavalry: 0, ranged: 0, horse_archer: 0, crusader_knight: 0, builder: 0, trebuchet: 0, battering_ram: 0, defender: 0,
    scout_ship: 0, warship: 0, transport_ship: 0, fisher_transport: 0, capital_ship: 0,
  };
  let totalHp = 0, totalMaxHp = 0;
  let defendingCity: string | null = null;
  let retreating = false;
  let assaulting = false;
  let siegingCity: string | null = null;
  for (const u of units) {
    counts[u.type] = (counts[u.type] ?? 0) + 1;
    totalHp += u.hp;
    totalMaxHp += u.maxHp;
    if (u.defendCityId) defendingCity = u.defendCityId;
    if (u.retreatAt) retreating = true;
    if (u.assaulting) assaulting = true;
    if (u.siegingCityId) siegingCity = u.siegingCityId;
  }
  const defendCityName = defendingCity ? cities.find(c => c.id === defendingCity)?.name : null;
  const siegeCityName = siegingCity ? cities.find(c => c.id === siegingCity)?.name : null;

  const hasLandCombat =
    counts.infantry > 0 || counts.cavalry > 0 || counts.ranged > 0 || counts.trebuchet > 0 || counts.battering_ram > 0 || counts.defender > 0;
  const shipCount = counts.scout_ship + counts.warship + counts.transport_ship + counts.capital_ship;
  const soleShip = units.length === 1 && isNavalUnitType(units[0].type) ? units[0] : null;
  const canBoard = soleShip && getShipMaxCargo(soleShip.type) > 0;
  const canDisembark = soleShip && (soleShip.cargoUnitIds?.length ?? 0) > 0;

  const anchor = units[0];
  const isThisStackSplitting =
    !!anchor &&
    !!splitStackPending &&
    splitStackPending.fromQ === anchor.q &&
    splitStackPending.fromR === anchor.r;
  const canSplit = units.length > 1;

  const armyPanelTitle = `${hasLandCombat ? 'Army' : shipCount > 0 && !hasLandCombat ? 'Fleet' : 'Units'} (${units.length})`;

  return (
    <MapRoomPanel title={armyPanelTitle} innerClassName="space-y-2">
      {/* One-line summary: composition + HP */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <div className="flex gap-1.5 text-[10px] text-empire-parchment/90 flex-wrap">
          {(Object.entries(counts) as [UnitType, number][]).map(([t, n]) =>
            n > 0 ? (
              <button
                key={t}
                type="button"
                disabled={!canSplit || !selectedHex}
                title="Split: move this unit type to an adjacent hex"
                onClick={() => selectedHex && startSplitStackByUnitType(t, selectedHex.q, selectedHex.r)}
                className="px-1.5 py-0.5 rounded border border-empire-stone/35 bg-black/20 hover:border-teal-500/45 hover:bg-teal-950/25 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {n}× {UNIT_DISPLAY_NAMES[t]}
              </button>
            ) : null,
          )}
        </div>
        <span className="text-empire-parchment/60 text-[10px] ml-auto">HP {totalHp}/{totalMaxHp}</span>
      </div>
      <div className="h-1.5 bg-empire-stone/30 rounded-full overflow-hidden">
        <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${totalMaxHp ? (totalHp / totalMaxHp) * 100 : 0}%` }} />
      </div>

      {/* Siege status — compact */}
      {(defendCityName || retreating || assaulting || siegeCityName) && (
        <div className="text-[10px] space-y-0.5 px-2 py-1 bg-empire-stone/20 rounded border border-empire-stone/30">
          {defendCityName && <div className="text-blue-400">Defending {defendCityName}</div>}
          {retreating && <div className="text-amber-400">Retreating</div>}
          {siegeCityName && <div className="text-amber-300">Besieging {siegeCityName}</div>}
          {assaulting && <div className="text-red-400">Assaulting city center</div>}
        </div>
      )}

      {(() => {
        const abilityTypes = new Set<UnitType>();
        for (const u of units) {
          if (getAbilityForUnit(u.type)) abilityTypes.add(u.type);
        }
        if (abilityTypes.size === 0) return null;
        const now = Date.now();
        return (
          <div className="border-t border-empire-stone/20 pt-1.5 space-y-1">
            <p className="text-[9px] text-empire-parchment/40 mb-0.5">Abilities</p>
            <div className="flex flex-wrap gap-1">
              {[...abilityTypes].map(ut => {
                const abilityId = getAbilityForUnit(ut)!;
                const def = ABILITY_DEFS[abilityId];
                const sampleUnit = units.find(u => u.type === ut);
                const isActive = sampleUnit?.abilityActive ?? false;
                const onCd = sampleUnit?.abilityCooldownUntil ? now < sampleUnit.abilityCooldownUntil : false;
                return (
                  <button
                    key={ut}
                    type="button"
                    onClick={() => activateAbility(ut)}
                    disabled={onCd && !def.toggle}
                    title={def.desc}
                    className={`px-1.5 py-0.5 text-[10px] rounded border transition-colors ${
                      isActive
                        ? 'border-cyan-500/60 bg-cyan-900/30 text-cyan-300'
                        : onCd
                          ? 'border-empire-stone/20 text-empire-parchment/25 cursor-not-allowed'
                          : 'border-purple-500/40 bg-purple-900/20 text-purple-300 hover:bg-purple-800/30'
                    }`}
                  >
                    {def.label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })()}

      {(canBoard || canDisembark) && soleShip && (
        <div className="flex flex-wrap gap-1 border-t border-empire-stone/25 pt-1.5">
          {canBoard && (
            <button
              type="button"
              onClick={() => boardAdjacentShip(soleShip.id)}
              className="px-1.5 py-0.5 text-[10px] rounded border border-sky-500/40 bg-sky-950/30 text-sky-200 hover:bg-sky-900/40"
            >
              Board adjacent troops
            </button>
          )}
          {canDisembark && (
            <button
              type="button"
              onClick={() => disembarkShip(soleShip.id)}
              className="px-1.5 py-0.5 text-[10px] rounded border border-emerald-500/40 bg-emerald-950/30 text-emerald-200 hover:bg-emerald-900/40"
            >
              Disembark ({soleShip.cargoUnitIds!.length})
            </button>
          )}
        </div>
      )}

      {canSplit && isThisStackSplitting && (
        <div className="rounded border border-empire-stone/30 bg-empire-stone/10 px-2 py-1.5 flex items-center justify-between gap-2">
          <p className="text-cyan-400/90 text-[10px]">Move {splitStackPending!.count} unit(s) → adjacent land or water (fleets)</p>
          <button
            type="button"
            onClick={cancelSplitStack}
            className="px-2 py-0.5 text-[10px] rounded border border-empire-stone/40 text-empire-parchment/80 hover:bg-empire-stone/20 shrink-0"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Collapsible unit list */}
      <div>
        <button type="button" onClick={() => setShowUnitList(v => !v)}
          className="flex items-center gap-1 text-empire-parchment/60 text-[10px] hover:text-empire-parchment">
          <span className="transition-transform">{showUnitList ? '▼' : '▶'}</span>
          Unit list ({units.length})
        </button>
        {showUnitList && (
          <div className="space-y-0.5 max-h-28 overflow-y-auto mt-1">
            {units.map(u => (
              <div key={u.id} className="flex items-center justify-between text-[10px]">
                <span className="text-empire-parchment capitalize">{u.type}{u.level > 0 ? ` Lv${u.level}` : ''}</span>
                <div className="flex gap-2">
                  <span className={u.hp < u.maxHp * 0.3 ? 'text-red-400' : 'text-red-300'}>HP {u.hp}/{u.maxHp}</span>
                  <span className="text-purple-300">XP {u.xp}</span>
                  <span className="text-gray-400">{u.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-maproom-sea/85 text-[10px]">Click a hex to move army there</p>
    </MapRoomPanel>
  );
}

// ─── Enemy City Actions ────────────────────────────────────────────

function EnemyCityActions({ city }: { city: import('@/types/game').City }) {
  const burnCity = useGameStore(s => s.burnCity);
  const captureCity = useGameStore(s => s.captureCity);

  return (
    <div className="space-y-1">
      <h3 className="text-red-400 text-xs font-semibold">ENEMY CITY: {city.name}</h3>
      <p className="text-empire-parchment/50 text-[10px]">Pop: {city.population}</p>
      <div className="flex gap-1">
        <button onClick={() => captureCity(city.id)}
          className="flex-1 px-2 py-1.5 text-xs bg-green-900/30 border border-green-500/30 rounded text-green-300 hover:bg-green-900/50 transition-colors">
          Capture
        </button>
        <button onClick={() => burnCity(city.id)}
          className="flex-1 px-2 py-1.5 text-xs bg-red-900/30 border border-red-500/30 rounded text-red-300 hover:bg-red-900/50 transition-colors">
          Burn (&#189; pop)
        </button>
      </div>
    </div>
  );
}

// ─── Construction Progress ─────────────────────────────────────────

function ConstructionProgress({ site, availBP }: { site: import('@/types/game').ConstructionSite; availBP: number }) {
  const pct = Math.min(100, Math.round((site.bpAccumulated / site.bpRequired) * 100));
  const bpPerSec = availBP / BP_RATE_BASE;
  const remainingBP = site.bpRequired - site.bpAccumulated;
  const etaSec = bpPerSec > 0 ? Math.ceil(remainingBP / bpPerSec) : Infinity;
  const typeName =
    site.type === 'city_defense' && site.defenseTowerType && site.defenseTowerTargetLevel
      ? `${DEFENSE_TOWER_DISPLAY_NAME[site.defenseTowerType]} L${site.defenseTowerTargetLevel}`
      : site.type === 'wall_section'
        ? `Wall section${site.wallBuildRing ? ` (ring ${site.wallBuildRing})` : ''}`
      : site.type.charAt(0).toUpperCase() + site.type.slice(1);

  return (
    <BuilderCottagePanel innerClassName="space-y-1.5">
      <div className="flex justify-between items-start gap-2">
        <div className="min-w-0">
          <div className="cottage-title text-[10px] font-bold uppercase tracking-wide">Building</div>
          <div className="text-[11px] text-empire-parchment/85 mt-0.5 truncate">{typeName}</div>
        </div>
        <span className="text-cottage-brass/95 text-xs font-semibold shrink-0">{pct}%</span>
      </div>
      <div className="w-full h-1.5 bg-cottage-wood/80 rounded-full overflow-hidden">
        <div className="h-full bg-cottage-brass/90 rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex justify-between text-[10px] text-empire-parchment/55">
        <span>
          BP: {Math.round(site.bpAccumulated)}/{site.bpRequired} ({availBP} avail)
        </span>
        <span>{etaSec < Infinity ? `~${etaSec}s left` : 'Stalled — no BP'}</span>
      </div>
    </BuilderCottagePanel>
  );
}

// ─── Builder Build Menu (field deposits — no roads/scout/logging here) ──

function BuilderBuildMenu({
  uiMode,
  startBuilderBuild,
  cancelBuilderBuild,
  hasBuildingOnHex,
  hasCityAtHex,
  tileHasMineDeposit,
  tileHasQuarryDeposit,
  tileHasGoldMineDeposit,
}: {
  uiMode: string;
  startBuilderBuild: (mode: 'mine' | 'quarry' | 'gold_mine') => void;
  cancelBuilderBuild: () => void;
  hasBuildingOnHex: boolean;
  hasCityAtHex: boolean;
  tileHasMineDeposit?: boolean;
  tileHasQuarryDeposit?: boolean;
  tileHasGoldMineDeposit?: boolean;
}) {
  if (uiMode === 'normal' || uiMode === 'move') {
    return (
      <BuilderCottagePanel title="Builder's cottage" innerClassName="space-y-2">
        <p className="text-empire-parchment/55 text-[10px]">Build here or select type — deposits will highlight on map</p>
        <div className="flex flex-col gap-1.5">
          {!hasBuildingOnHex && !hasCityAtHex && (tileHasMineDeposit || tileHasQuarryDeposit || tileHasGoldMineDeposit) && (
            <>
              <p className="text-cottage-brass/90 text-[10px] font-semibold uppercase tracking-wide pt-0.5">Resource sites</p>
              {tileHasMineDeposit && (
                <button
                  onClick={() => startBuilderBuild('mine')}
                  className="w-full text-left px-3 py-2 rounded border border-cottage-brass/45 bg-cottage-wood/40 text-cottage-glow hover:bg-cottage-plank/60 text-xs"
                >
                  <span className="font-medium">Mine</span>
                  <span className="text-empire-parchment/60 ml-1">— +{BUILDING_PRODUCTION.mine.iron} iron/cycle on deposit</span>
                </button>
              )}
              {tileHasQuarryDeposit && (
                <button
                  onClick={() => startBuilderBuild('quarry')}
                  className="w-full text-left px-3 py-2 rounded border border-empire-stone/45 bg-cottage-wood/35 text-empire-parchment/85 hover:bg-cottage-plank/50 text-xs"
                >
                  <span className="font-medium">Quarry</span>
                  <span className="text-empire-parchment/55 ml-1">— +3 stone/cycle on deposit</span>
                </button>
              )}
              {tileHasGoldMineDeposit && (
                <button
                  onClick={() => startBuilderBuild('gold_mine')}
                  className="w-full text-left px-3 py-2 rounded border border-empire-gold/45 bg-cottage-wood/40 text-empire-gold/90 hover:bg-cottage-plank/55 text-xs"
                >
                  <span className="font-medium">Gold mine</span>
                  <span className="text-empire-parchment/55 ml-1">— +7 gold/cycle on mountain deposit (20 iron)</span>
                </button>
              )}
            </>
          )}
        </div>
      </BuilderCottagePanel>
    );
  }

  if (uiMode === 'build_mine') {
    return (
      <BuilderCottagePanel title="Mine — select deposit" innerClassName="space-y-2">
        <p className="text-empire-parchment/55 text-[10px]">Click a highlighted mine deposit.</p>
        <button
          onClick={cancelBuilderBuild}
          className="w-full px-2 py-1.5 text-xs border border-cottage-brass/40 rounded text-empire-parchment/80 hover:bg-cottage-wood/50"
        >
          Cancel
        </button>
      </BuilderCottagePanel>
    );
  }

  if (uiMode === 'build_quarry') {
    return (
      <BuilderCottagePanel title="Quarry — select deposit" innerClassName="space-y-2">
        <p className="text-empire-parchment/55 text-[10px]">Click a highlighted quarry deposit.</p>
        <button
          onClick={cancelBuilderBuild}
          className="w-full px-2 py-1.5 text-xs border border-cottage-brass/40 rounded text-empire-parchment/80 hover:bg-cottage-wood/50"
        >
          Cancel
        </button>
      </BuilderCottagePanel>
    );
  }

  if (uiMode === 'build_gold_mine') {
    return (
      <BuilderCottagePanel title="Gold mine — select deposit" innerClassName="space-y-2">
        <p className="text-empire-parchment/55 text-[10px]">
          Click a highlighted gold deposit (mountains). Costs 20g + 20 iron from nearest city.
        </p>
        <button
          onClick={cancelBuilderBuild}
          className="w-full px-2 py-1.5 text-xs border border-cottage-brass/40 rounded text-empire-parchment/80 hover:bg-cottage-wood/50"
        >
          Cancel
        </button>
      </BuilderCottagePanel>
    );
  }

  if (uiMode === 'build_road') {
    return (
      <BuilderCottagePanel title="Roads" innerClassName="space-y-2">
        <p className="text-empire-parchment/55 text-[10px]">Road placement from this panel is disabled.</p>
        <button
          type="button"
          onClick={cancelBuilderBuild}
          className="w-full px-2 py-1.5 text-xs border border-cottage-brass/40 rounded text-empire-parchment/80 hover:bg-cottage-wood/50"
        >
          Cancel
        </button>
      </BuilderCottagePanel>
    );
  }

  return null;
}

function DefensePlacementOverlay() {
  const uiMode = useGameStore(s => s.uiMode);
  const pendingDefenseBuild = useGameStore(s => s.pendingDefenseBuild);
  const cancelDefensePlacement = useGameStore(s => s.cancelDefensePlacement);
  if (uiMode !== 'build_defense' || !pendingDefenseBuild) return null;
  const { towerType, level } = pendingDefenseBuild;
  return (
    <div className="fixed top-20 left-1/2 -translate-x-1/2 z-30 pointer-events-auto">
      <div className="bg-empire-dark/95 border border-empire-stone/40 rounded-lg px-4 py-3 shadow-xl flex items-center gap-3">
        <div>
          <div className="text-cottage-glow text-xs font-bold">Placing {DEFENSE_TOWER_DISPLAY_NAME[towerType]} (L{level})</div>
          <div className="text-[10px] text-empire-parchment/60">Click a territory hex (not city center, water, or mountain). Upgrades are on the side panel after you select the tower.</div>
        </div>
        <button
          type="button"
          onClick={cancelDefensePlacement}
          className="px-2 py-1.5 text-xs border border-empire-stone/40 rounded text-empire-parchment/70 hover:bg-empire-stone/20"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Build Menu ────────────────────────────────────────────────────

function BuildMenu({ q, r, inTerritory, buildersHere, tile, hasConstructionAt, hasCityAt }: {
  q: number; r: number; inTerritory: boolean; buildersHere: number;
  tile?: { hasRoad?: boolean; hasQuarryDeposit?: boolean; hasMineDeposit?: boolean; hasWoodDeposit?: boolean; biome?: string } | undefined;
  hasConstructionAt: (q: number, r: number) => boolean;
  hasCityAt: (q: number, r: number) => boolean;
}) {
  const tiles = useGameStore(s => s.tiles);
  const coastal = hexTouchesBiome(tiles, q, r, 'water');
  const buildStructure = useGameStore(s => s.buildStructure);
  const buildTrebuchetInField = useGameStore(s => s.buildTrebuchetInField);
  const startDefensePlacement = useGameStore(s => s.startDefensePlacement);
  const defenseInstallations = useGameStore(s => s.defenseInstallations);
  const human = useGameStore(s => s.getHumanPlayer)();
  const allCitiesState = useGameStore(s => s.cities);
  const territoryState = useGameStore(s => s.territory);
  const humanCities = allCitiesState.filter(c => c.ownerId === human?.id);
  const hasBuilderHut = humanCities.some(c => c.buildings.some(b => b.type === 'academy'));

  let availBP = 0;
  if (inTerritory) availBP += CITY_BUILDING_POWER;
  availBP += buildersHere * BUILDER_POWER;

  const isCityTile = hasCityAt(q, r);
  const hasDefenseAtHex = defenseInstallations.some(d => d.q === q && d.r === r);
  const canBuildTrebuchetHere =
    hasBuilderHut &&
    !hasCityAt(q, r) &&
    !hasConstructionAt(q, r) &&
    !hasDefenseAtHex &&
    tile?.biome !== 'water' &&
    tile?.biome !== 'mountain';
  type BuildMenuCategory = 'Food & trade' | 'Industry' | 'Recruitment' | 'Resource sites' | 'Coast & ships';
  type BuildMenuPanelTab = 'field' | 'food' | 'industry' | 'recruitment' | 'resources' | 'coast' | 'defense';
  const BUILD_MENU_CATEGORY_ORDER: BuildMenuCategory[] = [
    'Food & trade',
    'Industry',
    'Recruitment',
    'Resource sites',
    'Coast & ships',
  ];
  const CATEGORY_TAB: Record<BuildMenuCategory, Exclude<BuildMenuPanelTab, 'field' | 'defense'>> = {
    'Food & trade': 'food',
    Industry: 'industry',
    Recruitment: 'recruitment',
    'Resource sites': 'resources',
    'Coast & ships': 'coast',
  };

  const buildings: {
    category: BuildMenuCategory;
    type: BuildingType;
    label: string;
    desc: string;
    show?: boolean;
    needsUnits?: boolean;
  }[] = [
    ...(human?.kingdomId === 'fishers'
      ? [{
        category: 'Food & trade' as BuildMenuCategory,
        type: 'banana_farm' as BuildingType,
        label: 'Banana farm',
        desc: `Same as farm. L1: +${BUILDING_PRODUCTION.farm.food} grain/cycle (2 jobs); L2: +${FARM_L2_FOOD_PER_CYCLE} (3 jobs)  (${BUILDING_BP_COST.banana_farm} BP)`,
      }]
      : [{
        category: 'Food & trade' as BuildMenuCategory,
        type: 'farm' as BuildingType,
        label: 'Farm',
        desc: `L1: +${BUILDING_PRODUCTION.farm.food} grain/cycle (2 jobs); L2: +${FARM_L2_FOOD_PER_CYCLE} (3 jobs)  (${BUILDING_BP_COST.farm} BP)`,
      }]),
    { category: 'Food & trade' as BuildMenuCategory, type: 'market' as BuildingType, label: 'Market', desc: `+${MARKET_GOLD_PER_VILLAGE}g per empire incorporated village/cycle (2 jobs) (${BUILDING_BP_COST.market} BP)` },
    { category: 'Food & trade' as BuildMenuCategory, type: 'fishery' as BuildingType, label: 'Fishery', desc: `+${BUILDING_PRODUCTION.fishery.food} grain/cycle on coast (2 jobs) (${BUILDING_BP_COST.fishery} BP)`, show: coastal },
    { category: 'Industry' as BuildMenuCategory, type: 'factory' as BuildingType, label: 'Factory', desc: `+1 arms/cycle (2 jobs)  (${BUILDING_BP_COST.factory} BP)` },
    { category: 'Industry' as BuildMenuCategory, type: 'sawmill' as BuildingType, label: 'Sawmill', desc: `+${BUILDING_PRODUCTION.sawmill.refinedWood} refined wood/cycle; needs ${SAWMILL_WOOD_PER_REFINED} raw wood each (2 jobs) (${BUILDING_BP_COST.sawmill} BP)` },
    {
      category: 'Recruitment' as BuildMenuCategory,
      type: 'siege_workshop' as BuildingType,
      label: 'Siege workshop',
      desc: `Build trebuchets and battering rams (2 jobs) (${BUILDING_BP_COST.siege_workshop} BP)`,
    },
    {
      category: 'Recruitment' as BuildMenuCategory,
      type: 'social_bar' as BuildingType,
      label: 'Social hall',
      desc: `One per city — faster births at L1–L3 (${SOCIAL_BAR_BIRTH_MULT_PER_LEVEL * 100}% per level). ${SOCIAL_BAR_BP} BP, ${SOCIAL_BAR_BUILD_GOLD}g build`,
    },
    { category: 'Resource sites' as BuildMenuCategory, type: 'quarry' as BuildingType, label: 'Quarry', desc: `+${BUILDING_PRODUCTION.quarry.stone} stone/cycle (2 jobs) (${BUILDING_BP_COST.quarry} BP)`, show: tile?.hasQuarryDeposit && !isCityTile },
    { category: 'Resource sites' as BuildMenuCategory, type: 'mine' as BuildingType, label: 'Mine', desc: `+${BUILDING_PRODUCTION.mine.iron} iron/cycle (2 jobs) (${BUILDING_BP_COST.mine} BP)`, show: tile?.hasMineDeposit && !isCityTile },
    { category: 'Coast & ships' as BuildMenuCategory, type: 'port' as BuildingType, label: 'Port', desc: `Coastal — ships & naval play (1 job) (${BUILDING_BP_COST.port} BP)`, show: coastal },
    { category: 'Coast & ships' as BuildMenuCategory, type: 'shipyard' as BuildingType, label: 'Shipyard', desc: `Build ships (2 jobs) (${BUILDING_BP_COST.shipyard} BP)`, show: coastal },
    { category: 'Recruitment' as BuildMenuCategory, type: 'university' as BuildingType, label: 'University', desc: `Generates commanders & politicians; boosts education & research (3 jobs) (${BUILDING_BP_COST.university} BP)` },
  ].filter(b => b.show !== false);

  const buildingGroups = BUILD_MENU_CATEGORY_ORDER.map(title => ({
    title,
    items: buildings.filter(b => b.category === title),
  })).filter(g => g.items.length > 0);

  const trebuchetCanAfford =
    (human?.gold ?? 0) >= TREBUCHET_FIELD_GOLD_COST &&
    !!findCityForRefinedWoodSpend(q, r, human?.id ?? '', TREBUCHET_REFINED_WOOD_COST, allCitiesState, territoryState);

  const terrAtHex = territoryState.get(tileKey(q, r));
  const payCityForDefense =
    terrAtHex && human && terrAtHex.playerId === human.id
      ? allCitiesState.find(c => c.id === terrAtHex.cityId)
      : undefined;
  const showDefenseTab = inTerritory && !!payCityForDefense;

  const visibleTabs: BuildMenuPanelTab[] = [];
  if (canBuildTrebuchetHere) visibleTabs.push('field');
  for (const g of buildingGroups) {
    const t = CATEGORY_TAB[g.title as BuildMenuCategory];
    if (t && !visibleTabs.includes(t)) visibleTabs.push(t);
  }
  if (showDefenseTab) visibleTabs.push('defense');

  const TAB_LABEL: Record<BuildMenuPanelTab, string> = {
    field: 'Field',
    food: 'Food & trade',
    industry: 'Industry',
    recruitment: 'Recruitment',
    resources: 'Resources',
    coast: 'Coast & ships',
    defense: 'Defense',
  };

  const [panelTab, setPanelTab] = useState<BuildMenuPanelTab>('food');
  useEffect(() => {
    setPanelTab(prev => (visibleTabs.includes(prev) ? prev : visibleTabs[0] ?? 'food'));
  }, [q, r, visibleTabs.join(',')]);

  const renderBuildingButtons = (category: BuildMenuCategory) => {
    const items = buildingGroups.find(g => g.title === category)?.items ?? [];
    if (items.length === 0) {
      return <p className="text-empire-parchment/40 text-[10px]">Nothing available in this category on this hex.</p>;
    }
    const bpPerSec = availBP / BP_RATE_BASE;
    return (
      <div className="space-y-1.5">
        {items.map(b => {
          const cost = BUILDING_COSTS[b.type];
          const canAfford = (human?.gold ?? 0) >= cost;
          const biome = tile?.biome as Biome | undefined;
          const farmTerrainOk =
            !isFarmBuildingType(b.type) || !biome || isValidFarmPlacementBiome(biome);
          const enabled = canAfford && farmTerrainOk;
          const bpCost = BUILDING_BP_COST[b.type];
          const buildTime = bpPerSec > 0 ? Math.ceil(bpCost / bpPerSec) : Infinity;
          return (
            <button
              key={b.type}
              onClick={() => buildStructure(b.type, q, r)}
              disabled={!enabled}
              className={`w-full text-left px-3 py-2 rounded border text-xs transition-colors ${
                enabled
                  ? 'border-empire-stone/40 bg-empire-stone/10 hover:bg-empire-stone/20 text-empire-parchment'
                  : 'border-empire-stone/20 bg-transparent text-empire-parchment/30 cursor-not-allowed'
              }`}
            >
              <div className="flex justify-between">
                <span className="font-medium">{b.label}</span>
                <span className={enabled ? 'text-yellow-400' : 'text-red-400/50'}>{cost}g</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-empire-parchment/40">{b.desc}</span>
                <span className="text-empire-parchment/30 text-[10px] shrink-0">~{buildTime < Infinity ? `${buildTime}s` : '---'}</span>
              </div>
            </button>
          );
        })}
      </div>
    );
  };

  const goldDefense = human?.gold ?? 0;

  return (
    <BuilderCottagePanel title="Build & timber" innerClassName="space-y-2">
      <p className="text-empire-parchment/50 text-[10px] leading-snug border border-cottage-brass/25 rounded px-2 py-1.5 bg-cottage-wood/35">
        {inTerritory ? `City territory (${CITY_BUILDING_POWER} BP)` : `Outside territory`}
        {buildersHere > 0 &&
          ` + Builder's Hut workforce ${buildersHere} slot${buildersHere > 1 ? 's' : ''} (+${buildersHere * BUILDER_POWER} BP when task matches)`}
        {' '}
        <span className="text-cottage-glow/90">= {availBP} BP total</span>
      </p>

      {visibleTabs.length > 0 && (
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Build categories">
          {visibleTabs.map(tab => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={panelTab === tab}
              onClick={() => setPanelTab(tab)}
              className={`px-2 py-1 text-[10px] font-medium rounded border transition-colors ${
                panelTab === tab
                  ? 'border-cottage-brass/60 bg-cottage-plank/50 text-cottage-glow shadow-[inset_0_0_8px_rgba(201,168,76,0.12)]'
                  : 'border-cottage-brass/20 text-empire-parchment/75 hover:bg-cottage-wood/40 hover:border-cottage-brass/35'
              }`}
            >
              {TAB_LABEL[tab]}
            </button>
          ))}
        </div>
      )}

      {panelTab === 'field' && canBuildTrebuchetHere && (
        <div className="space-y-2 pt-0.5" role="tabpanel">
          <button
            onClick={() => buildTrebuchetInField(q, r)}
            disabled={!trebuchetCanAfford}
            className={`w-full text-left px-3 py-2 rounded border text-xs transition-colors ${
              trebuchetCanAfford
                ? 'border-amber-600/40 bg-amber-900/20 text-amber-300 hover:bg-amber-900/30'
                : 'border-empire-stone/20 bg-transparent text-empire-parchment/30 cursor-not-allowed'
            }`}
          >
            <div className="flex justify-between gap-2">
              <span className="font-medium">Build Trebuchet (field)</span>
              <span className={`text-right shrink-0 ${trebuchetCanAfford ? 'text-yellow-400' : 'text-red-400/50'}`}>
                {TREBUCHET_FIELD_GOLD_COST}g · {TREBUCHET_REFINED_WOOD_COST} ref.
              </span>
            </div>
            <div className="text-empire-parchment/40 text-[10px]">Siege. Nearest Builder&apos;s Hut supplies BP ({TREBUCHET_FIELD_BP_COST} BP)</div>
          </button>
        </div>
      )}

      {panelTab === 'food' && (
        <div role="tabpanel" className="pt-0.5">
          {renderBuildingButtons('Food & trade')}
        </div>
      )}
      {panelTab === 'industry' && (
        <div role="tabpanel" className="pt-0.5">
          {renderBuildingButtons('Industry')}
        </div>
      )}
      {panelTab === 'recruitment' && (
        <div role="tabpanel" className="pt-0.5">
          {renderBuildingButtons('Recruitment')}
        </div>
      )}
      {panelTab === 'resources' && (
        <div role="tabpanel" className="pt-0.5">
          {renderBuildingButtons('Resource sites')}
        </div>
      )}
      {panelTab === 'coast' && (
        <div role="tabpanel" className="pt-0.5">
          {renderBuildingButtons('Coast & ships')}
        </div>
      )}

      {panelTab === 'defense' && payCityForDefense && (
        <div className="space-y-2 pt-0.5 border-t border-empire-stone/25" role="tabpanel">
          <p className="text-[9px] text-empire-parchment/45 leading-snug">
            Mortar, archer tower, ballista — paid from your gold and this city&apos;s stores (territory BP only). Place a new tower at L1, then click the tower on the map to upgrade one level at a time.
          </p>
          {(['mortar', 'archer_tower', 'ballista'] as const).map(tt => {
            const n = defenseInstallations.filter(d => d.cityId === payCityForDefense.id && d.type === tt).length;
            const maxed = n >= DEFENSE_TOWER_MAX_PER_CITY[tt];
            const placeOk = !maxed && canAffordDefenseHud(goldDefense, payCityForDefense, 1);
            return (
              <div key={tt} className="space-y-1">
                <div className="text-[10px] text-empire-parchment/70">
                  {DEFENSE_TOWER_DISPLAY_NAME[tt]} — {n}/{DEFENSE_TOWER_MAX_PER_CITY[tt]} ({payCityForDefense.name})
                </div>
                <button
                  type="button"
                  disabled={!placeOk}
                  title={placeOk ? `Place L1 — ${formatDefenseLevelCost(1)}` : maxed ? 'Max towers of this type for this city' : `Need ${formatDefenseLevelCost(1)}`}
                  onClick={() => startDefensePlacement(tt, 1, payCityForDefense.id)}
                  className={`w-full text-left px-2 py-1.5 rounded border text-[10px] font-medium transition-colors ${
                    placeOk
                      ? 'border-empire-stone/40 bg-empire-stone/10 text-empire-parchment hover:bg-empire-stone/20'
                      : 'border-empire-stone/20 bg-transparent text-empire-parchment/30 cursor-not-allowed'
                  }`}
                >
                  Place new tower (L1) — {formatDefenseLevelCost(1)}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </BuilderCottagePanel>
  );
}

// ─── Supply view: empire income statement ───

function SupplyClusterSidePanel() {
  const phase = useGameStore(s => s.phase);
  const supplyViewTab = useGameStore(s => s.supplyViewTab);
  const selectedClusterKey = useGameStore(s => s.selectedClusterKey);
  const getEmpireIncomeStatement = useGameStore(s => s.getEmpireIncomeStatement);
  const getSupplyClustersWithPaths = useGameStore(s => s.getSupplyClustersWithPaths);
  const setSelectedClusterKey = useGameStore(s => s.setSelectedClusterKey);

  if (phase !== 'playing' || supplyViewTab !== 'supply' || !selectedClusterKey) return null;

  const entry = getSupplyClustersWithPaths().find(e => e.clusterKey === selectedClusterKey);
  const stmt = getEmpireIncomeStatement();

  if (!entry || !stmt) return null;

  const { cluster } = entry;
  const cityNames = cluster.cities.map(c => c.name).join(', ');

  const Row = ({ label, income, expense, net }: { label: string; income: number; expense: number; net: number }) => (
    <tr className="border-b border-empire-stone/20 last:border-0">
      <td className="py-2 pr-4 text-empire-parchment/80 text-xs font-medium">{label}</td>
      <td className="py-2 pr-3 text-right text-emerald-400/90 text-xs tabular-nums">+{income}</td>
      <td className="py-2 pr-3 text-right text-red-400/90 text-xs tabular-nums">−{expense}</td>
      <td className={`py-2 text-right text-xs font-semibold tabular-nums ${
        net >= 0 ? 'text-emerald-300' : 'text-red-300'
      }`}>
        {net >= 0 ? '+' : ''}{net}
      </td>
    </tr>
  );

  return (
    <div className="absolute top-14 left-2 w-72 pointer-events-auto z-10">
      <div className="bg-empire-dark/95 backdrop-blur-md border border-empire-stone/40 rounded-xl shadow-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-empire-stone/30 bg-empire-stone/5">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-sm font-semibold text-empire-gold tracking-wide">Empire</h3>
              <p className="text-empire-parchment/70 text-xs mt-0.5 truncate" title={cityNames}>{cityNames}</p>
            </div>
            <button
              onClick={() => setSelectedClusterKey(null)}
              className="text-empire-parchment/40 hover:text-empire-parchment text-xs p-1 rounded hover:bg-empire-stone/20 transition-colors"
            >
              [×]
            </button>
          </div>
        </div>
        <div className="p-4">
          <table className="w-full text-left">
            <thead>
              <tr className="text-empire-parchment/50 text-[10px] uppercase tracking-wider border-b border-empire-stone/20">
                <th className="pb-2 pr-4 font-medium">Resource</th>
                <th className="pb-2 pr-3 text-right font-medium">Income</th>
                <th className="pb-2 pr-3 text-right font-medium">Expense</th>
                <th className="pb-2 text-right font-medium">Net</th>
              </tr>
            </thead>
            <tbody>
              <Row label="Food" income={stmt.food.income} expense={stmt.food.expense} net={stmt.food.net} />
              <Row label="Iron" income={stmt.iron.income} expense={stmt.iron.expense} net={stmt.iron.net} />
              <Row label="Arms" income={stmt.arms.income} expense={stmt.arms.expense} net={stmt.arms.net} />
              <Row label="L2 Arms" income={stmt.armsL2.income} expense={stmt.armsL2.expense} net={stmt.armsL2.net} />
              <Row label="Stone" income={stmt.stone.income} expense={stmt.stone.expense} net={stmt.stone.net} />
            </tbody>
          </table>
          <div className={`mt-3 px-3 py-2 rounded-lg text-xs font-medium ${
            stmt.foodSurplus ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'
          }`}>
            {stmt.foodSurplus ? 'Food surplus — empire healthy' : 'Food deficit — empire at risk'}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Supply View Panel (bottom-right, map mode tabs) ─────────────────

function SupplyViewPanel() {
  const phase = useGameStore(s => s.phase);
  const supplyViewTab = useGameStore(s => s.supplyViewTab);
  const setSupplyViewTab = useGameStore(s => s.setSupplyViewTab);
  const territoryDisplayStyle = useGameStore(s => s.territoryDisplayStyle);
  const setTerritoryDisplayStyle = useGameStore(s => s.setTerritoryDisplayStyle);

  if (phase !== 'playing') return null;

  return (
    <div className="absolute bottom-2 right-2 pointer-events-auto z-10">
      <div className="bg-empire-dark/90 backdrop-blur-sm border border-empire-stone/30 rounded-lg overflow-hidden">
        <div className="flex">
          <button
            onClick={() => setSupplyViewTab('normal')}
            className={`px-3 py-2 text-xs font-medium transition-colors ${
              supplyViewTab === 'normal'
                ? 'bg-empire-gold/20 text-empire-gold border-b-2 border-empire-gold'
                : 'text-empire-parchment/60 hover:text-empire-parchment/80 hover:bg-empire-stone/20'
            }`}
          >
            Normal
          </button>
          <button
            onClick={() => setSupplyViewTab('supply')}
            className={`px-3 py-2 text-xs font-medium transition-colors ${
              supplyViewTab === 'supply'
                ? 'bg-empire-gold/20 text-empire-gold border-b-2 border-empire-gold'
                : 'text-empire-parchment/60 hover:text-empire-parchment/80 hover:bg-empire-stone/20'
            }`}
          >
            Supply
          </button>
        </div>
        <div className="flex border-t border-empire-stone/20">
          <button
            type="button"
            onClick={() => setTerritoryDisplayStyle('fill')}
            title="Faction-colored tint only (no border dashes)"
            className={`flex-1 px-2 py-1.5 text-[10px] font-medium transition-colors ${
              territoryDisplayStyle === 'fill'
                ? 'bg-empire-gold/15 text-empire-gold'
                : 'text-empire-parchment/50 hover:text-empire-parchment/75 hover:bg-empire-stone/15'
            }`}
          >
            Tint only
          </button>
          <button
            type="button"
            onClick={() => setTerritoryDisplayStyle('dashed')}
            title="Faction-colored tint on each hex, plus dashed border lines"
            className={`flex-1 px-2 py-1.5 text-[10px] font-medium transition-colors border-l border-empire-stone/20 ${
              territoryDisplayStyle === 'dashed'
                ? 'bg-empire-gold/15 text-empire-gold'
                : 'text-empire-parchment/50 hover:text-empire-parchment/75 hover:bg-empire-stone/15'
            }`}
          >
            Tint + edges
          </button>
        </div>
        {supplyViewTab === 'supply' && (
          <div className="px-3 py-2 text-[10px] text-empire-parchment/50 border-t border-empire-stone/20">
            Green = food surplus · Red = deficit · Click city to open (works even with units on hex)
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Notification Log ──────────────────────────────────────────────

function NotificationLog() {
  const notifications = useGameStore(s => s.notifications);
  if (notifications.length === 0) return null;

  const typeColors: Record<string, string> = {
    info: 'text-blue-300 border-blue-500/20',
    warning: 'text-yellow-300 border-yellow-500/20',
    danger: 'text-red-400 border-red-500/20',
    success: 'text-green-400 border-green-500/20',
  };

  return (
    <div className="w-80 max-w-[calc(100vw-1rem)] space-y-1 pointer-events-none">
      {notifications.slice(-5).map(n => (
        <div key={n.id}
          className={`text-xs px-3 py-1.5 bg-empire-dark/90 backdrop-blur-sm rounded border-l-2 shadow-md ${typeColors[n.type] ?? typeColors.info}`}>
          <span className="text-empire-parchment/40 mr-1">C{n.turn}</span>
          {n.message}
        </div>
      ))}
    </div>
  );
}
