import { getLandingTextsJson } from '@line-crm/db';
import {
  parseLandingTexts,
  resolveLandingTexts,
  type LandingTextKey,
} from '@line-crm/shared';

/** Read the stored overrides and merge them over the default copy. */
export async function loadLandingTexts(
  db: D1Database,
): Promise<Record<LandingTextKey, string>> {
  return resolveLandingTexts(parseLandingTexts(await getLandingTextsJson(db)));
}
