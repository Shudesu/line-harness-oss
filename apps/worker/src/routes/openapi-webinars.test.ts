import { describe, it, expect } from 'vitest';
import { openapi } from './openapi.js';

/**
 * オートウェビナー一式が OpenAPI に載っていることの回帰テスト。
 *
 * 2026-08-25 の構築記録 §6-5「最長の詰まり」— 動画アップロードの口が
 * OpenAPI にも MCP にも無かったため、利用者は20以上のエンドポイントを推測で
 * 叩き、最終的に OSS のソースを読んで発見した。この spec が唯一の発見経路。
 */
describe('openapi: webinars', () => {
  const spec = async () => {
    const res = await openapi.request('/openapi.json');
    return (await res.json()) as { paths: Record<string, unknown>; tags: { name: string }[] };
  };

  it('動画アップロードと確定の口が載っている（最長の詰まりの原因）', async () => {
    const s = await spec();
    expect(s.paths['/api/webinars/{id}/assets/{revision}/{path}']).toBeDefined();
    expect(s.paths['/api/webinars/{id}/video']).toBeDefined();
  });

  it('revision が数字必須であることが description に書かれている', async () => {
    // 400「revision must be digits」がルート発見の決め手だった。
    const s = await spec();
    const put = (s.paths['/api/webinars/{id}/assets/{revision}/{path}'] as { put: { description: string } }).put;
    expect(put.description).toContain('revision must be digits');
  });

  it('CTA・コメント・分析も載っている', async () => {
    const s = await spec();
    expect(s.paths['/api/webinars/{id}/ctas']).toBeDefined();
    expect(s.paths['/api/webinars/{id}/comments']).toBeDefined();
    expect(s.paths['/api/webinars/{id}/analytics']).toBeDefined();
  });

  it('Webinars タグが定義されている', async () => {
    const s = await spec();
    expect(s.tags.map((t) => t.name)).toContain('Webinars');
  });
});

/**
 * 流入経路(/r) とクリック計測(/t) の役割分担、フォーム URL の発見経路。
 * 構築記録 §6-2 / §6-3 / §6-4 の原因はすべて「どこにも書かれていない」ことだった。
 */
describe('openapi: links と forms', () => {
  const spec = async () => {
    const res = await openapi.request('/openapi.json');
    return (await res.json()) as { paths: Record<string, { get?: { description?: string }; post?: { description?: string } }> };
  };

  it('/r と /t が両方載っていて、役割の違いが書かれている', async () => {
    const s = await spec();
    const r = s.paths['/r/{ref}']?.get?.description ?? '';
    const t = s.paths['/t/{linkId}']?.get?.description ?? '';
    expect(r).toContain('外部（SNS投稿');
    expect(t).toContain('LINE のトーク内に貼るのはこちら');
    expect(t).toContain('SNS には貼らないこと');
  });

  it('/r がクエリを LIFF へパススルーすることが書かれている', async () => {
    // ウェビナー直行・フォーム直行の導線がここでしか分からない。
    const s = await spec();
    const r = s.paths['/r/{ref}']?.get?.description ?? '';
    expect(r).toContain('page=webinar');
    expect(r).toContain('form={formId}');
  });

  it('フォーム作成のレスポンスに公開URLが無いことと、正しい開き方が書かれている', async () => {
    const s = await spec();
    const d = s.paths['/api/forms']?.post?.description ?? '';
    expect(d).toContain('レスポンスに公開 URL は含まれない');
    expect(d).toContain('?form={id}');
  });

  it('{formUrl} がシナリオでは展開されないことが書かれている', async () => {
    const s = await spec();
    const d = s.paths['/api/tracked-links']?.post?.description ?? '';
    expect(d).toContain('シナリオのステップ本文では展開されない');
  });
});
