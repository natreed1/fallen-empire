/**
 * Multiplayer army orders: the server applies `moveTargets` only.
 * Move and intercept confirmations must be sent as that plan. Patrol, defend,
 * and attack orders are not in the plan schema — callers should not apply
 * them locally, or the next snapshot will silently revert them.
 */

export type TacticalOrderForMultiplayer = {
  type: string;
  toQ?: number;
  toR?: number;
  participatingUnitIds?: string[];
};

export type TacticalStackUnitRef = {
  id: string;
  aboardShipId?: string;
};

export type TacticalMultiplayerPlan = {
  moveTargets: { unitId: string; toQ: number; toR: number }[];
  unsyncedKinds: string[];
};

export function planMultiplayerTacticalOrders(
  orders: Record<string, TacticalOrderForMultiplayer | undefined>,
  unitsOnStack: (stackKey: string) => TacticalStackUnitRef[],
  allowMove: (stackKey: string, toQ: number, toR: number, marching: TacticalStackUnitRef[]) => boolean,
): TacticalMultiplayerPlan {
  const moveTargets: { unitId: string; toQ: number; toR: number }[] = [];
  const unsynced = new Set<string>();

  for (const stackKey of Object.keys(orders)) {
    const order = orders[stackKey];
    if (!order) continue;
    if ((order.type !== 'move' && order.type !== 'intercept') || order.toQ === undefined || order.toR === undefined) {
      unsynced.add(order.type);
      continue;
    }
    const ids = order.participatingUnitIds;
    const marching = unitsOnStack(stackKey).filter(u => {
      if (u.aboardShipId) return false;
      if (ids === undefined) return true;
      return ids.includes(u.id);
    });
    if (marching.length === 0) continue;
    if (!allowMove(stackKey, order.toQ, order.toR, marching)) continue;
    for (const u of marching) {
      moveTargets.push({ unitId: u.id, toQ: order.toQ, toR: order.toR });
    }
  }

  return { moveTargets, unsyncedKinds: [...unsynced] };
}
