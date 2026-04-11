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

type D1RunResult = {
  meta?: {
    changes?: number;
  };
};

type D1PreparedStatementLike = {
  bind(...values: unknown[]): {
    first<T = unknown>(): Promise<T | null>;
    run(): Promise<D1RunResult>;
  };
};

type D1DatabaseLike = {
  prepare(query: string): D1PreparedStatementLike;
};

export interface LineClientOptions {
  autoLog?: boolean;
}

export async function computeMessageContentHash(
  friendId: string,
  messages: Message[],
): Promise<string> {
  const key = friendId + JSON.stringify(messages);
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(key),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .substring(0, 32);
}

export class LineClient {
  private readonly autoLog: boolean;

  constructor(
    private readonly channelAccessToken: string,
    private readonly db?: D1DatabaseLike,
    options: LineClientOptions = {},
  ) {
    this.autoLog = options.autoLog ?? true;
  }

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
    const dedup = await this.prepareFriendSend(to, messages);
    if (dedup?.skip) return;

    const body: PushMessageRequest = { to, messages };
    await this.request('/message/push', body);
  }

  async multicast(to: string[], messages: Message[]): Promise<void> {
    const recipients = await Promise.all(
      to.map(async (lineUserId) => ({
        lineUserId,
        dedup: await this.prepareFriendSend(lineUserId, messages),
      })),
    );
    const allowedRecipients = recipients.filter((recipient) => !recipient.dedup?.skip);
    if (allowedRecipients.length === 0) return;

    const body: MulticastRequest = {
      to: allowedRecipients.map((recipient) => recipient.lineUserId),
      messages,
    };
    await this.request('/message/multicast', body);
  }

  async broadcast(messages: Message[], broadcastId?: string): Promise<void> {
    if (this.db && broadcastId) {
      const contentHash = await computeMessageContentHash(broadcastId, messages);
      const existing = await this.db
        .prepare(
          `SELECT 1 FROM messages_log
           WHERE broadcast_id = ?
             AND content_hash = ?
             AND created_at > datetime('now','-5 minutes','+9 hours')
           LIMIT 1`,
        )
        .bind(broadcastId, contentHash)
        .first();
      if (existing) {
        console.log(`[DEDUP] Skipping duplicate broadcast ${broadcastId}`);
        return;
      }
    }

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

  private async prepareFriendSend(
    to: string,
    messages: Message[],
  ): Promise<{ friendId: string; contentHash: string; skip: boolean } | null> {
    if (!this.db) return null;

    const friendId = await this.resolveFriendId(to);
    if (!friendId) return null;

    const allowed = await checkFriendRateLimit(this.db, friendId);
    if (!allowed) {
      console.warn(`[RATE_LIMIT] Skipping send to ${friendId}`);
      return { friendId, contentHash: '', skip: true };
    }

    const contentHash = await computeMessageContentHash(friendId, messages);
    const inserted = await this.insertMessageLog(friendId, messages, contentHash);
    if (!inserted) {
      console.log(`[DEDUP] Skipping duplicate send to ${friendId}`);
      return { friendId, contentHash, skip: true };
    }

    return { friendId, contentHash, skip: false };
  }

  private async resolveFriendId(to: string): Promise<string | null> {
    if (!this.db) return null;

    const friend = await this.db
      .prepare('SELECT id FROM friends WHERE id = ? OR line_user_id = ? LIMIT 1')
      .bind(to, to)
      .first<{ id: string }>();
    return friend?.id ?? null;
  }

  private async insertMessageLog(
    friendId: string,
    messages: Message[],
    contentHash: string,
  ): Promise<boolean> {
    if (!this.db) return false;

    const logId = crypto.randomUUID();
    const firstMessage = messages[0];
    const messageType = firstMessage?.type ?? 'unknown';
    const dedupWindow = Math.floor(Date.now() / (5 * 60 * 1000));
    const result = await this.db
      .prepare(
        `INSERT OR IGNORE INTO messages_log
           (id, friend_id, direction, message_type, content, content_hash, idempotency_key, created_at)
         SELECT ?, ?, 'outgoing', ?, ?, ?, ?, datetime('now','+9 hours')
         WHERE NOT EXISTS (
           SELECT 1 FROM messages_log
           WHERE friend_id = ?
             AND content_hash = ?
             AND created_at > datetime('now','-5 minutes','+9 hours')
         )`,
      )
      .bind(
        logId,
        friendId,
        messageType,
        JSON.stringify(messages),
        contentHash,
        `send:${friendId}:${contentHash}:${dedupWindow}`,
        friendId,
        contentHash,
      )
      .run();
    return (result.meta?.changes ?? 0) > 0;
  }
}

async function checkFriendRateLimit(db: D1DatabaseLike, friendId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) as cnt FROM messages_log
       WHERE friend_id = ?
         AND created_at > datetime('now','-1 hour','+9 hours')`,
    )
    .bind(friendId)
    .first<{ cnt: number }>();
  return (row?.cnt ?? 0) < 10;
}
