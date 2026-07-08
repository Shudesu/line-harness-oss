import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';

const dbMocks = {
  getForms: vi.fn(),
  getFormsWithStats: vi.fn(),
  getFormById: vi.fn(),
  createForm: vi.fn(),
  updateForm: vi.fn(),
  deleteForm: vi.fn(),
  getFormSubmissions: vi.fn(),
  createFormSubmission: vi.fn(),
  getFriendByLineUserId: vi.fn(),
  getFriendById: vi.fn(),
  getTrackedLinkById: vi.fn(),
  getMessageTemplateById: vi.fn(),
  enrollFriendInScenario: vi.fn(),
  addTagToFriend: vi.fn(),
  jstNow: vi.fn(() => '2026-07-08T00:00:00.000+09:00'),
};
vi.mock('@line-crm/db', () => dbMocks);

const tagAttachMocks = {
  attachTagAndFireSideEffects: vi.fn(),
};
vi.mock('../services/friend-tag-attach.js', () => tagAttachMocks);

const { forms } = await import('./forms.js');

function setupApp() {
  const app = new Hono();
  app.route('/', forms);
  return app;
}

const db = {} as D1Database;

const activeForm = {
  id: 'form-1',
  name: '応募フォーム',
  description: null,
  fields: JSON.stringify([
    { name: 'email', label: 'メールアドレス', type: 'email', required: true },
  ]),
  on_submit_tag_id: 'tag-1',
  on_submit_scenario_id: null,
  on_submit_message_type: null,
  on_submit_message_content: null,
  on_submit_webhook_url: null,
  on_submit_webhook_headers: null,
  on_submit_webhook_fail_message: null,
  save_to_metadata: 0,
  is_active: 1,
  submit_count: 0,
  created_at: '2026-07-08T00:00:00.000+09:00',
  updated_at: '2026-07-08T00:00:00.000+09:00',
};

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  tagAttachMocks.attachTagAndFireSideEffects.mockReset();

  dbMocks.getFormById.mockResolvedValue(activeForm);
  dbMocks.getFriendByLineUserId.mockResolvedValue({
    id: 'friend-1',
    line_user_id: 'U_friend',
    display_name: 'テスト太郎',
    picture_url: null,
    status_message: null,
    is_following: 1,
    user_id: null,
    line_account_id: null,
    metadata: '{}',
    first_tracked_link_id: null,
    created_at: '2026-07-08T00:00:00.000+09:00',
    updated_at: '2026-07-08T00:00:00.000+09:00',
  });
  dbMocks.getFriendById.mockResolvedValue(null);
  dbMocks.getTrackedLinkById.mockResolvedValue(null);
  dbMocks.getMessageTemplateById.mockResolvedValue(null);
  dbMocks.createFormSubmission.mockResolvedValue({
    id: 'submission-1',
    form_id: 'form-1',
    friend_id: 'friend-1',
    data: JSON.stringify({ email: 'test@example.com' }),
    created_at: '2026-07-08T00:00:00.000+09:00',
  });
  tagAttachMocks.attachTagAndFireSideEffects.mockResolvedValue({ added: true });
});

describe('POST /api/forms/:id/submit', () => {
  test('on_submit_tag_id uses the tag attach service that fires tag_change side effects', async () => {
    const res = await setupApp().request(
      '/api/forms/form-1/submit',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lineUserId: 'U_friend',
          data: { email: 'test@example.com' },
        }),
      },
      {
        DB: db,
        LINE_CHANNEL_ACCESS_TOKEN: 'test-token',
      },
    );

    expect(res.status).toBe(201);
    expect(tagAttachMocks.attachTagAndFireSideEffects).toHaveBeenCalledWith(
      db,
      'friend-1',
      'tag-1',
    );
    expect(dbMocks.addTagToFriend).not.toHaveBeenCalled();
  });
});
