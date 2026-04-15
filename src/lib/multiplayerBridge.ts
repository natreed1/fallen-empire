import type { AiActions } from './ai';

type PlanSender = (plan: Partial<AiActions>) => void;

let _send: PlanSender | null = null;

export function registerMultiplayerPlanSender(fn: PlanSender | null): void {
  _send = fn;
}

export function sendMultiplayerPlan(plan: Partial<AiActions>): void {
  _send?.(plan);
}
