import {
  City,
  Unit,
  Player,
  Hero,
  Tile,
  MapConfig,
  GameNotification,
  tileKey,
  hexDistance,
  getHexRing,
  parseTileKey,
  CONTESTED_ZONE_GOLD_REWARD,
  CONTESTED_ZONE_IRON_REWARD,
  HERO_BASE_HP,
  generateId,
} from '@/types/game';
import { landMilitaryContestsCityCapture } from '@/lib/military';

const HUMAN_ID = 'player_human';
const AI_ID = 'player_ai';
const AI_ID_2 = 'player_ai_2';

type PayoutGameMode =
  | 'human_vs_ai'
  | 'human_solo'
  | 'bot_vs_bot'
  | 'bot_vs_bot_4'
  | 'spectate'
  | 'battle_test';

function walkableLandTile(t: Tile | undefined, config: MapConfig, q: number, r: number): boolean {
  if (!t) return false;
  if (q < 0 || r < 0 || q >= config.width || r >= config.height) return false;
  if (t.biome === 'water' || t.biome === 'mountain') return false;
  return true;
}

/** Small purple zone (~7 hexes) between two capitals; excludes ancient city tile and capital hexes. */
export function computeContestedZoneHexKeys(
  tiles: Map<string, Tile>,
  q1: number,
  r1: number,
  q2: number,
  r2: number,
  config: MapConfig,
): string[] {
  const w = config.width;
  const h = config.height;
  const exclude = new Set<string>([tileKey(q1, r1), tileKey(q2, r2)]);

  const candidates: { t: Tile; diff: number }[] = [];
  tiles.forEach(t => {
    if (!walkableLandTile(t, config, t.q, t.r)) return;
    const k = tileKey(t.q, t.r);
    if (exclude.has(k)) return;
    if (t.hasAncientCity) return;
    const d1 = hexDistance(q1, r1, t.q, t.r);
    const d2 = hexDistance(q2, r2, t.q, t.r);
    candidates.push({ t, diff: Math.abs(d1 - d2) });
  });
  if (candidates.length === 0) return [];

  candidates.sort((a, b) => a.diff - b.diff);
  const bestDiff = candidates[0].diff;

  const ringHexesForCenter = (cq: number, cr: number): string[] => {
    const keys: string[] = [];
    const add = (q: number, r: number) => {
      if (q < 0 || r < 0 || q >= w || r >= h) return;
      const tt = tiles.get(tileKey(q, r));
      if (!walkableLandTile(tt, config, q, r)) return;
      if (exclude.has(tileKey(q, r))) return;
      if (tt?.hasAncientCity) return;
      keys.push(tileKey(q, r));
    };
    add(cq, cr);
    for (const { q, r } of getHexRing(cq, cr, 1)) add(q, r);
    return keys;
  };

  const bestCandidates = candidates.filter(c => c.diff === bestDiff);
  for (const { t } of bestCandidates) {
    const keys = ringHexesForCenter(t.q, t.r);
    if (keys.length >= 3) return keys;
  }

  let bestKeys: string[] = [];
  for (const { t } of candidates.slice(0, 24)) {
    const keys = ringHexesForCenter(t.q, t.r);
    if (keys.length > bestKeys.length) bestKeys = keys;
  }
  return bestKeys;
}

function contestedRivalPair(gameMode: PayoutGameMode, players: Player[]): [string, string] | null {
  const has = (id: string) => players.some(p => p.id === id);
  if (gameMode === 'human_vs_ai' || gameMode === 'human_solo' || gameMode === 'battle_test') {
    if (has(HUMAN_ID) && has(AI_ID)) return [HUMAN_ID, AI_ID];
  }
  if (gameMode === 'bot_vs_bot' || gameMode === 'bot_vs_bot_4') {
    if (has(AI_ID) && has(AI_ID_2)) return [AI_ID, AI_ID_2];
  }
  if (gameMode === 'spectate') {
    const ais = players.filter(p => !p.isHuman);
    if (ais.length >= 2) return [ais[0]!.id, ais[1]!.id];
  }
  return null;
}

function nearestCityForPlayer(cities: City[], playerId: string, fromQ: number, fromR: number): City | undefined {
  const owned = cities.filter(c => c.ownerId === playerId);
  if (owned.length === 0) return undefined;
  let best = owned[0];
  let bd = hexDistance(best.q, best.r, fromQ, fromR);
  for (let i = 1; i < owned.length; i++) {
    const c = owned[i];
    const d = hexDistance(c.q, c.r, fromQ, fromR);
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

function countForcesInZone(zoneKeys: string[], units: Unit[], heroes: Hero[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const key of zoneKeys) {
    const [q, r] = parseTileKey(key);
    for (const u of units) {
      if (landMilitaryContestsCityCapture(u, q, r)) {
        counts.set(u.ownerId, (counts.get(u.ownerId) ?? 0) + 1);
      }
    }
    for (const h of heroes) {
      const hp = h.hp ?? HERO_BASE_HP;
      if (h.q === q && h.r === r && hp > 0) {
        counts.set(h.ownerId, (counts.get(h.ownerId) ?? 0) + 1);
      }
    }
  }
  return counts;
}

function playerLabel(gameMode: PayoutGameMode, playerId: string, players: Player[]): string {
  if (playerId === HUMAN_ID) return 'You';
  const named = players.find((p) => p.id === playerId)?.name;
  if (named) return named;
  if (playerId === AI_ID) {
    if (gameMode === 'bot_vs_bot' || gameMode === 'bot_vs_bot_4') return 'North Empire';
    if (gameMode === 'human_solo') return 'Training target';
    return 'Enemy';
  }
  if (playerId === AI_ID_2) return 'South Empire';
  return 'Empire';
}

/**
 * Every other economy cycle (2, 4, 6, …): if one rival has strictly more military+hero presence
 * in the zone than the other, pay random gold or iron (balanced expected value).
 */
export function applyContestedZonePayout(opts: {
  zoneKeys: string[];
  newCycle: number;
  gameMode: PayoutGameMode;
  units: Unit[];
  heroes: Hero[];
  cities: City[];
  players: Player[];
}): { players: Player[]; cities: City[]; notifications: GameNotification[] } {
  const { zoneKeys, newCycle, gameMode, units, heroes, cities, players } = opts;
  if (zoneKeys.length === 0 || newCycle < 2 || newCycle % 2 !== 0) {
    return { players, cities, notifications: [] };
  }

  const rivals = contestedRivalPair(gameMode, players);
  if (!rivals) return { players, cities, notifications: [] };

  const [a, b] = rivals;
  const alive = units.filter(u => u.hp > 0);
  const counts = countForcesInZone(zoneKeys, alive, heroes);
  const ca = counts.get(a) ?? 0;
  const cb = counts.get(b) ?? 0;
  if (ca === cb) return { players, cities, notifications: [] };

  const winner = ca > cb ? a : b;
  const giveGold = Math.random() < 0.5;

  const notifs: GameNotification[] = [];
  let nextPlayers = players;
  let nextCities = cities;

  const [zq, zr] = parseTileKey(zoneKeys[0]);

  if (giveGold) {
    nextPlayers = players.map(p =>
      p.id === winner ? { ...p, gold: p.gold + CONTESTED_ZONE_GOLD_REWARD } : p,
    );
    notifs.push({
      id: generateId('n'),
      turn: newCycle,
      message: `Contested ground: +${CONTESTED_ZONE_GOLD_REWARD} gold (${playerLabel(gameMode, winner, players)}).`,
      type: 'success',
    });
  } else {
    const city = nearestCityForPlayer(cities, winner, zq, zr);
    if (!city) {
      nextPlayers = players.map(p =>
        p.id === winner ? { ...p, gold: p.gold + CONTESTED_ZONE_GOLD_REWARD } : p,
      );
      notifs.push({
        id: generateId('n'),
        turn: newCycle,
        message: `Contested ground: +${CONTESTED_ZONE_GOLD_REWARD} gold (${playerLabel(gameMode, winner, players)} — no city for iron).`,
        type: 'success',
      });
    } else {
      const cap = city.storageCap.iron ?? 50;
      const cur = city.storage.iron ?? 0;
      const add = Math.min(CONTESTED_ZONE_IRON_REWARD, Math.max(0, cap - cur));
      if (add === 0) {
        const fallback = Math.floor(CONTESTED_ZONE_GOLD_REWARD / 2);
        nextPlayers = players.map(p =>
          p.id === winner ? { ...p, gold: p.gold + fallback } : p,
        );
        notifs.push({
          id: generateId('n'),
          turn: newCycle,
          message: `Contested ground: iron full at ${city.name} — +${fallback} gold (${playerLabel(gameMode, winner, players)}).`,
          type: 'success',
        });
      } else {
        nextCities = cities.map(c => {
          if (c.id !== city.id) return c;
          return {
            ...c,
            storage: { ...c.storage, iron: cur + add },
          };
        });
        notifs.push({
          id: generateId('n'),
          turn: newCycle,
          message: `Contested ground: +${add} iron to ${city.name} (${playerLabel(gameMode, winner, players)}).`,
          type: 'success',
        });
      }
    }
  }

  return { players: nextPlayers, cities: nextCities, notifications: notifs };
}
