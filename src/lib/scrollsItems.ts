import {
  Unit,
  Tile,
  ScrollItem,
  ScrollKind,
  SpecialRegionKind,
  generateId,
  isNavalUnitType,
  scrollKindForTerrain,
} from '@/types/game';

export function makeScrollItem(kind: ScrollKind, sourceRegion: SpecialRegionKind): ScrollItem {
  return { id: generateId('scroll'), kind, sourceRegion };
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
