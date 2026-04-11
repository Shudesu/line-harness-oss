import { describe, it, expect, vi } from 'vitest';
import { resolveRewardTemplate } from './reward-resolver.js';
import type { MessageTemplate, TrackedLink, Friend } from '@line-crm/db';

const tplA: MessageTemplate = {
  id: 'tpl-a',
  name: 'reward A',
  message_type: 'text',
  message_content: 'A',
  created_at: '2026-04-07 00:00:00',
  updated_at: '2026-04-07 00:00:00',
};

const tplB: MessageTemplate = {
  id: 'tpl-b',
  name: 'reward B',
  message_type: 'text',
  message_content: 'B',
  created_at: '2026-04-07 00:00:00',
  updated_at: '2026-04-07 00:00:00',
};

const linkA: TrackedLink = {
  id: 'link-a',
  name: 'Campaign A',
  original_url: 'https://example.com',
  tag_id: null,
  scenario_id: null,
  intro_template_id: null,
  reward_template_id: 'tpl-a',
  is_active: 1,
  click_count: 0,
  created_at: '2026-04-01 00:00:00',
  updated_at: '2026-04-01 00:00:00',
} as TrackedLink;

const linkB: TrackedLink = {
  ...linkA,
  id: 'link-b',
  name: 'Campaign B',
  reward_template_id: 'tpl-b',
} as TrackedLink;

const linkNoReward: TrackedLink = {
  ...linkA,
  id: 'link-noreward',
  reward_template_id: null,
} as TrackedLink;

function makeDeps(opts: {
  friend?: Partial<Friend> | null;
  trackedLinks?: Record<string, TrackedLink>;
  templates?: Record<string, MessageTemplate>;
}) {
  return {
    getFriendById: vi.fn(async () => (opts.friend === undefined ? null : (opts.friend as Friend | null))),
    getTrackedLinkById: vi.fn(async (_db: unknown, id: string) => opts.trackedLinks?.[id] ?? null),
    getMessageTemplateById: vi.fn(async (_db: unknown, id: string) => opts.templates?.[id] ?? null),
  };
}

const fakeDb = {} as never;

describe('resolveRewardTemplate', () => {
  it('requestedTrackedLinkId が reward を持つ場合はそれを返す', async () => {
    const deps = makeDeps({
      friend: { id: 'f1', first_tracked_link_id: 'link-a' } as Friend,
      trackedLinks: { 'link-a': linkA, 'link-b': linkB },
      templates: { 'tpl-a': tplA, 'tpl-b': tplB },
    });
    const result = await resolveRewardTemplate(fakeDb, {
      friendId: 'f1',
      requestedTrackedLinkId: 'link-b',
    }, deps);
    expect(result).toEqual(tplB);
    expect(deps.getFriendById).not.toHaveBeenCalled();
  });

  it('requestedTrackedLinkId の link が存在しない場合は first-touch にフォールバック', async () => {
    const deps = makeDeps({
      friend: { id: 'f1', first_tracked_link_id: 'link-a' } as Friend,
      trackedLinks: { 'link-a': linkA },
      templates: { 'tpl-a': tplA },
    });
    const result = await resolveRewardTemplate(fakeDb, {
      friendId: 'f1',
      requestedTrackedLinkId: 'link-missing',
    }, deps);
    expect(result).toEqual(tplA);
  });

  it('requestedTrackedLinkId の link が reward_template_id NULL の場合は null を返す (first-touch にフォールバックしない)', async () => {
    // 意図的に reward なしで設定されたキャンペーンが、別キャンペーンの reward を漏らさないことを保証する。
    const deps = makeDeps({
      friend: { id: 'f1', first_tracked_link_id: 'link-a' } as Friend,
      trackedLinks: { 'link-noreward': linkNoReward, 'link-a': linkA },
      templates: { 'tpl-a': tplA },
    });
    const result = await resolveRewardTemplate(fakeDb, {
      friendId: 'f1',
      requestedTrackedLinkId: 'link-noreward',
    }, deps);
    expect(result).toBeNull();
    expect(deps.getFriendById).not.toHaveBeenCalled();
  });

  it('requestedTrackedLinkId なし & first_tracked_link_id なしは null', async () => {
    const deps = makeDeps({
      friend: { id: 'f1', first_tracked_link_id: null } as Friend,
      trackedLinks: {},
      templates: {},
    });
    const result = await resolveRewardTemplate(fakeDb, {
      friendId: 'f1',
      requestedTrackedLinkId: null,
    }, deps);
    expect(result).toBeNull();
  });

  it('requestedTrackedLinkId なし & first-touch ありは first-touch を返す (後方互換)', async () => {
    const deps = makeDeps({
      friend: { id: 'f1', first_tracked_link_id: 'link-a' } as Friend,
      trackedLinks: { 'link-a': linkA },
      templates: { 'tpl-a': tplA },
    });
    const result = await resolveRewardTemplate(fakeDb, {
      friendId: 'f1',
      requestedTrackedLinkId: null,
    }, deps);
    expect(result).toEqual(tplA);
  });
});
