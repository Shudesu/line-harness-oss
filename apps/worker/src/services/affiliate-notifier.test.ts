import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the LINE SDK so we can assert exactly what gets pushed without hitting
// the network. pushMessage is a shared spy across all LineClient instances.
const pushMessage = vi.fn().mockResolvedValue({});
const LineClientMock = vi.fn().mockImplementation((token: string) => ({
  __token: token,
  pushMessage,
}));
vi.mock('@line-crm/line-sdk', () => ({ LineClient: LineClientMock }));

// Mock the db helpers the notifier resolves through.
const dbMocks = {
  getAffiliateById: vi.fn(),
  getFriendById: vi.fn(),
  getLineAccountById: vi.fn(),
};
vi.mock('@line-crm/db', () => dbMocks);

const {
  notifyAffiliate,
  notifyAffiliateFriendAdd,
  notifyAffiliateApproval,
} = await import('./affiliate-notifier.js');

const DB = {} as D1Database;
const env = { LINE_CHANNEL_ACCESS_TOKEN: 'env-token' };

beforeEach(() => {
  vi.clearAllMocks();
  pushMessage.mockResolvedValue({});
});

describe('notifyAffiliate', () => {
  it('pushes to the affiliate friend via the account token', async () => {
    dbMocks.getAffiliateById.mockResolvedValue({ id: 'aff-1', friend_id: 'fr-1' });
    dbMocks.getFriendById.mockResolvedValue({
      id: 'fr-1',
      line_user_id: 'Uaaa',
      line_account_id: 'acct-1',
    });
    dbMocks.getLineAccountById.mockResolvedValue({ channel_access_token: 'acct-token' });

    await notifyAffiliate(DB, env, 'aff-1', 'hello');

    expect(LineClientMock).toHaveBeenCalledWith('acct-token');
    expect(pushMessage).toHaveBeenCalledWith('Uaaa', [{ type: 'text', text: 'hello' }]);
  });

  it('falls back to env token when the account has no token', async () => {
    dbMocks.getAffiliateById.mockResolvedValue({ id: 'aff-1', friend_id: 'fr-1' });
    dbMocks.getFriendById.mockResolvedValue({
      id: 'fr-1',
      line_user_id: 'Uaaa',
      line_account_id: null,
    });

    await notifyAffiliate(DB, env, 'aff-1', 'hello');

    expect(dbMocks.getLineAccountById).not.toHaveBeenCalled();
    expect(LineClientMock).toHaveBeenCalledWith('env-token');
    expect(pushMessage).toHaveBeenCalledWith('Uaaa', [{ type: 'text', text: 'hello' }]);
  });

  it('skips silently when the affiliate has no bound friend', async () => {
    dbMocks.getAffiliateById.mockResolvedValue({ id: 'aff-1', friend_id: null });

    await notifyAffiliate(DB, env, 'aff-1', 'hello');

    expect(dbMocks.getFriendById).not.toHaveBeenCalled();
    expect(pushMessage).not.toHaveBeenCalled();
  });

  it('skips silently when the affiliate does not exist', async () => {
    dbMocks.getAffiliateById.mockResolvedValue(null);

    await notifyAffiliate(DB, env, 'nope', 'hello');

    expect(pushMessage).not.toHaveBeenCalled();
  });

  it('skips silently when the bound friend has no line_user_id', async () => {
    dbMocks.getAffiliateById.mockResolvedValue({ id: 'aff-1', friend_id: 'fr-1' });
    dbMocks.getFriendById.mockResolvedValue({ id: 'fr-1', line_user_id: '', line_account_id: null });

    await notifyAffiliate(DB, env, 'aff-1', 'hello');

    expect(pushMessage).not.toHaveBeenCalled();
  });

  it('does not throw when pushMessage rejects (best-effort)', async () => {
    dbMocks.getAffiliateById.mockResolvedValue({ id: 'aff-1', friend_id: 'fr-1' });
    dbMocks.getFriendById.mockResolvedValue({
      id: 'fr-1',
      line_user_id: 'Uaaa',
      line_account_id: null,
    });
    pushMessage.mockRejectedValue(new Error('LINE 500'));

    await expect(notifyAffiliate(DB, env, 'aff-1', 'hello')).resolves.toBeUndefined();
  });

  it('does not throw when a db lookup rejects (best-effort)', async () => {
    dbMocks.getAffiliateById.mockRejectedValue(new Error('db down'));
    await expect(notifyAffiliate(DB, env, 'aff-1', 'hello')).resolves.toBeUndefined();
    expect(pushMessage).not.toHaveBeenCalled();
  });
});

describe('notifyAffiliateFriendAdd', () => {
  beforeEach(() => {
    dbMocks.getAffiliateById.mockResolvedValue({ id: 'aff-1', friend_id: 'fr-1' });
    dbMocks.getFriendById.mockResolvedValue({
      id: 'fr-1',
      line_user_id: 'Uaaa',
      line_account_id: null,
    });
  });

  it('includes the offer name when present', async () => {
    await notifyAffiliateFriendAdd(DB, env, 'aff-1', 'キャンペーンA');
    const text = pushMessage.mock.calls[0][1][0].text as string;
    expect(text).toContain('🎉 あなたの紹介リンクから友だち追加がありました！');
    expect(text).toContain('案件: キャンペーンA');
    expect(text).toContain('『アフィリ』と送るとマイページで実績を確認できます');
  });

  it('uses 汎用リンク when offer name is null', async () => {
    await notifyAffiliateFriendAdd(DB, env, 'aff-1', null);
    const text = pushMessage.mock.calls[0][1][0].text as string;
    expect(text).toContain('案件: 汎用リンク');
  });
});

describe('notifyAffiliateApproval', () => {
  beforeEach(() => {
    dbMocks.getAffiliateById.mockResolvedValue({ id: 'aff-1', friend_id: 'fr-1' });
    dbMocks.getFriendById.mockResolvedValue({
      id: 'fr-1',
      line_user_id: 'Uaaa',
      line_account_id: null,
    });
  });

  it('includes the offer + formatted reward when the offer is present', async () => {
    await notifyAffiliateApproval(DB, env, 'aff-1', '案件X', 12345);
    const text = pushMessage.mock.calls[0][1][0].text as string;
    expect(text).toContain('✅ 成果が承認されました！');
    expect(text).toContain('案件: 案件X');
    expect(text).toContain('確定報酬: ¥12,345');
    expect(text).toContain('『アフィリ』と送るとマイページで確認できます');
  });

  it('omits the reward line for an offer-less attribution', async () => {
    await notifyAffiliateApproval(DB, env, 'aff-1', null, 0);
    const text = pushMessage.mock.calls[0][1][0].text as string;
    expect(text).toContain('✅ 成果が承認されました！');
    expect(text).not.toContain('案件:');
    expect(text).not.toContain('確定報酬');
  });
});
