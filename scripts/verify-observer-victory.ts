/**
 * Lock observer-watch victory: bot_vs_bot_4 must not use the PvAI "no human cities" defeat path.
 */
import {
  gameModeIsObserverWatch,
  observerWatchConquestEnded,
} from '../src/lib/victory';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(gameModeIsObserverWatch('bot_vs_bot'), '2-bot watch is observer');
assert(gameModeIsObserverWatch('bot_vs_bot_4'), '4-bot watch is observer');
assert(gameModeIsObserverWatch('spectate'), 'spectate is observer');
assert(!gameModeIsObserverWatch('human_vs_ai'), 'PvAI is not observer');
assert(!gameModeIsObserverWatch('human_solo'), 'sandbox is not observer');
assert(!gameModeIsObserverWatch('multiplayer'), 'MP is not observer');

const fourBots = [
  { id: 'player_ai', isHuman: false },
  { id: 'player_ai_2', isHuman: false },
  { id: 'player_ai_3', isHuman: false },
  { id: 'player_ai_4', isHuman: false },
];
const fourCities = fourBots.map(p => ({ ownerId: p.id }));

const mid = observerWatchConquestEnded(fourBots, fourCities);
assert(!mid.ended, 'four living AIs must not end the watch match');

const oneLeft = observerWatchConquestEnded(fourBots, [{ ownerId: 'player_ai_3' }]);
assert(oneLeft.ended, 'one remaining AI ends observer conquest');
assert(oneLeft.winnerId === 'player_ai_3', 'winner is the last AI with a city');

const none = observerWatchConquestEnded(fourBots, []);
assert(none.ended, 'zero AI cities ends observer conquest');
assert(none.winnerId === undefined, 'no winner if every AI city is gone');

const twoBotStillPlaying = observerWatchConquestEnded(
  [
    { id: 'player_ai', isHuman: false },
    { id: 'player_ai_2', isHuman: false },
  ],
  [{ ownerId: 'player_ai' }, { ownerId: 'player_ai_2' }],
);
assert(!twoBotStillPlaying.ended, '?watch=4 after startBotVsBot (two AIs with cities) must stay playing');

console.log('verify-observer-victory: ok');
