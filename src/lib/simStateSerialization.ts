/**
 * JSON-safe wire format for {@link SimState} (Maps/Sets → arrays) for multiplayer sync.
 */

import type { SimState } from '../core/gameCore';
import type { Tile, TerritoryInfo } from '../types/game';
import type { SupplyCacheEntry } from './military';

export type SerializedSimState = Omit<
  SimState,
  'tiles' | 'territory' | 'scoutedHexes' | 'combatMoraleState' | 'supplyCache'
> & {
  tiles: [string, Tile][];
  territory: [string, TerritoryInfo][];
  scoutedHexes: string[];
  combatMoraleState: [string, { ownerId: string; morale: number }][];
  supplyCache?: [string, SupplyCacheEntry][];
};

export function serializeSimState(state: SimState): SerializedSimState {
  return {
    ...state,
    tiles: Array.from(state.tiles.entries()),
    territory: Array.from(state.territory.entries()),
    scoutedHexes: Array.from(state.scoutedHexes),
    combatMoraleState: Array.from(state.combatMoraleState.entries()),
    supplyCache: state.supplyCache ? Array.from(state.supplyCache.entries()) : undefined,
  };
}

export function deserializeSimState(data: SerializedSimState): SimState {
  return {
    ...data,
    tiles: new Map(data.tiles),
    territory: new Map(data.territory),
    scoutedHexes: new Set(data.scoutedHexes),
    combatMoraleState: new Map(data.combatMoraleState),
    supplyCache: data.supplyCache ? new Map(data.supplyCache) : undefined,
  };
}
