import { jstNow } from '@line-crm/db';

export type KuchikomiRoboEnv = {
  KUCHIKOMI_ROBO_WEBHOOK_URL?: string;
  KUCHIKOMI_ROBO_API_KEY?: string;
  KUCHIKOMI_ROBO_SHARED_SECRET?: string;
  KUCHIKOMI_ROBO_STORE_ID?: string;
};

export type KuchikomiRoboCustomer = {
  friendId?: string;
  lineUserId?: string;
  displayName?: string;
  phone?: string;
  email?: string;
};

export type KuchikomiRoboReviewRequestInput = {
  friendId?: string;
  customer?: KuchikomiRoboCustomer;
  storeId?: string;
  trigger?: string;
  visitAt?: string;
  reviewUrl?: string;
  lineAccountId?: string | null;
  metadata?: Record<string, unknown>;
};

export type KuchikomiRoboReviewRequest = {
  source: 'line-harness';
  event: 'review_request';
  timestamp: string;
  storeId?: string;
  customer: KuchikomiRoboCustomer;
  context: {
    trigger?: string;
    visitAt?: string;
    reviewUrl?: string;
    lineAccountId?: string | null;
    metadata?: Record<string, unknown>;
  };
};

type FriendRow = {
  id: string;
  line_user_id: string | null;
  display_name: string | null;
  metadata: string | null;
};

type SendOptions = {
  url?: string;
  apiKey?: string;
  sharedSecret?: string;
  storeId?: string;
};

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseMetadata(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function hasCustomerKey(customer: KuchikomiRoboCustomer): boolean {
  return Boolean(customer.friendId || customer.lineUserId || customer.phone || customer.email);
}

async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function buildKuchikomiRoboReviewRequest(
  db: D1Database,
  input: KuchikomiRoboReviewRequestInput,
  opts: { defaultStoreId?: string } = {},
): Promise<KuchikomiRoboReviewRequest> {
  const explicitCustomer = input.customer ?? {};
  let friend: FriendRow | null = null;
  let friendMetadata: Record<string, unknown> = {};

  const friendId = input.friendId ?? explicitCustomer.friendId;
  if (friendId) {
    friend = await db
      .prepare('SELECT id, line_user_id, display_name, metadata FROM friends WHERE id = ?')
      .bind(friendId)
      .first<FriendRow>();
    friendMetadata = parseMetadata(friend?.metadata ?? null);
  }

  const customer: KuchikomiRoboCustomer = {
    friendId: explicitCustomer.friendId ?? friend?.id ?? input.friendId,
    lineUserId: explicitCustomer.lineUserId ?? friend?.line_user_id ?? undefined,
    displayName:
      explicitCustomer.displayName ??
      friend?.display_name ??
      readString(friendMetadata.displayName) ??
      readString(friendMetadata.name),
    phone: explicitCustomer.phone ?? readString(friendMetadata.phone) ?? readString(friendMetadata.tel),
    email: explicitCustomer.email ?? readString(friendMetadata.email),
  };

  if (!hasCustomerKey(customer)) {
    throw new Error('Kuchikomi Robo review request needs friendId, lineUserId, phone, or email');
  }

  return {
    source: 'line-harness',
    event: 'review_request',
    timestamp: jstNow(),
    storeId: input.storeId ?? opts.defaultStoreId,
    customer,
    context: {
      trigger: input.trigger,
      visitAt: input.visitAt,
      reviewUrl: input.reviewUrl,
      lineAccountId: input.lineAccountId,
      metadata: {
        ...friendMetadata,
        ...(input.metadata ?? {}),
      },
    },
  };
}

export async function sendKuchikomiRoboReviewRequest(
  env: KuchikomiRoboEnv,
  request: KuchikomiRoboReviewRequest,
  opts: SendOptions = {},
): Promise<{ status: number; responseText: string }> {
  const url = opts.url ?? env.KUCHIKOMI_ROBO_WEBHOOK_URL;
  if (!url) {
    throw new Error('KUCHIKOMI_ROBO_WEBHOOK_URL is not configured');
  }
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'https:' && endpoint.hostname !== 'localhost' && endpoint.hostname !== '127.0.0.1') {
    throw new Error('Kuchikomi Robo webhook URL must be https://');
  }

  const body = JSON.stringify({
    ...request,
    storeId: request.storeId ?? opts.storeId ?? env.KUCHIKOMI_ROBO_STORE_ID,
  });
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'line-harness/kuchikomi-robo-integration',
  };

  const apiKey = opts.apiKey ?? env.KUCHIKOMI_ROBO_API_KEY;
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const sharedSecret = opts.sharedSecret ?? env.KUCHIKOMI_ROBO_SHARED_SECRET;
  if (sharedSecret) {
    headers['X-Webhook-Signature'] = await hmacSha256Hex(sharedSecret, body);
    headers['X-Line-Harness-Signature'] = `sha256=${headers['X-Webhook-Signature']}`;
  }

  const res = await fetch(endpoint.toString(), {
    method: 'POST',
    headers,
    body,
  });
  const responseText = await res.text().catch(() => '');
  if (!res.ok) {
    throw new Error(`Kuchikomi Robo webhook failed with ${res.status}${responseText ? `: ${responseText.slice(0, 200)}` : ''}`);
  }
  return { status: res.status, responseText };
}

