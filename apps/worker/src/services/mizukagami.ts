/**
 * MIZUKAGAMI Mirror Session — CF Workers → Soul Agent Platform BFF
 *
 * フロー:
 * 1. ユーザーが「水鏡」→ D1に状態 waiting_birthday を記録
 * 2. 生年月日入力 → diagnosis API (innate_only) → innateProfile取得
 * 3. innateProfile → mirror-session API (action=start) → 対話開始
 * 4. 以降のテキスト → mirror-session API (action=message) → 対話継続
 * 5. 完了時 → Web Report リンク送信
 */

import { LineClient } from "@line-crm/line-sdk";

// ============================================================
// Types
// ============================================================

interface MirrorSessionApiResponse {
  session_id: string;
  current_step: string;
  next_step?: string;
  message: string;
  disclosed_traditions?: string[];
  remaining_traditions?: string[];
  convergence_points?: Array<{
    traditions: string[];
    theme: string;
    strength: number;
  }>;
  divergence_points?: Array<{
    traditions: string[];
    theme: string;
    insight: string;
  }>;
  card?: WaterMirrorCardV2 | null;
  sessionCompleted?: boolean;
  resumed?: boolean;
  processingTime?: number;
}

interface WaterMirrorCardV2 {
  user_essence: string;
  convergence_narrative: string;
  action_guidance: { what: string; when: string; where: string; who: string };
  user_words: string[];
  closing_message: string;
  tradition_summary: Array<{
    tradition: string;
    result: string;
    disclosed_at: string;
    connection_to_user: string;
  }>;
  convergence_network: {
    nodes: string[];
    edges: Array<{
      from: string;
      to: string;
      type: "resonance" | "tension";
      label: string;
    }>;
  };
  /** 216魂マッチング結果（SAP APIが自動注入） */
  soul_name?: string;
  soul_no?: number;
  soul_name_reading?: string;
}

interface DiagnosisApiResponse {
  diagnosis: {
    innate: {
      primary: string;
      confidence: number;
      details: Record<string, unknown>;
    };
  };
  unleash: {
    kaku: { name: string; description: string };
    honryou: { name: string; description: string };
    miushinai: { name: string; description: string };
  } | null;
  calculatorDetails: Record<
    string,
    { tradition: string; weight: number; data: Record<string, unknown> }
  >;
  soulMatch: {
    soulNo: number;
    soulName: string;
    primarySpiral: string;
    secondarySystem: string;
    manifestation: string;
    confidence: number;
    matchType: string;
  } | null;
}

interface MirrorSessionStatusResponse {
  hasActiveSession: boolean;
  session: {
    session_id: string;
    current_step: string;
    disclosed_traditions: string[];
    remaining_traditions: string[];
  } | null;
}

type MizukagamiState =
  | "waiting_birthday"
  | "diagnosed"
  | "active"
  | "completed";

interface MizukagamiD1Row {
  id: string;
  line_user_id: string;
  state: MizukagamiState;
  birth_date: string | null;
  sap_session_id: string | null;
  calculator_summary: string | null;
  innate_profile: string | null;
  created_at: string;
  updated_at: string;
}

/** Map calculator key → tradition name */
const CALCULATOR_TO_TRADITION: Record<string, string> = {
  eto: "干支",
  numerology: "数秘術",
  bazi: "四柱推命",
  western: "西洋占星術",
  maya: "マヤ暦",
  vedic: "ヴェーダ占星術",
  iching: "易経",
  kabbalah: "カバラ",
  sukuyo: "宿曜",
  sanmei: "算命学",
  kusei: "九星気学",
  ziwei: "紫微斗数",
};

/** Extract a human-readable result label from calculator data */
function buildCalculatorSummary(
  calculatorDetails: Record<
    string,
    { tradition: string; weight: number; data: Record<string, unknown> }
  >,
): Record<string, string> {
  const summary: Record<string, string> = {};
  for (const [key, info] of Object.entries(calculatorDetails)) {
    const tradition = CALCULATOR_TO_TRADITION[key] ?? info.tradition;
    const d = info.data;
    switch (key) {
      case "eto":
        summary[tradition] = `${d.eto} ${d.element}の${d.polarity}`;
        break;
      case "numerology":
        summary[tradition] = `ライフパス ${d.lifePathNumber}`;
        break;
      case "bazi":
        summary[tradition] = `天干 ${d.stem} / ${d.element}`;
        break;
      case "western":
        summary[tradition] = `太陽 ${d.sunSign}・月 ${d.moonSign}`;
        break;
      case "maya": {
        const seal = d.seal as { name?: string } | undefined;
        summary[tradition] = `KIN ${d.kin} ${seal?.name ?? ""}`;
        break;
      }
      case "vedic":
        summary[tradition] = `${d.nakshatra}`;
        break;
      case "iching":
        summary[tradition] = `${d.hexagramName} ${d.symbol ?? ""}`;
        break;
      case "kabbalah":
        summary[tradition] = `${d.sephirotJp}`;
        break;
      case "sukuyo":
        summary[tradition] = `${d.shuku}`;
        break;
      case "sanmei":
        summary[tradition] = `${d.mainStar}`;
        break;
      case "kusei":
        summary[tradition] = `${d.name}`;
        break;
      case "ziwei":
        summary[tradition] = `${d.mingGongStar}`;
        break;
      default:
        summary[tradition] = info.tradition;
    }
  }
  return summary;
}

// ============================================================
// D1 Table setup (idempotent)
// ============================================================

export async function ensureMizukagamiTable(db: D1Database): Promise<void> {
  await db
    .prepare(
      `
    CREATE TABLE IF NOT EXISTS mizukagami_sessions (
      id TEXT PRIMARY KEY,
      line_user_id TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'waiting_birthday',
      birth_date TEXT,
      sap_session_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `,
    )
    .run();
  // Index for quick lookup
  await db
    .prepare(
      `
    CREATE INDEX IF NOT EXISTS idx_mizukagami_sessions_user_state
    ON mizukagami_sessions (line_user_id, state)
  `,
    )
    .run();
}

// ============================================================
// D1 Operations
// ============================================================

async function getActiveD1Session(
  db: D1Database,
  lineUserId: string,
): Promise<MizukagamiD1Row | null> {
  return db
    .prepare(
      "SELECT * FROM mizukagami_sessions WHERE line_user_id = ? AND state IN ('waiting_birthday', 'diagnosed', 'active') ORDER BY created_at DESC LIMIT 1",
    )
    .bind(lineUserId)
    .first<MizukagamiD1Row>();
}

async function createD1Session(
  db: D1Database,
  lineUserId: string,
): Promise<MizukagamiD1Row> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db
    .prepare(
      "INSERT INTO mizukagami_sessions (id, line_user_id, state, created_at, updated_at) VALUES (?, ?, 'waiting_birthday', ?, ?)",
    )
    .bind(id, lineUserId, now, now)
    .run();
  return {
    id,
    line_user_id: lineUserId,
    state: "waiting_birthday",
    birth_date: null,
    sap_session_id: null,
    calculator_summary: null,
    innate_profile: null,
    created_at: now,
    updated_at: now,
  };
}

export async function updateD1Session(
  db: D1Database,
  id: string,
  updates: Partial<
    Pick<
      MizukagamiD1Row,
      | "state"
      | "birth_date"
      | "sap_session_id"
      | "calculator_summary"
      | "innate_profile"
    >
  >,
): Promise<void> {
  const sets: string[] = ["updated_at = ?"];
  const vals: string[] = [new Date().toISOString()];
  if (updates.state) {
    sets.push("state = ?");
    vals.push(updates.state);
  }
  if (updates.birth_date) {
    sets.push("birth_date = ?");
    vals.push(updates.birth_date);
  }
  if (updates.sap_session_id) {
    sets.push("sap_session_id = ?");
    vals.push(updates.sap_session_id);
  }
  if (updates.calculator_summary) {
    sets.push("calculator_summary = ?");
    vals.push(updates.calculator_summary);
  }
  if (updates.innate_profile) {
    sets.push("innate_profile = ?");
    vals.push(updates.innate_profile);
  }
  vals.push(id);
  await db
    .prepare(`UPDATE mizukagami_sessions SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...vals)
    .run();
}

// ============================================================
// Trigger detection
// ============================================================

const MIZUKAGAMI_TRIGGERS = [
  "水鏡",
  "みずかがみ",
  "mizukagami",
  "診断を始める",
  "水鏡を始める",
];

export function isMizukagamiTrigger(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return MIZUKAGAMI_TRIGGERS.some((t) => normalized.includes(t.toLowerCase()));
}

// ============================================================
// Birthday parsing
// ============================================================

function parseBirthday(text: string): string | null {
  // Strip all non-digit characters first, then check patterns
  const digitsOnly = text.trim().replace(/[\s\-\/\.年月日]/g, "");

  let year: number, month: number, day: number;

  // Pattern 1: 8 digits (YYYYMMDD)
  const m8 = digitsOnly.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m8) {
    year = parseInt(m8[1], 10);
    month = parseInt(m8[2], 10);
    day = parseInt(m8[3], 10);
  } else {
    // Pattern 2: YYYY-MM-DD or YYYY/MM/DD (original text)
    const mDash = text.trim().match(/^(\d{4})[\-\/](\d{1,2})[\-\/](\d{1,2})$/);
    if (mDash) {
      year = parseInt(mDash[1], 10);
      month = parseInt(mDash[2], 10);
      day = parseInt(mDash[3], 10);
    } else {
      return null;
    }
  }

  // Validate ranges
  if (year < 1900 || year > new Date().getFullYear()) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;

  // Build YYYY-MM-DD string
  const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  // Final validation: ensure it's a real date and in the past
  const d = new Date(dateStr + "T00:00:00Z");
  if (isNaN(d.getTime())) return null;
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() + 1 !== month ||
    d.getUTCDate() !== day
  )
    return null;
  if (d > new Date()) return null;

  return dateStr;
}

// ============================================================
// API Clients (with Vercel Protection Bypass)
// ============================================================

/** Build common headers for SAP API calls. Includes Vercel bypass if configured. */
function buildSapHeaders(
  sapApiKey: string,
  vercelBypass?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": sapApiKey,
  };
  if (vercelBypass) {
    headers["x-vercel-protection-bypass"] = vercelBypass;
  }
  return headers;
}

async function callDiagnosisApi(
  sapApiUrl: string,
  sapApiKey: string,
  birthday: string,
  vercelBypass?: string,
): Promise<DiagnosisApiResponse> {
  const res = await fetch(`${sapApiUrl}/api/line/diagnosis`, {
    method: "POST",
    headers: buildSapHeaders(sapApiKey, vercelBypass),
    body: JSON.stringify({ birthday, mode: "innate_only" }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Diagnosis API error: ${res.status} ${text}`);
  }
  return (await res.json()) as DiagnosisApiResponse;
}

export async function callMirrorSessionApi(
  sapApiUrl: string,
  sapApiKey: string,
  body: Record<string, unknown>,
  vercelBypass?: string,
): Promise<MirrorSessionApiResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 55_000);
  let res: Response;
  try {
    res = await fetch(`${sapApiUrl}/api/line/mirror-session`, {
      method: "POST",
      headers: buildSapHeaders(sapApiKey, vercelBypass),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Mirror session API error: ${res.status} ${text}`);
  }
  return (await res.json()) as MirrorSessionApiResponse;
}

async function checkMirrorSessionStatus(
  sapApiUrl: string,
  sapApiKey: string,
  lineUserId: string,
  vercelBypass?: string,
): Promise<MirrorSessionStatusResponse> {
  const res = await fetch(`${sapApiUrl}/api/line/mirror-session`, {
    method: "POST",
    headers: buildSapHeaders(sapApiKey, vercelBypass),
    body: JSON.stringify({ action: "status", line_user_id: lineUserId }),
  });
  if (!res.ok) return { hasActiveSession: false, session: null };
  return (await res.json()) as MirrorSessionStatusResponse;
}

// ============================================================
// Tradition colors
// ============================================================

export const TRADITION_COLORS: Record<
  string,
  { color: string; label: string }
> = {
  干支: { color: "#C4A882", label: "Chinese Zodiac" },
  数秘術: { color: "#B08CD8", label: "Numerology" },
  四柱推命: { color: "#C4A882", label: "BaZi" },
  西洋占星術: { color: "#E07B6A", label: "Western Astrology" },
  カバラ: { color: "#B08CD8", label: "Kabbalah" },
  マヤ暦: { color: "#D4B06A", label: "Maya Calendar" },
  宿曜: { color: "#7EB8D8", label: "Sukuyo" },
  易経: { color: "#8BC4A0", label: "I Ching" },
  九星気学: { color: "#FFFFFF", label: "Nine Star Ki" },
  算命学: { color: "#8BC4A0", label: "Sanmei" },
  紫微斗数: { color: "#B08CD8", label: "Zi Wei Dou Shu" },
  ヴェーダ占星術: { color: "#7EB8D8", label: "Vedic" },
};

// ============================================================
// Flex Message builders
// ============================================================

export function buildProgressDots(
  disclosed: string[],
  total: number = 12,
): Record<string, unknown> {
  const dots = [];
  for (let i = 0; i < total; i++) {
    dots.push({
      type: "box",
      layout: "vertical",
      contents: [],
      width: "6px",
      height: "6px",
      cornerRadius: "3px",
      backgroundColor: i < disclosed.length ? "#7EB8D8" : "#1a1a2e",
    });
  }
  return {
    type: "box",
    layout: "horizontal",
    contents: dots,
    spacing: "4px",
    justifyContent: "center",
    margin: "md",
  };
}

export function buildDisclosureFlexBubble(
  disclosed: string[],
  newTraditions: string[],
  calcSummary?: Record<string, string>,
): Record<string, unknown> {
  const tradContents = newTraditions.flatMap((t) => {
    const tc = TRADITION_COLORS[t] ?? { color: "#8e8ea8", label: "" };
    const result = calcSummary?.[t];
    const items: Record<string, unknown>[] = [
      {
        type: "box",
        layout: "horizontal",
        margin: "sm",
        contents: [
          {
            type: "box",
            layout: "vertical",
            contents: [],
            width: "8px",
            height: "8px",
            cornerRadius: "4px",
            backgroundColor: tc.color,
            offsetTop: "4px",
          },
          {
            type: "text",
            text: t,
            size: "xs",
            color: tc.color,
            margin: "sm",
            weight: "bold",
          },
        ],
      },
    ];
    if (result) {
      items.push({
        type: "box",
        layout: "horizontal",
        contents: [
          {
            type: "text",
            text: result,
            size: "sm",
            color: "#e0e0e8",
          },
        ],
        paddingStart: "16px",
        margin: "xs",
      });
    }
    return items;
  });
  return {
    type: "bubble",
    size: "mega",
    body: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#050008",
      paddingAll: "20px",
      contents: [
        buildProgressDots(disclosed),
        { type: "separator", margin: "lg", color: "#1a1a2e" },
        ...tradContents,
        {
          type: "text",
          text: `${disclosed.length} / 12 叡智体系`,
          size: "xxs",
          color: "#5e5e7e",
          align: "center",
          margin: "lg",
        },
      ],
    },
  };
}

/**
 * ブリッジメッセージ生成（LLM不要、決定論的）
 * q6応答とカード到着の間に送る演出メッセージ。
 * innateProfileとcalcSummaryから即座に生成。
 */
export function buildBridgeMessages(
  innateProfile: {
    soulMatch?: { soulName?: string; soulNo?: number };
    spiralPrimary?: string;
  } | null,
  calcSummary?: Record<string, string>,
): Array<Record<string, unknown>> {
  const messages: Array<Record<string, unknown>> = [];

  // Bridge 1: 12叡智の収束演出
  messages.push({
    type: "text",
    text: "12の叡智があなたの水面に映し出されました。\nすべてが一つの方向に収束しています...",
  });

  // Bridge 2: 216魂マッチング演出（soulMatchがある場合のみ）
  const soulName = innateProfile?.soulMatch?.soulName;
  if (soulName) {
    messages.push({
      type: "text",
      text: `216のアーキタイプから、あなたの魂を照合しています...\n「${soulName}」の共鳴を感じます。\n\nカード生成に約1分ほどお待ちください。`,
    });
  } else {
    messages.push({
      type: "text",
      text: "あなたの水面に映る叡智を、一枚のカードに紡いでいます...\n\nカード生成に約1分ほどお待ちください。",
    });
  }

  return messages;
}

export function buildFinalCardFlexBubble(
  card: WaterMirrorCardV2,
): Record<string, unknown> {
  const actionItems = [
    { icon: "⚡", label: "WHAT", text: card.action_guidance.what },
    { icon: "🕐", label: "WHEN", text: card.action_guidance.when },
    { icon: "🧭", label: "WHERE", text: card.action_guidance.where },
    { icon: "👥", label: "WHO", text: card.action_guidance.who },
  ];
  const userWordBubbles = card.user_words.slice(0, 8).map((w) => ({
    type: "box",
    layout: "vertical",
    contents: [{ type: "text", text: w, size: "xxs", color: "#8e8ea8" }],
    backgroundColor: "#1a1a2e",
    cornerRadius: "12px",
    paddingAll: "6px",
    paddingStart: "10px",
    paddingEnd: "10px",
  }));
  return {
    type: "bubble",
    size: "mega",
    body: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#050008",
      paddingAll: "20px",
      contents: [
        {
          type: "box",
          layout: "horizontal",
          contents: [
            { type: "filler" },
            {
              type: "text",
              text: "水　鏡",
              size: "lg",
              color: "#e0e0e8",
              weight: "bold",
              align: "center",
            },
            { type: "filler" },
          ],
        },
        // Soul name (216魂マッチング結果)
        ...(card.soul_name
          ? [
              {
                type: "text",
                text: `「${card.soul_name}」の魂`,
                size: "md",
                color: "#D4B06A",
                weight: "bold",
                align: "center",
                margin: "md",
              },
            ]
          : []),
        {
          type: "text",
          text: card.user_essence,
          size: "sm",
          color: "#e0e0e8",
          wrap: true,
          align: "center",
          margin: "lg",
        },
        { type: "separator", margin: "lg", color: "#1a1a2e" },
        {
          type: "text",
          text: "YOUR WORDS",
          size: "xxs",
          color: "#5e5e7e",
          margin: "lg",
        },
        // User words: split into rows of 3 to avoid needing wrap on box
        ...(userWordBubbles.length > 0
          ? [
              {
                type: "box",
                layout: "horizontal",
                contents: userWordBubbles.slice(0, 3),
                spacing: "4px",
                margin: "sm",
              },
              ...(userWordBubbles.length > 3
                ? [
                    {
                      type: "box",
                      layout: "horizontal",
                      contents: userWordBubbles.slice(3),
                      spacing: "4px",
                      margin: "xs",
                    },
                  ]
                : []),
            ]
          : []),
        { type: "separator", margin: "lg", color: "#1a1a2e" },
        {
          type: "text",
          text: "ACTION GUIDANCE",
          size: "xxs",
          color: "#5e5e7e",
          margin: "lg",
        },
        ...actionItems.map((item) => ({
          type: "box",
          layout: "horizontal",
          margin: "sm",
          contents: [
            {
              type: "text",
              text: `${item.icon} ${item.label}`,
              size: "xxs",
              color: "#7EB8D8",
              flex: 2,
            },
            {
              type: "text",
              text: item.text,
              size: "xxs",
              color: "#e0e0e8",
              wrap: true,
              flex: 5,
            },
          ],
        })),
        { type: "separator", margin: "lg", color: "#1a1a2e" },
        {
          type: "text",
          text: card.closing_message,
          size: "xs",
          color: "#8e8ea8",
          wrap: true,
          align: "center",
          margin: "lg",
        },
      ],
    },
  };
}

// ============================================================
// Main handler
// ============================================================

export interface MizukagamiResult {
  handled: boolean;
  error?: string;
}

export interface MizukagamiQueueMessage {
  type: "session_start" | "session_message";
  sessionId: string;
  lineUserId: string;
  lineAccessToken: string;
  sapApiUrl: string;
  sapApiKey: string;
  vercelBypass?: string;
  innateProfile?: string;
  calcSummary?: string;
  text?: string;
  d1SessionId?: string;
}

export async function handleMizukagami(
  db: D1Database,
  lineClient: LineClient,
  lineUserId: string,
  text: string,
  replyToken: string,
  sapApiUrl: string,
  sapApiKey: string,
  vercelBypass?: string,
  queue?: Queue,
): Promise<MizukagamiResult> {
  try {
    await ensureMizukagamiTable(db);

    const d1Session = await getActiveD1Session(db, lineUserId);

    // --- Case 1: No D1 session, check if trigger ---
    if (!d1Session) {
      if (!isMizukagamiTrigger(text)) {
        // Also check SAP for active mirror session (resuming after worker restart)
        const sapStatus = await checkMirrorSessionStatus(
          sapApiUrl,
          sapApiKey,
          lineUserId,
          vercelBypass,
        );
        if (!sapStatus.hasActiveSession) return { handled: false };
        // SAP has active session but D1 doesn't — create D1 record and continue
        const newD1 = await createD1Session(db, lineUserId);
        await updateD1Session(db, newD1.id, {
          state: "active",
          sap_session_id: sapStatus.session?.session_id ?? null,
        });
        // Fall through to Case 3 (active session message)
        return await handleActiveSession(
          db,
          newD1.id,
          lineClient,
          lineUserId,
          text,
          replyToken,
          sapApiUrl,
          sapApiKey,
          vercelBypass,
          undefined,
          queue,
        );
      }

      // Trigger detected — start new session
      await createD1Session(db, lineUserId);
      await lineClient.replyMessage(replyToken, [
        {
          type: "text",
          text: "水鏡の水面が静かに揺れています。\n\nあなたの12の叡智を映し出すために、\n生年月日を教えてください。\n\n例: 19810324",
        },
      ]);
      return { handled: true };
    }

    // --- Case 2: Waiting for birthday ---
    if (d1Session.state === "waiting_birthday") {
      // If user sends trigger word again, reset session
      if (isMizukagamiTrigger(text)) {
        await updateD1Session(db, d1Session.id, { state: "completed" });
        const newSession = await createD1Session(db, lineUserId);
        console.log(
          `[mizukagami] Session reset for ${lineUserId}, new session: ${newSession.id}`,
        );
        await lineClient.replyMessage(replyToken, [
          {
            type: "text",
            text: "水鏡の水面が静かに揺れています。\n\nあなたの12の叡智を映し出すために、\n生年月日を教えてください。\n\n例: 19810324",
          },
        ]);
        return { handled: true };
      }

      const birthday = parseBirthday(text);
      console.log(`[mizukagami] parseBirthday("${text}") => ${birthday}`);
      if (!birthday) {
        await lineClient.replyMessage(replyToken, [
          {
            type: "text",
            text: "生年月日の形式が正しくありません。\n8桁の数字で入力してください。\n\n例: 19810324",
          },
        ]);
        return { handled: true };
      }

      // === Diagnosis only (~2s) — save result, reply with summary ===
      let diagResult: DiagnosisApiResponse;
      try {
        diagResult = await callDiagnosisApi(
          sapApiUrl,
          sapApiKey,
          birthday,
          vercelBypass,
        );
      } catch (err) {
        console.error("[mizukagami] Diagnosis API failed:", err);
        await lineClient.replyMessage(replyToken, [
          {
            type: "text",
            text: "診断の計算中にエラーが発生しました。\n「水鏡」と送ると最初からやり直せます。",
          },
        ]);
        return { handled: true };
      }

      const innateProfile = {
        spiralPrimary: diagResult.diagnosis.innate.primary,
        confidence: diagResult.diagnosis.innate.confidence,
        kaku: diagResult.unleash?.kaku ?? { name: "unknown", description: "" },
        honryou: diagResult.unleash?.honryou ?? {
          name: "unknown",
          description: "",
        },
        miushinai: diagResult.unleash?.miushinai ?? {
          name: "unknown",
          description: "",
        },
        calculatorDetails: diagResult.calculatorDetails,
        ...(diagResult.diagnosis.innate.nasaPrecision
          ? { nasaPrecision: diagResult.diagnosis.innate.nasaPrecision }
          : {}),
        ...(diagResult.soulMatch
          ? {
              soulMatch: {
                soulNo: diagResult.soulMatch.soulNo,
                soulName: diagResult.soulMatch.soulName,
                soulNameReading: "",
                innateSpiral: diagResult.soulMatch.primarySpiral,
                acquiredSystem: diagResult.soulMatch.secondarySystem,
                manifestedWisdom: diagResult.soulMatch.manifestation,
              },
            }
          : {}),
      };
      const calcSummary = buildCalculatorSummary(diagResult.calculatorDetails);

      // Save diagnosis to D1, state → "diagnosed"
      await updateD1Session(db, d1Session.id, {
        state: "diagnosed",
        birth_date: birthday,
        innate_profile: JSON.stringify(innateProfile),
        calculator_summary: JSON.stringify(calcSummary),
      });

      // Reply with diagnosis summary + invite to start dialogue
      const allTraditions = Object.entries(calcSummary);
      const summaryLines = allTraditions
        .slice(0, 6)
        .map(([t, v]) => `• ${t}: ${v}`)
        .join("\n");
      await lineClient.replyMessage(replyToken, [
        {
          type: "text",
          text: `✧ 12の叡智体系の計算が完了しました。\n\n${summaryLines}\n...他${Math.max(0, allTraditions.length - 6)}体系\n\n水鏡との対話を始めましょう。\n何か一言、お願いします。`,
        },
      ]);
      return { handled: true };
    }

    // --- Case 2.5: Diagnosed (ready to start mirror session) ---
    if (d1Session.state === "diagnosed") {
      if (isMizukagamiTrigger(text)) {
        await updateD1Session(db, d1Session.id, { state: "completed" });
        // Cleanup SAP session (fire-and-forget)
        callMirrorSessionApi(
          sapApiUrl,
          sapApiKey,
          { action: "complete", line_user_id: lineUserId },
          vercelBypass,
        ).catch(() => {});
        await createD1Session(db, lineUserId);
        await lineClient.replyMessage(replyToken, [
          {
            type: "text",
            text: "水鏡の水面が静かに揺れています。\n\nあなたの12の叡智を映し出すために、\n生年月日を教えてください。\n\n例: 19810324",
          },
        ]);
        return { handled: true };
      }

      // User responded — start mirror session
      if (!d1Session.innate_profile) {
        await lineClient.replyMessage(replyToken, [
          {
            type: "text",
            text: "セッションデータが見つかりません。\n「水鏡」と送ると最初からやり直せます。",
          },
        ]);
        await updateD1Session(db, d1Session.id, { state: "completed" });
        return { handled: true };
      }

      console.log("[mizukagami] diagnosed state: showing loading + enqueue");
      // Show loading animation via raw fetch (SDK dist stale, bypass with direct API call)
      await fetch("https://api.line.me/v2/bot/chat/loading/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${(lineClient as unknown as { channelAccessToken: string }).channelAccessToken}`,
        },
        body: JSON.stringify({ chatId: lineUserId, loadingSeconds: 30 }),
      }).catch(() => {});

      // Enqueue for background processing (15-min budget)
      console.log(`[mizukagami] queue available: ${!!queue}`);
      if (queue) {
        console.log("[mizukagami] sending to queue...");
        await queue.send({
          type: "session_start",
          sessionId: d1Session.id,
          lineUserId,
          lineAccessToken: (
            lineClient as unknown as { channelAccessToken: string }
          ).channelAccessToken,
          sapApiUrl,
          sapApiKey,
          vercelBypass,
          innateProfile: d1Session.innate_profile,
          calcSummary: d1Session.calculator_summary,
        } satisfies MizukagamiQueueMessage);
        return { handled: true };
      }

      // Fallback: direct call (if queue not available)
      const savedProfile = JSON.parse(d1Session.innate_profile);
      const savedCalcSummary: Record<string, string> =
        d1Session.calculator_summary
          ? JSON.parse(d1Session.calculator_summary)
          : {};

      let sessionResponse: MirrorSessionApiResponse;
      try {
        sessionResponse = await callMirrorSessionApi(
          sapApiUrl,
          sapApiKey,
          {
            action: "start",
            line_user_id: lineUserId,
            innate_profile: savedProfile,
          },
          vercelBypass,
        );
      } catch (err) {
        console.error("[mizukagami] Mirror session start failed:", err);
        await lineClient.pushMessage(lineUserId, [
          {
            type: "text",
            text: "水鏡のセッション開始に失敗しました。\n「水鏡」と送ると最初からやり直せます。",
          },
        ]);
        await updateD1Session(db, d1Session.id, { state: "completed" });
        return { handled: true };
      }

      // Send all messages in ONE pushMessage call to minimize time
      const messages: Array<Record<string, unknown>> = [];
      const disclosed = sessionResponse.disclosed_traditions ?? [];
      if (disclosed.length > 0) {
        messages.push({
          type: "flex",
          altText: `${disclosed.join("・")} が開示されました (${disclosed.length}/12)`,
          contents: buildDisclosureFlexBubble(
            disclosed,
            disclosed,
            savedCalcSummary,
          ),
        });
      }
      if (sessionResponse.message) {
        messages.push({ type: "text", text: sessionResponse.message });
      }
      if (messages.length > 0) {
        await lineClient.pushMessage(lineUserId, messages.slice(0, 5));
      }

      await updateD1Session(db, d1Session.id, {
        state: "active",
        sap_session_id: sessionResponse.session_id,
      });
      return { handled: true };
    }

    // --- Case 3: Active session — forward to mirror-session API ---
    if (d1Session.state === "active") {
      // Allow trigger word to reset active session
      if (isMizukagamiTrigger(text)) {
        await updateD1Session(db, d1Session.id, { state: "completed" });
        // Cleanup SAP session (fire-and-forget)
        callMirrorSessionApi(
          sapApiUrl,
          sapApiKey,
          { action: "complete", line_user_id: lineUserId },
          vercelBypass,
        ).catch(() => {});
        await createD1Session(db, lineUserId);
        await lineClient.replyMessage(replyToken, [
          {
            type: "text",
            text: "水鏡の水面が静かに揺れています。\n\nあなたの12の叡智を映し出すために、\n生年月日を教えてください。\n\n例: 19810324",
          },
        ]);
        return { handled: true };
      }
      const calcSummary = d1Session.calculator_summary
        ? (JSON.parse(d1Session.calculator_summary) as Record<string, string>)
        : undefined;
      return await handleActiveSession(
        db,
        d1Session.id,
        lineClient,
        lineUserId,
        text,
        replyToken,
        sapApiUrl,
        sapApiKey,
        vercelBypass,
        calcSummary,
        queue,
      );
    }

    return { handled: false };
  } catch (err) {
    console.error("[mizukagami] Error:", err);
    return {
      handled: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function handleActiveSession(
  db: D1Database,
  d1SessionId: string,
  lineClient: LineClient,
  lineUserId: string,
  text: string,
  replyToken: string,
  sapApiUrl: string,
  sapApiKey: string,
  vercelBypass?: string,
  calcSummary?: Record<string, string>,
  queue?: Queue,
): Promise<MizukagamiResult> {
  // Show loading animation via raw fetch
  await fetch("https://api.line.me/v2/bot/chat/loading/start", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${(lineClient as unknown as { channelAccessToken: string }).channelAccessToken}`,
    },
    body: JSON.stringify({ chatId: lineUserId, loadingSeconds: 30 }),
  }).catch(() => {});

  // Enqueue for background processing (15-min budget)
  if (queue) {
    await queue.send({
      type: "session_message",
      sessionId: d1SessionId,
      lineUserId,
      lineAccessToken: (lineClient as unknown as { channelAccessToken: string })
        .channelAccessToken,
      sapApiUrl,
      sapApiKey,
      vercelBypass,
      text,
      d1SessionId,
      calcSummary: calcSummary ? JSON.stringify(calcSummary) : undefined,
    } satisfies MizukagamiQueueMessage);
    return { handled: true };
  }

  // Fallback: direct call (if queue not available)
  let apiResponse: MirrorSessionApiResponse;
  try {
    apiResponse = await callMirrorSessionApi(
      sapApiUrl,
      sapApiKey,
      {
        action: "message",
        line_user_id: lineUserId,
        text,
      },
      vercelBypass,
    );
  } catch (err) {
    console.error("[mizukagami] Active session API error:", err);
    await updateD1Session(db, d1SessionId, { state: "completed" });
    await lineClient.pushMessage(lineUserId, [
      {
        type: "text",
        text: "水鏡のセッションでエラーが発生しました。\n「水鏡」と送ると最初からやり直せます。",
      },
    ]);
    return { handled: true };
  }

  // q6→card 自動遷移: next_step が "card" ならユーザー入力を待たずにカード生成
  let cardResponse: MirrorSessionApiResponse | null = null;
  if (apiResponse.next_step === "card" && !apiResponse.card) {
    try {
      cardResponse = await callMirrorSessionApi(
        sapApiUrl,
        sapApiKey,
        {
          action: "message",
          line_user_id: lineUserId,
          text: "水鏡カードを紡いでください",
        },
        vercelBypass,
      );
    } catch (err) {
      console.error("[mizukagami] Auto card generation error:", err);
    }
  }

  // Send ALL messages in ONE pushMessage call (minimize HTTP calls to stay within 30s)
  const messages: Array<Record<string, unknown>> = [];

  const disclosed = apiResponse.disclosed_traditions ?? [];
  if (disclosed.length > 0 && !apiResponse.card && !cardResponse?.card) {
    messages.push({
      type: "flex",
      altText: `${disclosed.length}/12 叡智体系`,
      contents: buildDisclosureFlexBubble(disclosed, disclosed, calcSummary),
    });
  }

  if (apiResponse.message) {
    messages.push({ type: "text", text: apiResponse.message });
  }

  // Card message from auto-transition
  if (cardResponse?.message) {
    messages.push({ type: "text", text: cardResponse.message });
  }

  // Final card (from original response or auto-transition)
  const finalCard = cardResponse?.card ?? apiResponse.card;
  if (finalCard) {
    messages.push({
      type: "flex",
      altText: "水鏡カード — あなたの12叡智の統合",
      contents: buildFinalCardFlexBubble(finalCard),
    });
  }

  const isCompleted =
    cardResponse?.sessionCompleted ?? apiResponse.sessionCompleted;
  const sessionId = cardResponse?.session_id ?? apiResponse.session_id;
  if (isCompleted) {
    await updateD1Session(db, d1SessionId, { state: "completed" });
    if (sessionId) {
      const reportUrl = `${sapApiUrl}/mizukagami/report/${sessionId}`;
      messages.push({
        type: "flex",
        altText: "振り返りレポートを見る",
        contents: {
          type: "bubble",
          body: {
            type: "box",
            layout: "vertical",
            backgroundColor: "#07070d",
            paddingAll: "20px",
            contents: [
              {
                type: "text",
                text: "あなたの水面の全貌を見る",
                size: "sm",
                color: "#e0e0e8",
                align: "center",
              },
            ],
          },
          footer: {
            type: "box",
            layout: "vertical",
            backgroundColor: "#07070d",
            paddingAll: "12px",
            contents: [
              {
                type: "button",
                action: {
                  type: "uri",
                  label: "振り返りレポート →",
                  uri: reportUrl,
                },
                style: "primary",
                color: "#7EB8D8",
              },
            ],
          },
        },
      });
    }
  }

  if (messages.length > 0) {
    await lineClient.pushMessage(lineUserId, messages.slice(0, 5));
  }

  return { handled: true };
}
