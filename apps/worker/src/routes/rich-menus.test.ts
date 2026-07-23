import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { richMenus } from './rich-menus.js';

const uploadRichMenuImage = vi.fn();
const getDefaultRichMenuId = vi.fn();
const getRichMenuList = vi.fn();

vi.mock('@line-crm/line-sdk', () => ({
  LineClient: vi.fn().mockImplementation(() => ({
    uploadRichMenuImage,
    getDefaultRichMenuId,
    getRichMenuList,
  })),
}));

describe('POST /api/rich-menus/:id/image', () => {
  function setupApp() {
    const app = new Hono<{
      Bindings: {
        DB: D1Database;
        LINE_CHANNEL_ACCESS_TOKEN: string;
      };
    }>();
    app.route('/', richMenus);
    return app;
  }

  beforeEach(() => {
    uploadRichMenuImage.mockReset();
    uploadRichMenuImage.mockResolvedValue(undefined);
  });

  test('accepts SDK imageData JSON field for base64 uploads', async () => {
    const app = setupApp();
    const res = await app.request('/api/rich-menus/richmenu-1/image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        imageData: 'aGVsbG8=',
        contentType: 'image/png',
      }),
    }, {
      LINE_CHANNEL_ACCESS_TOKEN: 'token',
      DB: {} as D1Database,
    });

    expect(res.status).toBe(200);
    expect(uploadRichMenuImage).toHaveBeenCalledTimes(1);
    const [richMenuId, imageData, contentType] = uploadRichMenuImage.mock.calls[0];
    expect(richMenuId).toBe('richmenu-1');
    expect(contentType).toBe('image/png');
    expect(new TextDecoder().decode(imageData as ArrayBuffer)).toBe('hello');
  });

  test('keeps accepting legacy image JSON field', async () => {
    const app = setupApp();
    const res = await app.request('/api/rich-menus/richmenu-2/image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        image: 'data:image/jpeg;base64,aGVsbG8=',
        contentType: 'image/jpeg',
      }),
    }, {
      LINE_CHANNEL_ACCESS_TOKEN: 'token',
      DB: {} as D1Database,
    });

    expect(res.status).toBe(200);
    expect(uploadRichMenuImage).toHaveBeenCalledTimes(1);
    const [richMenuId, imageData, contentType] = uploadRichMenuImage.mock.calls[0];
    expect(richMenuId).toBe('richmenu-2');
    expect(contentType).toBe('image/jpeg');
    expect(new TextDecoder().decode(imageData as ArrayBuffer)).toBe('hello');
  });
});

describe('GET /api/rich-menus/default', () => {
  function setupApp() {
    const app = new Hono<{
      Bindings: {
        DB: D1Database;
        LINE_CHANNEL_ACCESS_TOKEN: string;
      };
    }>();
    app.route('/', richMenus);
    return app;
  }

  beforeEach(() => {
    getDefaultRichMenuId.mockReset();
    getRichMenuList.mockReset();
  });

  test('returns the current default id and menu name', async () => {
    getDefaultRichMenuId.mockResolvedValue('richmenu-live');
    getRichMenuList.mockResolvedValue({ richmenus: [{ richMenuId: 'richmenu-live', name: '祝果メニュー' }] });
    const res = await setupApp().request('/api/rich-menus/default', {}, {
      LINE_CHANNEL_ACCESS_TOKEN: 'token',
      DB: {} as D1Database,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { richMenuId: 'richmenu-live', name: '祝果メニュー' },
    });
  });
});
