import { describe, it, expect, vi } from 'vitest';
import {
  buildAliasId,
  resolveSwitcherActions,
  publishRichMenuGroup,
  unpublishRichMenuGroup,
  linkRichMenuBulkChunked,
  type LineRichMenuClient,
  type R2Like,
} from './rich-menu-publisher.js';

describe('buildAliasId', () => {
  it('groupId 先頭 8 文字 + order_index で生成', () => {
    expect(buildAliasId('3a7c2f1d-1234-5678-9abc-def012345678', 0)).toBe('lhx-3a7c2f1d-0');
    expect(buildAliasId('3a7c2f1d-1234-5678-9abc-def012345678', 2)).toBe('lhx-3a7c2f1d-2');
  });
});

describe('resolveSwitcherActions', () => {
  it('targetPageId を alias_id に変換', () => {
    const groupId = '3a7c2f1d-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const pages = [
      {
        id: 'p1', orderIndex: 0, name: 'p1',
        imageR2Key: null, imageContentType: null, lineRichMenuId: null,
        areas: [{
          bounds: { x: 0, y: 0, width: 100, height: 100 },
          actionType: 'richmenuswitch' as const,
          actionData: { targetPageId: 'p2' },
        }],
      },
      {
        id: 'p2', orderIndex: 1, name: 'p2',
        imageR2Key: null, imageContentType: null, lineRichMenuId: null,
        areas: [],
      },
    ];
    const resolved = resolveSwitcherActions(pages, groupId);
    expect(resolved[0].areas[0].actionData).toEqual({
      richMenuAliasId: 'lhx-3a7c2f1d-1',
      data: 'switch-to-p2',
    });
  });

  it('uri/message/postback はそのまま', () => {
    const pages = [{
      id: 'p1', orderIndex: 0, name: 'p1',
      imageR2Key: null, imageContentType: null, lineRichMenuId: null,
      areas: [
        { bounds: { x: 0, y: 0, width: 100, height: 100 }, actionType: 'uri' as const, actionData: { uri: 'https://x.example' } },
        { bounds: { x: 0, y: 0, width: 100, height: 100 }, actionType: 'message' as const, actionData: { text: 'hi' } },
      ],
    }];
    const resolved = resolveSwitcherActions(pages, 'gid12345-aaaa');
    expect(resolved[0].areas[0].actionData).toEqual({ uri: 'https://x.example' });
    expect(resolved[0].areas[1].actionData).toEqual({ text: 'hi' });
  });

  it('未知の targetPageId は throw', () => {
    const pages = [{
      id: 'p1', orderIndex: 0, name: 'p1',
      imageR2Key: null, imageContentType: null, lineRichMenuId: null,
      areas: [{
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        actionType: 'richmenuswitch' as const,
        actionData: { targetPageId: 'nonexistent' },
      }],
    }];
    expect(() => resolveSwitcherActions(pages, 'gid12345-aaaa')).toThrow(/nonexistent/);
  });
});

type MockLineClient = LineRichMenuClient & { calls: string[]; currentDefault: string | null };

function makeMockLineClient(opts: { currentDefault?: string | null } = {}): MockLineClient {
  const calls: string[] = [];
  const state = { currentDefault: opts.currentDefault ?? null };
  return {
    calls,
    get currentDefault() {
      return state.currentDefault;
    },
    set currentDefault(value: string | null) {
      state.currentDefault = value;
    },
    createRichMenu: vi.fn(async () => {
      calls.push('create');
      return { richMenuId: `lm-${calls.filter((c) => c === 'create').length}` };
    }),
    uploadRichMenuImage: vi.fn(async () => {
      calls.push('upload');
    }),
    deleteRichMenuAlias: vi.fn(async () => {
      calls.push('delete-alias');
    }),
    createRichMenuAlias: vi.fn(async () => {
      calls.push('create-alias');
    }),
    deleteRichMenu: vi.fn(async () => {
      calls.push('delete-old');
    }),
    setDefaultRichMenu: vi.fn(async () => {
      calls.push('set-default');
    }),
    clearDefaultRichMenu: vi.fn(async () => {
      calls.push('clear-default');
    }),
    getCurrentDefaultRichMenuId: vi.fn(async () => {
      calls.push('get-default');
      return state.currentDefault;
    }),
    linkRichMenuBulk: vi.fn(async (_richMenuId: string, userIds: string[]) => {
      calls.push(`link-bulk-${userIds.length}`);
    }),
  } as MockLineClient;
}

function makeMockR2(): R2Like {
  return {
    get: vi.fn(async (_key: string) => ({ body: new Uint8Array([1, 2, 3]) })),
  };
}

describe('publishRichMenuGroup', () => {
  it('1 page: create → upload → alias upsert → 旧削除', async () => {
    const line = makeMockLineClient();
    const r2 = makeMockR2();
    const result = await publishRichMenuGroup(
      {
        id: 'gid12345-aaaa', size: 'large', chatBarText: 'menu', isDefaultForAll: false, selected: false,
        pages: [{
          id: 'p1', orderIndex: 0, name: 'p1',
          imageR2Key: 'rich-menus/test/p1.png', imageContentType: 'image/png',
          lineRichMenuId: 'old-1',
          areas: [],
        }],
      },
      line,
      r2,
    );
    // isDefaultForAll=false かつ LINE current default なし → clear-default は呼ばない (Round 2 修正)
    expect(line.calls).toEqual([
      'create', 'upload', 'delete-alias', 'create-alias', 'delete-old', 'get-default',
    ]);
    expect(line.calls).not.toContain('clear-default');
    expect(result.pages).toEqual([{ pageId: 'p1', newRichMenuId: 'lm-1' }]);
  });

  it('2 page: 各ページについて順序実行', async () => {
    const line = makeMockLineClient();
    const r2 = makeMockR2();
    const result = await publishRichMenuGroup(
      {
        id: 'gid12345-aaaa', size: 'large', chatBarText: 'm', isDefaultForAll: false, selected: false,
        pages: [
          { id: 'p1', orderIndex: 0, name: 'p1', imageR2Key: 'a.png', imageContentType: 'image/png', lineRichMenuId: null, areas: [] },
          { id: 'p2', orderIndex: 1, name: 'p2', imageR2Key: 'b.png', imageContentType: 'image/png', lineRichMenuId: null, areas: [] },
        ],
      },
      line,
      r2,
    );
    expect(result.pages.map((p) => p.newRichMenuId)).toEqual(['lm-1', 'lm-2']);
    // 旧 ID なしなので delete-old は呼ばれない
    expect(line.calls.filter((c) => c === 'delete-old')).toHaveLength(0);
  });

  it('isDefaultForAll=true なら setDefaultRichMenu を最初の page で呼ぶ', async () => {
    const line = makeMockLineClient();
    const r2 = makeMockR2();
    await publishRichMenuGroup(
      {
        id: 'gid12345-aaaa', size: 'large', chatBarText: 'm', isDefaultForAll: true, selected: true,
        pages: [{
          id: 'p1', orderIndex: 0, name: 'p1',
          imageR2Key: 'a.png', imageContentType: 'image/png',
          lineRichMenuId: null, areas: [],
        }],
      },
      line,
      r2,
    );
    expect(line.calls).toContain('set-default');
    // 有効化時は clear-default を呼ばない
    expect(line.calls).not.toContain('clear-default');
    expect(line.createRichMenu).toHaveBeenCalledWith(expect.objectContaining({ selected: true }));
  });

  it('isDefaultForAll=false かつ LINE current default が own page と一致 → clear-default を呼ぶ (Round 2 P1)', async () => {
    // 旧 line_richmenu_id が現在の LINE default と一致 = この group が以前 default だった
    const line = makeMockLineClient({ currentDefault: 'old-1' });
    const r2 = makeMockR2();
    await publishRichMenuGroup(
      {
        id: 'gid12345-aaaa', size: 'large', chatBarText: 'm', isDefaultForAll: false, selected: false,
        pages: [{
          id: 'p1', orderIndex: 0, name: 'p1',
          imageR2Key: 'a.png', imageContentType: 'image/png',
          lineRichMenuId: 'old-1', areas: [],
        }],
      },
      line,
      r2,
    );
    expect(line.calls).toContain('get-default');
    expect(line.calls).toContain('clear-default');
    expect(line.calls).not.toContain('set-default');
  });

  it('isDefaultForAll=false かつ LINE current default が他 group → clear-default を呼ばない (Round 2 P1)', async () => {
    // 別 group が現在 default。own page とは無関係。
    const line = makeMockLineClient({ currentDefault: 'rm-from-other-group' });
    const r2 = makeMockR2();
    await publishRichMenuGroup(
      {
        id: 'gid12345-aaaa', size: 'large', chatBarText: 'm', isDefaultForAll: false, selected: false,
        pages: [{
          id: 'p1', orderIndex: 0, name: 'p1',
          imageR2Key: 'a.png', imageContentType: 'image/png',
          lineRichMenuId: 'old-1', areas: [],
        }],
      },
      line,
      r2,
    );
    expect(line.calls).toContain('get-default');
    expect(line.calls).not.toContain('clear-default');
  });

  it('isDefaultForAll=false で getCurrentDefaultRichMenuId が throw しても publish 成功 (Round 3 P2-3)', async () => {
    const line = makeMockLineClient();
    line.getCurrentDefaultRichMenuId = vi.fn(async () => {
      throw new Error('LINE 5xx transient');
    });
    const r2 = makeMockR2();
    const result = await publishRichMenuGroup(
      {
        id: 'gid12345-aaaa', size: 'large', chatBarText: 'm', isDefaultForAll: false, selected: false,
        pages: [{
          id: 'p1', orderIndex: 0, name: 'p1',
          imageR2Key: 'a.png', imageContentType: 'image/png',
          lineRichMenuId: null, areas: [],
        }],
      },
      line,
      r2,
    );
    // publish 自体は成功 (alias swap 完了済み、status 更新を呼出側に任せられる)
    expect(result.pages[0].newRichMenuId).toBe('lm-1');
  });

  it('画像が R2 にないと throw', async () => {
    const line = makeMockLineClient();
    const r2: R2Like = { get: vi.fn(async () => null) };
    await expect(
      publishRichMenuGroup(
        {
          id: 'gid12345-aaaa', size: 'large', chatBarText: 'm', isDefaultForAll: false, selected: false,
          pages: [{
            id: 'p1', orderIndex: 0, name: 'p1',
            imageR2Key: 'missing.png', imageContentType: 'image/png',
            lineRichMenuId: null, areas: [],
          }],
        },
        line,
        r2,
      ),
    ).rejects.toThrow(/R2 image missing/);
  });

  it('image_r2_key が null だと throw (画像未設定 page)', async () => {
    const line = makeMockLineClient();
    const r2 = makeMockR2();
    await expect(
      publishRichMenuGroup(
        {
          id: 'gid12345-aaaa', size: 'large', chatBarText: 'm', isDefaultForAll: false, selected: false,
          pages: [{
            id: 'p1', orderIndex: 0, name: 'p1',
            imageR2Key: null, imageContentType: null,
            lineRichMenuId: null, areas: [],
          }],
        },
        line,
        r2,
      ),
    ).rejects.toThrow(/no image/);
  });
});

describe('unpublishRichMenuGroup', () => {
  it('alias + richmenu を全 page で delete (own default は unlink)', async () => {
    const line = makeMockLineClient({ currentDefault: 'lm-old-1' });
    const result = await unpublishRichMenuGroup(
      {
        id: 'gid12345-aaaa', size: 'large', chatBarText: 'm', isDefaultForAll: true, selected: true,
        pages: [
          { id: 'p1', orderIndex: 0, name: 'p1', imageR2Key: null, imageContentType: null, lineRichMenuId: 'lm-old-1', areas: [] },
          { id: 'p2', orderIndex: 1, name: 'p2', imageR2Key: null, imageContentType: null, lineRichMenuId: 'lm-old-2', areas: [] },
        ],
      },
      line,
    );
    // 各 page で delete-alias + delete-old (richmenu)
    expect(line.calls.filter((c) => c === 'delete-alias')).toHaveLength(2);
    expect(line.calls.filter((c) => c === 'delete-old')).toHaveLength(2);
    // default が own なので clear-default
    expect(line.calls).toContain('clear-default');
    expect(result.warnings).toEqual([]);
    expect(result.pages).toEqual([
      { pageId: 'p1', clearedRichMenuId: 'lm-old-1' },
      { pageId: 'p2', clearedRichMenuId: 'lm-old-2' },
    ]);
  });

  it('default が他 group の場合は clear-default を呼ばない', async () => {
    const line = makeMockLineClient({ currentDefault: 'lm-other-group' });
    await unpublishRichMenuGroup(
      {
        id: 'gid12345-aaaa', size: 'large', chatBarText: 'm', isDefaultForAll: false, selected: false,
        pages: [
          { id: 'p1', orderIndex: 0, name: 'p1', imageR2Key: null, imageContentType: null, lineRichMenuId: 'lm-mine', areas: [] },
        ],
      },
      line,
    );
    expect(line.calls).not.toContain('clear-default');
  });

  it('richmenuId なし page でも alias 削除は行う (404 OK)', async () => {
    const line = makeMockLineClient();
    line.deleteRichMenuAlias = vi.fn(async () => {
      throw new Error('404 Not Found');
    });
    const result = await unpublishRichMenuGroup(
      {
        id: 'gid12345-aaaa', size: 'large', chatBarText: 'm', isDefaultForAll: false, selected: false,
        pages: [
          { id: 'p1', orderIndex: 0, name: 'p1', imageR2Key: null, imageContentType: null, lineRichMenuId: null, areas: [] },
        ],
      },
      line,
    );
    // delete-alias は throw されたので warnings に記録される
    expect(result.warnings.some((w) => w.includes('delete alias'))).toBe(true);
  });
});

describe('linkRichMenuBulkChunked', () => {
  it('500 以下は 1 chunk', async () => {
    const line = makeMockLineClient();
    const ids = Array.from({ length: 300 }, (_, i) => `U${i}`);
    const result = await linkRichMenuBulkChunked(line, 'lm-1', ids);
    expect(result).toEqual({ chunks: 1, total: 300 });
    expect(line.calls).toEqual(['link-bulk-300']);
  });

  it('500 超は分割', async () => {
    const line = makeMockLineClient();
    const ids = Array.from({ length: 1100 }, (_, i) => `U${i}`);
    const result = await linkRichMenuBulkChunked(line, 'lm-1', ids);
    expect(result).toEqual({ chunks: 3, total: 1100 });
    expect(line.calls).toEqual(['link-bulk-500', 'link-bulk-500', 'link-bulk-100']);
  });

  it('空配列は no-op', async () => {
    const line = makeMockLineClient();
    const result = await linkRichMenuBulkChunked(line, 'lm-1', []);
    expect(result).toEqual({ chunks: 0, total: 0 });
    expect(line.calls).toEqual([]);
  });
});
