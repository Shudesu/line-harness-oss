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

export class LineClient {
  constructor(private readonly channelAccessToken: string) {}

  // ─── Core request helper ──────────────────────────────────────────────────

  async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ data: unknown; headers: Headers }> {
    const url = `${LINE_API_BASE}${path}`;

    const options: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.channelAccessToken}`,
      },
    };

    if (method !== 'GET' && method !== 'DELETE' && body !== undefined) {
      options.body = JSON.stringify(body);
    }

    const res = await fetch(url, options);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `LINE API error: ${res.status} ${res.statusText} — ${text}`,
      );
    }

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

  async multicast(
    to: string[],
    messages: Message[],
    customAggregationUnits?: string[],
  ): Promise<{ data: unknown; requestId: string | null }> {
    const body: Record<string, unknown> = { to, messages };
    if (customAggregationUnits) {
      body.customAggregationUnits = customAggregationUnits;
    }
    const { data, headers } = await this.request(
      'POST',
      '/v2/bot/message/multicast',
      body,
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
