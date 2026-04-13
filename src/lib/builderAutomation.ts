import {
  type City,
  type ConstructionSite,
  type DefenseInstallation,
  type Player,
  type ScoutTower,
  type Tile,
  type BuildingType,
  BUILDING_COSTS,
  BUILDING_BP_COST,
  BUILDING_IRON_COSTS,
  tileKey,
  parseTileKey,
  hexDistance,
  hexTouchesBiome,
  type BuilderTask,
  DEFAULT_BUILDER_TASK,
  getHexRing,
} from '@/types/game';
import { getUniversityBuilderSlots } from '@/lib/builders';

function occupiedByBuilding(q: number, r: number, cities: City[]): boolean {
  const k = tileKey(q, r);
  return cities.some(c => c.buildings.some(b => tileKey(b.q, b.r) === k));
}

function hexesOwnedByCity(
  cityId: string,
  territory: Map<string, { cityId: string; playerId: string }>,
): { q: number; r: number }[] {
  const out: { q: number; r: number }[] = [];
  for (const [key, info] of territory.entries()) {
    if (info.cityId !== cityId) continue;
    const [q, r] = parseTileKey(key);
    out.push({ q, r });
  }
  out.sort((a, b) => {
    const da = a.q + a.r;
    const db = b.q + b.r;
    return da - db;
  });
  return out;
}

function canStartResourceBuild(args: {
  type: BuildingType;
  q: number;
  r: number;
  city: City;
  player: Player;
  tiles: Map<string, Tile>;
  territory: Map<string, { cityId: string; playerId: string }>;
  constructions: ConstructionSite[];
  cities: City[];
}): boolean {
  const { type, q, r, city, player, tiles, territory, constructions, cities } = args;
  if (player.gold < BUILDING_COSTS[type]) return false;
  const ironCost = BUILDING_IRON_COSTS[type] ?? 0;
  if (ironCost > 0 && (city.storage.iron ?? 0) < ironCost) return false;
  if (city.population < 10) return false;
  const tile = tiles.get(tileKey(q, r));
  if (!tile || tile.biome === 'water' || tile.biome === 'mountain') return false;
  if (cities.some(c => c.q === q && c.r === r)) return false;
  if (constructions.some(cs => cs.q === q && cs.r === r)) return false;
  const hexKey = tileKey(q, r);
  if (occupiedByBuilding(q, r, cities)) return false;
  const terr = territory.get(hexKey);
  if (!terr || terr.playerId !== player.id || terr.cityId !== city.id) return false;
  if (type === 'quarry' && !tile.hasQuarryDeposit) return false;
  if (type === 'mine' && !tile.hasMineDeposit) return false;
  if (type === 'gold_mine' && !tile.hasGoldMineDeposit) return false;
  if (type === 'logging_hut' && tile.biome !== 'forest') return false;
  if (type === 'fishery' || type === 'port' || type === 'shipyard') {
    if (!hexTouchesBiome(tiles, q, r, 'water')) return false;
  }
  return true;
}

const MAX_REMOTE_RESOURCE_RING = 40;

/** Allow workforce automation on valid deposits in your empire (any city) or neutral land — not enemy territory. */
function canStartRemoteResourceBuild(args: {
  type: BuildingType;
  q: number;
  r: number;
  city: City;
  player: Player;
  tiles: Map<string, Tile>;
  territory: Map<string, { cityId: string; playerId: string }>;
  constructions: ConstructionSite[];
  cities: City[];
}): boolean {
  const { type, q, r, city, player, tiles, territory, constructions, cities } = args;
  if (player.gold < BUILDING_COSTS[type]) return false;
  const ironCost = BUILDING_IRON_COSTS[type] ?? 0;
  if (ironCost > 0 && (city.storage.iron ?? 0) < ironCost) return false;
  if (city.population < 10) return false;
  const tile = tiles.get(tileKey(q, r));
  if (!tile || tile.biome === 'water' || tile.biome === 'mountain') return false;
  if (cities.some(c => c.q === q && c.r === r)) return false;
  if (constructions.some(cs => cs.q === q && cs.r === r)) return false;
  const hexKey = tileKey(q, r);
  if (occupiedByBuilding(q, r, cities)) return false;
  const terr = territory.get(hexKey);
  if (terr && terr.playerId !== player.id) return false;
  if (type === 'quarry' && !tile.hasQuarryDeposit) return false;
  if (type === 'mine' && !tile.hasMineDeposit) return false;
  if (type === 'gold_mine' && !tile.hasGoldMineDeposit) return false;
  if (type === 'logging_hut' && tile.biome !== 'forest') return false;
  if (type === 'fishery' || type === 'port' || type === 'shipyard') {
    if (!hexTouchesBiome(tiles, q, r, 'water')) return false;
  }
  return true;
}

function findNearestRemoteResourceHex(
  type: BuildingType,
  city: City,
  player: Player,
  tiles: Map<string, Tile>,
  territory: Map<string, { cityId: string; playerId: string }>,
  constructions: ConstructionSite[],
  cities: City[],
): { q: number; r: number } | null {
  for (let ring = 0; ring <= MAX_REMOTE_RESOURCE_RING; ring++) {
    const hexes = ring === 0 ? [{ q: city.q, r: city.r }] : getHexRing(city.q, city.r, ring);
    for (const h of hexes) {
      if (
        canStartRemoteResourceBuild({
          type,
          q: h.q,
          r: h.r,
          city,
          player,
          tiles,
          territory,
          constructions,
          cities,
        })
      ) {
        return { q: h.q, r: h.r };
      }
    }
  }
  return null;
}

/**
 * One automated construction start per human city per economy cycle (when task matches and budget allows).
 * Returns patch fragments for the store caller to merge.
 */
export function planHumanBuilderAutomation(input: {
  cities: City[];
  players: Player[];
  tiles: Map<string, Tile>;
  territory: Map<string, { cityId: string; playerId: string }>;
  constructions: ConstructionSite[];
  defenseInstallations: DefenseInstallation[];
  scoutTowers: ScoutTower[];
  humanPlayerId: string;
  generateId: (prefix: string) => string;
}): {
  newConstructions: ConstructionSite[];
  nextGold: number;
  nextCities: City[];
  notification?: string;
} | null {
  const {
    cities,
    players,
    tiles,
    territory,
    constructions,
    defenseInstallations,
    scoutTowers,
    humanPlayerId,
    generateId,
  } = input;

  const player = players.find(p => p.id === humanPlayerId);
  if (!player?.isHuman) return null;

  const humanCities = cities.filter(c => c.ownerId === humanPlayerId);
  const sorted = [...humanCities].sort((a, b) => a.id.localeCompare(b.id));

  for (const city of sorted) {
    const academy = city.buildings.find(b => b.type === 'academy');
    if (!academy) continue;
    if (getUniversityBuilderSlots(academy) <= 0) continue;

    const task: BuilderTask = city.universityBuilderTask ?? DEFAULT_BUILDER_TASK;

    const hexList = hexesOwnedByCity(city.id, territory);
    const withDist = hexList.map(h => ({
      ...h,
      d: hexDistance(h.q, h.r, city.q, city.r),
    }));
    withDist.sort((a, b) => a.d - b.d);

    let buildType: BuildingType | null = null;
    let targetHex: { q: number; r: number } | null = null;

    if (task === 'expand_quarries') {
      for (const h of withDist) {
        if (
          canStartResourceBuild({
            type: 'quarry',
            q: h.q,
            r: h.r,
            city,
            player,
            tiles,
            territory,
            constructions,
            cities,
          })
        ) {
          buildType = 'quarry';
          targetHex = { q: h.q, r: h.r };
          break;
        }
      }
      if (!buildType) {
        const rh = findNearestRemoteResourceHex('quarry', city, player, tiles, territory, constructions, cities);
        if (rh) {
          buildType = 'quarry';
          targetHex = rh;
        }
      }
    } else if (task === 'expand_iron_mines') {
      for (const h of withDist) {
        if (
          canStartResourceBuild({
            type: 'mine',
            q: h.q,
            r: h.r,
            city,
            player,
            tiles,
            territory,
            constructions,
            cities,
          })
        ) {
          buildType = 'mine';
          targetHex = { q: h.q, r: h.r };
          break;
        }
      }
      if (!buildType) {
        const rm = findNearestRemoteResourceHex('mine', city, player, tiles, territory, constructions, cities);
        if (rm) {
          buildType = 'mine';
          targetHex = rm;
        }
      }
      if (!buildType) {
        for (const h of withDist) {
          if (
            canStartResourceBuild({
              type: 'gold_mine',
              q: h.q,
              r: h.r,
              city,
              player,
              tiles,
              territory,
              constructions,
              cities,
            })
          ) {
            buildType = 'gold_mine';
            targetHex = { q: h.q, r: h.r };
            break;
          }
        }
      }
      if (!buildType) {
        const rg = findNearestRemoteResourceHex('gold_mine', city, player, tiles, territory, constructions, cities);
        if (rg) {
          buildType = 'gold_mine';
          targetHex = rg;
        }
      }
    } else if (task === 'expand_forestry') {
      for (const h of withDist) {
        if (
          canStartResourceBuild({
            type: 'logging_hut',
            q: h.q,
            r: h.r,
            city,
            player,
            tiles,
            territory,
            constructions,
            cities,
          })
        ) {
          buildType = 'logging_hut';
          targetHex = { q: h.q, r: h.r };
          break;
        }
      }
      if (!buildType) {
        const rl = findNearestRemoteResourceHex('logging_hut', city, player, tiles, territory, constructions, cities);
        if (rl) {
          buildType = 'logging_hut';
          targetHex = rl;
        }
      }
      if (!buildType) {
        const hasSawmill = city.buildings.some(b => b.type === 'sawmill');
        if (!hasSawmill) {
          for (const h of withDist) {
            if (
              canStartResourceBuild({
                type: 'sawmill',
                q: h.q,
                r: h.r,
                city,
                player,
                tiles,
                territory,
                constructions,
                cities,
              })
            ) {
              buildType = 'sawmill';
              targetHex = { q: h.q, r: h.r };
              break;
            }
          }
        }
      }
      if (!buildType) {
        const hasSawmill = city.buildings.some(b => b.type === 'sawmill');
        if (!hasSawmill) {
          const rs = findNearestRemoteResourceHex('sawmill', city, player, tiles, territory, constructions, cities);
          if (rs) {
            buildType = 'sawmill';
            targetHex = rs;
          }
        }
      }
    }

    if (!buildType || !targetHex) continue;

    const goldCost = BUILDING_COSTS[buildType];
    const ironCost = BUILDING_IRON_COSTS[buildType] ?? 0;
    const nextGold = player.gold - goldCost;
    let nextCities = cities;
    if (ironCost > 0) {
      nextCities = cities.map(c =>
        c.id === city.id
          ? { ...c, storage: { ...c.storage, iron: Math.max(0, (c.storage.iron ?? 0) - ironCost) } }
          : c,
      );
    }

    const site: ConstructionSite = {
      id: generateId('con'),
      type: buildType,
      q: targetHex.q,
      r: targetHex.r,
      cityId: city.id,
      ownerId: humanPlayerId,
      bpRequired: BUILDING_BP_COST[buildType],
      bpAccumulated: 0,
    };

    return {
      newConstructions: [site],
      nextGold,
      nextCities,
      notification: `University workforce: started ${buildType} near ${city.name}.`,
    };
  }

  return null;
}
