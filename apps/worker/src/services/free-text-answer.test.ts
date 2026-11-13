import { describe, expect, it } from 'vitest';
import { findFreeTextAnswer, isRepeatedAnswer } from './free-text-answer.js';

const ACCOUNT = 'a60cb342-99ff-4ffc-b04a-3b4b2307e0f5';

// 返事待ち（待ちシナリオ進行中）か・答え済みタグがあるかだけを返す偽の DB
function fakeDb(opts: { waiting: boolean; answered: boolean }) {
  return {
    prepare: (sql: string) => ({
      bind: () => ({
        first: async () => {
          if (sql.includes('friend_scenarios')) return opts.waiting ? { 1: 1 } : null;
          if (sql.includes('friend_tags')) return opts.answered ? { 1: 1 } : null;
          return null;
        },
      }),
    }),
  } as unknown as D1Database;
}

describe('findFreeTextAnswer', () => {
  it('返事待ちで、まだ答えていない人の文は「その他」の答えとして受け取る', async () => {
    const answer = await findFreeTextAnswer(fakeDb({ waiting: true, answered: false }), 'f1', ACCOUNT);
    expect(answer?.replyKeyword).toBe('asa_q1');
    expect(answer?.tagIds).toEqual([
      '4f7ef601-20e5-4bc1-bc5b-3ca3d2e51293',
      'aa43c4e9-79ca-4fdc-8e84-ccf19c131a4a',
      '5069f021-a276-4dd7-b02a-a03dec16092a',
    ]);
  });
  it('ボタンで答え済みの人の文は普通のトークのまま', async () => {
    expect(await findFreeTextAnswer(fakeDb({ waiting: true, answered: true }), 'f1', ACCOUNT)).toBeNull();
  });
  it('返事待ちでない人（今までの友だち・1時間過ぎた人）の文は普通のトークのまま', async () => {
    expect(await findFreeTextAnswer(fakeDb({ waiting: false, answered: false }), 'f1', ACCOUNT)).toBeNull();
  });
  it('ほかのアカウント（インターン用など）では何もしない', async () => {
    expect(await findFreeTextAnswer(fakeDb({ waiting: true, answered: false }), 'f1', 'other-account')).toBeNull();
    expect(await findFreeTextAnswer(fakeDb({ waiting: true, answered: false }), 'f1', null)).toBeNull();
  });
});

describe('isRepeatedAnswer', () => {
  const ANSWERED = 'aa43c4e9-79ca-4fdc-8e84-ccf19c131a4a';
  const BUTTON = ['d458abb9-f279-4884-86b8-75622282d186', ANSWERED, '5069f021-a276-4dd7-b02a-a03dec16092a'];
  it('答え済みの人がもう一度ボタンを押したら押し直し扱い', async () => {
    expect(await isRepeatedAnswer(fakeDb({ waiting: true, answered: true }), 'f1', ACCOUNT, BUTTON)).toBe(true);
  });
  it('はじめて押したときは普通に受け取る', async () => {
    expect(await isRepeatedAnswer(fakeDb({ waiting: true, answered: false }), 'f1', ACCOUNT, BUTTON)).toBe(false);
  });
  it('質問カード以外のボタン・ほかのアカウントは今までどおり', async () => {
    expect(await isRepeatedAnswer(fakeDb({ waiting: true, answered: true }), 'f1', ACCOUNT, ['other-tag'])).toBe(false);
    expect(await isRepeatedAnswer(fakeDb({ waiting: true, answered: true }), 'f1', 'other-account', BUTTON)).toBe(false);
  });
});
