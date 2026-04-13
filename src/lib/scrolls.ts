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

/**
 * Grant scroll when a qualifying unit enters that region's relic hex (per player, per region).
 */
export function tickScrollRelicPickup(opts: {
  newCycle: number;
  tiles: Map<string, Tile>;
  units: Unit[];
  players: Player[];
  scrollRelics: ScrollRelicSite[];
  scrollRegionClaimed: Record<SpecialRegionKind, string[]>;
  scrollInventory: Record<string, ScrollItem[]>;
}): {
  scrollRegionClaimed: Record<SpecialRegionKind, string[]>;
  scrollInventory: Record<string, ScrollItem[]>;
  notifications: GameNotification[];
  scrollRelicPickupEvents: ScrollRelicPickupEvent[];
} {
  const {
    tiles,
    units,
    players,
    scrollRelics,
    scrollRegionClaimed: prevClaimed,
    scrollInventory: prevInv,
  } = opts;

  const notifications: GameNotification[] = [];
  const scrollRelicPickupEvents: ScrollRelicPickupEvent[] = [];

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

  for (const site of scrollRelics) {
    const { regionKind, q, r } = site;
    const lineKind = scrollKindForTerrain(regionKind);
    const tileAt = tiles.get(tileKey(q, r));

    for (const p of players) {
      const claimed = new Set(scrollRegionClaimed[regionKind] ?? []);
      if (claimed.has(p.id)) continue;

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

  return { scrollRegionClaimed, scrollInventory, notifications, scrollRelicPickupEvents };
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
