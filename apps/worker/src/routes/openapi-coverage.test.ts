// OpenAPI カバレッジゲート — 実在ルートと spec のズレを可視化し、これ以上増やさない。
//
// 背景: 2026-08-25 時点で実在357ルートに対し spec は81（23%）しか無かった。
// そのせいで、オートウェビナーを構築しようとした利用者が動画アップロードの口を
// 見つけられず、20以上のエンドポイントを推測で叩いた末に OSS のソースを読んで
// 発見する、という事故が起きた（構築記録 §6-5「最長の詰まり」）。
// OpenAPI は AI エージェントと利用者にとって唯一の発見経路なので、
// 「載っていない」は「無い」と同義になる。
//
// このテストは apps/worker/src のルート登録を静的に抽出し、spec と突き合わせる。
// **新しいルートを足して spec に書かないと落ちる。** 落ちたら:
//   1. openapi.ts に追記する（推奨）、または
//   2. 意図的に載せないなら KNOWN_GAPS に理由付きで追記する
//
// KNOWN_GAPS は「今ある負債」であって許可リストではない。減らす方向にだけ動かす
// （spec に書いたのに KNOWN_GAPS に残っていると、stale 検査で落ちる）。
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..');

/** Hono のルート登録を静的に抽出し、OpenAPI 記法（{param}）へ正規化する。 */
function actualRoutes(): string[] {
  const files = [
    ...readdirSync(join(SRC, 'routes'))
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .map((f) => join(SRC, 'routes', f)),
    join(SRC, 'index.ts'),
  ];
  const re = /\.(get|post|put|delete|patch)\(\s*'([^']+)'/g;
  const out = new Set<string>();
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(re)) {
      const method = m[1].toUpperCase();
      const raw = m[2];
      // 公開 API 面だけを対象にする（内部ヘルパの .get() 等は拾わない）。
      if (!(raw.startsWith('/api') || raw.startsWith('/r/') || raw.startsWith('/t/') || raw === '/webhook')) continue;
      const path = raw.replace(/:([A-Za-z0-9_]+)/g, '{$1}').replace(/\/\*$/, '/{path}');
      out.add(`${method} ${path}`);
    }
  }
  return [...out].sort();
}

/** openapi.ts の spec から「METHOD /path」を抽出する。 */
function documentedRoutes(): string[] {
  const src = readFileSync(join(SRC, 'routes', 'openapi.ts'), 'utf8');
  const out = new Set<string>();
  const blocks = /^    '([^']+)': \{([\s\S]*?)^    \},$/gm;
  for (const b of src.matchAll(blocks)) {
    const path = b[1];
    for (const mm of b[2].matchAll(/^      (get|post|put|delete|patch): \{/gm)) {
      out.add(`${mm[1].toUpperCase()} ${path}`);
    }
  }
  return [...out].sort();
}

/**
 * 未記載のまま残っているルート（= 返済すべき負債）。
 * 優先順位は「エージェントが使うか」。/api/liff/* はクライアント専用なので最後でよい。
 */
/**
 * **意図的にエージェントへ公開しない**ルート。負債ではない。
 *
 * LIFF クライアント（`/api/liff/*`）は LIFF アプリ自身が呼ぶ内部 API、
 * `/api/webhooks/*` は外部サービスからの受信口、フォームの `opened`/`partial` は
 * 回答画面が投げる計測イベント。いずれも AI エージェントや利用者が直接叩くものではない。
 *
 * ここに入れるかどうかの判断は「エージェントがこれを呼ぶ場面があるか」。
 * 迷ったら KNOWN_GAPS に置く（負債として見えるほうが安全）。
 */
const CLIENT_ONLY: readonly string[] = [
  // liff (29)
  'GET /api/liff/affiliate/me',
  'GET /api/liff/affiliate/offers',
  'GET /api/liff/booking/availability',
  'GET /api/liff/booking/me',
  'GET /api/liff/booking/menus',
  'GET /api/liff/booking/menus/{id}/staff',
  'GET /api/liff/config',
  'GET /api/liff/events/me',
  'GET /api/liff/events/me/{bookingId}',
  'GET /api/liff/events/{id}',
  'GET /api/liff/events/{id}/slots',
  'GET /api/liff/mileage/me',
  'GET /api/liff/webinars/{slug}',
  'GET /api/liff/webinars/{slug}/consultation-slots',
  'POST /api/liff/affiliate/links',
  'POST /api/liff/affiliate/offers/{id}/enroll',
  'POST /api/liff/affiliate/register',
  'POST /api/liff/booking/requests',
  'POST /api/liff/events/me/{bookingId}/cancel',
  'POST /api/liff/events/{id}/bookings',
  'POST /api/liff/link',
  'POST /api/liff/profile',
  'POST /api/liff/send-form-link',
  'POST /api/liff/webinars/{slug}/comments',
  'POST /api/liff/webinars/{slug}/consultation-book',
  'POST /api/liff/webinars/{slug}/cta-click',
  'POST /api/liff/webinars/{slug}/funnel-event',
  'POST /api/liff/webinars/{slug}/heartbeat',
  'POST /api/liff/webinars/{slug}/register',
  // webhooks (9)
  'DELETE /api/webhooks/incoming/{id}',
  'DELETE /api/webhooks/outgoing/{id}',
  'GET /api/webhooks/incoming',
  'GET /api/webhooks/outgoing',
  'POST /api/webhooks/incoming',
  'POST /api/webhooks/incoming/{id}/receive',
  'POST /api/webhooks/outgoing',
  'PUT /api/webhooks/incoming/{id}',
  'PUT /api/webhooks/outgoing/{id}',
  // forms (2)
  'POST /api/forms/{id}/opened',
  'POST /api/forms/{id}/partial',
];

/**
 * 未記載のまま残っている**返すべき負債**。
 * 優先順位は「エージェントが使うか」。数が多い順に booking / events /
 * rich-menu-groups / integrations あたりが機能として大きい。
 */
const KNOWN_GAPS: readonly string[] = [
  // booking (26)
  'DELETE /api/booking/admin/menus/{id}',
  'DELETE /api/booking/admin/staff/{id}',
  'DELETE /api/booking/admin/staff/{id}/google-calendar',
  'DELETE /api/booking/admin/staff/{id}/shifts/{shiftId}',
  'GET /api/booking/admin/availability',
  'GET /api/booking/admin/menus',
  'GET /api/booking/admin/menus/{id}/staff',
  'GET /api/booking/admin/pending-count',
  'GET /api/booking/admin/requests',
  'GET /api/booking/admin/staff',
  'GET /api/booking/admin/staff/{id}/availability-rules',
  'GET /api/booking/admin/staff/{id}/google-calendar',
  'GET /api/booking/admin/staff/{id}/menus',
  'GET /api/booking/admin/staff/{id}/shifts',
  'PATCH /api/booking/admin/requests/{id}',
  'POST /api/booking/admin/bookings',
  'POST /api/booking/admin/menus',
  'POST /api/booking/admin/staff',
  'POST /api/booking/admin/staff/{id}/google-calendar/oauth/start',
  'POST /api/booking/admin/staff/{id}/shifts/generate',
  'PUT /api/booking/admin/menus/{id}',
  'PUT /api/booking/admin/staff/{id}',
  'PUT /api/booking/admin/staff/{id}/availability-rules',
  'PUT /api/booking/admin/staff/{id}/google-calendar',
  'PUT /api/booking/admin/staff/{id}/menus',
  'PUT /api/booking/admin/staff/{id}/shifts',
  // events (14)
  'DELETE /api/events/admin/events/{id}',
  'DELETE /api/events/admin/events/{id}/slots/{slotId}',
  'GET /api/events/admin/events',
  'GET /api/events/admin/events/notifications/pending',
  'GET /api/events/admin/events/{id}',
  'GET /api/events/admin/events/{id}/bookings',
  'GET /api/events/admin/events/{id}/slots',
  'POST /api/events/admin/events',
  'POST /api/events/admin/events/{id}/bookings/{bookingId}/cancel',
  'POST /api/events/admin/events/{id}/bookings/{bookingId}/decide',
  'POST /api/events/admin/events/{id}/slots',
  'PUT /api/events/admin/events/{id}',
  'PUT /api/events/admin/events/{id}/bookings/{bookingId}',
  'PUT /api/events/admin/events/{id}/slots/{slotId}',
  // rich-menu-groups (13)
  'DELETE /api/rich-menu-groups/external/{richMenuId}',
  'DELETE /api/rich-menu-groups/{groupId}',
  'GET /api/rich-menu-groups',
  'GET /api/rich-menu-groups/external',
  'GET /api/rich-menu-groups/external/{richMenuId}/image',
  'GET /api/rich-menu-groups/{groupId}',
  'PATCH /api/rich-menu-groups/{groupId}',
  'POST /api/rich-menu-groups',
  'POST /api/rich-menu-groups/import',
  'POST /api/rich-menu-groups/{groupId}/apply-to-tag',
  'POST /api/rich-menu-groups/{groupId}/pages/{pageId}/image',
  'POST /api/rich-menu-groups/{groupId}/publish',
  'POST /api/rich-menu-groups/{groupId}/unpublish',
  // friends (12)
  'DELETE /api/friends/{friendId}/rich-menu',
  'GET /api/friends/ref-stats',
  'GET /api/friends/{friendId}/reminders',
  'GET /api/friends/{friendId}/rich-menu',
  'GET /api/friends/{id}/journey',
  'GET /api/friends/{id}/messages',
  'GET /api/friends/{id}/mileage',
  'GET /api/friends/{id}/score',
  'POST /api/friends/{friendId}/rich-menu',
  'POST /api/friends/{id}/messages',
  'POST /api/friends/{id}/score',
  'PUT /api/friends/{id}/metadata',
  // admin (10)
  'GET /api/admin/auto-reply-stats',
  'GET /api/admin/automations-summary',
  'GET /api/admin/friend-debug/{id}',
  'GET /api/admin/recent-messages',
  'POST /api/admin/broadcast-coverage',
  'POST /api/admin/broadcasts/{id}/reset-to-draft',
  'POST /api/admin/content-leak-check',
  'POST /api/admin/refresh-profiles',
  'POST /api/admin/tag-leak-check',
  'POST /api/admin/tag-remove-content-dups',
  // integrations (10)
  'DELETE /api/integrations/google-calendar/{id}',
  'GET /api/integrations/google-calendar',
  'GET /api/integrations/google-calendar/bookings',
  'GET /api/integrations/google-calendar/slots',
  'GET /api/integrations/stripe/events',
  'POST /api/integrations/google-calendar/book',
  'POST /api/integrations/google-calendar/connect',
  'POST /api/integrations/ig-harness/engagement',
  'POST /api/integrations/stripe/webhook',
  'PUT /api/integrations/google-calendar/bookings/{id}/status',
  // reminders (8)
  'DELETE /api/reminders/{id}',
  'DELETE /api/reminders/{reminderId}/steps/{stepId}',
  'GET /api/reminders',
  'GET /api/reminders/{id}',
  'POST /api/reminders',
  'POST /api/reminders/{id}/enroll/{friendId}',
  'POST /api/reminders/{id}/steps',
  'PUT /api/reminders/{id}',
  // broadcasts (7)
  'GET /api/broadcasts/{id}/insight',
  'GET /api/broadcasts/{id}/per-account-stats',
  'GET /api/broadcasts/{id}/preview-count',
  'GET /api/broadcasts/{id}/progress',
  'POST /api/broadcasts/{id}/fetch-insight',
  'POST /api/broadcasts/{id}/send-segment',
  'POST /api/broadcasts/{id}/test-send',
  // staff (7)
  'DELETE /api/staff/{id}',
  'GET /api/staff',
  'GET /api/staff/me',
  'GET /api/staff/{id}',
  'PATCH /api/staff/{id}',
  'POST /api/staff',
  'POST /api/staff/{id}/regenerate-key',
  // account-settings (6)
  'GET /api/account-settings/link-base-url',
  'GET /api/account-settings/test-recipients',
  'GET /api/account-settings/tracked-link-base-url',
  'PUT /api/account-settings/link-base-url',
  'PUT /api/account-settings/test-recipients',
  'PUT /api/account-settings/tracked-link-base-url',
  // ad-platforms (6)
  'DELETE /api/ad-platforms/{id}',
  'GET /api/ad-platforms',
  'GET /api/ad-platforms/{id}/logs',
  'POST /api/ad-platforms',
  'POST /api/ad-platforms/test',
  'PUT /api/ad-platforms/{id}',
  // automations (6)
  'DELETE /api/automations/{id}',
  'GET /api/automations',
  'GET /api/automations/{id}',
  'GET /api/automations/{id}/logs',
  'POST /api/automations',
  'PUT /api/automations/{id}',
  // chats (6)
  'GET /api/chats',
  'GET /api/chats/{id}',
  'POST /api/chats',
  'POST /api/chats/{id}/loading',
  'POST /api/chats/{id}/send',
  'PUT /api/chats/{id}',
  // mileage (6)
  'DELETE /api/mileage/rules/{id}',
  'GET /api/mileage/overview',
  'GET /api/mileage/rules',
  'POST /api/mileage/events',
  'POST /api/mileage/rules',
  'PUT /api/mileage/rules/{id}',
  // notifications (6)
  'DELETE /api/notifications/rules/{id}',
  'GET /api/notifications',
  'GET /api/notifications/rules',
  'GET /api/notifications/rules/{id}',
  'POST /api/notifications/rules',
  'PUT /api/notifications/rules/{id}',
  // templates (6)
  'DELETE /api/templates/{id}',
  'GET /api/templates',
  'GET /api/templates/{id}',
  'GET /api/templates/{id}/usages',
  'POST /api/templates',
  'PUT /api/templates/{id}',
  // auto-replies (5)
  'DELETE /api/auto-replies/{id}',
  'GET /api/auto-replies',
  'GET /api/auto-replies/{id}',
  'POST /api/auto-replies',
  'PUT /api/auto-replies/{id}',
  // line-accounts (5)
  'GET /api/line-accounts/{id}/follower-import',
  'GET /api/line-accounts/{id}/follower-insight',
  'POST /api/line-accounts/{id}/follower-import/detect',
  'POST /api/line-accounts/{id}/follower-import/start',
  'POST /api/line-accounts/{id}/follower-import/step',
  // message-templates (5)
  'DELETE /api/message-templates/{id}',
  'GET /api/message-templates',
  'GET /api/message-templates/{id}',
  'POST /api/message-templates',
  'PUT /api/message-templates/{id}',
  // rich-menus (5)
  'DELETE /api/rich-menus/{id}',
  'GET /api/rich-menus',
  'POST /api/rich-menus',
  'POST /api/rich-menus/{id}/default',
  'POST /api/rich-menus/{id}/image',
  // scoring-rules (5)
  'DELETE /api/scoring-rules/{id}',
  'GET /api/scoring-rules',
  'GET /api/scoring-rules/{id}',
  'POST /api/scoring-rules',
  'PUT /api/scoring-rules/{id}',
  // accounts (4)
  'GET /api/accounts/migrations',
  'GET /api/accounts/migrations/{migrationId}',
  'GET /api/accounts/{id}/health',
  'POST /api/accounts/{id}/migrate',
  // affiliate-offers (4)
  'GET /api/affiliate-offers',
  'GET /api/affiliate-offers/{id}',
  'POST /api/affiliate-offers',
  'PUT /api/affiliate-offers/{id}',
  // operators (4)
  'DELETE /api/operators/{id}',
  'GET /api/operators',
  'POST /api/operators',
  'PUT /api/operators/{id}',
  // traffic-pools (4)
  'DELETE /api/traffic-pools/{id}/accounts/{accountId}',
  'GET /api/traffic-pools/{id}/accounts',
  'POST /api/traffic-pools/{id}/accounts',
  'PUT /api/traffic-pools/{id}/accounts/{accountId}',
  // auth (3)
  'GET /api/auth/session',
  'POST /api/auth/login',
  'POST /api/auth/logout',
  // inbox (3)
  'GET /api/inbox/activity-digest',
  'GET /api/inbox/unanswered',
  'GET /api/inbox/unanswered/count',
  // meet-consultations (3)
  'DELETE /api/meet-consultations/{externalEventId}',
  'GET /api/meet-consultations',
  'POST /api/meet-consultations',
  // scenarios (3)
  'GET /api/scenarios/{id}/preview',
  'GET /api/scenarios/{id}/stats',
  'POST /api/scenarios/{id}/steps/reorder',
  // tracked-links (3)
  'DELETE /api/tracked-links/{id}',
  'GET /api/tracked-links/{id}',
  'PATCH /api/tracked-links/{id}',
  // affiliates (2)
  'GET /api/affiliates/{id}/journeys',
  'GET /api/affiliates/{id}/links',
  // analytics (2)
  'GET /api/analytics/ref-summary',
  'GET /api/analytics/ref/{refCode}',
  // conversations (2)
  'GET /api/conversations',
  'GET /api/conversations/{friendId}',
  // conversions (2)
  'GET /api/conversions/approvals',
  'PATCH /api/conversions/events/{id}/approval',
  // images (2)
  'DELETE /api/images/{key}',
  'POST /api/images',
  // affiliates-report (1)
  'GET /api/affiliates-report',
  // capabilities (1)
  'GET /api/capabilities',
  // duplicates (1)
  'GET /api/duplicates/stats',
  // friend-reminders (1)
  'DELETE /api/friend-reminders/{id}',
  // health (1)
  'GET /api/health',
  // links (1)
  'POST /api/links/wrap',
  // meet-callback (1)
  'POST /api/meet-callback',
  // public (1)
  'POST /api/public/media-inquiries',
  // qr (1)
  'GET /api/qr',
  // r (1)
  'GET /r/{ref}/help',
  // rich-menu-images (1)
  'GET /api/rich-menu-images/{key}{.+}',
  // segments (1)
  'POST /api/segments/count',
  // tags (1)
  'PATCH /api/tags/{id}/mileage',
  // usage (1)
  'GET /api/usage',
  // users-grouped (1)
  'GET /api/users-grouped',
];

describe('OpenAPI カバレッジ', () => {
  it('spec に無いルートは KNOWN_GAPS に載っていること（新規ルートは spec 必須）', () => {
    const undocumented = actualRoutes().filter((r) => !documentedRoutes().includes(r));
    const unexpected = undocumented.filter((r) => !KNOWN_GAPS.includes(r) && !CLIENT_ONLY.includes(r));
    expect(
      unexpected,
      `spec にも KNOWN_GAPS にも CLIENT_ONLY にも無いルート:\n${unexpected.join('\n')}`,
    ).toEqual([]);
  });

  it('KNOWN_GAPS に stale な項目が無いこと（spec に書いたら消す）', () => {
    const actual = actualRoutes();
    const documented = documentedRoutes();
    const stale = [...KNOWN_GAPS, ...CLIENT_ONLY].filter((g) => documented.includes(g) || !actual.includes(g));
    expect(stale, `spec に記載済み、または実在しないルートが KNOWN_GAPS に残っている:\n${stale.join('\n')}`).toEqual([]);
  });

  it('実質カバレッジ（クライアント専用を除く）が後退していないこと', () => {
    // 「返すべき対象」に対する到達率。CLIENT_ONLY を分母から外さないと、
    // 返さなくてよいものが混ざって進捗が読めない。
    const actual = actualRoutes();
    const target = actual.filter((r) => !CLIENT_ONLY.includes(r));
    const documented = documentedRoutes().filter((d) => target.includes(d));
    const rate = Math.floor((documented.length / target.length) * 100);
    // 2026-08-25 実測: 87/317 = 27%。**下げてはいけない**。
    expect(rate).toBeGreaterThanOrEqual(27);
  });

  it('カバレッジが後退していないこと', () => {
    const actual = actualRoutes();
    const documented = documentedRoutes().filter((d) => actual.includes(d));
    // 2026-08-25 の実測値（entry-routes 6本を追加して 81→87）。**下げてはいけない**。
    expect(documented.length).toBeGreaterThanOrEqual(87);
  });
});
