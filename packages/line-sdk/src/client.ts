import type {
  BroadcastRequest,
  FlexContainer,
  Message,
  MulticastRequest,
  PushMessageRequest,
  ReplyMessageRequest,
  RichMenuObject,
  UserProfile,
} from './types.js';

const LINE_API_BASE = 'https://api.line.me';

// P1 緊急修正 (2026-06-07):
//   1. fetch にタイムアウト無し → Worker の 30 秒 wall 制限超過リスク。
//      AbortSignal.timeout(15_000) で 15 秒に強制打ち切り (push/multicast/broadcast 全て)。
//   2. 429 (rate limit) リトライ無し → broadcast が silent loss。
//      Retry-After ヘッダを尊重、指数バックオフで最大 2 回までリトライ。
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RETRY_ATTEMPTS = 2;
const RETRY_BACKOFF_MS = [3_000, 6_000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(header: string | null, fallbackMs: number): number {
  if (!header) return fallbackMs;
  // Retry-After は秒数か HTTP-date。LINE は秒数で返すので数値優先。
  const sec = Number(header);
  if (Number.isFinite(sec) && sec > 0) {
    // Worker の 30 秒制限を超えない範囲にクリップ
    return Math.min(sec * 1000, 10_000);
  }
  return fallbackMs;
}

export class LineClient {
  constructor(private readonly channelAccessToken: string) {}

  // ─── Core request helper ──────────────────────────────────────────────────

  async request(
    method: string,
    path: string,
    body?: unknown,
    /**
     * P1 (2026-06-07): 任意の追加ヘッダ。X-Line-Retry-Key (multicast の重複防止 key)
     * を渡す経路として使う。Authorization / Content-Type は base 側で固定し、
     * extra でそれらを上書きできないよう base の後ろから merge する。
     */
    extraHeaders?: Record<string, string>,
  ): Promise<{ data: unknown; headers: Headers }> {
    const url = `${LINE_API_BASE}${path}`;

    const mergedHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.channelAccessToken}`,
    };
    if (extraHeaders) {
      for (const [k, v] of Object.entries(extraHeaders)) {
        // base ヘッダは上書きさせない (Authorization 等を retryKey から書き換えられる事故を防ぐ)。
        if (k.toLowerCase() === 'authorization' || k.toLowerCase() === 'content-type') continue;
        mergedHeaders[k] = v;
      }
    }

    const baseOptions: RequestInit = {
      method,
      headers: mergedHeaders,
    };

    if (method !== 'GET' && method !== 'DELETE' && body !== undefined) {
      baseOptions.body = JSON.stringify(body);
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
      // 各試行ごとに新しい AbortSignal を生成 (使い回し不可)
      const options: RequestInit = {
        ...baseOptions,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      };

      let res: Response;
      try {
        res = await fetch(url, options);
      } catch (err) {
        // AbortError (timeout) は即 throw、リトライしない
        // (broadcast を 3 回 × 15 秒 = 45 秒待たせると Worker 制限超過)
        if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
          throw new Error(
            `LINE API timeout after ${REQUEST_TIMEOUT_MS}ms: ${method} ${path}`,
          );
        }
        throw err;
      }

      if (res.ok) {
        // Some endpoints (e.g. push, reply) return an empty body with 200.
        const contentType = res.headers.get('content-type') ?? '';
        let data: unknown;
        if (contentType.includes('application/json')) {
          data = await res.json();
        } else {
          data = undefined;
        }
        return { data, headers: res.headers };
      }

      // 429 のみリトライ対象。それ以外は即 throw。
      if (res.status !== 429) {
        const text = await res.text().catch(() => '');
        throw new Error(
          `LINE API error: ${res.status} ${res.statusText} — ${text}`,
        );
      }

      // 429: Retry-After を見て待機 → リトライ
      const text = await res.text().catch(() => '');
      lastError = new Error(
        `LINE API error: ${res.status} ${res.statusText} — ${text}`,
      );

      if (attempt >= MAX_RETRY_ATTEMPTS) break;

      const fallback = RETRY_BACKOFF_MS[attempt] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1];
      const waitMs = parseRetryAfterMs(res.headers.get('retry-after'), fallback);
      console.warn(
        `[line-sdk] 429 rate limit on ${method} ${path}, retry in ${waitMs}ms (attempt ${attempt + 1}/${MAX_RETRY_ATTEMPTS})`,
      );
      await sleep(waitMs);
    }

    // 429 リトライ枯渇 → 最後のエラーを throw
    throw lastError ?? new Error(`LINE API error: 429 retries exhausted on ${method} ${path}`);
  }

  // ─── Profile ──────────────────────────────────────────────────────────────

  async getProfile(userId: string): Promise<UserProfile> {
    const { data } = await this.request(
      'GET',
      `/v2/bot/profile/${encodeURIComponent(userId)}`,
    );
    return data as UserProfile;
  }

  // ─── Messaging ───────────────────────────────────────────────────────────

  async pushMessage(to: string, messages: Message[]): Promise<unknown> {
    const body: PushMessageRequest = { to, messages };
    const { data } = await this.request('POST', '/v2/bot/message/push', body);
    return data;
  }

  /**
   * @param retryKey  P1 (2026-06-07): X-Line-Retry-Key として付与する dedup key。
   *   LINE は 1 分以内に同じ key の multicast を再受信したら無視する公式 dedup を
   *   持つ。cron double-fire や recoverStuck race で同じ batch が二重発射されても
   *   ユーザーが重複メッセージを受け取らないようにする。
   *   呼び出し側は `${broadcast_id}-${batch_offset}` のような決定論的 key を渡す。
   *   形式: UUID 形式 (8-4-4-4-12) 推奨だが、LINE のドキュメント上は任意の文字列。
   */
  async multicast(
    to: string[],
    messages: Message[],
    customAggregationUnits?: string[],
    retryKey?: string,
  ): Promise<{ data: unknown; requestId: string | null }> {
    const body: Record<string, unknown> = { to, messages };
    if (customAggregationUnits) {
      body.customAggregationUnits = customAggregationUnits;
    }
    const extraHeaders: Record<string, string> | undefined = retryKey
      ? { 'X-Line-Retry-Key': retryKey }
      : undefined;
    const { data, headers } = await this.request(
      'POST',
      '/v2/bot/message/multicast',
      body,
      extraHeaders,
    );
    return { data, requestId: headers.get('x-line-request-id') };
  }

  async broadcast(
    messages: Message[],
  ): Promise<{ data: unknown; requestId: string | null }> {
    const body: BroadcastRequest = { messages };
    const { data, headers } = await this.request(
      'POST',
      '/v2/bot/message/broadcast',
      body,
    );
    return { data, requestId: headers.get('x-line-request-id') };
  }

  async replyMessage(
    replyToken: string,
    messages: Message[],
  ): Promise<unknown> {
    const body: ReplyMessageRequest = { replyToken, messages };
    const { data } = await this.request('POST', '/v2/bot/message/reply', body);
    return data;
  }

  // ─── Rich Menu ────────────────────────────────────────────────────────────

  async getRichMenuList(): Promise<{ richmenus: RichMenuObject[] }> {
    const { data } = await this.request('GET', '/v2/bot/richmenu/list');
    return data as { richmenus: RichMenuObject[] };
  }

  async createRichMenu(menu: RichMenuObject): Promise<{ richMenuId: string }> {
    const { data } = await this.request('POST', '/v2/bot/richmenu', menu);
    return data as { richMenuId: string };
  }

  async deleteRichMenu(richMenuId: string): Promise<unknown> {
    const { data } = await this.request(
      'DELETE',
      `/v2/bot/richmenu/${encodeURIComponent(richMenuId)}`,
    );
    return data;
  }

  async setDefaultRichMenu(richMenuId: string): Promise<unknown> {
    const { data } = await this.request(
      'POST',
      `/v2/bot/user/all/richmenu/${encodeURIComponent(richMenuId)}`,
    );
    return data;
  }

  async linkRichMenuToUser(
    userId: string,
    richMenuId: string,
  ): Promise<unknown> {
    const { data } = await this.request(
      'POST',
      `/v2/bot/user/${encodeURIComponent(userId)}/richmenu/${encodeURIComponent(richMenuId)}`,
    );
    return data;
  }

  async unlinkRichMenuFromUser(userId: string): Promise<unknown> {
    const { data } = await this.request(
      'DELETE',
      `/v2/bot/user/${encodeURIComponent(userId)}/richmenu`,
    );
    return data;
  }

  async getRichMenuIdOfUser(userId: string): Promise<{ richMenuId: string }> {
    const { data } = await this.request(
      'GET',
      `/v2/bot/user/${encodeURIComponent(userId)}/richmenu`,
    );
    return data as { richMenuId: string };
  }

  async getDefaultRichMenuId(): Promise<string | null> {
    const url = `${LINE_API_BASE}/v2/bot/user/all/richmenu`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.channelAccessToken}`,
      },
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`LINE API error: ${res.status} ${res.statusText} — ${text}`);
    }
    const data = (await res.json()) as { richMenuId: string };
    return data.richMenuId;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  async pushTextMessage(to: string, text: string): Promise<unknown> {
    return this.pushMessage(to, [{ type: 'text', text }]);
  }

  async pushFlexMessage(
    to: string,
    altText: string,
    contents: FlexContainer,
  ): Promise<unknown> {
    return this.pushMessage(to, [{ type: 'flex', altText, contents }]);
  }

  async pushImageMessage(
    to: string,
    originalContentUrl: string,
    previewImageUrl: string,
  ): Promise<unknown> {
    return this.pushMessage(to, [{ type: 'image', originalContentUrl, previewImageUrl }]);
  }

  // ─── Rich Menu Image Upload ─────────────────────────────────────────────

  /** Upload image to a rich menu. Accepts PNG/JPEG binary (ArrayBuffer or Uint8Array). */
  async uploadRichMenuImage(
    richMenuId: string,
    imageData: ArrayBuffer,
    contentType: 'image/png' | 'image/jpeg' = 'image/png',
  ): Promise<void> {
    const url = `https://api-data.line.me/v2/bot/richmenu/${encodeURIComponent(richMenuId)}/content`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        Authorization: `Bearer ${this.channelAccessToken}`,
      },
      body: imageData,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `LINE API error: ${res.status} ${res.statusText} — ${text}`,
      );
    }
  }

  // ─── Insight API ─────────────────────────────────────────────────────────

  /**
   * Get user interaction statistics for a broadcast message.
   * Data becomes available ~3 days after sending.
   * GET only — no messages are sent.
   */
  async getMessageEventInsight(requestId: string): Promise<unknown> {
    const { data } = await this.request(
      'GET',
      `/v2/bot/insight/message/event?requestId=${encodeURIComponent(requestId)}`,
    );
    return data;
  }

  /**
   * Get statistics per unit for multicast messages.
   * GET only — no messages are sent.
   */
  async getUnitInsight(
    customAggregationUnit: string,
    from: string,
    to: string,
  ): Promise<unknown> {
    const params = new URLSearchParams({ customAggregationUnit, from, to });
    const { data } = await this.request(
      'GET',
      `/v2/bot/insight/message/event/aggregation?${params.toString()}`,
    );
    return data;
  }
}
