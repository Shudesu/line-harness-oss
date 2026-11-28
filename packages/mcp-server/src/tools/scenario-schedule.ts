import { parseDelay } from "@line-harness/sdk";

export type DeliveryMode = "relative" | "elapsed" | "absolute_time";

export interface StepScheduleInput {
  delay?: string;
  offsetDays?: number;
  offsetMinutes?: number;
  deliveryTime?: string;
}

export type StepSchedule =
  | { delayMinutes: number }
  | { offsetDays: number; offsetMinutes: number }
  | { offsetDays: number; deliveryTime: string };

/** deliveryMode に応じて create_scenario のステップ指定を API のスケジュール項目へ変換する。不正なら Error。 */
export function buildStepSchedule(mode: DeliveryMode, step: StepScheduleInput, index: number): StepSchedule {
  const n = index + 1;
  const has = (...v: unknown[]) => v.some((x) => x !== undefined);
  if (mode === "relative") {
    if (has(step.offsetDays, step.offsetMinutes, step.deliveryTime)) {
      throw new Error(`step ${n}: relative モードでは delay のみ指定できます（時刻指定は deliveryMode: "absolute_time" で作成してください）`);
    }
    if (step.delay === undefined) throw new Error(`step ${n}: delay が必要です（例 '30m', '24h'）`);
    try {
      return { delayMinutes: parseDelay(step.delay) };
    } catch {
      throw new Error(`Invalid delay format at step ${n}: "${step.delay}". Use formats like '0m', '30m', '24h'.`);
    }
  }
  if (step.offsetDays === undefined) throw new Error(`step ${n}: ${mode} モードでは offsetDays が必要です`);
  if (mode === "elapsed") {
    if (has(step.delay, step.deliveryTime)) throw new Error(`step ${n}: elapsed モードでは offsetDays + offsetMinutes のみ指定できます`);
    return { offsetDays: step.offsetDays, offsetMinutes: step.offsetMinutes ?? 0 };
  }
  if (has(step.delay, step.offsetMinutes)) throw new Error(`step ${n}: absolute_time モードでは offsetDays + deliveryTime のみ指定できます`);
  if (step.deliveryTime === undefined) throw new Error(`step ${n}: absolute_time モードでは deliveryTime "HH:MM"（JST）が必要です`);
  return { offsetDays: step.offsetDays, deliveryTime: step.deliveryTime };
}
