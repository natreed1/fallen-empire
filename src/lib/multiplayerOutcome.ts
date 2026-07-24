/**
 * Local win/loss for multiplayer clients after remapping (self = player_human, opponent = player_ai).
 * Used when the authoritative server only sets phase='victory' without outcome notifications.
 */

import type { City } from '../types/game';

const LOCAL = 'player_human';
const OPP = 'player_ai';

export type MultiplayerLocalOutcome = {
  isWin: boolean;
  message: string;
};

/** Derive whether the local player won from remapped city ownership. */
export function getMultiplayerLocalOutcome(cities: City[]): MultiplayerLocalOutcome {
  const humanCities = cities.filter(c => c.ownerId === LOCAL);
  const oppCities = cities.filter(c => c.ownerId === OPP);
  const humanPop = humanCities.reduce((a, c) => a + c.population, 0);
  const oppPop = oppCities.reduce((a, c) => a + c.population, 0);

  if (oppCities.length === 0 && humanCities.length > 0) {
    return { isWin: true, message: 'Victory! You conquered the rival empire!' };
  }
  if (humanCities.length === 0 && oppCities.length > 0) {
    return { isWin: false, message: 'Defeat! Your empire has fallen.' };
  }
  if (humanCities.length === 0 && oppCities.length === 0) {
    return { isWin: false, message: 'The game is over.' };
  }

  // Cycle-cap / timeout: both sides still hold cities — compare territory then population.
  const humanWins =
    humanCities.length > oppCities.length ||
    (humanCities.length === oppCities.length && humanPop >= oppPop);
  return humanWins
    ? { isWin: true, message: "Time's up! You control more territory. Victory!" }
    : { isWin: false, message: "Time's up! The rival empire dominates. Defeat." };
}
