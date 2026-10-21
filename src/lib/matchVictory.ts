/** True when any non-human player still owns a city. */
export function anyNonHumanEmpireHasCity(
  cities: readonly { ownerId: string }[],
  players: readonly { id: string; isHuman: boolean }[],
): boolean {
  const rivalIds = new Set<string>();
  for (const p of players) {
    if (!p.isHuman) rivalIds.add(p.id);
  }
  if (rivalIds.size === 0) return false;
  return cities.some(c => rivalIds.has(c.ownerId));
}
