import { describe, expect, it, vi } from 'vitest';
import { applyPostbackTags, parsePostbackTags } from './postback-tag.js';

vi.mock('./friend-tag-attach.js', () => ({ attachTagAndFireSideEffects: vi.fn(async () => ({ added: true })) }));

describe('parsePostbackTags', () => {
  it('今までの合図（lh_tag= で始まらない）は null で何も変えない', () => {
    expect(parsePostbackTags('survey:consent')).toBeNull();
    expect(parsePostbackTags('qa_1')).toBeNull();
    expect(parsePostbackTags('kw=x&lh_tag=t1')).toBeNull();
  });
  it('タグを複数・キーワード付きで読む（重複は1つに）', () => {
    expect(parsePostbackTags('lh_tag=t1&lh_tag=t2&lh_tag=t1&kw=asa_q1')).toEqual({ tagIds: ['t1', 't2'], keyword: 'asa_q1' });
  });
  it('キーワードが無ければ印を付けるだけ', () => {
    expect(parsePostbackTags('lh_tag=t1')).toEqual({ tagIds: ['t1'], keyword: null });
  });
  it('タグが空なら null', () => {
    expect(parsePostbackTags('lh_tag=&kw=x')).toBeNull();
  });
});

describe('applyPostbackTags', () => {
  it('実在するタグだけ付ける', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { attachTagAndFireSideEffects } = await import('./friend-tag-attach.js');
    const db = {
      prepare: () => ({ bind: (id: string) => ({ first: async () => (id === 'real' ? { 1: 1 } : null) }) }),
    } as unknown as D1Database;
    expect(await applyPostbackTags(db, 'f1', ['real', 'gone'])).toBe(1);
    expect(attachTagAndFireSideEffects).toHaveBeenCalledTimes(1);
    expect(attachTagAndFireSideEffects).toHaveBeenCalledWith(db, 'f1', 'real');
    errorSpy.mockRestore();
  });
});
