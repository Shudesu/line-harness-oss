/** Copy slots an operator can override. */
export const LANDING_TEXT_KEYS = [
  "qrHeading",
  "qrHint",
  "qrFooter",
  "mobileHeading",
] as const;

export type LandingTextKey = (typeof LANDING_TEXT_KEYS)[number];

/**
 * Stored overrides. A missing key uses the default copy; an empty string drops
 * the element entirely. Newlines render as <br>.
 *
 * Whitespace-only values are stored as the empty string: the settings form
 * tells the operator that an empty box hides the line, and a box holding only
 * spaces reads as empty, so it must behave the same way.
 */
export type LandingTexts = Partial<Record<LandingTextKey, string>>;

/** Copy used when the operator has stored no override for a slot. */
export const DEFAULT_LANDING_TEXTS: Record<LandingTextKey, string> = {
  qrHeading: "スマートフォンで QR コードを読み取ってください",
  qrHint: "LINE アプリのカメラまたは\nスマートフォンのカメラで読み取れます",
  qrFooter: "友だち追加で全機能を無料体験できます",
  mobileHeading: "LINE で開く",
};

/**
 * Longest override accepted. The cards are 360–480px wide, so anything beyond
 * this wraps into a block rather than reading as a line of copy.
 */
export const LANDING_TEXT_MAX_LENGTH = 200;

/** Merge stored overrides over the defaults. */
export function resolveLandingTexts(
  stored: LandingTexts | null | undefined,
): Record<LandingTextKey, string> {
  const resolved = { ...DEFAULT_LANDING_TEXTS };
  if (!stored) return resolved;
  for (const key of LANDING_TEXT_KEYS) {
    const value = stored[key];
    if (typeof value === "string") resolved[key] = value;
  }
  return resolved;
}

/**
 * Read a stored row. Unknown keys and malformed values are dropped rather than
 * thrown: a broken row must not take the public landing page down, and the
 * write path below is what keeps rows well-formed.
 */
export function parseLandingTexts(raw: string | null | undefined): LandingTexts {
  if (raw === null || raw === undefined) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const row = value as Record<string, unknown>;
  const parsed: LandingTexts = {};
  for (const key of LANDING_TEXT_KEYS) {
    const entry = row[key];
    if (typeof entry === "string" && entry.length <= LANDING_TEXT_MAX_LENGTH) {
      parsed[key] = entry;
    }
  }
  return parsed;
}

export type LandingTextsValidation =
  | { ok: true; value: LandingTexts }
  | { ok: false; error: string };

/** Validate an incoming write. Unknown keys are rejected so a typo surfaces. */
export function validateLandingTexts(input: unknown): LandingTextsValidation {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, error: "landing texts must be an object" };
  }
  const row = input as Record<string, unknown>;
  for (const key of Object.keys(row)) {
    if (!(LANDING_TEXT_KEYS as readonly string[]).includes(key)) {
      return { ok: false, error: `unknown landing text key: ${key}` };
    }
  }
  const value: LandingTexts = {};
  for (const key of LANDING_TEXT_KEYS) {
    const entry = row[key];
    if (entry === undefined) continue;
    if (typeof entry !== "string") {
      return { ok: false, error: `${key} must be a string` };
    }
    if (entry.length > LANDING_TEXT_MAX_LENGTH) {
      return {
        ok: false,
        error: `${key} must be ${LANDING_TEXT_MAX_LENGTH} characters or fewer`,
      };
    }
    value[key] = entry.trim() === "" ? "" : entry;
  }
  return { ok: true, value };
}
