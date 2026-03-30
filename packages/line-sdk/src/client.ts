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

const LINE_API_BASE = 'https://api.line.me/v2/bot';

export class LineClient {
  constructor(private readonly channelAccessToken: string) {}

  // ─── Core request helper ──────────────────────────────────────────────────

  private async request<T = unknown>(
    path: string,
    body: object,
    method: 'GET' | 'POST' | 'DELETE' = 'POST',
  ): Promise<T> {
    const url = `${LINE_API_BASE}${path}`;

    const options: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.channelAccessToken}`,
      },
    };

    if (method !== 'GET' && method !== 'DELETE') {
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
    if (contentType.includes('application/json')) {
      return res.json() as Promise<T>;
    }

    return undefined as unknown as T;
  }

  // ─── Profile ──────────────────────────────────────────────────────────────

  async getProfile(userId: string): Promise<UserProfile> {
    return this.request<UserProfile>(
      `/profile/${encodeURIComponent(userId)}`,
      {},
      'GET',
    );
  }

  // ─── Messaging ───────────────────────────────────────────────────────────

  async pushMessage(to: string, messages: Message[]): Promise<void> {
    const body: PushMessageRequest = { to, messages };
    await this.request('/message/push', body);
  }

  async multicast(to: string[], messages: Message[]): Promise<void> {
    const body: MulticastRequest = { to, messages };
    await this.request('/message/multicast', body);
  }

  async broadcast(messages: Message[]): Promise<void> {
    const body: BroadcastRequest = { messages };
    await this.request('/message/broadcast', body);
  }

  async replyMessage(
    replyToken: string,
    messages: Message[],
  ): Promise<void> {
    const body: ReplyMessageRequest = { replyToken, messages };
    await this.request('/message/reply', body);
  }

  // ─── Rich Menu ────────────────────────────────────────────────────────────

  async getRichMenuList(): Promise<{ richmenus: RichMenuObject[] }> {
    return this.request<{ richmenus: RichMenuObject[] }>(
      '/richmenu/list',
      {},
      'GET',
    );
  }

  async createRichMenu(menu: RichMenuObject): Promise<{ richMenuId: string }> {
    return this.request<{ richMenuId: string }>('/richmenu', menu);
  }

  async deleteRichMenu(richMenuId: string): Promise<void> {
    await this.request(
      `/richmenu/${encodeURIComponent(richMenuId)}`,
      {},
      'DELETE',
    );
  }

  async setDefaultRichMenu(richMenuId: string): Promise<void> {
    await this.request(
      `/user/all/richmenu/${encodeURIComponent(richMenuId)}`,
      {},
    );
  }

  async linkRichMenuToUser(userId: string, richMenuId: string): Promise<void> {
    await this.request(
      `/user/${encodeURIComponent(userId)}/richmenu/${encodeURIComponent(richMenuId)}`,
      {},
    );
  }

  async unlinkRichMenuFromUser(userId: string): Promise<void> {
    await this.request(
      `/user/${encodeURIComponent(userId)}/richmenu`,
      {},
      'DELETE',
    );
  }

  async getRichMenuIdOfUser(userId: string): Promise<{ richMenuId: string }> {
    return this.request<{ richMenuId: string }>(
      `/user/${encodeURIComponent(userId)}/richmenu`,
      {},
      'GET',
    );
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  async pushTextMessage(to: string, text: string): Promise<void> {
    await this.pushMessage(to, [{ type: 'text', text }]);
  }

  async pushFlexMessage(
    to: string,
    altText: string,
    contents: FlexContainer,
  ): Promise<void> {
    await this.pushMessage(to, [{ type: 'flex', altText, contents }]);
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
      throw new Error(`LINE API error: ${res.status} ${res.statusText} — ${text}`);
    }
  }

  // ─── Rich Menu Alias (for tab switching) ───────────────────────────────

  async createRichMenuAlias(richMenuId: string, aliasId: string): Promise<void> {
    await this.request('/richmenu/alias', {
      method: 'POST',
      body: JSON.stringify({ richMenuAliasId: aliasId, richMenuId }),
    });
  }

  async deleteRichMenuAlias(aliasId: string): Promise<void> {
    await this.request(`/richmenu/alias/${encodeURIComponent(aliasId)}`, {}, 'DELETE');
  }

  async getRichMenuAliasList(): Promise<{ aliases: { richMenuAliasId: string; richMenuId: string }[] }> {
    return this.request('/richmenu/alias/list', {}, 'GET');
  }

  async updateRichMenuAlias(aliasId: string, richMenuId: string): Promise<void> {
    await this.request(`/richmenu/alias/${encodeURIComponent(aliasId)}`, { richMenuId });
  }
}
