import { beforeEach, describe, expect, test, vi } from 'vitest';

const dbMocks = {
  getScenarios: vi.fn(),
  enrollFriendInScenario: vi.fn(),
  jstNow: vi.fn(() => '2026-07-24T12:00:00+09:00'),
};
vi.mock('@line-crm/db', () => dbMocks);

const eventBusMocks = {
  fireEvent: vi.fn(),
};
vi.mock('./event-bus.js', () => eventBusMocks);

const { attachTagAndFireSideEffects } = await import('./friend-tag-attach.js');

function makeFriendTagDb(initiallyAttached: boolean): D1Database {
  let attached = initiallyAttached;
  return {
    prepare(sql: string) {
      let params: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) {
          params = values;
          return statement;
        },
        async first() {
          if (sql.includes('SELECT 1 AS x FROM friend_tags')) {
            return attached ? { x: 1, params } : null;
          }
          return null;
        },
        async run() {
          if (sql.includes('INSERT OR IGNORE INTO friend_tags')) attached = true;
          return { success: true, meta: { changes: 1 } };
        },
      };
      return statement;
    },
  } as unknown as D1Database;
}

beforeEach(() => {
  for (const mock of Object.values(dbMocks)) mock.mockReset();
  for (const mock of Object.values(eventBusMocks)) mock.mockReset();
  dbMocks.jstNow.mockReturnValue('2026-07-24T12:00:00+09:00');
  dbMocks.getScenarios.mockResolvedValue([]);
  eventBusMocks.fireEvent.mockResolvedValue(undefined);
});

describe('attachTagAndFireSideEffects', () => {
  test('同じタグを再付与しても side effects を重複発火しない', async () => {
    const db = makeFriendTagDb(false);

    const first = await attachTagAndFireSideEffects(db, 'friend-1', 'tag-1');
    const second = await attachTagAndFireSideEffects(db, 'friend-1', 'tag-1');

    expect(first).toEqual({ added: true });
    expect(second).toEqual({ added: false });
    expect(dbMocks.getScenarios).toHaveBeenCalledTimes(1);
    expect(eventBusMocks.fireEvent).toHaveBeenCalledTimes(1);
    expect(eventBusMocks.fireEvent).toHaveBeenCalledWith(db, 'tag_change', {
      friendId: 'friend-1',
      eventData: { tagId: 'tag-1', action: 'add' },
    });
  });
});
