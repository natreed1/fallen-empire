'use client';

import { useState, useEffect, useMemo } from 'react';
import { useGameStore } from '@/store/useGameStore';
import { setAiParams } from '@/lib/aiParams';
import { computeTradeClusters, getCapitalCluster, getSupplyingClusterKey } from '@/lib/logistics';
import { computeCityProductionRate, computeSawmillBuildingPreview } from '@/lib/gameLoop';
import { getWeatherHarvestMultiplier } from '@/lib/weather';
import { BUILDING_COSTS, BUILDING_PRODUCTION, BUILDING_BP_COST, BUILDING_JOBS, CITY_BUILDING_POWER, BUILDER_POWER, BP_RATE_BASE, TERRAIN_FOOD_YIELD, UNIT_COSTS, UNIT_L2_COSTS, UNIT_L3_COSTS, UNIT_BASE_STATS, UNIT_DISPLAY_NAMES, HERO_BUFFS, COMMANDER_TRAIT_INFO, COMMANDER_RECRUIT_GOLD, COMMANDER_STARTING_PICK, COMMANDER_DRAFT_POOL_SIZE, VILLAGE_INCORPORATE_COST, MARKET_GOLD_PER_CYCLE, SCOUT_MISSION_COST, WEATHER_DISPLAY, BARACKS_UPGRADE_COST, BARACKS_L3_UPGRADE_COST, FACTORY_UPGRADE_COST, FARM_UPGRADE_COST, FARM_L2_FOOD_PER_CYCLE, WALL_SECTION_STONE_COST, WORKERS_PER_LEVEL, MIN_STAFFING_RATIO, ROAD_BP_COST, TREBUCHET_FIELD_BP_COST, TREBUCHET_FIELD_GOLD_COST, TREBUCHET_REFINED_WOOD_COST, SCOUT_TOWER_BP_COST, SCOUT_TOWER_GOLD_COST, SAWMILL_WOOD_PER_REFINED, getBuildingJobs, getUnitStats, BuildingType, UnitType, ArmyStance, Biome, hexDistance, tileKey, POP_BIRTH_RATE, POP_NATURAL_DEATHS, POP_CARRYING_CAPACITY_PER_FOOD, POP_EXPECTED_K_ALPHA, STARVATION_DEATHS, SHIP_RECRUIT_COSTS, isNavalUnitType, getShipMaxCargo, hexTouchesBiome, AttackCityStyle, DefenseTowerType, DefenseTowerLevel, DEFENSE_TOWER_LEVEL_COSTS, DEFENSE_TOWER_MAX_PER_CITY, DEFENSE_TOWER_DISPLAY_NAME, getDefenseTowerBpCost, City, CONTESTED_ZONE_GOLD_REWARD, CONTESTED_ZONE_IRON_REWARD, KingdomId, KINGDOM_IDS, KINGDOM_DISPLAY_NAMES, KINGDOM_SETUP_ICONS, SCROLL_SEARCH_CYCLES_REQUIRED, SCROLL_DISPLAY_NAME, SCROLL_COMBAT_BONUS, SCROLL_DEFENSE_BONUS, SCROLL_MOVEMENT_BONUS, SCROLL_ARMY_SLOT_ORDER, SCROLL_SLOT_LABEL, type ScrollKind, type Commander, type ScrollAttachment } from '@/types/game';
import { countLandMilitaryByType } from '@/lib/siege';
import { findCityForRefinedWoodSpend } from '@/lib/territory';
import Image from 'next/image';
import Link from 'next/link';

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

/** Mortar / archer tower / ballista: builder + your territory; also used from main Build menu. */
function BuilderCityDefensesSection({
  q,
  r,
  inTerritory,
  buildersHere,
  hasDefenseAtHex,
  hasCityAtHex,
  tileBiome,
  usingMoveDestination,
}: {
  q: number;
  r: number;
  inTerritory: boolean;
  buildersHere: number;
  hasDefenseAtHex: boolean;
  hasCityAtHex: boolean;
  tileBiome?: string;
  /** True when map shows a pending move — defenses place on that hex, BP from builders on the selected stack. */
  usingMoveDestination?: boolean;
}) {
  const human = useGameStore(s => s.getHumanPlayer)();
  const allCitiesState = useGameStore(s => s.cities);
  const territoryState = useGameStore(s => s.territory);
  const defenseInstallations = useGameStore(s => s.defenseInstallations);
  const startCityDefenseTowerBuild = useGameStore(s => s.startCityDefenseTowerBuild);

  if (buildersHere <= 0 || hasCityAtHex) return null;
  if (tileBiome === 'water' || tileBiome === 'mountain') return null;

  const payCityForDefense =
    inTerritory && human
      ? (() => {
          const info = territoryState.get(tileKey(q, r));
          if (!info || info.playerId !== human.id) return undefined;
          return allCitiesState.find(c => c.id === info.cityId);
        })()
      : undefined;

  if (!inTerritory) {
    return (
      <div className="rounded border border-rose-500/30 bg-rose-950/25 px-2 py-2 space-y-1">
        <div className="text-rose-200 text-[11px] font-semibold">City defenses (mortar, archer, ballista)</div>
        <p className="text-[10px] text-empire-parchment/60 leading-snug">
          {usingMoveDestination ? (
            <>
              The <span className="text-empire-parchment/85">move destination</span> must be inside your territory. Pick another land hex in your border, or cancel the move (Esc) and walk the builder there first.
            </>
          ) : (
            <>
              Move your builder onto <span className="text-empire-parchment/85">your territory</span> (inside your border). Then L1–L5 buttons appear here and in the full Build menu. Costs: player gold + that city&apos;s wood/stone/iron.
            </>
          )}
        </p>
      </div>
    );
  }

  if (hasDefenseAtHex) {
    return (
      <p className="text-[10px] text-empire-parchment/50 border border-empire-stone/20 rounded px-2 py-1.5">
        This hex already has a defense — click it to upgrade (needs builder on hex).
      </p>
    );
  }

  if (!payCityForDefense) return null;

  return (
    <div className="space-y-2 border border-rose-500/35 rounded-md px-2 py-2 bg-rose-950/20">
      <h4 className="text-rose-300 text-[11px] font-semibold">City defenses — place here (builder BP)</h4>
      {usingMoveDestination && (
        <p className="text-[10px] text-amber-200/80 leading-snug">
          Placement uses your <span className="text-amber-100/90">move destination</span> (pending-move ring). Builders on the selected stack supply BP until they reach the site or you cancel the move first.
        </p>
      )}
      <p className="text-[10px] text-empire-parchment/50 leading-snug">
        Mortar: splash, trebuchet range (1/city). Archer tower / ballista: r3 (2 each). Tap L1–L5 to pay and start build.
      </p>
      {(['mortar', 'archer_tower', 'ballista'] as const).map(tt => {
        const n = defenseInstallations.filter(d => d.cityId === payCityForDefense.id && d.type === tt).length;
        const maxed = n >= DEFENSE_TOWER_MAX_PER_CITY[tt];
        return (
          <div key={tt} className="space-y-1">
            <div className="text-[10px] text-empire-parchment/70">
              {DEFENSE_TOWER_DISPLAY_NAME[tt]} — {n}/{DEFENSE_TOWER_MAX_PER_CITY[tt]} in this city
            </div>
            <div className="flex flex-wrap gap-1">
              {([1, 2, 3, 4, 5] as const).map(lvl => {
                const ok = !maxed && canAffordDefenseHud(human?.gold ?? 0, payCityForDefense, lvl);
                return (
                  <button
                    key={lvl}
                    type="button"
                    disabled={!ok}
                    title={formatDefenseLevelCost(lvl)}
                    onClick={() => startCityDefenseTowerBuild(q, r, tt, lvl)}
                    className={`min-w-[2rem] px-1.5 py-1 rounded border text-[10px] font-medium ${
                      ok
                        ? 'border-rose-500/50 bg-rose-950/40 text-rose-100 hover:bg-rose-900/35'
                        : 'border-empire-stone/20 text-empire-parchment/25 cursor-not-allowed'
                    }`}
                  >
                    L{lvl}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function GameHUD() {
  const phase = useGameStore(s => s.phase);
  return (
    <div className="absolute inset-0 pointer-events-none z-10">
      {phase === 'setup' && <SetupScreen />}
      {phase === 'place_city' && <PlaceCityOverlay />}
      {phase === 'commander_setup' && <CommanderSetupOverlay />}
      {phase === 'playing' && <PlayingHUD />}
      {phase === 'victory' && <VictoryScreen />}
    </div>
  );
}

// ─── Setup ─────────────────────────────────────────────────────────

function SetupScreen() {
  const startPlacement = useGameStore(s => s.startPlacement);
  const selectedKingdom = useGameStore(s => s.selectedKingdom);
  const setSelectedKingdom = useGameStore(s => s.setSelectedKingdom);
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/60 pointer-events-auto">
      <div className="bg-empire-dark border border-empire-gold/40 rounded-xl p-8 text-center max-w-lg">
        <h1 className="text-3xl font-bold text-empire-gold tracking-widest mb-4">FALLEN EMPIRE</h1>
        <p className="text-empire-parchment/70 mb-2 leading-relaxed">
          The old empire has crumbled. Rebuild — or be conquered.
        </p>
        <p className="text-empire-parchment/50 text-sm mb-4">
          Real-time strategy. 35-minute match. Economy cycles every 30s.
          <br />Draft soldiers from your population. Armies stack on hexes.
        </p>
        <p className="text-empire-parchment/60 text-xs uppercase tracking-wide mb-2">Choose your kingdom</p>
        <div className="grid grid-cols-2 gap-2 mb-6">
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
        <div className="flex flex-col gap-3">
          <button onClick={startPlacement}
            className="px-8 py-3 bg-empire-gold/20 border border-empire-gold/60 rounded-lg text-empire-gold font-bold tracking-wide hover:bg-empire-gold/30 transition-colors">
            PLAY (You vs AI)
          </button>
          <button
            type="button"
            onClick={() => {
              useGameStore.getState().generateWorld({ width: 38, height: 38 });
              useGameStore.getState().startSoloPlacement();
            }}
            className="px-8 py-3 bg-emerald-950/50 border border-emerald-600/50 rounded-lg text-emerald-100/95 font-medium tracking-wide hover:bg-emerald-900/40 transition-colors"
          >
            Mechanics test (38×38, no AI)
          </button>
          <button
            type="button"
            onClick={async () => {
              const data = await fetch('/ai-params.json').then(r => r.ok ? r.json() : null).catch(() => null);
              if (data) setAiParams(data);
              useGameStore.getState().startSmallMapBotVsBot();
            }}
            className="px-8 py-3 bg-empire-gold/15 border border-empire-gold/50 rounded-lg text-empire-gold/90 font-medium tracking-wide hover:bg-empire-gold/25 transition-colors"
          >
            Small map battle (38×38, champion AI)
          </button>
          <button
            type="button"
            onClick={() => useGameStore.getState().startBotVsBot()}
            className="px-8 py-3 bg-empire-dark border border-empire-gold/40 rounded-lg text-empire-parchment font-medium tracking-wide hover:bg-empire-gold/10 transition-colors"
          >
            Watch 2 Bot (large map)
          </button>
          <button
            type="button"
            onClick={() => useGameStore.getState().startFourBotVsBot()}
            className="px-8 py-3 bg-empire-dark border border-empire-gold/40 rounded-lg text-empire-parchment font-medium tracking-wide hover:bg-empire-gold/10 transition-colors"
          >
            Watch 4 Bot
          </button>
          <p className="text-empire-parchment/40 text-xs">
            Small map: 38×38, trained champion from ai-params.json. 2 Bot: default map. 4 Bot: four kingdoms (52×52).
          </p>
        </div>
      </div>
    </div>
  );
}

function CommanderSetupOverlay() {
  const cities = useGameStore(s => s.cities);
  const commanderDraftOptions = useGameStore(s => s.commanderDraftOptions);
  const commanderDraftSelectedIds = useGameStore(s => s.commanderDraftSelectedIds);
  const commanderDraftAssignment = useGameStore(s => s.commanderDraftAssignment);
  const toggleCommanderDraftSelection = useGameStore(s => s.toggleCommanderDraftSelection);
  const setCommanderDraftRole = useGameStore(s => s.setCommanderDraftRole);
  const confirmCommanderDraft = useGameStore(s => s.confirmCommanderDraft);

  const humanCity = cities.find(c => c.ownerId === 'player_human');
  const capitalName = humanCity?.name ?? 'your capital';

  const selectedSet = new Set(commanderDraftSelectedIds);
  const n = commanderDraftSelectedIds.length;

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/80 pointer-events-auto z-30 overflow-y-auto py-6 px-3">
      <div className="bg-empire-dark border border-empire-gold/40 rounded-xl p-5 sm:p-7 max-w-5xl w-full shadow-xl my-auto">
        <h2 className="text-empire-gold text-lg sm:text-xl font-bold tracking-wide text-center mb-1">Choose your commanders</h2>
        <p className="text-empire-parchment/60 text-xs sm:text-sm text-center mb-5 leading-relaxed">
          Pick {COMMANDER_STARTING_PICK} of {COMMANDER_DRAFT_POOL_SIZE}. Commanders are separate from heroes and do not use barracks slots. Then set each to defend {capitalName} or stay unassigned (attach to a stack from the hex panel later).
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-5">
          {commanderDraftOptions.map(opt => {
            const on = selectedSet.has(opt.draftId);
            return (
              <button
                key={opt.draftId}
                type="button"
                onClick={() => toggleCommanderDraftSelection(opt.draftId)}
                className={`text-left rounded-lg border p-2 transition-colors ${
                  on ? 'border-empire-gold bg-empire-gold/15 ring-1 ring-empire-gold/50' : 'border-empire-stone/35 bg-black/25 hover:border-empire-gold/40'
                }`}
              >
                {opt.portraitDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={opt.portraitDataUrl} alt="" className="w-full aspect-square object-cover rounded border border-empire-stone/30 mb-1.5" />
                ) : (
                  <div className="w-full aspect-square rounded bg-empire-stone/15 border border-empire-stone/25 mb-1.5" />
                )}
                <div className="text-empire-parchment font-semibold text-[11px] leading-tight">{opt.name}</div>
                <div className="text-[9px] text-empire-parchment/50 mt-0.5 line-clamp-2">
                  {opt.traitIds.map(t => COMMANDER_TRAIT_INFO[t].label).join(' · ')}
                </div>
              </button>
            );
          })}
        </div>
        {n === COMMANDER_STARTING_PICK && (
          <div className="space-y-2 mb-5 border-t border-empire-stone/25 pt-4">
            <p className="text-[11px] text-violet-200/90 uppercase tracking-wide font-semibold">Starting assignments</p>
            {commanderDraftOptions
              .filter(o => selectedSet.has(o.draftId))
              .map(opt => {
                const role = commanderDraftAssignment[opt.draftId] ?? 'none';
                return (
                  <div key={opt.draftId} className="flex flex-wrap items-center gap-2 text-[11px] sm:text-xs">
                    <span className="text-empire-parchment/90 min-w-[100px] shrink-0">{opt.name}</span>
                    <div className="flex gap-1.5 flex-wrap">
                      <button
                        type="button"
                        onClick={() => setCommanderDraftRole(opt.draftId, 'capital')}
                        className={`px-2 py-1 rounded border text-[10px] ${
                          role === 'capital'
                            ? 'border-amber-500/70 bg-amber-950/50 text-amber-100'
                            : 'border-empire-stone/30 text-empire-parchment/60 hover:border-amber-500/40'
                        }`}
                      >
                        Defend {capitalName}
                      </button>
                      <button
                        type="button"
                        onClick={() => setCommanderDraftRole(opt.draftId, 'none')}
                        className={`px-2 py-1 rounded border text-[10px] ${
                          role === 'none'
                            ? 'border-violet-500/60 bg-violet-950/40 text-violet-100'
                            : 'border-empire-stone/30 text-empire-parchment/60 hover:border-violet-500/40'
                        }`}
                      >
                        Unassigned
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>
        )}
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            disabled={n !== COMMANDER_STARTING_PICK}
            onClick={() => confirmCommanderDraft()}
            className="px-8 py-2.5 bg-empire-gold/25 border border-empire-gold/60 rounded-lg text-empire-gold font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-empire-gold/35 transition-colors"
          >
            Begin — {n}/{COMMANDER_STARTING_PICK} selected
          </button>
          {n !== COMMANDER_STARTING_PICK && (
            <p className="text-[10px] text-empire-parchment/45">Select exactly {COMMANDER_STARTING_PICK} portraits above.</p>
          )}
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
        <p className="text-empire-parchment/50 text-sm mt-1">Click a land hex to found your capital</p>
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

function PlayingHUD() {
  const pendingTacticalOrders = useGameStore(s => s.pendingTacticalOrders);
  const tacticalAttackCityDraft = useGameStore(s => s.tacticalAttackCityDraft);
  return (
    <>
      <TopBar />
      <WeatherOverlay />
      <CityModal />
      <SidePanel />
      {pendingTacticalOrders !== null && <TacticalBottomBar />}
      {tacticalAttackCityDraft !== null && <AttackCitySetupModal />}
      <SiegeProgressPanel />
      <SupplyClusterSidePanel />
      <SupplyViewPanel />
      <MoveConfirmPopup />
      <CombatHud />
      <NotificationLog />
    </>
  );
}

// ─── City logistics modal (opened from hex panel, not on first city click) ─

function SpecialRegionExploreModal() {
  const selectedHex = useGameStore(s => s.selectedHex);
  const pendingTacticalOrders = useGameStore(s => s.pendingTacticalOrders);
  const tiles = useGameStore(s => s.tiles);
  const specialRegions = useGameStore(s => s.specialRegions);
  const scrollSearchProgress = useGameStore(s => s.scrollSearchProgress);
  const scrollSearchClaimed = useGameStore(s => s.scrollSearchClaimed);
  const players = useGameStore(s => s.players);
  const openTacticalMode = useGameStore(s => s.openTacticalMode);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(false);
  }, [selectedHex?.q, selectedHex?.r]);

  if (pendingTacticalOrders !== null) return null;
  if (!selectedHex || dismissed) return null;
  const tile = tiles.get(tileKey(selectedHex.q, selectedHex.r));
  const regId = tile?.specialRegionId;
  if (!regId) return null;
  const reg = specialRegions.find(r => r.id === regId);
  if (!reg) return null;

  const human = players.find(p => p.isHuman);
  const hid = human?.id ?? '';
  const claimed = hid ? (scrollSearchClaimed[reg.id] ?? []).includes(hid) : false;
  const prog = hid ? (scrollSearchProgress[reg.id]?.[hid] ?? 0) : 0;
  const pct = Math.min(1, prog / SCROLL_SEARCH_CYCLES_REQUIRED);

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 pointer-events-auto"
      onClick={() => setDismissed(true)}
    >
      <div
        className="bg-empire-dark/95 border border-teal-600/50 rounded-xl p-5 max-w-sm w-full mx-4 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-teal-200 font-bold text-sm mb-1">Explore — {reg.name}</h3>
        <p className="text-empire-parchment/70 text-xs mb-3">
          {claimed
            ? 'You claimed this region\'s scroll.'
            : 'Send land armies into this zone (ships count in Isle of Lost). Progress advances each economy cycle while you hold units here.'}
        </p>
        {!claimed && (
          <div className="mb-3">
            <div className="flex justify-between text-[10px] text-empire-parchment/50 mb-1">
              <span>Search progress</span>
              <span>{Math.min(prog, SCROLL_SEARCH_CYCLES_REQUIRED)} / {SCROLL_SEARCH_CYCLES_REQUIRED}</span>
            </div>
            <div className="h-2.5 bg-empire-stone/25 rounded-full overflow-hidden border border-teal-800/30">
              <div
                className="h-full bg-teal-500/85 rounded-full transition-all"
                style={{ width: `${pct * 100}%` }}
              />
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setDismissed(true);
              openTacticalMode();
            }}
            className="flex-1 min-w-[8rem] px-3 py-2 text-xs font-bold rounded border border-empire-gold/50 text-empire-gold hover:bg-empire-gold/10"
          >
            Send army
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="px-3 py-2 text-xs rounded border border-empire-stone/40 text-empire-parchment/80 hover:bg-empire-stone/20"
          >
            Close
          </button>
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

  const isObserver = gameMode === 'bot_vs_bot' || gameMode === 'bot_vs_bot_4';

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

function CityModalContent({ city, onClose, isObserver = false }: { city: import('@/types/game').City; onClose: () => void; isObserver?: boolean }) {
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
  const clusters = computeTradeClusters(cities, tiles, units, territory);
  const ownerForCluster = isObserver ? players.find(p => p.id === city.ownerId) : human;
  const playerClusters = ownerForCluster ? clusters.get(ownerForCluster.id) ?? [] : [];
  const cluster = playerClusters.find(c => c.cityIds.includes(city.id));
  const clusterTotal = cluster
    ? cluster.cities.reduce(
        (acc, c) => {
          const p = computeCityProductionRate(c, tiles, territory, harvestMult);
          return { food: acc.food + p.food, guns: acc.guns + p.guns };
        },
        { food: 0, guns: 0 },
      )
    : localProd;
  const fromNetwork = {
    food: Math.max(0, clusterTotal.food - localProd.food),
    guns: Math.max(0, clusterTotal.guns - localProd.guns),
  };
  const isIsolated = cluster ? cluster.cities.length === 1 : true;

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
            return (
              <div key={i} className="flex justify-between text-empire-parchment/80">
                <span>{label}</span>
                <span>{assigned}/{jobs} workers</span>
              </div>
            );
          })}
        </div>
      </div>
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

function humanBattleHexKeys(units: import('@/types/game').Unit[]): string[] {
  const byHex: Record<string, import('@/types/game').Unit[]> = {};
  for (const u of units) {
    if (u.hp <= 0 || u.aboardShipId) continue;
    const k = tileKey(u.q, u.r);
    if (!byHex[k]) byHex[k] = [];
    byHex[k].push(u);
  }
  const keys: string[] = [];
  for (const [k, arr] of Object.entries(byHex)) {
    if (new Set(arr.map(u => u.ownerId)).size < 2) continue;
    if (arr.some(u => u.ownerId.includes('human'))) keys.push(k);
  }
  return keys;
}

function CombatHud() {
  return (
    <>
      <CombatBanner />
      <BattleReportModal />
    </>
  );
}

function CombatBanner() {
  const units = useGameStore(s => s.units);
  const gameMode = useGameStore(s => s.gameMode);
  const openBattleModal = useGameStore(s => s.openBattleModal);

  const keys = useMemo(() => humanBattleHexKeys(units), [units]);
  const fightingUnits = units.filter(
    u => u.ownerId.includes('human') && u.hp > 0 && u.status === 'fighting'
  );

  if (keys.length === 0 || gameMode === 'bot_vs_bot' || gameMode === 'bot_vs_bot_4') return null;

  return (
    <div className="absolute top-24 left-1/2 -translate-x-1/2 pointer-events-auto z-20">
      <div className="bg-empire-dark/95 border border-red-500/60 rounded-lg px-4 py-3 shadow-xl min-w-[280px] flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-red-400 font-bold tracking-wide text-sm">COMBAT</p>
          <p className="text-empire-parchment/60 text-xs mt-0.5">
            {fightingUnits.length} of your unit{fightingUnits.length !== 1 ? 's' : ''} engaged · {keys.length} battlefield{keys.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={() => openBattleModal()}
          className="shrink-0 px-4 py-2 text-xs font-bold rounded border border-empire-gold/50 bg-empire-gold/15 text-empire-gold hover:bg-empire-gold/25 transition-colors"
        >
          Battle report
        </button>
      </div>
    </div>
  );
}

function BattleReportModal() {
  const battleModalHexKey = useGameStore(s => s.battleModalHexKey);
  const closeBattleModal = useGameStore(s => s.closeBattleModal);
  const openBattleModal = useGameStore(s => s.openBattleModal);
  const units = useGameStore(s => s.units);
  const heroes = useGameStore(s => s.heroes);
  const players = useGameStore(s => s.players);
  const setRetreatStack = useGameStore(s => s.setRetreatStack);
  const gameMode = useGameStore(s => s.gameMode);

  const battleKeys = useMemo(() => humanBattleHexKeys(units), [units]);

  useEffect(() => {
    if (!battleModalHexKey) return;
    if (!battleKeys.includes(battleModalHexKey)) closeBattleModal();
  }, [battleModalHexKey, battleKeys, closeBattleModal]);

  if (!battleModalHexKey || gameMode === 'bot_vs_bot' || gameMode === 'bot_vs_bot_4') return null;

  const [q, r] = battleModalHexKey.split(',').map(Number);
  const atHex = units.filter(
    u => u.q === q && u.r === r && u.hp > 0 && !u.aboardShipId
  );
  const yours = atHex.filter(u => u.ownerId.includes('human'));
  const enemies = atHex.filter(u => !u.ownerId.includes('human'));

  const sumHp = (list: typeof atHex) =>
    list.reduce((acc, u) => acc + Math.max(0, u.hp), 0);
  const sumMax = (list: typeof atHex) =>
    list.reduce((acc, u) => acc + (u.maxHp ?? getUnitStats(u).maxHp), 0);

  const heroYou = heroes.find(h => h.q === q && h.r === r && h.ownerId.includes('human'));
  const heroEnemy = heroes.find(h => h.q === q && h.r === r && !h.ownerId.includes('human'));

  const nameFor = (ownerId: string) => players.find(p => p.id === ownerId)?.name ?? ownerId;

  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) closeBattleModal();
  };

  return (
    <div
      className="absolute inset-0 flex items-center justify-center bg-black/65 pointer-events-auto z-[95] isolate"
      onClick={handleBackdrop}
      onPointerDown={e => e.stopPropagation()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="battle-report-title"
        className="bg-empire-dark/95 border border-red-500/45 rounded-xl p-5 max-w-lg w-full mx-4 shadow-2xl pointer-events-auto max-h-[min(85vh,640px)] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 id="battle-report-title" className="text-red-400 font-bold tracking-wide text-base">
              Battle report
            </h2>
            <p className="text-empire-parchment/55 text-xs mt-1">
              Hex ({q}, {r}) · Retreat orders a 2s delay before units stop attacking and route away.
            </p>
          </div>
          <button
            type="button"
            onClick={closeBattleModal}
            className="text-empire-parchment/50 hover:text-empire-parchment text-sm px-2 py-1 rounded border border-empire-stone/30"
          >
            Close
          </button>
        </div>

        {battleKeys.length > 1 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {battleKeys.map(k => {
              const [cq, cr] = k.split(',').map(Number);
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => openBattleModal(k)}
                  className={`text-xs px-2.5 py-1 rounded border transition-colors ${
                    k === battleModalHexKey
                      ? 'border-empire-gold/70 bg-empire-gold/15 text-empire-gold'
                      : 'border-empire-stone/35 text-empire-parchment/70 hover:border-empire-stone/55'
                  }`}
                >
                  ({cq}, {cr})
                </button>
              );
            })}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 text-xs mb-4">
          <div className="rounded-lg border border-emerald-800/40 bg-emerald-950/25 px-3 py-2">
            <p className="text-emerald-400/90 font-semibold mb-1">Your force</p>
            <p className="text-empire-parchment/80">
              {yours.length} unit{yours.length !== 1 ? 's' : ''} · {Math.round(sumHp(yours))} / {Math.round(sumMax(yours))} HP
            </p>
            {heroYou && (
              <p className="text-empire-parchment/60 mt-1">Hero: {Math.round(heroYou.hp ?? 0)} / {heroYou.maxHp ?? '—'} HP</p>
            )}
          </div>
          <div className="rounded-lg border border-rose-800/40 bg-rose-950/20 px-3 py-2">
            <p className="text-rose-400/90 font-semibold mb-1">Enemy</p>
            <p className="text-empire-parchment/80">
              {enemies.length} unit{enemies.length !== 1 ? 's' : ''} · {Math.round(sumHp(enemies))} / {Math.round(sumMax(enemies))} HP
            </p>
            {heroEnemy && (
              <p className="text-empire-parchment/60 mt-1">
                {nameFor(heroEnemy.ownerId)} hero: {Math.round(heroEnemy.hp ?? 0)} / {heroEnemy.maxHp ?? '—'} HP
              </p>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 space-y-4 pr-1">
          <div>
            <p className="text-emerald-500/80 text-[11px] font-semibold uppercase tracking-wide mb-2">Your units</p>
            <ul className="space-y-1.5">
              {yours.map(u => {
                const max = u.maxHp ?? getUnitStats(u).maxHp;
                const pct = max > 0 ? Math.round((100 * u.hp) / max) : 0;
                return (
                  <li key={u.id} className="flex items-center gap-2 text-[11px] text-empire-parchment/90">
                    <span className="w-24 truncate">{UNIT_DISPLAY_NAMES[u.type]}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-empire-stone/30 overflow-hidden">
                      <div
                        className="h-full bg-emerald-600/80 rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-empire-parchment/60 tabular-nums w-16 text-right">
                      {u.hp}/{max}
                    </span>
                  </li>
                );
              })}
              {yours.length === 0 && <li className="text-empire-parchment/45 text-[11px]">No land units (check garrison or cargo).</li>}
            </ul>
          </div>
          <div>
            <p className="text-rose-500/80 text-[11px] font-semibold uppercase tracking-wide mb-2">Enemy units</p>
            <ul className="space-y-1.5">
              {enemies.map(u => {
                const max = u.maxHp ?? getUnitStats(u).maxHp;
                const pct = max > 0 ? Math.round((100 * u.hp) / max) : 0;
                return (
                  <li key={u.id} className="flex items-center gap-2 text-[11px] text-empire-parchment/90">
                    <span className="w-24 truncate">{UNIT_DISPLAY_NAMES[u.type]}</span>
                    <span className="text-empire-parchment/50 w-20 truncate">{nameFor(u.ownerId)}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-empire-stone/30 overflow-hidden">
                      <div
                        className="h-full bg-rose-600/75 rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-empire-parchment/60 tabular-nums w-16 text-right">
                      {u.hp}/{max}
                    </span>
                  </li>
                );
              })}
              {enemies.length === 0 && <li className="text-empire-parchment/45 text-[11px]">No visible enemy stacks here.</li>}
            </ul>
          </div>
        </div>

        <div className="mt-5 pt-4 border-t border-empire-stone/25 flex flex-wrap gap-2 justify-end">
          <button
            type="button"
            onClick={() => {
              setRetreatStack(q, r);
              closeBattleModal();
            }}
            className="px-4 py-2 text-xs font-bold rounded border border-amber-600/50 bg-amber-950/35 text-amber-300 hover:bg-amber-900/45 transition-colors"
          >
            Retreat this stack
          </button>
          <button
            type="button"
            onClick={closeBattleModal}
            className="px-4 py-2 text-xs font-bold rounded border border-empire-stone/40 text-empire-parchment/80 hover:bg-empire-stone/15 transition-colors"
          >
            Dismiss
          </button>
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

function TopBar() {
  const cycle = useGameStore(s => s.cycle);
  const players = useGameStore(s => s.players);
  const cities = useGameStore(s => s.cities);
  const units = useGameStore(s => s.units);
  const territory = useGameStore(s => s.territory);
  const heroes = useGameStore(s => s.heroes);
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

  const human = players.find(p => p.isHuman);
  const isObserverMode = gameMode === 'bot_vs_bot' || gameMode === 'bot_vs_bot_4';
  const observedCity = isObserverMode ? getSelectedCityForDisplay() : null;
  const displayPlayer = isObserverMode
    ? (observedCity ? players.find(p => p.id === observedCity.ownerId) : players[0]) ?? null
    : human ?? null;
  const humanCities = cities.filter(c => c.ownerId === (displayPlayer?.id ?? human?.id));

  const clusters = computeTradeClusters(cities, tiles, units, territory);
  const humanClusters = displayPlayer ? clusters.get(displayPlayer.id) ?? [] : [];
  // Show resources from ALL display player cities — isolated cities' production was hidden when using capital cluster only
  const citiesForResources = humanCities;
  const networkCount = humanClusters.filter(c => c.cities.length > 1).length;
  const isolatedCount = humanClusters.filter(c => c.cities.length === 1).length;
  const hasMultipleCities = humanCities.length >= 2;
  const logisticsLabel = humanClusters.length === 0
    ? '—'
    : !hasMultipleCities
      ? `${humanCities.length} city${humanCities.length !== 1 ? 's' : ''}`
      : isolatedCount > 0
        ? `${networkCount || 0} network${networkCount !== 1 ? 's' : ''}, ${isolatedCount} isolated`
        : `${humanClusters.length} network${humanClusters.length !== 1 ? 's' : ''}`;

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
    const baseTax = Math.floor(city.population * taxRate);
    const marketCount = city.buildings.filter(b => b.type === 'market').length;
    const moraleMod = city.morale / 100;
    const marketGold = Math.floor(marketCount * MARKET_GOLD_PER_CYCLE * moraleMod);
    goldPerCycle += baseTax + marketGold;
  }

  // Civilian consumption: 0.5 food per pop per cluster (consumptionPhase)
  const civilianFoodDemand = Math.ceil(totalPop * 0.5);
  // Military upkeep: food + guns per supplied cluster (upkeepTick)
  let militaryFoodDemand = 0;
  let militaryGunDemand = 0;
  const displayPlayerId = displayPlayer?.id ?? human?.id ?? '';
  const humanUnits = units.filter(u => u.ownerId === displayPlayerId && u.hp > 0);
  const unitsByCluster = new Map<string | null, typeof humanUnits>();
  for (const u of humanUnits) {
    const key = getSupplyingClusterKey(u, humanClusters, tiles, units, displayPlayerId);
    if (!unitsByCluster.has(key ?? null)) unitsByCluster.set(key ?? null, []);
    unitsByCluster.get(key ?? null)!.push(u);
  }
  for (const [clusterKey, clusterUnits] of unitsByCluster) {
    if (clusterKey === null) continue; // unsupplied: no upkeep deducted
    let foodD = 0, gunD = 0;
    for (const u of clusterUnits) {
      const stats = getUnitStats(u);
      const heroAtUnit = heroes.find(
        h => h.q === u.q && h.r === u.r && h.ownerId === u.ownerId && h.type === 'logistician',
      );
      const foodUp = heroAtUnit ? Math.ceil((stats.foodUpkeep * 0.5)) : stats.foodUpkeep;
      foodD += foodUp;
      gunD += (stats.gunUpkeep ?? 0);
    }
    militaryFoodDemand += foodD;
    militaryGunDemand += gunD;
  }
  // L2 factories: 1 iron per city with L2 factory per cycle (clusterResourcePhase)
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
    <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-2 bg-empire-dark/90 backdrop-blur-sm border-b border-empire-stone/30 pointer-events-auto">
      <div className="flex items-center gap-4 text-sm">
        {/* Timer */}
        <span className={`font-mono font-bold text-base ${urgent ? 'text-red-400 animate-pulse' : 'text-empire-parchment'}`}>
          {formatTime(gameTimeRemaining)}
        </span>
        {(gameMode === 'bot_vs_bot' || gameMode === 'bot_vs_bot_4') && displayPlayer && (
          <span className="text-empire-gold/80 text-xs font-medium">Observing: {displayPlayer.name}</span>
        )}
        {(gameMode === 'bot_vs_bot' || gameMode === 'bot_vs_bot_4') && (
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
          <span className="text-empire-parchment/50 text-[10px]">Networks</span>
          <span className={`text-xs font-medium ${hasMultipleCities && isolatedCount > 0 ? 'text-amber-400' : 'text-green-400/90'}`}>
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
          <button
            type="button"
            onClick={openTacticalMode}
            className="text-[10px] uppercase text-empire-gold/90 hover:text-empire-gold border border-empire-gold/40 hover:border-empire-gold/60 px-2 py-1 rounded transition-colors"
          >
            Army
          </button>
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

function AttackCitySetupModal() {
  const draft = useGameStore(s => s.tacticalAttackCityDraft);
  const cancel = useGameStore(s => s.cancelTacticalAttackCityDraft);
  const commit = useGameStore(s => s.commitTacticalAttackCitySetup);
  const units = useGameStore(s => s.units); // re-render stacks when units change

  const [attackStyle, setAttackStyle] = useState<AttackCityStyle>('siege');
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
        x => x.q === q && x.r === r && x.ownerId === 'player_human' && x.hp > 0,
      );
      const maxByType = countLandMilitaryByType(stackUnits);
      init[sk] = { w1: { ...maxByType }, w2: {} };
    }
    setForms(init);
    setAttackStyle('siege');
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
    commit({ attackStyle, useWaves, perStack });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-auto bg-black/55 p-4">
      <div className="bg-empire-dark/98 border border-empire-gold/50 rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-4 space-y-4">
        <div className="flex justify-between items-start gap-2">
          <div>
            <h3 className="text-empire-gold font-bold text-sm tracking-wide">Attack {draft.cityName}</h3>
            <p className="text-empire-parchment/60 text-xs mt-1">
              Choose how many of each unit type join, optional waves, and attack style.
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

        <label className="flex items-center gap-2 text-xs text-empire-parchment/90 cursor-pointer select-none">
          <input type="checkbox" checked={useWaves} onChange={e => setUseWaves(e.target.checked)} className="rounded border-empire-stone/50" />
          <span>Send in waves (wave 2 waits until wave 1 reaches the rally point)</span>
        </label>

        {draft.stackKeys.map(sk => {
          const [q, r] = sk.split(',').map(Number);
          const f = forms[sk];
          const stackUnits = units.filter(
            u => u.q === q && u.r === r && u.ownerId === 'player_human' && u.hp > 0,
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

function SiegeProgressPanel() {
  const cities = useGameStore(s => s.cities);
  const units = useGameStore(s => s.units);
  const gameMode = useGameStore(s => s.gameMode);
  const beginSiegeAssaultOnCity = useGameStore(s => s.beginSiegeAssaultOnCity);

  const rows = useMemo(() => {
    if (gameMode === 'bot_vs_bot' || gameMode === 'bot_vs_bot_4') return [];
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

// ─── Tactical Panel (stack list only; orders from bottom bar) ────────

function commanderForArmyStack(
  q: number,
  r: number,
  stackIds: Set<string>,
  commanders: Commander[],
  cities: City[],
): Commander | undefined {
  for (const c of commanders) {
    if (c.ownerId !== 'player_human' || !c.assignment) continue;
    const a = c.assignment;
    if (a.kind === 'field' && stackIds.has(a.anchorUnitId)) return c;
    if (a.kind === 'city_defense') {
      const city = cities.find(ct => ct.id === a.cityId);
      if (city && city.q === q && city.r === r) return c;
    }
  }
  return undefined;
}

function scrollLabelsForStack(
  stackIds: Set<string>,
  attachments: ScrollAttachment[],
): string[] {
  const kinds = new Set<ScrollKind>();
  for (const a of attachments) {
    if (a.ownerId !== 'player_human') continue;
    if (!stackIds.has(a.carrierUnitId)) continue;
    kinds.add(a.kind);
  }
  return SCROLL_ARMY_SLOT_ORDER.filter(k => kinds.has(k)).map(k => SCROLL_DISPLAY_NAME[k]);
}

function CommanderRecruitInArmyPanel() {
  const cities = useGameStore(s => s.cities);
  const players = useGameStore(s => s.players);
  const heroes = useGameStore(s => s.heroes);
  const pendingRecruits = useGameStore(s => s.pendingRecruits);
  const recruitCommander = useGameStore(s => s.recruitCommander);
  const human = players.find(p => p.isHuman);
  const humanCities = cities.filter(c => c.ownerId === 'player_human');
  const playerBarracks = humanCities.reduce((sum, c) => sum + c.buildings.filter(b => b.type === 'barracks').length, 0);
  const playerHeroes = heroes.filter(h => h.ownerId === human?.id).length;
  const pendingHeroSlots = pendingRecruits.filter(pr => 'heroKind' in pr && pr.playerId === human?.id).length;
  const leaderSlotsUsed = playerHeroes + pendingHeroSlots;
  const gold = human?.gold ?? 0;
  const canRecruitLeader = leaderSlotsUsed < playerBarracks;
  const canRecruitCommander = gold >= COMMANDER_RECRUIT_GOLD;
  const barracksCities = humanCities.filter(c => c.buildings.some(b => b.type === 'barracks'));
  if (barracksCities.length === 0) return null;
  return (
    <div className="rounded border border-violet-600/35 bg-violet-950/25 px-2 py-2 space-y-1.5">
      <div className="text-[11px] font-semibold text-violet-200">Recruit commanders</div>
      <p className="text-[10px] text-empire-parchment/55 leading-snug">
        {COMMANDER_RECRUIT_GOLD}g each — not limited by barracks. Spawns at that city next cycle; attach from the hex panel.
      </p>
      <div className="space-y-1">
        {barracksCities.map(c => (
          <button
            key={c.id}
            type="button"
            disabled={!canRecruitCommander}
            onClick={() => recruitCommander(c.id)}
            className="w-full text-left px-2 py-1.5 rounded border border-violet-500/40 text-[11px] text-violet-100 hover:bg-violet-900/35 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {c.name} — Recruit ({COMMANDER_RECRUIT_GOLD}g)
          </button>
        ))}
      </div>
      {!canRecruitLeader && (
        <p className="text-[10px] text-amber-400/90">
          Hero slots full ({leaderSlotsUsed}/{playerBarracks}). Build more barracks for heroes.
        </p>
      )}
    </div>
  );
}

function TacticalPanel() {
  const units = useGameStore(s => s.units);
  const cities = useGameStore(s => s.cities);
  const commanders = useGameStore(s => s.commanders);
  const scrollAttachments = useGameStore(s => s.scrollAttachments ?? []);
  const pendingTacticalOrders = useGameStore(s => s.pendingTacticalOrders);
  const tacticalSelectedStackKeys = useGameStore(s => s.tacticalSelectedStackKeys);
  const toggleTacticalStack = useGameStore(s => s.toggleTacticalStack);
  const confirmTacticalOrders = useGameStore(s => s.confirmTacticalOrders);
  const cancelTacticalMode = useGameStore(s => s.cancelTacticalMode);

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

  return (
    <div className="absolute top-14 right-2 w-[min(100%,26rem)] pointer-events-auto max-h-[85vh] overflow-y-auto">
      <div className="bg-empire-dark/95 border border-empire-gold/40 rounded-lg p-3 space-y-3">
        <div className="flex justify-between items-center">
          <h3 className="text-empire-gold font-bold text-sm">Army</h3>
          <button
            type="button"
            onClick={cancelTacticalMode}
            className="w-8 h-8 flex items-center justify-center rounded text-empire-parchment/50 hover:text-empire-parchment hover:bg-empire-stone/20 text-lg leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <p className="text-empire-parchment/70 text-xs">
          <strong>1.</strong> Click stacks to select armies (none selected = all). <strong>2.</strong> Use the bottom bar (Move, Attack hex, Incorporate, Attack city, Defend). <strong>3.</strong> Recruit commanders below if needed. Each stack shows composition, commander, and scrolls. Then <strong>Confirm orders</strong>.
        </p>
        <p className="text-empire-parchment/50 text-[10px]">
          Selected: {tacticalSelectedStackKeys.length === 0 ? 'all armies' : `${tacticalSelectedStackKeys.length} stack(s)`}
        </p>
        <CommanderRecruitInArmyPanel />
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {humanStacks.map(({ q, r, units: stackUnits }) => {
            const stackKey = tileKey(q, r);
            const order = pendingTacticalOrders?.[stackKey];
            const isSelected = tacticalSelectedStackKeys.includes(stackKey);
            const stackIds = new Set(stackUnits.map(u => u.id));
            const counts: Record<string, number> = {};
            let status = 'idle';
            for (const u of stackUnits) {
              counts[u.type] = (counts[u.type] ?? 0) + 1;
              if (u.status === 'fighting') status = 'fighting';
              else if (u.status === 'moving' && status !== 'fighting') status = 'moving';
            }
            const compLines = Object.entries(counts)
              .map(([t, n]) => `${n}× ${UNIT_DISPLAY_NAMES[t as UnitType]}`)
              .join(' · ');
            const cmd = commanderForArmyStack(q, r, stackIds, commanders, cities);
            const scrollLbl = scrollLabelsForStack(stackIds, scrollAttachments);
            return (
              <div
                key={stackKey}
                role="button"
                tabIndex={0}
                onClick={() => toggleTacticalStack(stackKey)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleTacticalStack(stackKey); } }}
                className={`rounded border p-2 cursor-pointer select-none transition-colors ${
                  isSelected ? 'border-cyan-500/60 bg-cyan-900/20 ring-1 ring-cyan-400/40' : 'border-empire-stone/30 bg-empire-stone/10 hover:bg-empire-stone/20'
                }`}
              >
                <div className="flex justify-between items-start gap-2">
                  <div className="text-xs min-w-0 flex-1">
                    <span className="text-empire-parchment font-medium">Army — ({q}, {r})</span>
                    <span className="text-empire-parchment/50 ml-1">— {stackUnits.length} unit{stackUnits.length !== 1 ? 's' : ''}</span>
                    <div className="text-[10px] text-empire-parchment/75 mt-1 leading-snug break-words" title={compLines}>
                      <span className="text-empire-gold/80 font-semibold">Composition: </span>
                      {compLines}
                    </div>
                    {cmd && (
                      <div className="mt-1.5 flex gap-2 items-start">
                        {cmd.portraitDataUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={cmd.portraitDataUrl}
                            width={36}
                            height={36}
                            alt=""
                            className="rounded border border-violet-500/40 shrink-0"
                            style={{ imageRendering: 'pixelated' }}
                          />
                        ) : (
                          <div className="w-9 h-9 rounded bg-empire-stone/25 border border-violet-500/30 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="text-[10px] text-violet-200 font-semibold">{cmd.name}</div>
                          <div className="text-[9px] text-empire-parchment/55 leading-snug">{cmd.backstory}</div>
                          <div className="text-[9px] text-violet-300/90 mt-0.5">
                            {cmd.traitIds.map(tid => `${COMMANDER_TRAIT_INFO[tid].label} (${COMMANDER_TRAIT_INFO[tid].desc})`).join(' · ')}
                          </div>
                        </div>
                      </div>
                    )}
                    {!cmd && (
                      <p className="text-[10px] text-empire-parchment/40 mt-1">No commander assigned — recruit above or at a Barracks; attach from the hex panel.</p>
                    )}
                    {scrollLbl.length > 0 && (
                      <p className="text-[10px] text-amber-200/85 mt-1">
                        <span className="text-amber-400/90 font-semibold">Scrolls: </span>
                        {scrollLbl.join(' · ')}
                      </p>
                    )}
                    <span className={`text-[10px] block mt-1 ${status === 'fighting' ? 'text-red-400' : status === 'moving' ? 'text-green-400' : 'text-empire-parchment/50'}`}>
                      Status: {status}
                    </span>
                  </div>
                </div>
                {order && (
                  <div className="text-[10px] text-empire-gold/80 mt-1">
                    {order.type === 'defend' && order.cityId
                      ? `Defend ${friendlyCities.find(c => c.id === order.cityId)?.name ?? 'city'}`
                      : order.type === 'move' || order.type === 'intercept'
                        ? `→ (${order.toQ}, ${order.toR})`
                        : order.type === 'incorporate_village'
                          ? `Incorporate → (${order.toQ}, ${order.toR})`
                          : order.type === 'attack_city'
                            ? (() => {
                                const ec = cities.find(c => c.id === order.cityId);
                                const n1 = order.wave1UnitIds?.length ?? 0;
                                const n2 = order.wave2UnitIds?.length ?? 0;
                                const waves = n2 > 0 ? ` (W1:${n1} W2:${n2})` : ` (${n1}u)`;
                                return `Attack ${ec?.name ?? 'city'} — ${order.attackStyle}${waves}`;
                              })()
                            : ''}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {humanStacks.length === 0 && (
          <p className="text-empire-parchment/50 text-xs">No units on the map.</p>
        )}

        <div className="flex gap-2 pt-2 border-t border-empire-stone/30">
          <button
            type="button"
            onClick={confirmTacticalOrders}
            className="flex-1 px-3 py-2 text-xs font-bold rounded border border-green-500/50 bg-green-900/30 text-green-300 hover:bg-green-800/40"
          >
            Confirm orders
          </button>
          <button
            type="button"
            onClick={cancelTacticalMode}
            className="px-3 py-2 text-xs font-bold rounded border border-empire-stone/40 text-empire-parchment/80 hover:bg-empire-stone/20"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Army orders bottom bar (when Army panel is open) ──────────────

function TacticalBottomBar() {
  const pendingTacticalOrders = useGameStore(s => s.pendingTacticalOrders);
  const cities = useGameStore(s => s.cities);
  const tacticalSelectedStackKeys = useGameStore(s => s.tacticalSelectedStackKeys);
  const assigningTacticalForSelectedStacks = useGameStore(s => s.assigningTacticalForSelectedStacks);
  const startTacticalOrderForSelected = useGameStore(s => s.startTacticalOrderForSelected);
  const clearTacticalOrdersForSelected = useGameStore(s => s.clearTacticalOrdersForSelected);

  if (pendingTacticalOrders === null) return null;

  const friendlyCities = cities.filter(c => c.ownerId === 'player_human');
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
    if (ot === 'defend_pick') return `Defend: click your city center (${n} stack(s))`;
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
    <div className="fixed bottom-0 left-0 right-0 z-40 pointer-events-auto bg-empire-dark/95 border-t border-empire-gold/40 px-4 py-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-empire-gold font-bold text-sm uppercase tracking-wide shrink-0">Orders</span>
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
          {friendlyCities.length > 0 && (
            <button
              type="button"
              onClick={() => startTacticalOrderForSelected('defend_pick')}
              disabled={isAssigningDestination}
              className={`px-3 py-2 text-sm rounded border font-medium transition-colors text-blue-300 hover:bg-blue-900/40 disabled:opacity-50 disabled:cursor-not-allowed ${
                assignOt === 'defend_pick'
                  ? 'ring-2 ring-blue-300/70 border-blue-400/90 bg-blue-950/45'
                  : 'border-blue-500/50 bg-blue-900/20'
              } ${pendingOrderTypes.has('defend') ? 'border-sky-400 bg-blue-950/55 shadow-[inset_0_0_10px_rgba(56,189,248,0.2)]' : ''}`}
              title="Then click one of your cities on the map"
            >
              Defend
            </button>
          )}
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
  const getFactoryAt = useGameStore(s => s.getFactoryAt);
  const getAcademyAt = useGameStore(s => s.getAcademyAt);
  const getQuarryMineAt = useGameStore(s => s.getQuarryMineAt);
  const getJobBuildingAt = useGameStore(s => s.getJobBuildingAt);
  const getHeroAt = useGameStore(s => s.getHeroAt);
  const getTile = useGameStore(s => s.getTile);
  const isInPlayerTerritory = useGameStore(s => s.isInPlayerTerritory);
  const getCityAt = useGameStore(s => s.getCityAt);
  const hasBuildingAt = useGameStore(s => s.hasBuildingAt);
  const incorporateVillage = useGameStore(s => s.incorporateVillage);
  const getConstructionAt = useGameStore(s => s.getConstructionAt);
  const hasRoadConstructionAt = useGameStore(s => s.hasRoadConstructionAt);
  const buildRoad = useGameStore(s => s.buildRoad);
  const buildTrebuchetInField = useGameStore(s => s.buildTrebuchetInField);
  const buildScoutTowerInField = useGameStore(s => s.buildScoutTowerInField);
  const scoutTowers = useGameStore(s => s.scoutTowers);
  const defenseInstallations = useGameStore(s => s.defenseInstallations);
  const startCityDefenseTowerBuild = useGameStore(s => s.startCityDefenseTowerBuild);
  const startBuilderBuild = useGameStore(s => s.startBuilderBuild);
  const cancelBuilderBuild = useGameStore(s => s.cancelBuilderBuild);
  const confirmRoadPath = useGameStore(s => s.confirmRoadPath);
  const roadPathSelection = useGameStore(s => s.roadPathSelection);
  const isHexVisible = useGameStore(s => s.isHexVisible);
  const isHexScouted = useGameStore(s => s.isHexScouted);
  const getScoutMissionAt = useGameStore(s => s.getScoutMissionAt);
  const sendScout = useGameStore(s => s.sendScout);
  const deselectAll = useGameStore(s => s.deselectAll);
  const pendingMove = useGameStore(s => s.pendingMove);
  const specialRegions = useGameStore(s => s.specialRegions);
  const scrollSearchProgress = useGameStore(s => s.scrollSearchProgress);
  const scrollSearchClaimed = useGameStore(s => s.scrollSearchClaimed);
  const scrollInventory = useGameStore(s => s.scrollInventory);
  const scrollAttachments = useGameStore(s => s.scrollAttachments);
  const assignScrollToUnit = useGameStore(s => s.assignScrollToUnit);
  const unassignScrollFromUnit = useGameStore(s => s.unassignScrollFromUnit);
  const addNotification = useGameStore(s => s.addNotification);
  const commanders = useGameStore(s => s.commanders);
  const assignCommanderToCityDefense = useGameStore(s => s.assignCommanderToCityDefense);
  const assignCommanderToFieldAtSelectedHex = useGameStore(s => s.assignCommanderToFieldAtSelectedHex);
  const unassignCommander = useGameStore(s => s.unassignCommander);
  const openCityLogistics = useGameStore(s => s.openCityLogistics);
  const gameMode = useGameStore(s => s.gameMode);
  const [armyScrollPickKind, setArmyScrollPickKind] = useState<ScrollKind | null>(null);

  useEffect(() => {
    setArmyScrollPickKind(null);
  }, [selectedHex?.q, selectedHex?.r, pendingTacticalOrders]);

  if (pendingTacticalOrders !== null) return <TacticalPanel />;
  if (!selectedHex) return null;

  // City defenses always use the selected hex (builder must stand on that tile to build).
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
  const factoryInfo = getFactoryAt(selectedHex.q, selectedHex.r);
  const academyInfo = getAcademyAt(selectedHex.q, selectedHex.r);
  const quarryMineInfo = getQuarryMineAt(selectedHex.q, selectedHex.r);
  const jobBuildingInfo = getJobBuildingAt(selectedHex.q, selectedHex.r);
  const heroAtHex = getHeroAt(selectedHex.q, selectedHex.r);
  const inTerritory = isInPlayerTerritory(selectedHex.q, selectedHex.r);
  const hasBuilding = hasBuildingAt(selectedHex.q, selectedHex.r);
  const construction = getConstructionAt(selectedHex.q, selectedHex.r);
  const tile = getTile(selectedHex.q, selectedHex.r);
  const isVillage = tile?.hasVillage ?? false;

  // Military units at hex (not builders) — for village incorporation
  const militaryHere = allUnits.filter(
    u => u.q === selectedHex.q && u.r === selectedHex.r && u.ownerId === 'player_human' && u.hp > 0 && u.type !== 'builder'
  );

  // Can build here? In territory (city BP) OR has builder units at hex
  const buildersHere = allUnits.filter(
    u => u.q === selectedHex.q && u.r === selectedHex.r && u.ownerId === 'player_human' && u.type === 'builder' && u.hp > 0
  ).length;
  const defenseUsesMoveDestination = false;
  const canBuildHere = (inTerritory || buildersHere > 0) && !hasBuilding && !cityAtHex;

  // Compute available BP at this hex for display
  let availBP = 0;
  if (inTerritory) availBP += CITY_BUILDING_POWER;
  availBP += buildersHere * BUILDER_POWER;

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
  const hasDefenseHere = defenseInstallations.some(d => d.q === selectedHex.q && d.r === selectedHex.r);
  const canBuildTrebuchetHere =
    buildersHere > 0 &&
    !cityAtHex &&
    !construction &&
    !hasDefenseHere &&
    tile?.biome !== 'water' &&
    tile?.biome !== 'mountain';
  const canAffordTrebuchet =
    (human?.gold ?? 0) >= TREBUCHET_FIELD_GOLD_COST &&
    !!findCityForRefinedWoodSpend(
      selectedHex.q,
      selectedHex.r,
      human?.id ?? '',
      TREBUCHET_REFINED_WOOD_COST,
      cities,
      territory,
    );
  const hasScoutTowerHere = scoutTowers.some(t => t.q === selectedHex.q && t.r === selectedHex.r);
  const canBuildScoutTowerHere =
    buildersHere > 0 &&
    !cityAtHex &&
    !construction &&
    !hasScoutTowerHere &&
    !hasDefenseHere &&
    tile?.biome !== 'water' &&
    tile?.biome !== 'mountain';
  const canAffordScoutTower = (human?.gold ?? 0) >= SCOUT_TOWER_GOLD_COST;
  const cityForWall = inTerritory && human ? (() => {
    const info = territory.get(tileKey(selectedHex.q, selectedHex.r));
    if (!info || info.playerId !== human.id) return null;
    return cities.find(c => c.id === info.cityId) ?? null;
  })() : null;

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

        {cityAtHex &&
          (cityAtHex.ownerId === 'player_human' ||
            gameMode === 'bot_vs_bot' ||
            gameMode === 'bot_vs_bot_4') && (
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

        {tile?.specialRegionId && (() => {
          const reg = specialRegions.find(r => r.id === tile.specialRegionId);
          if (!reg) return null;
          const hid = human?.id ?? '';
          const claimed = hid ? (scrollSearchClaimed[reg.id] ?? []).includes(hid) : false;
          const prog = hid ? (scrollSearchProgress[reg.id]?.[hid] ?? 0) : 0;
          const progPct = Math.min(1, prog / SCROLL_SEARCH_CYCLES_REQUIRED);
          return (
            <div className="px-2 py-1.5 bg-teal-950/40 border border-teal-600/35 rounded text-xs space-y-1.5">
              <div className="font-medium text-teal-200/95">{reg.name}</div>
              <div className="text-teal-100/70 text-[10px] leading-snug">
                {claimed
                  ? 'You have claimed this region\'s scroll.'
                  : `Explore popup on select — ${Math.min(prog, SCROLL_SEARCH_CYCLES_REQUIRED)} / ${SCROLL_SEARCH_CYCLES_REQUIRED} economy cycles with units in zone.`}
              </div>
              {!claimed && (
                <div className="h-1.5 bg-empire-stone/25 rounded-full overflow-hidden border border-teal-800/25">
                  <div
                    className="h-full bg-teal-500/80 rounded-full transition-all"
                    style={{ width: `${progPct * 100}%` }}
                  />
                </div>
              )}
            </div>
          );
        })()}

        {human && militaryHere.filter(u => !isNavalUnitType(u.type)).length > 0 && (() => {
          const landArmy = militaryHere.filter(u => !isNavalUnitType(u.type));
          const landIds = new Set(landArmy.map(u => u.id));
          const inv = scrollInventory[human.id] ?? [];
          const attachmentForKind = (kind: ScrollKind) =>
            scrollAttachments.find(
              a => a.kind === kind && a.ownerId === human.id && landIds.has(a.carrierUnitId),
            );
          const firstUnitWithoutScroll = landArmy.find(
            u => !scrollAttachments.some(a => a.carrierUnitId === u.id),
          );
          const slotBonusLine = (kind: ScrollKind) => {
            switch (kind) {
              case 'combat':
                return `+${Math.round(SCROLL_COMBAT_BONUS * 100)}% attack`;
              case 'defense':
                return `+${Math.round(SCROLL_DEFENSE_BONUS * 100)}% damage reduction`;
              case 'movement':
                return `+${Math.round(SCROLL_MOVEMENT_BONUS * 100)}% movement`;
            }
          };
          const assignItemFromVault = (scrollItemId: string) => {
            if (!firstUnitWithoutScroll) {
              addNotification(
                'Every unit in this army already carries a scroll. Return one to the vault to assign another.',
                'warning',
              );
              return;
            }
            assignScrollToUnit(scrollItemId, firstUnitWithoutScroll.id);
            setArmyScrollPickKind(null);
          };
          return (
            <div className="px-2 py-1.5 bg-amber-950/30 border border-amber-700/30 rounded text-xs space-y-2">
              <div className="font-medium text-amber-200/90">Army scrolls</div>
              <p className="text-empire-parchment/60 text-[11px] leading-snug">
                This army group can equip <span className="text-empire-parchment/80">three</span> ancient scrolls—attack, defense, and movement. Each bonus applies to{' '}
                <span className="text-empire-parchment/85">the whole stack</span> at this hex (each scroll is held by one of your units).
              </p>
              <div className="grid grid-cols-1 gap-1.5">
                {SCROLL_ARMY_SLOT_ORDER.map(kind => {
                  const att = attachmentForKind(kind);
                  const isPicking = armyScrollPickKind === kind;
                  const matchingInv = inv.filter(i => i.kind === kind);
                  return (
                    <div
                      key={kind}
                      className="rounded border border-amber-800/45 bg-amber-950/25 px-2 py-1.5 space-y-1"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-100/85">
                          {SCROLL_SLOT_LABEL[kind]}
                        </span>
                        <span className="text-[9px] text-empire-parchment/40 shrink-0">
                          {slotBonusLine(kind)} · stack
                        </span>
                      </div>
                      {att ? (
                        <div className="flex flex-wrap items-center justify-between gap-1 pt-0.5">
                          <span className="text-[11px] text-amber-200/95">{SCROLL_DISPLAY_NAME[kind]}</span>
                          <button
                            type="button"
                            className="text-[10px] px-1.5 py-0.5 rounded bg-empire-stone/25 hover:bg-empire-stone/40"
                            onClick={() => unassignScrollFromUnit(att.carrierUnitId)}
                          >
                            Return
                          </button>
                        </div>
                      ) : (
                        <div className="pt-0.5 space-y-1">
                          <button
                            type="button"
                            className={`w-full min-h-[34px] rounded border border-dashed px-2 py-1 text-left transition-colors ${
                              isPicking
                                ? 'border-amber-500/55 bg-amber-900/35 text-empire-parchment/80'
                                : 'border-amber-700/35 bg-amber-950/20 text-empire-parchment/45 hover:bg-amber-900/20 hover:border-amber-600/45'
                            }`}
                            onClick={() => setArmyScrollPickKind(isPicking ? null : kind)}
                          >
                            {isPicking ? (
                              <span className="text-[11px]">Choosing from vault… (tap to cancel)</span>
                            ) : (
                              <span className="text-[11px]">Empty — tap to assign from vault</span>
                            )}
                          </button>
                          {isPicking && (
                            <div className="space-y-1 pl-0.5">
                              {matchingInv.length === 0 ? (
                                <p className="text-[10px] text-empire-parchment/45">
                                  No {SCROLL_SLOT_LABEL[kind].toLowerCase()} scroll in your vault. Discover scrolls in named regions on the map.
                                </p>
                              ) : (
                                matchingInv.map(item => (
                                  <button
                                    key={item.id}
                                    type="button"
                                    className="w-full text-left text-[10px] px-2 py-1 rounded bg-amber-900/45 hover:bg-amber-800/55 text-amber-100/90"
                                    onClick={() => assignItemFromVault(item.id)}
                                  >
                                    Assign {SCROLL_DISPLAY_NAME[item.kind]}
                                  </button>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {inv.length > 0 && (
                <p className="text-[10px] text-empire-parchment/40 pt-0.5 border-t border-amber-700/15">
                  Vault: {inv.map(i => SCROLL_DISPLAY_NAME[i.kind]).join(' · ')}
                </p>
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

        {/* Hero indicator */}
        {heroAtHex && (
          <div className="flex items-center gap-2 px-2 py-1.5 bg-yellow-900/20 border border-yellow-500/30 rounded text-xs">
            <span className="text-yellow-400">&#9733;</span>
            <span className="text-yellow-300 font-medium">{heroAtHex.name}</span>
            <span className="text-yellow-400/60">({HERO_BUFFS[heroAtHex.type].desc})</span>
          </div>
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
                  <div className="font-semibold text-violet-200">{c.name}</div>
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
                {cityAtHex?.ownerId === 'player_human' && (
                  <button
                    type="button"
                    onClick={() => assignCommanderToCityDefense(c.id, cityAtHex.id)}
                    className="px-2 py-0.5 rounded bg-violet-800/50 text-violet-100 text-[10px] hover:bg-violet-700/55"
                  >
                    Defend {cityAtHex.name}
                  </button>
                )}
                {militaryHere.length > 0 && (
                  <button
                    type="button"
                    onClick={() => assignCommanderToFieldAtSelectedHex(c.id)}
                    className="px-2 py-0.5 rounded bg-slate-800/60 text-slate-100 text-[10px] hover:bg-slate-700/55"
                  >
                    Lead stack here
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
        {construction && <ConstructionProgress site={construction} availBP={availBP} />}

        {(() => {
          const od = defenseInstallations.find(
            d => d.q === selectedHex.q && d.r === selectedHex.r && d.ownerId === 'player_human',
          );
          if (!od) return null;
          const terrH = territory.get(tileKey(selectedHex.q, selectedHex.r));
          const payC =
            terrH && terrH.playerId === 'player_human'
              ? cities.find(c => c.id === terrH.cityId)
              : undefined;
          const nextL = (od.level + 1) as DefenseTowerLevel;
          const canUp =
            od.level < 5 &&
            buildersHere > 0 &&
            payC &&
            canAffordDefenseHud(human?.gold ?? 0, payC, nextL);
          return (
            <div className="bg-rose-900/15 border border-rose-500/30 rounded px-3 py-2 space-y-1.5 text-xs">
              <div className="text-rose-300 font-bold">
                {DEFENSE_TOWER_DISPLAY_NAME[od.type]} — L{od.level}
              </div>
              <p className="text-[10px] text-empire-parchment/55">
                Mortar splashes adjacent hexes (same range as trebuchet). Archer tower and ballista shoot each combat tick (r3); ballista fires twice.
              </p>
              {od.level < 5 && (
                <button
                  type="button"
                  disabled={!canUp}
                  onClick={() =>
                    startCityDefenseTowerBuild(selectedHex.q, selectedHex.r, od.type, nextL)
                  }
                  className={`w-full text-left px-2 py-1.5 rounded border text-[11px] ${
                    canUp
                      ? 'border-rose-500/50 bg-rose-950/40 text-rose-200 hover:bg-rose-900/35'
                      : 'border-empire-stone/20 text-empire-parchment/30 cursor-not-allowed'
                  }`}
                >
                  Upgrade to L{nextL} — {formatDefenseLevelCost(nextL)}
                  {!buildersHere && od.level < 5 && (
                    <span className="block text-[10px] text-empire-parchment/45 mt-0.5">Need a builder on this hex</span>
                  )}
                </button>
              )}
            </div>
          );
        })()}

        {/* City details shown in CityModal when city hex clicked */}

        {/* Builder Build Menu: Mine, Quarry, Road — show FIRST when builder selected (before ArmyPanel) */}
        {buildersHere > 0 && !city && !cityAtHex && !barracksCity && !academyInfo && !factoryInfo && !quarryMineInfo && !construction && (
          <BuilderBuildMenu
            uiMode={uiMode}
            startBuilderBuild={startBuilderBuild}
            cancelBuilderBuild={cancelBuilderBuild}
            confirmRoadPath={confirmRoadPath}
            roadPathSelection={roadPathSelection}
            buildTrebuchetHere={() => buildTrebuchetInField(selectedHex.q, selectedHex.r)}
            canBuildTrebuchetHere={canBuildTrebuchetHere}
            canAffordTrebuchet={canAffordTrebuchet}
            buildScoutTowerHere={() => buildScoutTowerInField(selectedHex.q, selectedHex.r)}
            canBuildScoutTowerHere={canBuildScoutTowerHere}
            canAffordScoutTower={canAffordScoutTower}
            defenseHexQ={defenseHexQ}
            defenseHexR={defenseHexR}
            inTerritory={inTerritoryForDefense}
            buildersHere={buildersHere}
            hasDefenseAtHex={hasDefenseAtDefenseHex}
            hasCityAtHex={!!cityAtDefenseHex}
            tileBiome={defenseTile?.biome}
            defenseUsesMoveDestination={defenseUsesMoveDestination}
          />
        )}

        {units.length > 0 && <ArmyPanel units={units} />}

        {shipyardInfo && !city && selectedHex && (
          <ShipyardPanel city={shipyardInfo.city} shipyardQ={selectedHex.q} shipyardR={selectedHex.r} />
        )}

        {/* Barracks recruit panel — shown when clicking a barracks hex */}
        {barracksCity && !city && !academyInfo && selectedHex && <BarracksPanel city={barracksCity} barracksQ={selectedHex.q} barracksR={selectedHex.r} />}

        {/* Academy recruit panel — shown when clicking an academy hex (civilian units) */}
        {academyInfo && !city && selectedHex && <AcademyPanel city={academyInfo.city} academyQ={selectedHex.q} academyR={selectedHex.r} />}

        {/* Factory info panel — shown when clicking a factory hex */}
        {factoryInfo && !city && !barracksCity && !academyInfo && selectedHex && <FactoryPanel city={factoryInfo.city} factoryQ={selectedHex.q} factoryR={selectedHex.r} />}

        {/* Quarry / Mine worker panel — shown when clicking a quarry or mine hex */}
        {quarryMineInfo && !city && selectedHex && <QuarryMinePanel city={quarryMineInfo.city} building={quarryMineInfo.building} />}

        {/* Farm / Factory / Market worker panel — shown when clicking farm, factory, or market hex */}
        {jobBuildingInfo && !city && !barracksCity && !academyInfo && !factoryInfo && !quarryMineInfo && !shipyardInfo && selectedHex && ['farm', 'market', 'fishery', 'sawmill', 'logging_hut', 'port'].includes(jobBuildingInfo.building.type) && (
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

        {/* Build menu: available in territory OR with builders present (city buildings + single road) */}
        {!city && !cityAtHex && !barracksCity && !academyInfo && !factoryInfo && canBuildHere && !construction && uiMode === 'normal' && (
          <BuildMenu
            q={selectedHex.q}
            r={selectedHex.r}
            inTerritory={inTerritory ?? false}
            buildersHere={buildersHere}
            unitsHere={allUnitsAtHex.filter(u => u.ownerId === 'player_human').length}
            tile={tile}
            hasRoadConstructionAt={hasRoadConstructionAt}
            hasConstructionAt={(q, r) => !!getConstructionAt(q, r)}
            hasCityAt={(q, r) => !!getCityAt(q, r)}
            buildRoad={buildRoad}
            cityForWall={cityForWall ?? null}
          />
        )}

        {!city && !inTerritory && buildersHere === 0 && units.length === 0 && !enemyCity && !barracksCity && !academyInfo && !factoryInfo && !construction && (
          <p className="text-empire-parchment/40 text-xs">Outside your territory — send Builders here to construct</p>
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
              <li>Civilians consume <strong>0.5 grain per pop</strong> per cycle (cluster-wide).</li>
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
  const clusters = computeTradeClusters(cities, tiles, units, territory);
  const playerClusters = human ? clusters.get(human.id) ?? [] : [];
  const cluster = playerClusters.find(c => c.cityIds.includes(city.id));
  const clusterTotal = cluster
    ? cluster.cities.reduce(
        (acc, c) => {
          const p = computeCityProductionRate(c, tiles, territory, harvestMult);
          return { food: acc.food + p.food, guns: acc.guns + p.guns };
        },
        { food: 0, guns: 0 },
      )
    : localProd;
  const fromNetwork = {
    food: Math.max(0, clusterTotal.food - localProd.food),
    guns: Math.max(0, clusterTotal.guns - localProd.guns),
  };
  const isIsolated = cluster ? cluster.cities.length === 1 : true;

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

      <p className="text-empire-parchment/40 text-[10px]">Click Barracks for military units, Academy for builders</p>
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
  { type: 'trebuchet', maintain: '2 grain/cycle', desc: 'Siege. Range 3 vs walls/buildings.' },
  { type: 'battering_ram', maintain: '2 grain/cycle', desc: 'Siege. Melee vs walls. Low HP, defend well.' },
  { type: 'defender', maintain: '1 grain/cycle', desc: 'Tank. L3 only, iron only. High HP, damage resist.', l2BarracksOnly: true },
];

const KINGDOM_MILITARY_ROWS: MilitaryRecruitRow[] = [
  { type: 'horse_archer', maintain: '2 grain/cycle', desc: 'Mongol horse archer. Range 2, fast.', kingdomOnly: 'mongols' },
  {
    type: 'crusader_knight',
    maintain: '2 grain/cycle',
    desc: 'Crusader knight. Best infantry; high iron cost. L3 barracks.',
    kingdomOnly: 'crusaders',
    fixedLevel: 3,
    l3BarracksOnly: true,
  },
];

// ─── Academy Panel (Click academy → recruit civilian units) ────────

const CIVILIAN_RECRUIT_INFO: { type: UnitType; cost: number; maintain: string; desc: string }[] = [
  { type: 'builder',  cost: 2,  maintain: '1 grain/cycle',              desc: 'Builds outside territory. +10 BP.' },
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
  const recruitHero = useGameStore(s => s.recruitHero);
  const recruitCommander = useGameStore(s => s.recruitCommander);
  const upgradeBarracks = useGameStore(s => s.upgradeBarracks);
  const players = useGameStore(s => s.players);
  const heroes = useGameStore(s => s.heroes);
  const pendingRecruits = useGameStore(s => s.pendingRecruits);
  const units = useGameStore(s => s.units);
  const human = players.find(p => p.isHuman);
  const playerHeroes = heroes.filter(h => h.ownerId === human?.id).length;
  const pendingHeroSlots = pendingRecruits.filter(pr => 'heroKind' in pr && pr.playerId === human?.id).length;
  const leaderSlotsUsed = playerHeroes + pendingHeroSlots;
  const gold = human?.gold ?? 0;
  const cities = useGameStore(s => s.cities);
  const barracks = city.buildings.find(b => b.type === 'barracks' && b.q === barracksQ && b.r === barracksR);
  const barracksLvl = barracks?.level ?? 1;
  const totalGunsL2 = cities.filter(c => c.ownerId === human?.id).reduce((s, c) => s + (c.storage.gunsL2 ?? 0), 0);
  const humanCities = cities.filter(c => c.ownerId === human?.id);
  const totalPop = humanCities.reduce((s, c) => s + c.population, 0);
  const livingTroops = units.filter(u => u.ownerId === human?.id && u.hp > 0).length;
  const troopSlotsLeft = Math.max(0, totalPop - livingTroops);
  const playerBarracks = humanCities.reduce((sum, c) => sum + c.buildings.filter(b => b.type === 'barracks').length, 0);
  const canRecruitLeader = leaderSlotsUsed < playerBarracks;
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
    for (let i = 0; i < qty; i++) {
      recruitUnit(city.id, type, armsLevel);
    }
  };

  return (
    <div className="space-y-1.5">
      <h3 className="text-orange-400 text-xs font-semibold uppercase tracking-wide">Barracks — {city.name}</h3>
      {barracksLvl < 2 && (
        <button
          onClick={() => upgradeBarracks(city.id, barracksQ, barracksR)}
          disabled={gold < BARACKS_UPGRADE_COST}
          className="w-full px-2 py-1.5 text-xs bg-amber-900/30 border border-amber-500/40 rounded text-amber-300 hover:bg-amber-900/50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Upgrade Barracks (L2) — {BARACKS_UPGRADE_COST}g
        </button>
      )}
      {barracksLvl === 2 && (
        <button
          onClick={() => upgradeBarracks(city.id, barracksQ, barracksR)}
          disabled={gold < BARACKS_L3_UPGRADE_COST}
          className="w-full px-2 py-1.5 text-xs bg-amber-900/30 border border-amber-500/50 rounded text-amber-200 hover:bg-amber-900/50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Upgrade Barracks (L3) — {BARACKS_L3_UPGRADE_COST}g
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
          const lvl = (fixedLevel ?? getLevel(type)) as 1 | 2 | 3;
          const goldCost = lvl === 3 ? UNIT_L3_COSTS[type].gold : lvl === 2 ? UNIT_L2_COSTS[type].gold : UNIT_COSTS[type].gold;
          const stoneCost = lvl === 2 ? (UNIT_L2_COSTS[type].stone ?? 0) : 0;
          const ironCost = lvl === 3 ? (UNIT_L3_COSTS[type].iron ?? 0) : 0;
          const refinedWoodCost =
            lvl === 3 ? (UNIT_L3_COSTS[type].refinedWood ?? 0) : lvl === 2 ? (UNIT_L2_COSTS[type].refinedWood ?? 0) : (UNIT_COSTS[type].refinedWood ?? 0);
          const stats = getUnitStats({ type, armsLevel: lvl });
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
          const canAfford =
            gold >= totalGold &&
            cityStone >= totalStone &&
            cityIron >= totalIron &&
            cityRefinedWood >= totalRefinedWood &&
            livingTroops + qty <= totalPop &&
            canAffordL2Arms;
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
                ? isL3 ? 'border-amber-500/30 bg-amber-900/15 text-empire-parchment' : isL2 ? 'border-cyan-500/30 bg-cyan-900/15 text-empire-parchment' : 'border-orange-500/30 bg-orange-900/15 text-empire-parchment'
                : 'border-empire-stone/20 bg-transparent text-empire-parchment/30'
            }`}>
              <div className="flex justify-between items-center gap-2 mb-0.5">
                <span className={`font-bold text-xs ${isL3 ? 'text-amber-300' : isL2 ? 'text-cyan-300' : ''}`}>
                  {isL3 ? `L3 ` : isL2 ? `L2 ` : ''}{UNIT_DISPLAY_NAMES[type]}
                </span>
                <span className={`text-xs font-mono ${canAfford ? 'text-yellow-400' : 'text-red-400/50'}`}>{costLabel} ea</span>
              </div>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[10px] text-empire-parchment/50">{desc}</span>
                {type !== 'defender' && type !== 'crusader_knight' && (
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => setLevel(type, 1)} disabled={lvl === 1} className="w-5 h-5 rounded bg-empire-stone/30 text-empire-parchment/80 text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-empire-stone/50" aria-label="L1">−</button>
                    <span className="text-[10px] font-mono text-orange-300 w-5 text-center">L{lvl}</span>
                    <button type="button" onClick={() => setLevel(type, 2)} disabled={lvl === 2 || lvl === 3 || barracksLvl < 2} className="w-5 h-5 rounded bg-empire-stone/30 text-empire-parchment/80 text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-empire-stone/50" aria-label="L2">+</button>
                    <button type="button" onClick={() => setLevel(type, 3)} disabled={lvl === 3 || barracksLvl < 2} className="w-5 h-5 rounded bg-empire-stone/30 text-empire-parchment/80 text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-empire-stone/50" aria-label="L3">++</button>
                  </div>
                )}
                {(type === 'defender' || type === 'crusader_knight') && <span className="text-[10px] font-mono text-amber-300">L3 only</span>}
              </div>
              <div className="flex justify-between text-[10px] mt-0.5 mb-1.5">
                <span className={isL3 ? 'text-amber-300/90' : isL2 ? 'text-cyan-300/90' : 'text-empire-parchment/40'}>HP {stats.maxHp} | ATK {stats.attack} | Rng {stats.range}</span>
                <span className="text-orange-300/60">{upkeepText}</span>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={1}
                  max={maxQty}
                  value={Math.min(qty, maxQty)}
                  onChange={e => setQty(type, Number(e.target.value))}
                  className="flex-1 h-1 bg-empire-stone/30 rounded-lg appearance-none cursor-pointer accent-orange-500"
                />
                <span className="text-xs font-mono text-orange-300 w-6 text-right">{qty}</span>
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
                      ? isL3 ? 'bg-amber-600/40 text-amber-200 hover:bg-amber-600/60' : isL2 ? 'bg-cyan-600/40 text-cyan-200 hover:bg-cyan-600/60' : 'bg-orange-600/40 text-orange-200 hover:bg-orange-600/60'
                      : 'bg-empire-stone/10 text-empire-parchment/20 cursor-not-allowed'
                  }`}
                >
                  Recruit {qty}{isL3 ? ' L3' : isL2 ? ' L2' : ''}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <button onClick={() => recruitHero(city.id)}
        disabled={!canRecruitLeader || gold < 80}
        className="w-full px-2 py-1.5 text-xs bg-yellow-900/20 border border-yellow-500/30 rounded text-yellow-300 hover:bg-yellow-900/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
        &#9733; Recruit Hero (80g) — {leaderSlotsUsed}/{playerBarracks} hero slots
      </button>
      <button
        type="button"
        onClick={() => recruitCommander(city.id)}
        disabled={!canRecruitCommander}
        className="w-full px-2 py-1.5 text-xs bg-violet-950/40 border border-violet-500/35 rounded text-violet-200 hover:bg-violet-900/45 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Recruit Commander ({COMMANDER_RECRUIT_GOLD}g) — no barracks limit; ready next cycle, assign from hex panel
      </button>
    </div>
  );
}

// ─── Academy Panel (Click academy → recruit builders) ───────────────

function AcademyPanel({ city, academyQ, academyR }: { city: import('@/types/game').City; academyQ: number; academyR: number }) {
  const recruitUnit = useGameStore(s => s.recruitUnit);
  const players = useGameStore(s => s.players);
  const units = useGameStore(s => s.units);
  const cities = useGameStore(s => s.cities);
  const human = players.find(p => p.isHuman);
  const gold = human?.gold ?? 0;
  const totalPop = cities.filter(c => c.ownerId === human?.id).reduce((s, c) => s + c.population, 0);
  const livingTroops = units.filter(u => u.ownerId === human?.id && u.hp > 0).length;
  const troopSlotsLeft = Math.max(0, totalPop - livingTroops);

  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const getQty = (type: string) => quantities[type] ?? 1;
  const setQty = (type: string, val: number) => setQuantities(prev => ({ ...prev, [type]: val }));

  const handleBatchRecruit = (type: import('@/types/game').UnitType, cost: number, qty: number) => {
    for (let i = 0; i < qty; i++) {
      recruitUnit(city.id, type, 1);
    }
  };

  return (
    <div className="space-y-2">
      <h3 className="text-sky-400 text-xs font-semibold uppercase tracking-wide">University — {city.name}</h3>
      <p className="text-empire-parchment/50 text-[10px]">Troops: {livingTroops} / {totalPop} (1 per pop; pop lost when unit dies)</p>

      <div className="space-y-2">
        {CIVILIAN_RECRUIT_INFO.map(({ type, cost, maintain, desc }) => {
          const stats = UNIT_BASE_STATS[type];
          const qty = getQty(type);
          const totalCost = cost * qty;
          const maxByGold = Math.floor(gold / Math.max(1, cost));
          const maxByPop = troopSlotsLeft;
          const maxQty = Math.max(1, Math.min(maxByGold, maxByPop, 20));
          const canAfford = gold >= totalCost && livingTroops + qty <= totalPop;
          return (
            <div key={type} className={`px-3 py-2.5 rounded border transition-colors ${
              canAfford
                ? 'border-sky-500/30 bg-sky-900/15 text-empire-parchment'
                : 'border-empire-stone/20 bg-transparent text-empire-parchment/30'
            }`}>
              <div className="flex justify-between items-center mb-0.5">
                <span className="font-bold text-xs">{UNIT_DISPLAY_NAMES[type]}</span>
                <span className={`text-xs font-mono ${canAfford ? 'text-yellow-400' : 'text-red-400/50'}`}>{cost}g ea</span>
              </div>
              <div className="text-[10px] text-empire-parchment/50">{desc}</div>
              <div className="flex justify-between text-[10px] mt-1 mb-2">
                <span className="text-empire-parchment/40">HP {stats.maxHp} | ATK {stats.attack} | Rng {stats.range}</span>
                <span className="text-sky-300/60">{maintain}</span>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={1}
                  max={maxQty}
                  value={Math.min(qty, maxQty)}
                  onChange={e => setQty(type, Number(e.target.value))}
                  className="flex-1 h-1 bg-empire-stone/30 rounded-lg appearance-none cursor-pointer accent-sky-500"
                />
                <span className="text-xs font-mono text-sky-300 w-6 text-right">{qty}</span>
              </div>

              <div className="flex justify-between items-center mt-1.5">
                <span className="text-[10px] text-empire-parchment/40">
                  Total: <span className={canAfford ? 'text-yellow-400' : 'text-red-400'}>{totalCost}g</span>
                  {' + '}{qty} pop
                </span>
                <button
                  onClick={() => handleBatchRecruit(type, cost, qty)}
                  disabled={!canAfford}
                  className={`px-3 py-1 text-[10px] font-bold rounded transition-colors ${
                    canAfford
                      ? 'bg-sky-600/40 text-sky-200 hover:bg-sky-600/60'
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
  const gold = useGameStore(s => s.players.find(p => p.isHuman)?.gold ?? 0);
  const maxW = getBuildingJobs(building);
  const assigned = building.assignedWorkers ?? 0;
  const lvl = building.level ?? 1;
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
          Links your trade cluster across water to other port cities on the same sea.
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
  const maxW = getBuildingJobs(building);
  const assigned = building.assignedWorkers ?? 0;
  const staffRatio = maxW > 0 ? assigned / maxW : 0;
  const active = staffRatio > MIN_STAFFING_RATIO;
  const lvl = building.level ?? 1;
  const prod = building.type === 'quarry'
    ? (BUILDING_PRODUCTION.quarry.stone ?? 0) * lvl
    : building.type === 'gold_mine'
      ? (BUILDING_PRODUCTION.gold_mine.gold ?? 0) * lvl
      : (BUILDING_PRODUCTION.mine.iron ?? 0) * lvl;
  const effectiveProd = active ? Math.floor(prod * staffRatio) : 0;
  const staffColor = staffRatio > 0.8 ? 'text-green-400' : staffRatio > MIN_STAFFING_RATIO ? 'text-yellow-400' : 'text-red-400';
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
  return (
    <div className="space-y-2 p-2 bg-red-950/30 border border-red-500/30 rounded">
      <div className="text-center text-red-400 text-xs font-bold tracking-wider">&#9876; ACTIVE COMBAT &#9876;</div>

      <BattleSide label="YOUR FORCES" units={friendly} color="text-blue-400" />

      <div className="border-t border-red-500/20 my-1" />

      <BattleSide label="ENEMY FORCES" units={enemy} color="text-red-400" />
    </div>
  );
}

// ─── Army Panel (Stack Composition) ────────────────────────────────

function ArmyPanel({ units }: { units: import('@/types/game').Unit[] }) {
  const [showUnitList, setShowUnitList] = useState(false);
  const [splitCount, setSplitCount] = useState('');
  const setStance = useGameStore(s => s.setStance);
  const startDefendMode = useGameStore(s => s.startDefendMode);
  const startInterceptMode = useGameStore(s => s.startInterceptMode);
  const setRetreat = useGameStore(s => s.setRetreat);
  const disbandSelectedUnits = useGameStore(s => s.disbandSelectedUnits);
  const setSiegeAssault = useGameStore(s => s.setSiegeAssault);
  const startSplitStack = useGameStore(s => s.startSplitStack);
  const cancelSplitStack = useGameStore(s => s.cancelSplitStack);
  const boardAdjacentShip = useGameStore(s => s.boardAdjacentShip);
  const disembarkShip = useGameStore(s => s.disembarkShip);
  const uiMode = useGameStore(s => s.uiMode);
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
  const hasNavalCombat = units.some(u => isNavalUnitType(u.type) && UNIT_BASE_STATS[u.type].attack > 0);
  const hasCombatUnits = hasLandCombat || hasNavalCombat;
  const shipCount = counts.scout_ship + counts.warship + counts.transport_ship + counts.capital_ship;
  const soleShip = units.length === 1 && isNavalUnitType(units[0].type) ? units[0] : null;
  const canBoard = soleShip && getShipMaxCargo(soleShip.type) > 0;
  const canDisembark = soleShip && (soleShip.cargoUnitIds?.length ?? 0) > 0;
  const avgStance = units[0]?.stance ?? 'aggressive';
  const stances: ArmyStance[] = ['aggressive', 'defensive', 'passive'];
  const stanceColors: Record<ArmyStance, string> = {
    aggressive: 'text-red-400 border-red-500/40 bg-red-900/20',
    defensive: 'text-blue-400 border-blue-500/40 bg-blue-900/20',
    passive: 'text-gray-400 border-gray-500/40 bg-gray-900/20',
  };

  const isThisStackSplitting = selectedHex && splitStackPending && splitStackPending.fromQ === selectedHex.q && splitStackPending.fromR === selectedHex.r;
  const canSplit = units.length > 1;
  const defaultSplitHalf = Math.max(1, Math.floor(units.length / 2));
  const splitN = isThisStackSplitting ? splitStackPending!.count : (splitCount === '' ? defaultSplitHalf : Math.max(1, Math.min(units.length - 1, parseInt(splitCount, 10) || defaultSplitHalf)));

  return (
    <div className="space-y-2">
      {/* One-line summary: title + composition + HP */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 className="text-green-400 text-xs font-semibold shrink-0">
          {hasLandCombat ? 'ARMY' : shipCount > 0 && !hasLandCombat ? 'FLEET' : 'UNITS'} ({units.length})
        </h3>
        <div className="flex gap-1.5 text-[10px] text-empire-parchment/90 flex-wrap">
          {counts.infantry > 0 && <span>&#9876;{counts.infantry}</span>}
          {counts.cavalry > 0 && <span>&#9822;{counts.cavalry}</span>}
          {counts.ranged > 0 && <span>&#127993;{counts.ranged}</span>}
          {counts.trebuchet > 0 && <span>&#9883;{counts.trebuchet}</span>}
          {counts.battering_ram > 0 && <span>&#128737;{counts.battering_ram}</span>}
          {counts.defender > 0 && <span>Def{counts.defender}</span>}
          {counts.builder > 0 && <span>B{counts.builder}</span>}
          {counts.scout_ship > 0 && <span className="text-sky-300">Sc{counts.scout_ship}</span>}
          {counts.warship > 0 && <span className="text-sky-300">W{counts.warship}</span>}
          {counts.transport_ship > 0 && <span className="text-sky-300">T{counts.transport_ship}</span>}
          {counts.capital_ship > 0 && <span className="text-sky-300">K{counts.capital_ship}</span>}
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

      {/* Stance + actions in one compact block */}
      {hasCombatUnits && (
        <div className="space-y-1.5">
          <div className="flex gap-1">
            {stances.map(s => (
              <button key={s} onClick={() => setStance(s)}
                className={`flex-1 px-1 py-0.5 text-[10px] rounded border capitalize transition-colors ${
                  avgStance === s ? stanceColors[s] : 'border-empire-stone/20 text-empire-parchment/30'
                }`}>
                {s}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {hasLandCombat && (
              <>
                <button type="button" onClick={startDefendMode} disabled={uiMode === 'defend'}
                  className="px-1.5 py-0.5 text-[10px] rounded border border-blue-500/40 bg-blue-900/20 text-blue-300 hover:bg-blue-800/30 disabled:opacity-50">Defend</button>
                <button type="button" onClick={startInterceptMode} disabled={uiMode === 'intercept'}
                  className="px-1.5 py-0.5 text-[10px] rounded border border-amber-500/40 bg-amber-900/20 text-amber-300 hover:bg-amber-800/30 disabled:opacity-50">Intercept</button>
                <button type="button" onClick={() => setSiegeAssault(!assaulting)}
                  className={`px-1.5 py-0.5 text-[10px] rounded border ${assaulting ? 'border-red-500/60 bg-red-900/30 text-red-300' : 'border-empire-stone/40 bg-empire-stone/20 text-empire-parchment/80'}`}>Siege</button>
              </>
            )}
            <button type="button" onClick={setRetreat}
              className="px-1.5 py-0.5 text-[10px] rounded border border-amber-600/50 bg-amber-950/30 text-amber-400 hover:bg-amber-900/40">Retreat</button>
            <button type="button" onClick={disbandSelectedUnits}
              className="px-1.5 py-0.5 text-[10px] rounded border border-red-700/50 bg-red-950/30 text-red-400 hover:bg-red-900/40">Disband</button>
          </div>
          {(uiMode === 'defend' || uiMode === 'intercept') && (
            <p className="text-empire-parchment/60 text-[10px]">{uiMode === 'defend' ? 'Click a friendly city' : 'Click hex to intercept'}</p>
          )}
        </div>
      )}

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

      {/* Split stack — easy split to adjacent hex */}
      {canSplit && (
        <div className="rounded border border-empire-stone/30 bg-empire-stone/10 px-2 py-1.5 space-y-1">
          {isThisStackSplitting ? (
            <>
              <p className="text-cyan-400/90 text-[10px]">Move {splitStackPending!.count} unit(s) → click adjacent hex</p>
              <button type="button" onClick={cancelSplitStack}
                className="px-2 py-0.5 text-[10px] rounded border border-empire-stone/40 text-empire-parchment/80 hover:bg-empire-stone/20">Cancel</button>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-empire-parchment/80 text-[10px]">Split:</span>
                <input type="number" min={1} max={units.length - 1} value={splitCount || defaultSplitHalf}
                  onChange={e => setSplitCount(e.target.value === '' ? '' : e.target.value)}
                  className="w-12 px-1 py-0.5 text-[10px] rounded border border-empire-stone/40 bg-empire-dark text-empire-parchment"
                />
                <span className="text-empire-parchment/50 text-[10px]">units</span>
                <button type="button" onClick={() => startSplitStack(splitN)}
                  className="px-2 py-0.5 text-[10px] rounded border border-cyan-500/50 bg-cyan-900/20 text-cyan-300 hover:bg-cyan-800/30">Split</button>
              </div>
              <p className="text-empire-parchment/50 text-[10px]">New stack goes to adjacent hex</p>
            </>
          )}
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

      <p className="text-green-400/60 text-[10px]">Click a hex to move army there</p>
    </div>
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
      : site.type.charAt(0).toUpperCase() + site.type.slice(1);

  return (
    <div className="bg-amber-900/15 border border-amber-500/30 rounded px-3 py-2 space-y-1.5">
      <div className="flex justify-between items-center">
        <span className="text-amber-400 text-xs font-bold">BUILDING: {typeName}</span>
        <span className="text-amber-300/70 text-[10px]">{pct}%</span>
      </div>
      <div className="w-full h-1.5 bg-empire-stone/30 rounded-full overflow-hidden">
        <div className="h-full bg-amber-500/70 rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex justify-between text-[10px] text-empire-parchment/50">
        <span>BP: {Math.round(site.bpAccumulated)}/{site.bpRequired} ({availBP} avail)</span>
        <span>{etaSec < Infinity ? `~${etaSec}s left` : 'Stalled — no BP'}</span>
      </div>
    </div>
  );
}

// ─── Builder Build Menu (Mine, Quarry, Road outside territory) ───────

function BuilderBuildMenu({
  uiMode,
  startBuilderBuild,
  cancelBuilderBuild,
  confirmRoadPath,
  roadPathSelection,
  buildTrebuchetHere,
  canBuildTrebuchetHere,
  canAffordTrebuchet,
  buildScoutTowerHere,
  canBuildScoutTowerHere,
  canAffordScoutTower,
  defenseHexQ,
  defenseHexR,
  inTerritory,
  buildersHere,
  hasDefenseAtHex,
  hasCityAtHex,
  tileBiome,
  defenseUsesMoveDestination,
}: {
  uiMode: string;
  startBuilderBuild: (mode: 'mine' | 'quarry' | 'gold_mine' | 'logging_hut' | 'road') => void;
  cancelBuilderBuild: () => void;
  confirmRoadPath: () => void;
  roadPathSelection: { q: number; r: number }[];
  buildTrebuchetHere: () => void;
  canBuildTrebuchetHere: boolean;
  canAffordTrebuchet: boolean;
  buildScoutTowerHere: () => void;
  canBuildScoutTowerHere: boolean;
  canAffordScoutTower: boolean;
  defenseHexQ: number;
  defenseHexR: number;
  inTerritory: boolean;
  buildersHere: number;
  hasDefenseAtHex: boolean;
  hasCityAtHex: boolean;
  tileBiome?: Biome;
  defenseUsesMoveDestination?: boolean;
}) {
  if (uiMode === 'normal' || uiMode === 'move') {
    return (
      <div className="space-y-2">
        <h3 className="text-amber-400/90 text-xs font-semibold uppercase tracking-wide">Builder</h3>
        <p className="text-empire-parchment/50 text-[10px]">Build here or select type — deposits will highlight on map</p>
        <BuilderCityDefensesSection
          q={defenseHexQ}
          r={defenseHexR}
          inTerritory={inTerritory}
          buildersHere={buildersHere}
          hasDefenseAtHex={hasDefenseAtHex}
          hasCityAtHex={hasCityAtHex}
          tileBiome={tileBiome}
          usingMoveDestination={defenseUsesMoveDestination}
        />
        <div className="flex flex-col gap-1.5">
          {(canBuildTrebuchetHere || canBuildScoutTowerHere) && (
            <p className="text-empire-parchment/45 text-[10px] font-semibold uppercase tracking-wide pt-0.5">Siege & vision</p>
          )}
          {canBuildTrebuchetHere && (
            <button
              onClick={buildTrebuchetHere}
              disabled={!canAffordTrebuchet}
              className={`w-full text-left px-3 py-2 rounded border text-xs transition-colors ${
                canAffordTrebuchet
                  ? 'border-amber-600/40 bg-amber-900/20 text-amber-300 hover:bg-amber-900/30'
                  : 'border-empire-stone/20 bg-transparent text-empire-parchment/30 cursor-not-allowed'
              }`}
            >
              <span className="font-medium">Build Trebuchet (this hex)</span>
              <span className={canAffordTrebuchet ? 'text-amber-400/70 ml-1' : 'text-red-400/50 ml-1'}>
                — {TREBUCHET_FIELD_GOLD_COST}g, {TREBUCHET_REFINED_WOOD_COST} ref., {TREBUCHET_FIELD_BP_COST} BP (siege)
              </span>
            </button>
          )}
          {canBuildScoutTowerHere && (
            <button
              onClick={buildScoutTowerHere}
              disabled={!canAffordScoutTower}
              className={`w-full text-left px-3 py-2 rounded border text-xs transition-colors ${
                canAffordScoutTower
                  ? 'border-cyan-600/40 bg-cyan-900/20 text-cyan-300 hover:bg-cyan-900/30'
                  : 'border-empire-stone/20 bg-transparent text-empire-parchment/30 cursor-not-allowed'
              }`}
            >
              <span className="font-medium">Build Scout Tower (this hex)</span>
              <span className={canAffordScoutTower ? 'text-cyan-400/70 ml-1' : 'text-red-400/50 ml-1'}>
                — {SCOUT_TOWER_GOLD_COST}g, {SCOUT_TOWER_BP_COST} BP (vision 4)
              </span>
            </button>
          )}
          <p className="text-empire-parchment/45 text-[10px] font-semibold uppercase tracking-wide pt-0.5">Resource sites</p>
          <button
            onClick={() => startBuilderBuild('mine')}
            className="w-full text-left px-3 py-2 rounded border border-amber-600/40 bg-amber-900/20 text-amber-300 hover:bg-amber-900/30 text-xs"
          >
            <span className="font-medium">Mine</span>
            <span className="text-amber-400/70 ml-1">— +2 iron/cycle on deposit</span>
          </button>
          <button
            onClick={() => startBuilderBuild('quarry')}
            className="w-full text-left px-3 py-2 rounded border border-stone-500/40 bg-stone-900/20 text-stone-300 hover:bg-stone-900/30 text-xs"
          >
            <span className="font-medium">Quarry</span>
            <span className="text-stone-400/70 ml-1">— +5 stone/cycle on deposit</span>
          </button>
          <button
            onClick={() => startBuilderBuild('gold_mine')}
            className="w-full text-left px-3 py-2 rounded border border-yellow-600/40 bg-yellow-900/20 text-yellow-300 hover:bg-yellow-900/30 text-xs"
          >
            <span className="font-medium">Gold mine</span>
            <span className="text-yellow-400/70 ml-1">— +10 gold/cycle on mountain deposit (20 iron)</span>
          </button>
          <button
            onClick={() => startBuilderBuild('logging_hut')}
            className="w-full text-left px-3 py-2 rounded border border-emerald-600/40 bg-emerald-900/20 text-emerald-300 hover:bg-emerald-900/30 text-xs"
          >
            <span className="font-medium">Logging hut</span>
            <span className="text-emerald-400/70 ml-1">— +wood/cycle on forest</span>
          </button>
          <p className="text-empire-parchment/45 text-[10px] font-semibold uppercase tracking-wide pt-0.5">Roads</p>
          <button
            onClick={() => startBuilderBuild('road')}
            className="w-full text-left px-3 py-2 rounded border border-amber-600/40 bg-amber-900/20 text-amber-300 hover:bg-amber-900/30 text-xs"
          >
            <span className="font-medium">Road</span>
            <span className="text-amber-400/70 ml-1">— Mark path (hexes), Confirm</span>
          </button>
        </div>
      </div>
    );
  }

  if (uiMode === 'build_mine') {
    return (
      <div className="space-y-2">
        <h3 className="text-amber-400/90 text-xs font-semibold">Mine — Select Deposit</h3>
        <p className="text-empire-parchment/50 text-[10px]">Click a highlighted mine deposit. Builder will move there and start.</p>
        <button onClick={cancelBuilderBuild} className="w-full px-2 py-1.5 text-xs border border-empire-stone/40 rounded text-empire-parchment/70 hover:bg-empire-stone/20">Cancel</button>
      </div>
    );
  }

  if (uiMode === 'build_quarry') {
    return (
      <div className="space-y-2">
        <h3 className="text-stone-400/90 text-xs font-semibold">Quarry — Select Deposit</h3>
        <p className="text-empire-parchment/50 text-[10px]">Click a highlighted quarry deposit. Builder will move there and start.</p>
        <button onClick={cancelBuilderBuild} className="w-full px-2 py-1.5 text-xs border border-empire-stone/40 rounded text-empire-parchment/70 hover:bg-empire-stone/20">Cancel</button>
      </div>
    );
  }

  if (uiMode === 'build_gold_mine') {
    return (
      <div className="space-y-2">
        <h3 className="text-yellow-400/90 text-xs font-semibold">Gold mine — Select Deposit</h3>
        <p className="text-empire-parchment/50 text-[10px]">Click a highlighted gold deposit (mountains). Costs 20g + 20 iron from nearest city. Builder will move there and start.</p>
        <button onClick={cancelBuilderBuild} className="w-full px-2 py-1.5 text-xs border border-empire-stone/40 rounded text-empire-parchment/70 hover:bg-empire-stone/20">Cancel</button>
      </div>
    );
  }

  if (uiMode === 'build_road') {
    return (
      <div className="space-y-2">
        <h3 className="text-amber-400/90 text-xs font-semibold">Road — Mark Path</h3>
        <p className="text-empire-parchment/50 text-[10px]">Click hexes to add/remove from path. Confirm when done. Builders will walk to each hex; roads complete as they arrive and they auto-continue to the next.</p>
        <p className="text-amber-400/80 text-xs font-medium">{roadPathSelection.length} hex(es) selected</p>
        <div className="flex gap-2">
          <button onClick={confirmRoadPath} disabled={roadPathSelection.length === 0}
            className="flex-1 px-2 py-1.5 text-xs rounded border border-amber-500/50 bg-amber-900/30 text-amber-300 hover:bg-amber-900/50 disabled:opacity-50 disabled:cursor-not-allowed">
            Confirm
          </button>
          <button onClick={cancelBuilderBuild} className="px-2 py-1.5 text-xs border border-empire-stone/40 rounded text-empire-parchment/70 hover:bg-empire-stone/20">Cancel</button>
        </div>
      </div>
    );
  }

  return null;
}

// ─── Build Menu ────────────────────────────────────────────────────

function BuildMenu({ q, r, inTerritory, buildersHere, unitsHere, tile, hasRoadConstructionAt, hasConstructionAt, hasCityAt, buildRoad, cityForWall }: {
  q: number; r: number; inTerritory: boolean; buildersHere: number; unitsHere: number;
  tile?: { hasRoad?: boolean; hasQuarryDeposit?: boolean; hasMineDeposit?: boolean; hasWoodDeposit?: boolean; biome?: string } | undefined;
  hasRoadConstructionAt: (q: number, r: number) => boolean;
  hasConstructionAt: (q: number, r: number) => boolean;
  hasCityAt: (q: number, r: number) => boolean;
  buildRoad: (q: number, r: number) => void;
  cityForWall: import('@/types/game').City | null;
}) {
  const tiles = useGameStore(s => s.tiles);
  const coastal = hexTouchesBiome(tiles, q, r, 'water');
  const buildStructure = useGameStore(s => s.buildStructure);
  const buildTrebuchetInField = useGameStore(s => s.buildTrebuchetInField);
  const buildScoutTowerInField = useGameStore(s => s.buildScoutTowerInField);
  const scoutTowers = useGameStore(s => s.scoutTowers);
  const defenseInstallations = useGameStore(s => s.defenseInstallations);
  const buildWallRing = useGameStore(s => s.buildWallRing);
  const human = useGameStore(s => s.getHumanPlayer)();
  const allCitiesState = useGameStore(s => s.cities);
  const territoryState = useGameStore(s => s.territory);
  const humanCities = allCitiesState.filter(c => c.ownerId === human?.id);
  const totalStone = humanCities.reduce((s, c) => s + (c.storage.stone ?? 0), 0);

  let availBP = 0;
  if (inTerritory) availBP += CITY_BUILDING_POWER;
  availBP += buildersHere * BUILDER_POWER;

  const hasUnitsForDeposit = unitsHere > 0;
  const hasDefenseAtHex = defenseInstallations.some(d => d.q === q && d.r === r);
  const canBuildTrebuchetHere =
    buildersHere > 0 &&
    !hasCityAt(q, r) &&
    !hasConstructionAt(q, r) &&
    !hasDefenseAtHex &&
    tile?.biome !== 'water' &&
    tile?.biome !== 'mountain';
  const hasScoutTowerAt = scoutTowers.some(t => t.q === q && t.r === r);
  const canBuildScoutTowerHere =
    buildersHere > 0 &&
    !hasCityAt(q, r) &&
    !hasConstructionAt(q, r) &&
    !hasScoutTowerAt &&
    !hasDefenseAtHex &&
    tile?.biome !== 'water' &&
    tile?.biome !== 'mountain';
  const scoutTowerCanAfford = (human?.gold ?? 0) >= SCOUT_TOWER_GOLD_COST;

  type BuildMenuCategory = 'Food & trade' | 'Industry' | 'Recruitment' | 'Resource sites' | 'Coast & ships';
  const BUILD_MENU_CATEGORY_ORDER: BuildMenuCategory[] = [
    'Food & trade',
    'Industry',
    'Recruitment',
    'Resource sites',
    'Coast & ships',
  ];

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
        desc: `Same as farm. L1: +25 grain/cycle (2 jobs); L2: +60 (3 jobs)  (${BUILDING_BP_COST.banana_farm} BP)`,
      }]
      : [{
        category: 'Food & trade' as BuildMenuCategory,
        type: 'farm' as BuildingType,
        label: 'Farm',
        desc: `L1: +25 grain/cycle (2 jobs); L2: +60 (3 jobs)  (${BUILDING_BP_COST.farm} BP)`,
      }]),
    { category: 'Food & trade' as BuildMenuCategory, type: 'market' as BuildingType, label: 'Market', desc: `+${MARKET_GOLD_PER_CYCLE} gold/cycle (2 jobs)  (${BUILDING_BP_COST.market} BP)` },
    { category: 'Food & trade' as BuildMenuCategory, type: 'fishery' as BuildingType, label: 'Fishery', desc: `+${BUILDING_PRODUCTION.fishery.food} grain/cycle on coast (2 jobs) (${BUILDING_BP_COST.fishery} BP)`, show: coastal },
    { category: 'Industry' as BuildMenuCategory, type: 'factory' as BuildingType, label: 'Factory', desc: `+1 arms/cycle (2 jobs)  (${BUILDING_BP_COST.factory} BP)` },
    { category: 'Industry' as BuildMenuCategory, type: 'sawmill' as BuildingType, label: 'Sawmill', desc: `+${BUILDING_PRODUCTION.sawmill.refinedWood} refined wood/cycle; needs ${SAWMILL_WOOD_PER_REFINED} raw wood each (2 jobs) (${BUILDING_BP_COST.sawmill} BP)` },
    { category: 'Recruitment' as BuildMenuCategory, type: 'barracks' as BuildingType, label: 'Barracks', desc: `Recruit military units & heroes (2 jobs)  (${BUILDING_BP_COST.barracks} BP)` },
    { category: 'Recruitment' as BuildMenuCategory, type: 'academy' as BuildingType, label: 'University', desc: `Civilian recruitment (builders) (2 jobs)  (${BUILDING_BP_COST.academy} BP)` },
    { category: 'Resource sites' as BuildMenuCategory, type: 'quarry' as BuildingType, label: 'Quarry', desc: `+5 stone/cycle (2 jobs) (${BUILDING_BP_COST.quarry} BP)`, show: tile?.hasQuarryDeposit, needsUnits: true },
    { category: 'Resource sites' as BuildMenuCategory, type: 'mine' as BuildingType, label: 'Mine', desc: `+2 iron/cycle (2 jobs) (${BUILDING_BP_COST.mine} BP)`, show: tile?.hasMineDeposit, needsUnits: true },
    { category: 'Resource sites' as BuildMenuCategory, type: 'logging_hut' as BuildingType, label: 'Logging hut', desc: `+${BUILDING_PRODUCTION.logging_hut.wood} wood/cycle (2 jobs) (${BUILDING_BP_COST.logging_hut} BP)`, show: tile?.biome === 'forest', needsUnits: true },
    { category: 'Coast & ships' as BuildMenuCategory, type: 'port' as BuildingType, label: 'Port', desc: `Trade cluster link across water (1 job) (${BUILDING_BP_COST.port} BP)`, show: coastal },
    { category: 'Coast & ships' as BuildMenuCategory, type: 'shipyard' as BuildingType, label: 'Shipyard', desc: `Build ships (2 jobs) (${BUILDING_BP_COST.shipyard} BP)`, show: coastal },
  ].filter(b => b.show !== false);

  const buildingGroups = BUILD_MENU_CATEGORY_ORDER.map(title => ({
    title,
    items: buildings.filter(b => b.category === title),
  })).filter(g => g.items.length > 0);

  const canBuildRoad = buildersHere > 0 && !tile?.hasRoad && !hasRoadConstructionAt(q, r);
  const trebuchetCanAfford =
    (human?.gold ?? 0) >= TREBUCHET_FIELD_GOLD_COST &&
    !!findCityForRefinedWoodSpend(q, r, human?.id ?? '', TREBUCHET_REFINED_WOOD_COST, allCitiesState, territoryState);

  const showFieldSection = canBuildTrebuchetHere || canBuildScoutTowerHere || canBuildRoad;

  return (
    <div className="space-y-2">
      <h3 className="text-empire-parchment/60 text-xs font-semibold">BUILD</h3>
      {showFieldSection && (
        <p className="text-empire-parchment/45 text-[10px] font-semibold uppercase tracking-wide">Field</p>
      )}
      {canBuildTrebuchetHere && (
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
          <div className="text-empire-parchment/40 text-[10px]">Siege. Builder builds on this hex ({TREBUCHET_FIELD_BP_COST} BP)</div>
        </button>
      )}
      {canBuildScoutTowerHere && (
        <button
          onClick={() => buildScoutTowerInField(q, r)}
          disabled={!scoutTowerCanAfford}
          className={`w-full text-left px-3 py-2 rounded border text-xs transition-colors ${
            scoutTowerCanAfford
              ? 'border-cyan-600/40 bg-cyan-900/20 text-cyan-300 hover:bg-cyan-900/30'
              : 'border-empire-stone/20 bg-transparent text-empire-parchment/30 cursor-not-allowed'
          }`}
        >
          <div className="flex justify-between">
            <span className="font-medium">Build Scout Tower (field)</span>
            <span className={scoutTowerCanAfford ? 'text-cyan-400' : 'text-red-400/50'}>{SCOUT_TOWER_GOLD_COST}g</span>
          </div>
          <div className="text-empire-parchment/40 text-[10px]">Vision 4. Builder builds on this hex ({SCOUT_TOWER_BP_COST} BP)</div>
        </button>
      )}
      {canBuildRoad && (
        <button
          onClick={() => buildRoad(q, r)}
          className="w-full text-left px-3 py-2 rounded border border-amber-600/40 bg-amber-900/20 text-amber-300 hover:bg-amber-900/30 text-xs"
        >
          <div className="flex justify-between">
            <span className="font-medium">Build Road</span>
            <span className="text-amber-400/80">Free</span>
          </div>
          <div className="text-empire-parchment/40 text-[10px]">+50% speed; mountain pass ({ROAD_BP_COST} BP)</div>
        </button>
      )}
      {cityForWall && (
        <>
          <p className="text-empire-parchment/45 text-[10px] font-semibold uppercase tracking-wide pt-0.5">Walls</p>
          <button
            onClick={() => buildWallRing(cityForWall.id, 1)}
            disabled={totalStone < 6 * WALL_SECTION_STONE_COST}
            className={`w-full text-left px-3 py-2 rounded border text-xs transition-colors ${
              totalStone >= 6 * WALL_SECTION_STONE_COST
                ? 'border-amber-600/40 bg-amber-900/20 text-amber-300 hover:bg-amber-900/30'
                : 'border-empire-stone/20 bg-transparent text-empire-parchment/30 cursor-not-allowed'
            }`}
          >
            <div className="flex justify-between">
              <span className="font-medium">Build full wall ring 1</span>
              <span className={totalStone >= 30 ? 'text-amber-400/80' : 'text-red-400/50'}>30 stone</span>
            </div>
            <div className="text-empire-parchment/40 text-[10px]">Builds entire ring (6 sections) around {cityForWall.name} at once</div>
          </button>
          <button
            onClick={() => buildWallRing(cityForWall.id, 2)}
            disabled={totalStone < 12 * WALL_SECTION_STONE_COST}
            className={`w-full text-left px-3 py-2 rounded border text-xs transition-colors ${
              totalStone >= 12 * WALL_SECTION_STONE_COST
                ? 'border-amber-600/40 bg-amber-900/20 text-amber-300 hover:bg-amber-900/30'
                : 'border-empire-stone/20 bg-transparent text-empire-parchment/30 cursor-not-allowed'
            }`}
          >
            <div className="flex justify-between">
              <span className="font-medium">Build full wall ring 2</span>
              <span className={totalStone >= 60 ? 'text-amber-400/80' : 'text-red-400/50'}>60 stone</span>
            </div>
            <div className="text-empire-parchment/40 text-[10px]">Builds entire ring (12 sections) around {cityForWall.name} at once</div>
          </button>
        </>
      )}
      <p className="text-empire-parchment/40 text-[10px]">
        {inTerritory ? `City territory (${CITY_BUILDING_POWER} BP)` : `Outside territory`}
        {buildersHere > 0 && ` + ${buildersHere} builder${buildersHere > 1 ? 's' : ''} (+${buildersHere * BUILDER_POWER} BP)`}
        {' '}= {availBP} BP total
      </p>
      {buildingGroups.length > 0 && (
        <p className="text-empire-parchment/45 text-[10px] font-semibold uppercase tracking-wide pt-0.5">City buildings</p>
      )}
      {buildingGroups.map(({ title, items }) => (
        <div key={title} className="space-y-1.5">
          <p className="text-empire-parchment/50 text-[10px] font-medium">{title}</p>
          {items.map(b => {
            const cost = BUILDING_COSTS[b.type];
            const canAfford = (human?.gold ?? 0) >= cost;
            const blocked = b.needsUnits && !hasUnitsForDeposit;
            const enabled = canAfford && !blocked;
            const bpCost = BUILDING_BP_COST[b.type];
            const bpPerSec = availBP / BP_RATE_BASE;
            const buildTime = bpPerSec > 0 ? Math.ceil(bpCost / bpPerSec) : Infinity;
            return (
              <button key={b.type} onClick={() => buildStructure(b.type, q, r)}
                disabled={!enabled}
                className={`w-full text-left px-3 py-2 rounded border text-xs transition-colors ${
                  enabled
                    ? 'border-empire-stone/40 bg-empire-stone/10 hover:bg-empire-stone/20 text-empire-parchment'
                    : 'border-empire-stone/20 bg-transparent text-empire-parchment/30 cursor-not-allowed'
                }`}>
                <div className="flex justify-between">
                  <span className="font-medium">{b.label}</span>
                  <span className={enabled ? 'text-yellow-400' : 'text-red-400/50'}>{cost}g</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-empire-parchment/40">{b.desc}</span>
                  <span className="text-empire-parchment/30 text-[10px]">~{buildTime < Infinity ? `${buildTime}s` : '---'}</span>
                </div>
                {blocked && <p className="text-red-400/60 text-[10px] mt-0.5">Move units here first</p>}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ─── Supply Cluster Side Panel (income statement when cluster selected) ───

function SupplyClusterSidePanel() {
  const phase = useGameStore(s => s.phase);
  const supplyViewTab = useGameStore(s => s.supplyViewTab);
  const selectedClusterKey = useGameStore(s => s.selectedClusterKey);
  const getClusterIncomeStatement = useGameStore(s => s.getClusterIncomeStatement);
  const getSupplyClustersWithPaths = useGameStore(s => s.getSupplyClustersWithPaths);
  const setSelectedClusterKey = useGameStore(s => s.setSelectedClusterKey);

  if (phase !== 'playing' || supplyViewTab !== 'supply' || !selectedClusterKey) return null;

  const entry = getSupplyClustersWithPaths().find(e => e.clusterKey === selectedClusterKey);
  const stmt = getClusterIncomeStatement(selectedClusterKey);

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
              <h3 className="text-sm font-semibold text-empire-gold tracking-wide">Cluster</h3>
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
            {stmt.foodSurplus ? 'Food surplus — cluster healthy' : 'Food deficit — cluster at risk'}
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
    <div className="absolute bottom-2 left-2 w-80 space-y-1 pointer-events-none">
      {notifications.slice(-5).map(n => (
        <div key={n.id}
          className={`text-xs px-3 py-1.5 bg-empire-dark/85 backdrop-blur-sm rounded border-l-2 ${typeColors[n.type] ?? typeColors.info}`}>
          <span className="text-empire-parchment/40 mr-1">C{n.turn}</span>
          {n.message}
        </div>
      ))}
    </div>
  );
}
