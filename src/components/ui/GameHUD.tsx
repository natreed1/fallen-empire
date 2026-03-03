'use client';

import { useState, useEffect } from 'react';
import { useGameStore } from '@/store/useGameStore';
import { computeTradeClusters, getCapitalCluster, getSupplyingClusterKey } from '@/lib/logistics';
import { computeCityProductionRate } from '@/lib/gameLoop';
import { getWeatherHarvestMultiplier } from '@/lib/weather';
import { BUILDING_COSTS, BUILDING_PRODUCTION, BUILDING_BP_COST, BUILDING_JOBS, CITY_BUILDING_POWER, BUILDER_POWER, BP_RATE_BASE, TERRAIN_FOOD_YIELD, UNIT_COSTS, UNIT_BASE_STATS, UNIT_L2_STATS, UNIT_DISPLAY_NAMES, HERO_BUFFS, VILLAGE_INCORPORATE_COST, MARKET_GOLD_PER_CYCLE, SCOUT_MISSION_COST, WEATHER_DISPLAY, BARACKS_UPGRADE_COST, FACTORY_UPGRADE_COST, FARM_UPGRADE_COST, FARM_L2_FOOD_PER_CYCLE, WALL_SECTION_STONE_COST, WORKERS_PER_LEVEL, MIN_STAFFING_RATIO, ROAD_BP_COST, TREBUCHET_FIELD_BP_COST, TREBUCHET_FIELD_GOLD_COST, getBuildingJobs, BuildingType, UnitType, ArmyStance, Biome, hexDistance, tileKey, POP_BIRTH_RATE, POP_NATURAL_DEATHS, POP_CARRYING_CAPACITY_PER_FOOD, POP_EXPECTED_K_ALPHA, STARVATION_DEATHS } from '@/types/game';
import Image from 'next/image';
import Link from 'next/link';

export default function GameHUD() {
  const phase = useGameStore(s => s.phase);
  return (
    <div className="absolute inset-0 pointer-events-none z-10">
      {phase === 'setup' && <SetupScreen />}
      {phase === 'place_city' && <PlaceCityOverlay />}
      {phase === 'playing' && <PlayingHUD />}
      {phase === 'victory' && <VictoryScreen />}
    </div>
  );
}

// ─── Setup ─────────────────────────────────────────────────────────

function SetupScreen() {
  const startPlacement = useGameStore(s => s.startPlacement);
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/60 pointer-events-auto">
      <div className="bg-empire-dark border border-empire-gold/40 rounded-xl p-8 text-center max-w-md">
        <h1 className="text-3xl font-bold text-empire-gold tracking-widest mb-4">FALLEN EMPIRE</h1>
        <p className="text-empire-parchment/70 mb-2 leading-relaxed">
          The old empire has crumbled. Rebuild — or be conquered.
        </p>
        <p className="text-empire-parchment/50 text-sm mb-6">
          Real-time strategy. 35-minute match. Economy cycles every 30s.
          <br />Draft soldiers from your population. Armies stack on hexes.
        </p>
        <div className="flex flex-col gap-3">
          <button onClick={startPlacement}
            className="px-8 py-3 bg-empire-gold/20 border border-empire-gold/60 rounded-lg text-empire-gold font-bold tracking-wide hover:bg-empire-gold/30 transition-colors">
            PLAY (You vs AI)
          </button>
          <button
            type="button"
            onClick={() => useGameStore.getState().startBotVsBot()}
            className="px-8 py-3 bg-empire-dark border border-empire-gold/40 rounded-lg text-empire-parchment font-medium tracking-wide hover:bg-empire-gold/10 transition-colors"
          >
            Watch Bot vs Bot
          </button>
          <p className="text-empire-parchment/40 text-xs">
            Bot vs Bot: two AIs fight using full features (economy, siege, scouts, villages, L2 units).
          </p>
        </div>
      </div>
    </div>
  );
}

function PlaceCityOverlay() {
  const pendingCityHex = useGameStore(s => s.pendingCityHex);
  const confirmCityPlacement = useGameStore(s => s.confirmCityPlacement);
  const cancelCityPlacement = useGameStore(s => s.cancelCityPlacement);
  const getTile = useGameStore(s => s.getTile);

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
  return (
    <>
      <TopBar />
      <WeatherOverlay />
      <CityModal />
      <SidePanel />
      <SupplyClusterSidePanel />
      <SupplyViewPanel />
      <MoveConfirmPopup />
      <NotificationLog />
    </>
  );
}

// ─── City Modal (opens when clicking city hex) ────────────────────────

function CityModal() {
  const getSelectedCity = useGameStore(s => s.getSelectedCity);
  const deselectAll = useGameStore(s => s.deselectAll);
  const city = getSelectedCity();
  if (!city) return null;

  return (
    <div
      className="absolute inset-0 flex items-center justify-center bg-black/60 pointer-events-auto z-20"
      onClick={e => { if (e.target === e.currentTarget) deselectAll(); }}
    >
      <div
        className="bg-empire-dark/95 border border-empire-gold/50 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <CityModalContent city={city} onClose={deselectAll} />
      </div>
    </div>
  );
}

function CityModalContent({ city, onClose }: { city: import('@/types/game').City; onClose: () => void }) {
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
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold text-empire-gold">{city.name}</h2>
        <button onClick={onClose} className="text-empire-parchment/50 hover:text-empire-parchment text-lg leading-none">×</button>
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
  const human = players.find(p => p.isHuman);
  const humanCities = cities.filter(c => c.ownerId === human?.id);

  const clusters = computeTradeClusters(cities, tiles, units, territory);
  const humanClusters = human ? clusters.get(human.id) ?? [] : [];
  // Show resources from ALL human cities — isolated cities' production was hidden when using capital cluster only
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
  const totalGunsL2 = citiesForResources.reduce((s, c) => s + (c.storage.gunsL2 ?? 0), 0);
  const totalUnits = units.filter(u => u.ownerId === human?.id && u.hp > 0).length;

  const harvestMult = getWeatherHarvestMultiplier(activeWeather);
  let grainPerCycle = 0;
  let armsPerCycle = 0;
  let stonePerCycle = 0;
  let ironPerCycle = 0;
  let goldPerCycle = 0;
  for (const city of citiesForResources) {
    const prod = computeCityProductionRate(city, tiles, territory, harvestMult);
    grainPerCycle += prod.food;
    armsPerCycle += prod.guns;
    stonePerCycle += prod.stone;
    ironPerCycle += prod.iron;
    const taxRate = human?.taxRate ?? 0.3;
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
  const humanUnits = units.filter(u => u.ownerId === human?.id && u.hp > 0);
  const unitsByCluster = new Map<string | null, typeof humanUnits>();
  for (const u of humanUnits) {
    const key = getSupplyingClusterKey(u, humanClusters, tiles, units, human?.id ?? '');
    if (!unitsByCluster.has(key ?? null)) unitsByCluster.set(key ?? null, []);
    unitsByCluster.get(key ?? null)!.push(u);
  }
  for (const [clusterKey, clusterUnits] of unitsByCluster) {
    if (clusterKey === null) continue; // unsupplied: no upkeep deducted
    let foodD = 0, gunD = 0;
    for (const u of clusterUnits) {
      const stats = u.armsLevel === 2 ? UNIT_L2_STATS[u.type] : UNIT_BASE_STATS[u.type];
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
          <span className="text-yellow-400 font-bold text-xs">{human?.gold ?? 0}</span>
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
      </div>

      <div className="flex items-center gap-3">
        <Link
          href="/workflow"
          className="text-[10px] text-empire-parchment/60 hover:text-empire-gold uppercase transition-colors"
          title="Notes, ideas & backlog"
        >
          Workflow
        </Link>
        {uiMode === 'move' && (
          <span className="text-xs text-green-400 bg-green-400/10 px-2 py-1 rounded">MOVE — Click destination</span>
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

// ─── Side Panel ────────────────────────────────────────────────────

function SidePanel() {
  const selectedHex = useGameStore(s => s.selectedHex);
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
  const startBuilderBuild = useGameStore(s => s.startBuilderBuild);
  const cancelBuilderBuild = useGameStore(s => s.cancelBuilderBuild);
  const confirmRoadPath = useGameStore(s => s.confirmRoadPath);
  const roadPathSelection = useGameStore(s => s.roadPathSelection);
  const isHexVisible = useGameStore(s => s.isHexVisible);
  const isHexScouted = useGameStore(s => s.isHexScouted);
  const getScoutMissionAt = useGameStore(s => s.getScoutMissionAt);
  const sendScout = useGameStore(s => s.sendScout);
  const deselectAll = useGameStore(s => s.deselectAll);

  if (!selectedHex) return null;

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
  const canBuildTrebuchetHere = buildersHere > 0 && !cityAtHex && !construction && tile?.biome !== 'water' && tile?.biome !== 'mountain';
  const canAffordTrebuchet = (human?.gold ?? 0) >= TREBUCHET_FIELD_GOLD_COST;
  const cityForWall = inTerritory && human ? (() => {
    const info = territory.get(tileKey(selectedHex.q, selectedHex.r));
    if (!info || info.playerId !== human.id) return null;
    return cities.find(c => c.id === info.cityId) ?? null;
  })() : null;

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
              {tile.hasGoldMineDeposit && <span>Gold deposit</span>}
              {tile.hasAncientCity && <span>Ancient city</span>}
              {!tile.hasRoad && !tile.hasRuins && !tile.hasVillage && !tile.isProvinceCenter && !tile.hasQuarryDeposit && !tile.hasMineDeposit && !tile.hasGoldMineDeposit && !tile.hasAncientCity && (
                <span className="text-empire-parchment/40">—</span>
              )}
            </div>
          </div>
        )}

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
          />
        )}

        {units.length > 0 && <ArmyPanel units={units} />}

        {/* Barracks recruit panel — shown when clicking a barracks hex */}
        {barracksCity && !city && !academyInfo && selectedHex && <BarracksPanel city={barracksCity} barracksQ={selectedHex.q} barracksR={selectedHex.r} />}

        {/* Academy recruit panel — shown when clicking an academy hex (civilian units) */}
        {academyInfo && !city && selectedHex && <AcademyPanel city={academyInfo.city} academyQ={selectedHex.q} academyR={selectedHex.r} />}

        {/* Factory info panel — shown when clicking a factory hex */}
        {factoryInfo && !city && !barracksCity && !academyInfo && selectedHex && <FactoryPanel city={factoryInfo.city} factoryQ={selectedHex.q} factoryR={selectedHex.r} />}

        {/* Quarry / Mine worker panel — shown when clicking a quarry or mine hex */}
        {quarryMineInfo && !city && selectedHex && <QuarryMinePanel city={quarryMineInfo.city} building={quarryMineInfo.building} />}

        {/* Farm / Factory / Market worker panel — shown when clicking farm, factory, or market hex */}
        {jobBuildingInfo && !city && !barracksCity && !academyInfo && !factoryInfo && !quarryMineInfo && selectedHex && ['farm', 'market'].includes(jobBuildingInfo.building.type) && (
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

const MILITARY_RECRUIT_INFO: { type: UnitType; cost: number; maintain: string; desc: string }[] = [
  { type: 'infantry', cost: 1,  maintain: '1 grain/cycle',   desc: 'Melee. Cheap and sturdy.' },
  { type: 'cavalry',  cost: 3,  maintain: '2 grain/cycle',   desc: 'Fast melee. 1.5x speed.' },
  { type: 'ranged',   cost: 2,  maintain: '1 grain/cycle',  desc: 'Archer. Attacks from 2 hex.' },
  { type: 'trebuchet', cost: 8, maintain: '2 grain/cycle',  desc: 'Siege. Range 3 vs walls/buildings.' },
  { type: 'battering_ram', cost: 6, maintain: '2 grain/cycle', desc: 'Siege. Melee vs walls. Low HP, defend well.' },
];

// ─── Academy Panel (Click academy → recruit civilian units) ────────

const CIVILIAN_RECRUIT_INFO: { type: UnitType; cost: number; maintain: string; desc: string }[] = [
  { type: 'builder',  cost: 2,  maintain: '1 grain/cycle',              desc: 'Builds outside territory. +10 BP.' },
];

function BarracksPanel({ city, barracksQ, barracksR }: { city: import('@/types/game').City; barracksQ: number; barracksR: number }) {
  const recruitUnit = useGameStore(s => s.recruitUnit);
  const recruitHero = useGameStore(s => s.recruitHero);
  const upgradeBarracks = useGameStore(s => s.upgradeBarracks);
  const players = useGameStore(s => s.players);
  const heroes = useGameStore(s => s.heroes);
  const units = useGameStore(s => s.units);
  const human = players.find(p => p.isHuman);
  const playerHeroes = heroes.filter(h => h.ownerId === human?.id).length;
  const gold = human?.gold ?? 0;
  const cities = useGameStore(s => s.cities);
  const barracks = city.buildings.find(b => b.type === 'barracks' && b.q === barracksQ && b.r === barracksR);
  const barracksLvl = barracks?.level ?? 1;
  const totalGunsL2 = cities.filter(c => c.ownerId === human?.id).reduce((s, c) => s + (c.storage.gunsL2 ?? 0), 0);
  const humanCities = cities.filter(c => c.ownerId === human?.id);
  const totalPop = humanCities.reduce((s, c) => s + c.population, 0);
  const livingTroops = units.filter(u => u.ownerId === human?.id && u.hp > 0).length;
  const troopSlotsLeft = Math.max(0, totalPop - livingTroops);

  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [levels, setLevels] = useState<Record<string, 1 | 2>>({});
  const getQty = (type: string) => quantities[type] ?? 1;
  const setQty = (type: string, val: number) => setQuantities(prev => ({ ...prev, [type]: val }));
  const getLevel = (type: string): 1 | 2 => {
    const l = levels[type] ?? 1;
    return barracksLvl >= 2 ? (l as 1 | 2) : 1;
  };
  const setLevel = (type: string, l: 1 | 2) => setLevels(prev => ({ ...prev, [type]: l }));

  const handleBatchRecruit = (type: import('@/types/game').UnitType, cost: number, qty: number, armsLevel: 1 | 2) => {
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
      <p className="text-empire-parchment/50 text-[10px]">Troops: {livingTroops} / {totalPop} (1 per pop; pop lost when unit dies)</p>

      <div className="space-y-1.5">
        {MILITARY_RECRUIT_INFO.map(({ type, cost, maintain, desc }) => {
          const lvl = getLevel(type);
          const stats = lvl === 2 ? UNIT_L2_STATS[type] : UNIT_BASE_STATS[type];
          const gunL2Upkeep = lvl === 2 ? ((UNIT_L2_STATS[type] as { gunL2Upkeep?: number }).gunL2Upkeep ?? 0) : 0;
          const upkeepText = lvl === 2
            ? `L2 arms. +${gunL2Upkeep} L2 arms/cycle`
            : maintain;
          const qty = getQty(type);
          const totalCost = cost * qty;
          const maxByGold = Math.floor(gold / Math.max(1, cost));
          const maxByPop = troopSlotsLeft;
          const maxQty = Math.max(1, Math.min(maxByGold, maxByPop, 20));
          const canAffordL2 = gunL2Upkeep === 0 || totalGunsL2 >= gunL2Upkeep * qty;
          const canAfford = gold >= totalCost && livingTroops + qty <= totalPop && (lvl === 1 || canAffordL2);
          const isL2 = lvl === 2;
          return (
            <div key={type} className={`px-2.5 py-2 rounded border transition-colors ${
              canAfford
                ? isL2 ? 'border-cyan-500/30 bg-cyan-900/15 text-empire-parchment' : 'border-orange-500/30 bg-orange-900/15 text-empire-parchment'
                : 'border-empire-stone/20 bg-transparent text-empire-parchment/30'
            }`}>
              <div className="flex justify-between items-center gap-2 mb-0.5">
                <span className={`font-bold text-xs ${isL2 ? 'text-cyan-300' : ''}`}>
                  {isL2 ? `L2 ` : ''}{UNIT_DISPLAY_NAMES[type]}
                </span>
                <span className={`text-xs font-mono ${canAfford ? 'text-yellow-400' : 'text-red-400/50'}`}>{cost}g ea</span>
              </div>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[10px] text-empire-parchment/50">{desc}</span>
                {/* Level: minus / level / plus */}
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setLevel(type, 1)}
                    disabled={lvl === 1}
                    className="w-5 h-5 rounded bg-empire-stone/30 text-empire-parchment/80 text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-empire-stone/50"
                    aria-label="Level down"
                  >
                    −
                  </button>
                  <span className="text-[10px] font-mono text-orange-300 w-5 text-center">L{lvl}</span>
                  <button
                    type="button"
                    onClick={() => setLevel(type, 2)}
                    disabled={lvl === 2 || barracksLvl < 2}
                    className="w-5 h-5 rounded bg-empire-stone/30 text-empire-parchment/80 text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-empire-stone/50"
                    aria-label="Level up"
                  >
                    +
                  </button>
                </div>
              </div>
              <div className="flex justify-between text-[10px] mt-0.5 mb-1.5">
                <span className={isL2 ? 'text-cyan-300/90' : 'text-empire-parchment/40'}>HP {stats.maxHp} | ATK {stats.attack} | Rng {stats.range}</span>
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
                  Total: <span className={canAfford ? 'text-yellow-400' : 'text-red-400'}>{totalCost}g</span>
                  {' + '}{qty} pop
                </span>
                <button
                  onClick={() => handleBatchRecruit(type, cost, qty, lvl)}
                  disabled={!canAfford}
                  className={`px-2.5 py-1 text-[10px] font-bold rounded transition-colors ${
                    canAfford
                      ? isL2 ? 'bg-cyan-600/40 text-cyan-200 hover:bg-cyan-600/60' : 'bg-orange-600/40 text-orange-200 hover:bg-orange-600/60'
                      : 'bg-empire-stone/10 text-empire-parchment/20 cursor-not-allowed'
                  }`}
                >
                  Recruit {qty}{isL2 ? ' L2' : ''}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <button onClick={() => recruitHero(city.id)}
        className="w-full px-2 py-1.5 text-xs bg-yellow-900/20 border border-yellow-500/30 rounded text-yellow-300 hover:bg-yellow-900/40 transition-colors">
        &#9733; Recruit Hero (80g) — {playerHeroes} active
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
      <h3 className="text-sky-400 text-xs font-semibold uppercase tracking-wide">Academy — {city.name}</h3>
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
  const isFarm = building.type === 'farm';
  const farmFoodPerCycle = isFarm ? (lvl >= 2 ? FARM_L2_FOOD_PER_CYCLE : (BUILDING_PRODUCTION.farm.food ?? 0) * lvl) : 0;
  const label = building.type.charAt(0).toUpperCase() + building.type.slice(1);
  const titleLabel = isFarm ? `Farm L${lvl}` : label;

  return (
    <div className="space-y-2">
      <h3 className="text-empire-gold/90 text-xs font-semibold uppercase tracking-wide">{titleLabel} — {city.name}</h3>
      {isFarm && (
        <div className="flex justify-between text-xs">
          <span className="text-empire-parchment/50">Production</span>
          <span className="text-cyan-300">+{farmFoodPerCycle} grain/cycle</span>
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
          Upgrade Farm (L2) — {FARM_UPGRADE_COST}g
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
  const setStance = useGameStore(s => s.setStance);
  const startDefendMode = useGameStore(s => s.startDefendMode);
  const startInterceptMode = useGameStore(s => s.startInterceptMode);
  const setRetreat = useGameStore(s => s.setRetreat);
  const disbandSelectedUnits = useGameStore(s => s.disbandSelectedUnits);
  const setSiegeAssault = useGameStore(s => s.setSiegeAssault);
  const uiMode = useGameStore(s => s.uiMode);
  const cities = useGameStore(s => s.cities);

  const counts: Record<UnitType, number> = { infantry: 0, cavalry: 0, ranged: 0, builder: 0, trebuchet: 0, battering_ram: 0 };
  let totalHp = 0, totalMaxHp = 0;
  let defendingCity: string | null = null;
  let retreating = false;
  let assaulting = false;
  for (const u of units) {
    counts[u.type] = (counts[u.type] ?? 0) + 1;
    totalHp += u.hp;
    totalMaxHp += u.maxHp;
    if (u.defendCityId) defendingCity = u.defendCityId;
    if (u.retreatAt) retreating = true;
    if (u.assaulting) assaulting = true;
  }
  const defendCityName = defendingCity ? cities.find(c => c.id === defendingCity)?.name : null;

  const hasCombatUnits = counts.infantry > 0 || counts.cavalry > 0 || counts.ranged > 0 || counts.trebuchet > 0 || counts.battering_ram > 0;
  const avgStance = units[0]?.stance ?? 'aggressive';
  const stances: ArmyStance[] = ['aggressive', 'defensive', 'passive'];
  const stanceColors: Record<ArmyStance, string> = {
    aggressive: 'text-red-400 border-red-500/40 bg-red-900/20',
    defensive: 'text-blue-400 border-blue-500/40 bg-blue-900/20',
    passive: 'text-gray-400 border-gray-500/40 bg-gray-900/20',
  };

  return (
    <div className="space-y-2">
      <h3 className="text-green-400 text-xs font-semibold">{hasCombatUnits ? 'ARMY' : 'UNITS'} ({units.length})</h3>

      {/* Siege status (design §41–44) */}
      {(defendCityName || retreating || assaulting) && (
        <div className="text-[10px] space-y-0.5 px-2 py-1.5 bg-empire-stone/20 rounded border border-empire-stone/30">
          {defendCityName && <div className="text-blue-400">Defending {defendCityName}</div>}
          {retreating && <div className="text-amber-400">Retreating (2s delay)</div>}
          {assaulting && <div className="text-red-400">Siege: Assault (attack debuff)</div>}
        </div>
      )}

      {/* Composition */}
      <div className="flex gap-2 text-xs flex-wrap">
        {counts.infantry > 0 && <span className="text-empire-parchment">&#9876; {counts.infantry} Inf</span>}
        {counts.cavalry > 0 && <span className="text-empire-parchment">&#9822; {counts.cavalry} Cav</span>}
        {counts.ranged > 0 && <span className="text-empire-parchment">&#127993; {counts.ranged} Rng</span>}
        {counts.trebuchet > 0 && <span className="text-empire-parchment">&#9883; {counts.trebuchet} Treb</span>}
        {counts.battering_ram > 0 && <span className="text-empire-parchment">&#128737; {counts.battering_ram} Ram</span>}
      </div>

      {/* HP bar */}
      <div className="flex items-center gap-2 text-xs">
        <span className="text-empire-parchment/50">HP</span>
        <div className="flex-1 h-1.5 bg-empire-stone/30 rounded-full overflow-hidden">
          <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${totalMaxHp ? (totalHp / totalMaxHp) * 100 : 0}%` }} />
        </div>
        <span className="text-empire-parchment text-[10px]">{totalHp}/{totalMaxHp}</span>
      </div>

      {/* Stance toggle — only for combat units */}
      {hasCombatUnits && (
        <div>
          <label className="text-xs text-empire-parchment/50 block mb-1">Stance</label>
          <div className="flex gap-1">
            {stances.map(s => (
              <button key={s} onClick={() => setStance(s)}
                className={`flex-1 px-1 py-1 text-[10px] rounded border capitalize transition-colors ${
                  avgStance === s ? stanceColors[s] : 'border-empire-stone/20 text-empire-parchment/30'
                }`}>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Defend, Intercept, Retreat, Disband, Siege (design §2, 3, 34, 41–44) */}
      {hasCombatUnits && (
        <div className="space-y-1">
          <div className="flex flex-wrap gap-1">
            <button type="button" onClick={startDefendMode} disabled={uiMode === 'defend'}
              className="px-2 py-1 text-[10px] rounded border border-blue-500/40 bg-blue-900/20 text-blue-300 hover:bg-blue-800/30 disabled:opacity-50">
              Defend
            </button>
            <button type="button" onClick={startInterceptMode} disabled={uiMode === 'intercept'}
              className="px-2 py-1 text-[10px] rounded border border-amber-500/40 bg-amber-900/20 text-amber-300 hover:bg-amber-800/30 disabled:opacity-50">
              Intercept
            </button>
            <button type="button" onClick={setRetreat}
              className="px-2 py-1 text-[10px] rounded border border-amber-600/50 bg-amber-950/30 text-amber-400 hover:bg-amber-900/40">
              Retreat
            </button>
            <button type="button" onClick={() => setSiegeAssault(!assaulting)}
              className={`px-2 py-1 text-[10px] rounded border ${assaulting ? 'border-red-500/60 bg-red-900/30 text-red-300' : 'border-empire-stone/40 bg-empire-stone/20 text-empire-parchment/80'}`}>
              Siege {assaulting ? '(Assault)' : ''}
            </button>
            <button type="button" onClick={disbandSelectedUnits}
              className="px-2 py-1 text-[10px] rounded border border-red-700/50 bg-red-950/30 text-red-400 hover:bg-red-900/40">
              Disband
            </button>
          </div>
          {(uiMode === 'defend' || uiMode === 'intercept') && (
            <p className="text-empire-parchment/60 text-[10px]">
              {uiMode === 'defend' ? 'Click a friendly city to defend' : 'Click hex to intercept'}
            </p>
          )}
        </div>
      )}

      {/* Individual units */}
      <div className="space-y-0.5 max-h-32 overflow-y-auto">
        {units.map(u => (
          <div key={u.id} className="flex items-center justify-between text-[10px]">
            <span className="text-empire-parchment capitalize">
              {u.type} {u.level > 0 && <span className="text-yellow-400">Lv{u.level}</span>}
            </span>
            <div className="flex gap-2">
              <span className={u.hp < u.maxHp * 0.3 ? 'text-red-400' : 'text-red-300'}>HP {u.hp}/{u.maxHp}</span>
              <span className="text-purple-300">XP {u.xp}</span>
              <span className={`${
                u.status === 'fighting' ? 'text-red-400' :
                u.status === 'moving' ? 'text-green-400' :
                u.status === 'starving' ? 'text-orange-400' :
                'text-gray-400'
              }`}>{u.status}</span>
            </div>
          </div>
        ))}
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
  const typeName = site.type.charAt(0).toUpperCase() + site.type.slice(1);

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
}: {
  uiMode: string;
  startBuilderBuild: (mode: 'mine' | 'quarry' | 'gold_mine' | 'road') => void;
  cancelBuilderBuild: () => void;
  confirmRoadPath: () => void;
  roadPathSelection: { q: number; r: number }[];
  buildTrebuchetHere: () => void;
  canBuildTrebuchetHere: boolean;
  canAffordTrebuchet: boolean;
}) {
  if (uiMode === 'normal' || uiMode === 'move') {
    return (
      <div className="space-y-2">
        <h3 className="text-amber-400/90 text-xs font-semibold uppercase tracking-wide">Builder</h3>
        <p className="text-empire-parchment/50 text-[10px]">Build here or select type — deposits will highlight on map</p>
        <div className="flex flex-col gap-1.5">
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
                — {TREBUCHET_FIELD_GOLD_COST}g, {TREBUCHET_FIELD_BP_COST} BP (siege)
              </span>
            </button>
          )}
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
  tile?: { hasRoad?: boolean; hasQuarryDeposit?: boolean; hasMineDeposit?: boolean; biome?: string } | undefined;
  hasRoadConstructionAt: (q: number, r: number) => boolean;
  hasConstructionAt: (q: number, r: number) => boolean;
  hasCityAt: (q: number, r: number) => boolean;
  buildRoad: (q: number, r: number) => void;
  cityForWall: import('@/types/game').City | null;
}) {
  const buildStructure = useGameStore(s => s.buildStructure);
  const buildTrebuchetInField = useGameStore(s => s.buildTrebuchetInField);
  const buildWallRing = useGameStore(s => s.buildWallRing);
  const human = useGameStore(s => s.getHumanPlayer)();
  const humanCities = useGameStore(s => s.cities).filter(c => c.ownerId === human?.id);
  const totalStone = humanCities.reduce((s, c) => s + (c.storage.stone ?? 0), 0);

  let availBP = 0;
  if (inTerritory) availBP += CITY_BUILDING_POWER;
  availBP += buildersHere * BUILDER_POWER;

  const hasUnitsForDeposit = unitsHere > 0;
  const canBuildTrebuchetHere = buildersHere > 0 && !hasCityAt(q, r) && !hasConstructionAt(q, r) && tile?.biome !== 'water' && tile?.biome !== 'mountain';

  const buildings: { type: BuildingType; label: string; desc: string; show?: boolean; needsUnits?: boolean }[] = [
    { type: 'farm' as BuildingType, label: 'Farm', desc: `L1: +25 grain/cycle (2 jobs); L2: +60 (3 jobs)  (${BUILDING_BP_COST.farm} BP)` },
    { type: 'factory' as BuildingType, label: 'Factory', desc: `+1 arms/cycle (2 jobs)  (${BUILDING_BP_COST.factory} BP)` },
    { type: 'barracks' as BuildingType, label: 'Barracks', desc: `Recruit military units & heroes (2 jobs)  (${BUILDING_BP_COST.barracks} BP)` },
    { type: 'academy' as BuildingType, label: 'Academy', desc: `Recruit civilian units (builders) (2 jobs)  (${BUILDING_BP_COST.academy} BP)` },
    { type: 'market' as BuildingType, label: 'Market', desc: `+${MARKET_GOLD_PER_CYCLE} gold/cycle (2 jobs)  (${BUILDING_BP_COST.market} BP)` },
    { type: 'quarry' as BuildingType, label: 'Quarry', desc: `+5 stone/cycle (2 jobs) (${BUILDING_BP_COST.quarry} BP)`, show: tile?.hasQuarryDeposit, needsUnits: true },
    { type: 'mine' as BuildingType, label: 'Mine', desc: `+2 iron/cycle (2 jobs) (${BUILDING_BP_COST.mine} BP)`, show: tile?.hasMineDeposit, needsUnits: true },
  ].filter(b => b.show !== false);

  const canBuildRoad = buildersHere > 0 && !tile?.hasRoad && !hasRoadConstructionAt(q, r);
  const trebuchetCanAfford = (human?.gold ?? 0) >= TREBUCHET_FIELD_GOLD_COST;

  return (
    <div className="space-y-2">
      <h3 className="text-empire-parchment/60 text-xs font-semibold">BUILD</h3>
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
          <div className="flex justify-between">
            <span className="font-medium">Build Trebuchet (field)</span>
            <span className={trebuchetCanAfford ? 'text-yellow-400' : 'text-red-400/50'}>{TREBUCHET_FIELD_GOLD_COST}g</span>
          </div>
          <div className="text-empire-parchment/40 text-[10px]">Siege. Builder builds on this hex ({TREBUCHET_FIELD_BP_COST} BP)</div>
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
      {buildings.map(b => {
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
