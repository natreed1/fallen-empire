/** Watch-only matches: no human cities; conquest/time-up must not use the PvAI defeat path. */
export function gameModeIsObserverWatch(mode: string): boolean {
  return mode === 'bot_vs_bot' || mode === 'bot_vs_bot_4' || mode === 'spectate';
}

/** Observer conquest: end when at most one AI still owns a city. */
export function observerWatchConquestEnded(
  players: { id: string; isHuman: boolean }[],
  cities: { ownerId: string }[],
): { ended: boolean; winnerId: string | undefined } {
  const aiIds = players.filter(p => !p.isHuman).map(p => p.id);
  const alive = aiIds.filter(pid => cities.some(c => c.ownerId === pid));
  return { ended: alive.length <= 1, winnerId: alive[0] };
}
