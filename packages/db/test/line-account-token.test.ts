import { describe, it, expect } from 'vitest';
import { resolveDefaultAccessToken } from '../src/line-accounts.js';

/**
 * `all()` を1回返すだけの D1 スタブ。`resolveDefaultAccessToken` は
 * 「有効なアカウントを列挙して1本かどうか見る」ことしかしないので、これで足りる。
 */
function mockDb(rows: Array<{ channel_access_token: string }>): D1Database {
  return {
    prepare: () => ({
      all: async () => ({ results: rows }),
    }),
  } as unknown as D1Database;
}

describe('resolveDefaultAccessToken', () => {
  it('有効なアカウントが1本だけなら、env ではなくその行のトークンを使う', async () => {
    // これが本命。テナントに1アカウントしか無いのに friend.line_account_id が
    // NULL だったせいで env の古いトークンを掴み、送信だけ 500 になっていた
    // （2026-08-24 の障害）。1本しか無いなら曖昧さが無いので、DB を正とする。
    const token = await resolveDefaultAccessToken(mockDb([{ channel_access_token: 'db-token' }]), 'env-token');
    expect(token).toBe('db-token');
  });

  it('有効なアカウントが無ければ env にフォールバックする', async () => {
    // 開通直後（line_accounts がまだ入っていない）はこの経路しか無い。
    const token = await resolveDefaultAccessToken(mockDb([]), 'env-token');
    expect(token).toBe('env-token');
  });

  it('有効なアカウントが複数あるときは env のまま（勝手に1本を選ばない）', async () => {
    // 複数アカウントのテナントでどれを使うかは呼び出し側の文脈
    // （friend.line_account_id など）でしか決められない。ここで推測すると
    // 別アカウントの名前でメッセージが出てしまう。
    const token = await resolveDefaultAccessToken(
      mockDb([{ channel_access_token: 'a' }, { channel_access_token: 'b' }]),
      'env-token',
    );
    expect(token).toBe('env-token');
  });

  it('1本だけあってもトークンが空なら env にフォールバックする', async () => {
    const token = await resolveDefaultAccessToken(mockDb([{ channel_access_token: '' }]), 'env-token');
    expect(token).toBe('env-token');
  });

  it('D1 が落ちても env にフォールバックし、例外を投げない', async () => {
    // 送信経路の入口なので、ここで throw すると 500 になる。可用性を優先する。
    const db = {
      prepare: () => ({
        all: async () => {
          throw new Error('D1 unavailable');
        },
      }),
    } as unknown as D1Database;
    await expect(resolveDefaultAccessToken(db, 'env-token')).resolves.toBe('env-token');
  });
});
