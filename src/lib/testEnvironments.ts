export type TestEnvironmentId =
  | 'loading-screen'
  | 'combat-risk-preview'
  | 'hud-status-summary'
  | 'economy-tooltip'
  | 'save-load-api-guard'
  | 'ai-planning-explanation';

export type TestEnvironmentBootMode = 'loading' | 'battle_test' | 'spectate';

export type TestEnvironmentSpec = {
  id: TestEnvironmentId;
  title: string;
  description: string;
  bootMode: TestEnvironmentBootMode;
  seed?: number;
  opponentCount?: number;
};

export const TEST_ENVIRONMENTS: TestEnvironmentSpec[] = [
  {
    id: 'loading-screen',
    title: 'Loading Screen Sandbox',
    description: 'Standalone loading/start screen with no game simulation boot.',
    bootMode: 'loading',
  },
  {
    id: 'combat-risk-preview',
    title: 'Combat Risk Preview Sandbox',
    description: 'Deterministic battle-test skirmish with the battle report opened automatically.',
    bootMode: 'battle_test',
  },
  {
    id: 'hud-status-summary',
    title: 'HUD Status Summary Sandbox',
    description: 'Paused two-empire observer match for immediately inspecting persistent HUD status.',
    bootMode: 'spectate',
    seed: 910_101,
    opponentCount: 1,
  },
  {
    id: 'economy-tooltip',
    title: 'Economy Tooltip Sandbox',
    description: 'Paused economy-active observer match with cities, resources, and income state available.',
    bootMode: 'spectate',
    seed: 910_202,
    opponentCount: 1,
  },
  {
    id: 'save-load-api-guard',
    title: 'Save/Load Guard Sandbox',
    description: 'Paused deterministic match state for inspecting serialization and persistence flows.',
    bootMode: 'spectate',
    seed: 910_303,
    opponentCount: 1,
  },
  {
    id: 'ai-planning-explanation',
    title: 'AI Planning Explanation Sandbox',
    description: 'Paused bot-observer state with planning actors and commanders initialized.',
    bootMode: 'spectate',
    seed: 910_404,
    opponentCount: 2,
  },
];

export function getTestEnvironment(id: string): TestEnvironmentSpec | undefined {
  return TEST_ENVIRONMENTS.find(env => env.id === id);
}
