/**
 * Remap server player ids (`player_ai` / `player_ai_2`) so local client always uses `player_human` for self
 * and `player_ai` for the opponent (reuses existing human-vs-AI UI assumptions).
 */

import type { SimState } from '../core/gameCore';
import type { MoraleState } from './combat';
import type { ScrollItem, SpecialRegionKind } from '../types/game';

const S_P1 = 'player_ai';
const S_P2 = 'player_ai_2';
const LOCAL = 'player_human';
const OPP = 'player_ai';

function mapPlayerId(role: 'host' | 'guest', id: string): string {
  if (role === 'host') {
    if (id === S_P1) return LOCAL;
    if (id === S_P2) return OPP;
    return id;
  }
  if (id === S_P2) return LOCAL;
  if (id === S_P1) return OPP;
  return id;
}

/** Deep-remap SimState for one client's UI (immutable). */
export function remapSimStateForClient(state: SimState, role: 'host' | 'guest'): SimState {
  const mp = (id: string) => mapPlayerId(role, id);

  const players = state.players.map(p => {
    const id = mp(p.id);
    return {
      ...p,
      id,
      isHuman: id === LOCAL,
    };
  });

  const scrollInventory: Record<string, ScrollItem[]> = {};
  for (const [k, v] of Object.entries(state.scrollInventory)) {
    scrollInventory[mp(k)] = v;
  }

  // Rebuild into a fresh object — in-place rename can collide when host maps
  // player_ai_2 → player_ai while player_ai → player_human still exists.
  const scrollSearchVisited: Record<string, Partial<Record<SpecialRegionKind, string[]>>> = {};
  for (const [k, v] of Object.entries(state.scrollSearchVisited ?? {})) {
    scrollSearchVisited[mp(k)] = v;
  }

  const scrollRegionClaimed = { ...state.scrollRegionClaimed };
  for (const region of Object.keys(scrollRegionClaimed) as (keyof typeof scrollRegionClaimed)[]) {
    const arr = scrollRegionClaimed[region];
    if (arr?.length) scrollRegionClaimed[region] = arr.map(mp);
  }

  // Keys are `${hexKey}:${ownerId}` — rebuild so guest/host owner ids stay consistent.
  const combatMoraleState: MoraleState = new Map();
  for (const [key, entry] of state.combatMoraleState ?? []) {
    const ownerId = mp(entry.ownerId);
    const suffix = `:${entry.ownerId}`;
    const hexKey = key.endsWith(suffix) ? key.slice(0, -suffix.length) : key;
    combatMoraleState.set(`${hexKey}:${ownerId}`, { ownerId, morale: entry.morale });
  }

  return {
    ...state,
    players,
    cities: state.cities.map(c => ({ ...c, ownerId: mp(c.ownerId) })),
    units: state.units.map(u => ({ ...u, ownerId: mp(u.ownerId) })),
    territory: new Map(
      Array.from(state.territory.entries()).map(([key, t]) => [key, { ...t, playerId: mp(t.playerId) }]),
    ),
    scrollInventory,
    scrollSearchVisited,
    scrollRegionClaimed,
    commanders: state.commanders.map(c => ({ ...c, ownerId: mp(c.ownerId) })),
    scoutMissions: state.scoutMissions.map(m => ({ ...m })),
    scoutTowers: (state.scoutTowers ?? []).map(t => ({ ...t, ownerId: mp(t.ownerId) })),
    constructions: state.constructions.map(c => ({ ...c, ownerId: mp(c.ownerId) })),
    wallSections: state.wallSections.map(w => ({ ...w, ownerId: mp(w.ownerId) })),
    defenseInstallations: state.defenseInstallations.map(d => ({
      ...d,
      ownerId: mp(d.ownerId),
    })),
    unitStacks: state.unitStacks.map(s => ({ ...s, ownerId: mp(s.ownerId) })),
    operationalArmies: state.operationalArmies.map(o => ({ ...o, ownerId: mp(o.ownerId) })),
    pendingRecruits: state.pendingRecruits.map(pr => ({ ...pr, playerId: mp(pr.playerId) })),
    cityCaptureHold: Object.fromEntries(
      Object.entries(state.cityCaptureHold).map(([cid, h]) => [cid, { ...h, attackerId: mp(h.attackerId) }]),
    ),
    scrollAttachments: state.scrollAttachments.map(a => ({ ...a, ownerId: mp(a.ownerId) })),
    combatMoraleState,
  };
}

/** Map local `player_human` unit ids to server `player_ai` / `player_ai_2` for intents. */
export function localPlayerIdToServer(localId: string, role: 'host' | 'guest'): string {
  if (localId !== LOCAL) return localId;
  return role === 'host' ? S_P1 : S_P2;
}
