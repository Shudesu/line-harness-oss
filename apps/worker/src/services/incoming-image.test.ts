import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { IncomingMediaRow } from '@line-crm/db';

const dbMocks = vi.hoisted(() => ({
  getIncomingMedia: vi.fn(),
  reserveIncomingMedia: vi.fn(),
  markIncomingMediaPending: vi.fn(),
  markIncomingMediaStored: vi.fn(),
  markIncomingMediaFailed: vi.fn(),
  jstNow: vi.fn(() => '2026-08-31T12:00:00.000+09:00'),
}));

vi.mock('@line-crm/db', () => dbMocks);

import { fetchAndStoreIncomingImage, hasExpectedImageMagic } from './incoming-image.js';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const GIF_BYTES = new TextEncoder().encode('GIF89a');
const WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50,
]);
const PNG_SHA256 = '4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6';

function pendingRow(overrides: Partial<IncomingMediaRow> = {}): IncomingMediaRow {
  return {
    id: 'row-1',
    line_account_id: 'acc-1',
    line_message_id: 'msg-1',
    source_type: 'user',
    source_id: 'U123',
    sender_user_id: 'U123',
    r2_key: `incoming-${'a'.repeat(64)}`,
    mime_type: null,
    byte_size: null,
    sha256: null,
    status: 'pending',
    stored_at: null,
    created_at: '2026-08-31T12:00:00.000+09:00',
    updated_at: '2026-08-31T12:00:00.000+09:00',
    ...overrides,
  };
}

function makeR2Stub() {
  const store = new Map<string, {
    data: ArrayBuffer;
    contentType: string;
    customMetadata: Record<string, string>;
  }>();
  return {
    put: vi.fn(async (
      key: string,
      data: ArrayBuffer,
      opts: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> },
    ) => {
      store.set(key, {
        data,
        contentType: opts.httpMetadata?.contentType ?? '',
        customMetadata: opts.customMetadata ?? {},
      });
      return null;
    }),
    head: vi.fn(async (key: string) => store.has(key) ? ({ key } as R2Object) : null),
    get: vi.fn(async (key: string) => {
      const item = store.get(key);
      if (!item) return null;
      return {
        key,
        size: item.data.byteLength,
        httpMetadata: { contentType: item.contentType },
        customMetadata: item.customMetadata,
        arrayBuffer: async () => item.data.slice(0),
      } as unknown as R2ObjectBody;
    }),
    _store: store,
  };
}

function baseOptions(r2: ReturnType<typeof makeR2Stub>, fetchMock: typeof fetch) {
  return {
    db: {} as D1Database,
    r2: r2 as unknown as R2Bucket,
    fetch: fetchMock,
    workerUrl: 'https://worker.example.com',
    channelAccessToken: 'token-abc',
    accountId: 'acc-1',
    messageId: 'msg-1',
    source: { type: 'user' as const, id: 'U123', senderUserId: 'U123' },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getIncomingMedia.mockResolvedValue(null);
  dbMocks.reserveIncomingMedia.mockImplementation(async (_db, input) => pendingRow({
    id: input.id,
    line_account_id: input.lineAccountId,
    line_message_id: input.lineMessageId,
    source_type: input.sourceType,
    source_id: input.sourceId,
    sender_user_id: input.senderUserId,
    r2_key: input.r2Key,
  }));
  dbMocks.markIncomingMediaPending.mockResolvedValue(undefined);
  dbMocks.markIncomingMediaStored.mockResolvedValue(undefined);
  dbMocks.markIncomingMediaFailed.mockResolvedValue(undefined);
});

describe('fetchAndStoreIncomingImage', () => {
  test.each([
    ['image/png', PNG_BYTES],
    ['image/jpeg', JPEG_BYTES],
    ['image/jpg', JPEG_BYTES],
    ['image/gif', GIF_BYTES],
    ['image/webp', WEBP_BYTES],
  ])('validates %s magic bytes', (contentType, bytes) => {
    expect(hasExpectedImageMagic(contentType, bytes)).toBe(true);
    expect(hasExpectedImageMagic(contentType, new Uint8Array([0, 1, 2, 3]))).toBe(false);
  });

  test.each([
    { type: 'user' as const, id: 'U123', senderUserId: 'U123' },
    { type: 'group' as const, id: 'C123', senderUserId: 'U456' },
    { type: 'room' as const, id: 'R123', senderUserId: null },
  ])('stores $type source metadata, MIME, size, and SHA-256', async (source) => {
    const r2 = makeR2Stub();
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(PNG_BYTES.slice().buffer, {
      status: 200,
      headers: { 'Content-Type': 'image/png', 'Content-Length': String(PNG_BYTES.byteLength) },
    }));

    const result = await fetchAndStoreIncomingImage({
      ...baseOptions(r2, fetchMock),
      source,
    });

    expect(dbMocks.reserveIncomingMedia).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        lineAccountId: 'acc-1',
        lineMessageId: 'msg-1',
        sourceType: source.type,
        sourceId: source.id,
        senderUserId: source.senderUserId,
        r2Key: expect.stringMatching(/^incoming-[0-9a-f]{64}$/),
      }),
    );
    expect(r2.put).toHaveBeenCalledTimes(1);
    expect(dbMocks.markIncomingMediaStored).toHaveBeenCalledWith(
      expect.anything(),
      'acc-1',
      'msg-1',
      expect.objectContaining({
        mimeType: 'image/png',
        byteSize: PNG_BYTES.byteLength,
        sha256: PNG_SHA256,
      }),
    );
    expect(result).toEqual({
      originalContentUrl: 'https://worker.example.com/api/incoming-media/acc-1/msg-1/content',
      previewImageUrl: 'https://worker.example.com/api/incoming-media/acc-1/msg-1/content',
    });
  });

  test('duplicate webhook reuses the stored row/object without another fetch or put', async () => {
    const r2 = makeR2Stub();
    const row = pendingRow({ status: 'stored', mime_type: 'image/jpeg', byte_size: 3, sha256: 'b'.repeat(64) });
    r2._store.set(row.r2_key, {
      data: JPEG_BYTES.slice().buffer,
      contentType: 'image/jpeg',
      customMetadata: { sha256: 'unused-by-stored-row', byteSize: String(JPEG_BYTES.byteLength) },
    });
    dbMocks.getIncomingMedia.mockResolvedValue(row);
    const fetchMock = vi.fn<typeof fetch>();

    const result = await fetchAndStoreIncomingImage(baseOptions(r2, fetchMock));

    expect(result).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r2.put).not.toHaveBeenCalled();
    expect(dbMocks.reserveIncomingMedia).not.toHaveBeenCalled();
  });

  test('R2 failure records failed status and keeps the webhook fallback', async () => {
    const r2 = makeR2Stub();
    r2.put.mockRejectedValueOnce(new Error('R2 down'));
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JPEG_BYTES.slice().buffer, {
      status: 200,
      headers: { 'Content-Type': 'image/jpeg' },
    }));

    const result = await fetchAndStoreIncomingImage(baseOptions(r2, fetchMock));

    expect(result).toBeNull();
    expect(dbMocks.markIncomingMediaFailed).toHaveBeenCalledWith(
      expect.anything(), 'acc-1', 'msg-1', expect.any(String),
    );
    expect(dbMocks.markIncomingMediaStored).not.toHaveBeenCalled();
  });

  test('finalizes an existing R2 object after D1 failure even when LINE is unavailable', async () => {
    const r2 = makeR2Stub();
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(WEBP_BYTES.slice().buffer, {
        status: 200,
        headers: { 'Content-Type': 'image/webp' },
      }))
      .mockRejectedValueOnce(new Error('LINE content expired'));
    dbMocks.markIncomingMediaStored.mockRejectedValueOnce(new Error('D1 unavailable'));

    const first = await fetchAndStoreIncomingImage(baseOptions(r2, fetchMock));
    const storedKey = r2.put.mock.calls[0][0];
    dbMocks.getIncomingMedia.mockResolvedValueOnce(pendingRow({ r2_key: storedKey }));
    const second = await fetchAndStoreIncomingImage(baseOptions(r2, fetchMock));

    expect(first).toBeNull();
    expect(second).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r2.put).toHaveBeenCalledTimes(1);
    expect(r2._store).toHaveLength(1);
    expect(dbMocks.markIncomingMediaStored).toHaveBeenCalledTimes(2);
  });

  test('rejects MIME spoofing when image magic bytes do not match', async () => {
    const r2 = makeR2Stub();
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(new TextEncoder().encode('not a png'), {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    }));

    const result = await fetchAndStoreIncomingImage(baseOptions(r2, fetchMock));

    expect(result).toBeNull();
    expect(r2.put).not.toHaveBeenCalled();
    expect(dbMocks.markIncomingMediaFailed).toHaveBeenCalled();
  });

  test('rejects traversal-shaped identifiers before D1, LINE, or R2 access', async () => {
    const r2 = makeR2Stub();
    const fetchMock = vi.fn<typeof fetch>();

    const result = await fetchAndStoreIncomingImage({
      ...baseOptions(r2, fetchMock),
      messageId: '../secret',
    });

    expect(result).toBeNull();
    expect(dbMocks.getIncomingMedia).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r2.put).not.toHaveBeenCalled();
  });
});
