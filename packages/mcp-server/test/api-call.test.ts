import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiCall, toToolResult } from '../src/api-call.js';

/**
 * 「この環境にその機能が無い」と「その ID が見つからない」を、AI が区別できること。
 *
 * 以前はどちらも {"success":false,"error":"Not found"} として同じに見えており、
 * AI は後者だと解釈して ID を変えて何度も試していた（実戦報告の
 * 「20以上のエンドポイントを推測で叩いた」と同じ構造）。
 *
 * MCP サーバーは npx で常に最新が入る一方、テナントは固定バージョンの bundle で
 * 動くため、新しいツールを足すほどこの乖離は広がる。
 */
function stubFetch(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

describe('apiCall: 404 の判別', () => {
  beforeEach(() => {
    process.env.LINE_HARNESS_API_URL = 'https://t.example';
    process.env.LINE_HARNESS_API_KEY = 'k';
  });
  afterEach(() => vi.unstubAllGlobals());

  it('ルート未存在（error が厳密に "Not found"）なら、バージョン差の可能性を hint で返す', () => {
    stubFetch(404, { success: false, error: 'Not found' });
    return apiCall('/api/whatever').then((r) => {
      expect(r.ok).toBe(false);
      expect(r.hint).toContain('この環境に存在しません');
      expect(r.hint).toContain('ID を変えて再試行しても解決しません');
    });
  });

  it('ハンドラ自身の 404（対象名入り）は hint を付けない — ID の問題なので再試行が有効', async () => {
    stubFetch(404, { success: false, error: 'Scenario not found' });
    const r = await apiCall('/api/scenarios/xxx');
    expect(r.ok).toBe(false);
    expect(r.hint).toBeUndefined();
  });

  it('401/403 は認証の問題として案内する', async () => {
    stubFetch(401, { success: false, error: 'Unauthorized' });
    const r = await apiCall('/api/tags');
    expect(r.hint).toContain('LINE_HARNESS_API_KEY');
  });

  it('成功時は hint を付けない', async () => {
    stubFetch(200, { success: true, data: [] });
    const r = await apiCall('/api/tags');
    expect(r.ok).toBe(true);
    expect(r.hint).toBeUndefined();
  });

  it('toToolResult は失敗時に isError を立てる（以前は 404 でも成功扱いだった）', async () => {
    stubFetch(404, { success: false, error: 'Not found' });
    const out = toToolResult(await apiCall('/api/x'));
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain('_hint');
  });

  it('成功時は isError を立てない', async () => {
    stubFetch(200, { success: true });
    const out = toToolResult(await apiCall('/api/x'));
    expect(out.isError).toBeUndefined();
  });
});
