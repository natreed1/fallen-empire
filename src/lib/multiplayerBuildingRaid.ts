/**
 * Map-click raids on an enemy building commit immediately.
 * In multiplayer the client does not simulate; only `moveTargets` reach the server.
 * A local march is overwritten by the next snapshot, so the raid must be sent as moves.
 * Occupying the building hex is what damages it on the server.
 */

export type BuildingRaidMoveTarget = {
  unitId: string;
  toQ: number;
  toR: number;
};

export function buildingRaidMoveTargets(
  unitIds: readonly string[],
  toQ: number,
  toR: number,
): BuildingRaidMoveTarget[] {
  const targets: BuildingRaidMoveTarget[] = [];
  const seen = new Set<string>();
  for (const unitId of unitIds) {
    if (!unitId || seen.has(unitId)) continue;
    seen.add(unitId);
    targets.push({ unitId, toQ, toR });
  }
  return targets;
}
