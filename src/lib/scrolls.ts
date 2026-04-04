import {
  Unit,
  Tile,
  Player,
  ScrollItem,
  ScrollAttachment,
  ScrollKind,
  GameNotification,
  tileKey,
  generateId,
  isNavalUnitType,
  SCROLL_SEARCH_CYCLES_REQUIRED,
  SCROLL_DISPLAY_NAME,
  scrollKindForTerrain,
} from '@/types/game';

export function makeScrollItem(kind: ScrollKind): ScrollItem {
  return { id: generateId('scroll'), kind };
}

/** Land military (or any ship on isle_lost) counts toward the scroll line for this terrain. */
export function unitCountsTowardScrollSearch(
  u: Unit,
  tileAtUnit: Tile | undefined,
  targetScroll: ScrollKind,
): boolean {
  if (u.hp <= 0 || u.aboardShipId || u.type === 'builder') return false;
  if (!tileAtUnit?.specialTerrainKind) return false;
  if (scrollKindForTerrain(tileAtUnit.specialTerrainKind) !== targetScroll) return false;
  if (tileAtUnit.specialTerrainKind === 'isle_lost') {
    return true;
  }
  return !isNavalUnitType(u.type);
}

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

const SCROLL_LINES: ScrollKind[] = ['combat', 'defense', 'movement'];

/**
 * Advance search progress per scroll line; at threshold, grant scroll to inventory.
 * Keys: scrollSearchProgress[kind][playerId], scrollSearchClaimed[kind] = player ids.
 */
export function tickScrollRegionSearch(opts: {
  newCycle: number;
  tiles: Map<string, Tile>;
  units: Unit[];
  players: Player[];
  scrollSearchProgress: Record<string, Record<string, number>>;
  scrollSearchClaimed: Record<string, string[]>;
  scrollInventory: Record<string, ScrollItem[]>;
}): {
  scrollSearchProgress: Record<string, Record<string, number>>;
  scrollSearchClaimed: Record<string, string[]>;
  scrollInventory: Record<string, ScrollItem[]>;
  notifications: GameNotification[];
} {
  const {
    tiles,
    units,
    players,
    scrollSearchProgress: prevProg,
    scrollSearchClaimed: prevClaimed,
    scrollInventory: prevInv,
  } = opts;

  const notifications: GameNotification[] = [];
  let scrollSearchProgress = { ...prevProg };
  let scrollSearchClaimed = { ...prevClaimed };
  const scrollInventory = { ...prevInv };

  for (const p of players) {
    if (!scrollInventory[p.id]) scrollInventory[p.id] = [];
  }

  for (const scrollKind of SCROLL_LINES) {
    const claimed = new Set(scrollSearchClaimed[scrollKind] ?? []);
    const progForKind = { ...(scrollSearchProgress[scrollKind] ?? {}) };

    for (const p of players) {
      if (claimed.has(p.id)) continue;

      let any = false;
      for (const u of units) {
        if (u.ownerId !== p.id) continue;
        const t = tiles.get(tileKey(u.q, u.r));
        if (unitCountsTowardScrollSearch(u, t, scrollKind)) {
          any = true;
          break;
        }
      }

      if (!any) continue;

      const cur = progForKind[p.id] ?? 0;
      const next = cur + 1;
      progForKind[p.id] = next;

      if (next >= SCROLL_SEARCH_CYCLES_REQUIRED) {
        claimed.add(p.id);
        const item = makeScrollItem(scrollKind);
        scrollInventory[p.id] = [...(scrollInventory[p.id] ?? []), item];
        const label = p.isHuman ? 'You' : p.name;
        notifications.push({
          id: generateId('n'),
          turn: opts.newCycle,
          message: `${label} uncovered ${SCROLL_DISPLAY_NAME[scrollKind]} in the wilds.`,
          type: 'success',
        });
      }
    }

    scrollSearchProgress[scrollKind] = progForKind;
    scrollSearchClaimed[scrollKind] = [...claimed];
  }

  return { scrollSearchProgress, scrollSearchClaimed, scrollInventory, notifications };
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
      const item: ScrollItem = { id: a.scrollId, kind: a.kind };
      nextInv[a.ownerId] = [...(nextInv[a.ownerId] ?? []), item];
    }
  }
  return { attachments: nextAtt, scrollInventory: nextInv };
}
