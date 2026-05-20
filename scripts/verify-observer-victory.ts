/**
 * Regression check for observer-only victory/timeout branches.
 *
 * Run: npm exec --yes tsx -- scripts/verify-observer-victory.ts
 */
import {
  gameModeIsAiOnlyObserver,
  type GameMode,
} from '../src/store/useGameStore';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const observerModes: GameMode[] = ['bot_vs_bot', 'bot_vs_bot_4', 'spectate'];
const playableModes: GameMode[] = ['human_vs_ai', 'human_solo', 'battle_test', 'multiplayer'];

for (const mode of observerModes) {
  assert(gameModeIsAiOnlyObserver(mode), `${mode} should use AI-only victory handling`);
}

for (const mode of playableModes) {
  assert(!gameModeIsAiOnlyObserver(mode), `${mode} should not use AI-only victory handling`);
}

console.log('verify-observer-victory: ok');
