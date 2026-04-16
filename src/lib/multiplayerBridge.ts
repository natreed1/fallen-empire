import type { AiActions } from './ai';

type PlanSender = (plan: Partial<AiActions>) => void;

let _send: PlanSender | null = null;

export function registerMultiplayerPlanSender(fn: PlanSender | null): void {
  _send = fn;
}

export function sendMultiplayerPlan(plan: Partial<AiActions>): void {
  _send?.(plan);
}

/** Host-only: pause/resume or change economy tick rate (game server). */
export type MultiplayerSimControlPayload = {
  paused?: boolean;
  speedMultiplier?: 0.5 | 1 | 2 | 4;
};

type SimControlSender = (payload: MultiplayerSimControlPayload) => void;

let _sendSimControl: SimControlSender | null = null;

export function registerMultiplayerSimControlSender(fn: SimControlSender | null): void {
  _sendSimControl = fn;
}

export function sendMultiplayerSimControl(payload: MultiplayerSimControlPayload): void {
  _sendSimControl?.(payload);
}
