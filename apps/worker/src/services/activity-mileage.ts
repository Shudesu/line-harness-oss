import type { ApplyMileageRulesInput } from '@line-crm/db';

/** Mileage is a best-effort projection: the user's primary action must succeed even if it is unavailable. */
export async function awardActivityMileage(
  db: D1Database,
  input: ApplyMileageRulesInput,
): Promise<void> {
  try {
    const { applyMileageRulesForEvent } = await import('@line-crm/db');
    await applyMileageRulesForEvent(db, input);
  } catch (error) {
    console.error(`${input.eventType} mileage failed:`, error);
  }
}
