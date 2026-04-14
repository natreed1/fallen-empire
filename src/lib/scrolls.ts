import {
  Unit,
  Tile,
  Player,
  ScrollItem,
  ScrollAttachment,
  ScrollKind,
  SpecialRegionKind,
  ScrollRelicSite,
  GameNotification,
  tileKey,
  generateId,
  scrollKindForTerrain,
  SCROLL_REGION_ITEM_NAME,
  emptyScrollRegionClaimed,
} from '@/types/game';
import { unitCountsTowardScrollSearch, makeScrollItem } from './scrollsItems';

export { makeScrollItem } from './scrollsItems';

export function hexHasScrollKind(
  q: number,
  r: number,
  ownerId: string,
  kind: ScrollKind,
  units: Unit[],
  attachments: ScrollAttachment[],
): boolean {
  for (const a of attachments) {
    if (a.kind !== kind || a.ownerId !== ownerId) continue;
    if (a.armyId) {
      const onHex = units.some(
        u =>
          u.hp > 0 &&
          u.armyId === a.armyId &&
          u.q === q &&
          u.r === r &&
          !u.aboardShipId,
      );
      if (onHex) return true;
      continue;
    }
    const carrier = units.find(u => u.id === a.carrierUnitId);
    if (!carrier || carrier.hp <= 0) continue;
    if (carrier.q === q && carrier.r === r) return true;
  }
  return false;
}

export function armyHasMovementScroll(
  army: Unit[],
  ownerId: string,
  units: Unit[],
  attachments: ScrollAttachment[],
): boolean {
  const at = army[0];
  if (!at) return false;
  return hexHasScrollKind(at.q, at.r, ownerId, 'movement', units, attachments);
}

export type ScrollRelicPickupEvent = {
  playerId: string;
  regionKind: SpecialRegionKind;
  kind: ScrollKind;
};

export type ScrollSearchPromptEvent = {
  playerId: string;
  regionKind: SpecialRegionKind;
};

function cloneVisited(
  prev: Record<string, Partial<Record<SpecialRegionKind, string[]>>>,
): Record<string, Partial<Record<SpecialRegionKind, string[]>>> {
  const out: Record<string, Partial<Record<SpecialRegionKind, string[]>>> = {};
  for (const pid of Object.keys(prev)) {
    const sub = prev[pid];
    if (!sub) continue;
    out[pid] = {};
    for (const rk of Object.keys(sub) as SpecialRegionKind[]) {
      const arr = sub[rk];
      if (arr) out[pid]![rk] = [...arr];
    }
  }
  return out;
}

function isSearchCompleteForPlayer(
  cluster: string[],
  visitedKeys: string[],
  player: Player | undefined,
): boolean {
  if (cluster.length === 0) return true;
  const vis = new Set(visitedKeys);
  if (cluster.every(k => vis.has(k))) return true;
  // AI: touching the wilds once counts as having searched (full exploration is expensive to path).
  if (player && !player.isHuman && vis.size > 0) return true;
  return false;
}

/**
 * Track hexes visited in each relic cluster, then grant the scroll only when the human has
 * covered the whole connected patch and steps on the relic hex with a qualifying unit.
 */
export function tickScrollRelicPickup(opts: {
  newCycle: number;
  tiles: Map<string, Tile>;
  units: Unit[];
  players: Player[];
  scrollRelics: ScrollRelicSite[];
  scrollRegionClaimed: Record<SpecialRegionKind, string[]>;
  scrollInventory: Record<string, ScrollItem[]>;
  scrollRelicClusters: Record<SpecialRegionKind, string[]>;
  scrollSearchVisited: Record<string, Partial<Record<SpecialRegionKind, string[]>>>;
}): {
  scrollRegionClaimed: Record<SpecialRegionKind, string[]>;
  scrollInventory: Record<string, ScrollItem[]>;
  notifications: GameNotification[];
  scrollRelicPickupEvents: ScrollRelicPickupEvent[];
  scrollSearchPromptEvents: ScrollSearchPromptEvent[];
  scrollSearchVisited: Record<string, Partial<Record<SpecialRegionKind, string[]>>>;
} {
  const {
    tiles,
    units,
    players,
    scrollRelics,
    scrollRegionClaimed: prevClaimed,
    scrollInventory: prevInv,
    scrollRelicClusters,
    scrollSearchVisited: prevVisited,
  } = opts;

  const notifications: GameNotification[] = [];
  const scrollRelicPickupEvents: ScrollRelicPickupEvent[] = [];
  const scrollSearchPromptEvents: ScrollSearchPromptEvent[] = [];

  let scrollRegionClaimed: Record<SpecialRegionKind, string[]> = {
    ...emptyScrollRegionClaimed(),
    ...prevClaimed,
  };
  for (const k of Object.keys(scrollRegionClaimed) as SpecialRegionKind[]) {
    scrollRegionClaimed[k] = [...(scrollRegionClaimed[k] ?? [])];
  }

  const scrollInventory = { ...prevInv };
  for (const p of players) {
    if (!scrollInventory[p.id]) scrollInventory[p.id] = [];
  }

  const playerById = new Map(players.map(p => [p.id, p]));
  const scrollSearchVisited = cloneVisited(prevVisited);

  const regionKinds = new Set(scrollRelics.map(s => s.regionKind));

  for (const regionKind of regionKinds) {
    const cluster = scrollRelicClusters[regionKind] ?? [];
    if (cluster.length === 0) continue;
    const clusterSet = new Set(cluster);
    const lineKind = scrollKindForTerrain(regionKind);

    for (const p of players) {
      const claimed = new Set(scrollRegionClaimed[regionKind] ?? []);
      if (claimed.has(p.id)) continue;

      const prevArr = scrollSearchVisited[p.id]?.[regionKind] ?? [];
      const visSet = new Set(prevArr);

      for (const u of units) {
        if (u.ownerId !== p.id) continue;
        const k = tileKey(u.q, u.r);
        if (!clusterSet.has(k)) continue;
        const tileAt = tiles.get(k);
        if (!unitCountsTowardScrollSearch(u, tileAt, lineKind)) continue;
        visSet.add(k);
      }

      const merged = [...visSet];
      if (!scrollSearchVisited[p.id]) scrollSearchVisited[p.id] = {};
      scrollSearchVisited[p.id]![regionKind] = merged;

      const prevSize = prevArr.length;
      if (
        p.isHuman &&
        cluster.length > 1 &&
        prevSize === 0 &&
        merged.length > 0 &&
        !claimed.has(p.id)
      ) {
        scrollSearchPromptEvents.push({ playerId: p.id, regionKind });
      }
    }
  }

  for (const site of scrollRelics) {
    const { regionKind, q, r } = site;
    const lineKind = scrollKindForTerrain(regionKind);
    const tileAt = tiles.get(tileKey(q, r));
    const cluster = scrollRelicClusters[regionKind] ?? [];

    for (const p of players) {
      const claimed = new Set(scrollRegionClaimed[regionKind] ?? []);
      if (claimed.has(p.id)) continue;

      const visited = scrollSearchVisited[p.id]?.[regionKind] ?? [];
      const pl = playerById.get(p.id);
      if (!isSearchCompleteForPlayer(cluster, visited, pl)) continue;

      let picked = false;
      for (const u of units) {
        if (u.ownerId !== p.id) continue;
        if (u.q !== q || u.r !== r) continue;
        if (!unitCountsTowardScrollSearch(u, tileAt, lineKind)) continue;
        picked = true;
        break;
      }
      if (!picked) continue;

      claimed.add(p.id);
      scrollRegionClaimed[regionKind] = [...claimed];

      const item = makeScrollItem(lineKind, regionKind);
      scrollInventory[p.id] = [...(scrollInventory[p.id] ?? []), item];

      const label = p.isHuman ? 'You' : p.name;
      notifications.push({
        id: generateId('n'),
        turn: opts.newCycle,
        message: `${label} claimed ${SCROLL_REGION_ITEM_NAME[regionKind]}.`,
        type: 'success',
      });
      scrollRelicPickupEvents.push({ playerId: p.id, regionKind, kind: lineKind });
    }
  }

  return {
    scrollRegionClaimed,
    scrollInventory,
    notifications,
    scrollRelicPickupEvents,
    scrollSearchPromptEvents,
    scrollSearchVisited,
  };
}

/** When a carrier dies, return their scroll to inventory. */
export function returnScrollsForDeadCarriers(
  killedUnitIds: Set<string>,
  attachments: ScrollAttachment[],
  scrollInventory: Record<string, ScrollItem[]>,
): { attachments: ScrollAttachment[]; scrollInventory: Record<string, ScrollItem[]> } {
  let nextInv = { ...scrollInventory };
  let nextAtt = attachments;
  for (const id of killedUnitIds) {
    const lost = attachments.filter(a => a.carrierUnitId === id);
    if (lost.length === 0) continue;
    nextAtt = nextAtt.filter(a => a.carrierUnitId !== id);
    for (const a of lost) {
      const item: ScrollItem = { id: a.scrollId, kind: a.kind, sourceRegion: a.sourceRegion };
      nextInv[a.ownerId] = [...(nextInv[a.ownerId] ?? []), item];
    }
  }
  return { attachments: nextAtt, scrollInventory: nextInv };
}
