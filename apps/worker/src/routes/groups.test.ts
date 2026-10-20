import { describe, expect, test, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';

// Mock @line-crm/db so the route is driven purely from this test file.
const dbMocks = {
  listGroups: vi.fn(),
  getGroupById: vi.fn(),
  addTagToGroup: vi.fn(),
  removeTagFromGroup: vi.fn(),
  upsertLineGroup: vi.fn(),
};
vi.mock('@line-crm/db', () => dbMocks);

const { groups } = await import('./groups.js');

type TestEnv = { Bindings: { DB: D1Database } };

/** D1 stub for the ad-hoc tag-existence lookup the route does. */
function makeDbStub(tagRow: { id: string } | null = { id: 'tag-1' }): D1Database {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        all: vi.fn(async () => ({ results: [] })),
        first: vi.fn(async () => tagRow),
        run: vi.fn(async () => ({ meta: { changes: 0 } })),
      })),
    })),
  } as unknown as D1Database;
}

function setupApp(db?: D1Database) {
  const app = new Hono<TestEnv>();
  app.use('*', async (c, next) => {
    c.env = { DB: db ?? makeDbStub() };
    await next();
  });
  app.route('/', groups);
  return app;
}

function groupRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'Cabc',
    account_id: 'acc-1',
    name: 'KOBOREL PJ',
    status: 'joined',
    message_count: 216,
    last_message_at: '2026-10-10T09:00:00.000',
    joined_at: '2026-09-01T00:00:00.000',
    left_at: null,
    created_at: '2026-09-01T00:00:00.000',
    updated_at: '2026-10-10T09:00:00.000',
    tags: [{ id: 'tag-1', name: '進行中', color: '#10B981' }],
    ...overrides,
  };
}

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
});

describe('GET /api/groups', () => {
  test('returns an empty list when nothing is registered', async () => {
    dbMocks.listGroups.mockResolvedValue([]);
    const res = await setupApp().request('/api/groups');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: [] });
  });

  test('serializes snake_case rows to camelCase and keeps tags', async () => {
    dbMocks.listGroups.mockResolvedValue([groupRow()]);
    const res = await setupApp().request('/api/groups');
    const body = (await res.json()) as { data: Record<string, unknown>[] };
    expect(body.data[0]).toMatchObject({
      id: 'Cabc',
      accountId: 'acc-1',
      messageCount: 216,
      lastMessageAt: '2026-10-10T09:00:00.000',
      tags: [{ id: 'tag-1', name: '進行中', color: '#10B981' }],
    });
  });

  test('passes tagId through so filtering happens in SQL', async () => {
    dbMocks.listGroups.mockResolvedValue([]);
    await setupApp().request('/api/groups?tagId=tag-9&accountId=acc-2&status=left');
    expect(dbMocks.listGroups).toHaveBeenCalledWith(expect.anything(), {
      tagId: 'tag-9',
      accountId: 'acc-2',
      status: 'left',
    });
  });

  test('ignores a status value outside joined/left instead of querying for it', async () => {
    dbMocks.listGroups.mockResolvedValue([]);
    await setupApp().request('/api/groups?status=bogus');
    expect(dbMocks.listGroups).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: null }),
    );
  });
});

describe('POST /api/groups/:id/tags', () => {
  test('attaches the tag and reports whether it was newly added', async () => {
    dbMocks.getGroupById.mockResolvedValue(groupRow());
    dbMocks.addTagToGroup.mockResolvedValue(true);
    const res = await setupApp().request('/api/groups/Cabc/tags', {
      method: 'POST',
      body: JSON.stringify({ tagId: 'tag-1' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { added: boolean } };
    expect(body.data.added).toBe(true);
    expect(dbMocks.addTagToGroup).toHaveBeenCalledWith(expect.anything(), 'Cabc', 'tag-1');
  });

  test('400 when tagId is missing', async () => {
    const res = await setupApp().request('/api/groups/Cabc/tags', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(dbMocks.addTagToGroup).not.toHaveBeenCalled();
  });

  test('404 when the group is unknown', async () => {
    dbMocks.getGroupById.mockResolvedValue(null);
    const res = await setupApp().request('/api/groups/missing/tags', {
      method: 'POST',
      body: JSON.stringify({ tagId: 'tag-1' }),
    });
    expect(res.status).toBe(404);
    expect(dbMocks.addTagToGroup).not.toHaveBeenCalled();
  });

  test('404 when the tag does not exist, so no orphan join row is written', async () => {
    dbMocks.getGroupById.mockResolvedValue(groupRow());
    const res = await setupApp(makeDbStub(null)).request('/api/groups/Cabc/tags', {
      method: 'POST',
      body: JSON.stringify({ tagId: 'ghost' }),
    });
    expect(res.status).toBe(404);
    expect(dbMocks.addTagToGroup).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/groups/:id/tags/:tagId', () => {
  test('detaches the tag', async () => {
    dbMocks.removeTagFromGroup.mockResolvedValue(undefined);
    const res = await setupApp().request('/api/groups/Cabc/tags/tag-1', {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    expect(dbMocks.removeTagFromGroup).toHaveBeenCalledWith(
      expect.anything(),
      'Cabc',
      'tag-1',
    );
  });
});

describe('GET /api/groups/:id', () => {
  test('404 when not found', async () => {
    dbMocks.getGroupById.mockResolvedValue(null);
    const res = await setupApp().request('/api/groups/missing');
    expect(res.status).toBe(404);
  });
});
