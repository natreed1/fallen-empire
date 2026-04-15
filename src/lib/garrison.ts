import { Unit, City, isNavalUnitType, hexDistance } from '@/types/game';

/** Hex steps for march UI; at least 1 to avoid divide-by-zero. */
export function marchHexDistanceAtOrder(u: { q: number; r: number }, targetQ: number, targetR: number): number {
  return Math.max(1, hexDistance(u.q, u.r, targetQ, targetR));
}

export function isLandMilitaryUnit(u: Unit): boolean {
  return !isNavalUnitType(u.type) && u.type !== 'builder';
}

/** True if unit counts as garrisoned for rendering (friendly city, at center, flag set). */
export function isGarrisonedAtCity(u: Unit, city: City): boolean {
  if (!u.garrisonCityId || u.garrisonCityId !== city.id || u.hp <= 0) return false;
  if (city.ownerId !== u.ownerId) return false;
  return u.q === city.q && u.r === city.r;
}

/** True when the unit is shown as a garrison badge only (not as a field map sprite). Matches HexGrid rendering. */
export function unitShownAsGarrisonSprite(u: Unit, cities: City[]): boolean {
  if (u.cityDefenseMode === 'auto_engage') return false;
  return cities.some(c => isGarrisonedAtCity(u, c));
}

export function shouldClearGarrisonForMove(u: Unit, targetQ: number, targetR: number, cities: City[]): boolean {
  if (!u.garrisonCityId || !isLandMilitaryUnit(u)) return false;
  const c = cities.find(x => x.id === u.garrisonCityId);
  if (!c) return true;
  return targetQ !== c.q || targetR !== c.r;
}

function shouldClearDefendCityForMove(u: Unit, targetQ: number, targetR: number, cities: City[]): boolean {
  if (!u.defendCityId) return false;
  const dc = cities.find(c => c.id === u.defendCityId);
  return !dc || targetQ !== dc.q || targetR !== dc.r;
}

function shouldClearIncorporateForMove(u: Unit, targetQ: number, targetR: number): boolean {
  if (!u.incorporateVillageAt) return false;
  return u.incorporateVillageAt.q !== targetQ || u.incorporateVillageAt.r !== targetR;
}

/** Mutate unit: strip garrison / interdict / defend-city assignment when move order ends elsewhere. */
export function applyDeployFlagsForMoveMutable(u: Unit, targetQ: number, targetR: number, cities: City[]): void {
  if (shouldClearGarrisonForMove(u, targetQ, targetR, cities)) {
    delete u.garrisonCityId;
  }
  if (shouldClearDefendCityForMove(u, targetQ, targetR, cities)) {
    delete u.defendCityId;
    delete u.cityDefenseMode;
  }
  if (shouldClearIncorporateForMove(u, targetQ, targetR)) delete u.incorporateVillageAt;
  // Patrol is NOT cleared here: this helper runs every time a unit receives a move target (including
  // automatic patrol wander in military.ts). Clearing patrol belongs on explicit player/AI orders only
  // — use {@link withoutPatrolFields} / {@link clearPatrolFieldsMutable} there.
}

/** Drop patrol assignment (player or AI replaced roaming with a concrete order). */
export function clearPatrolFieldsMutable(u: Unit): void {
  delete u.patrolCenterQ;
  delete u.patrolCenterR;
  delete u.patrolRadius;
  delete u.patrolHexKeys;
}

export function withoutPatrolFields<U extends Unit>(u: U): U {
  const next = { ...u };
  clearPatrolFieldsMutable(next);
  return next;
}

/** When issuing movement to targetQ,targetR, strip garrison if leaving the garrison city hex; clear defend if destination is not that city. */
export function withDeployFlags(u: Unit, targetQ: number, targetR: number, cities: City[]): Unit {
  if (!shouldClearGarrisonForMove(u, targetQ, targetR, cities) && !shouldClearDefendCityForMove(u, targetQ, targetR, cities) && !shouldClearIncorporateForMove(u, targetQ, targetR)) return u;
  const next = { ...u };
  applyDeployFlagsForMoveMutable(next, targetQ, targetR, cities);
  return next;
}

/** After becoming idle on own city center, land military re-enters garrison and counts as defending that city. */
export function tryReGarrisonIdleUnit(u: Unit, cities: City[]): void {
  if (u.hp <= 0 || !isLandMilitaryUnit(u) || u.aboardShipId) return;
  if (u.status !== 'idle') return;
  if (u.cityDefenseMode === 'auto_engage') return;
  if (u.patrolCenterQ !== undefined) return;
  const city = cities.find(c => c.q === u.q && c.r === u.r && c.ownerId === u.ownerId);
  if (!city) return;
  u.garrisonCityId = city.id;
  u.defendCityId = city.id;
}
