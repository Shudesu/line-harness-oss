/**
 * L-TRACK 互換: 認証スキップモード のマッチング処理
 *
 * skip_liff=1 のトラックリンクをクリックして友だち追加した場合、
 * クリック時点ではfriend_idが未確定。クリックログには ltp/fbclid/UA/IP のみ記録される。
 *
 * follow webhook 受信時にこの関数を呼ぶ。直近N分（デフォルト10分）の friend_id=NULL の
 * link_click を、時間窓+IP+UA で突合して、マッチしたら friend_id を埋める。
 *
 * 重要な制約: LINE follow webhook には IP/UA が来ない（公式仕様）ため、
 * このルートで取れるシグナルは「時間」のみ。同時複数 click 時は最終手段「直近1件のみ」になり、
 * L-TRACK と同じく精度に限界がある。
 *
 * 高精度モード（LIFF経由・確定的紐付け）を使う場合は、tracked_links.skip_liff=0 にする。
 */

import {
  findRecentAnonymousClickMatch,
  attachFriendToClick,
  getTrackedLinkById,
  addTagToFriend,
  enrollFriendInScenario,
  recordRefTracking,
  enqueueAfConfirm,
} from '@line-crm/db';

export interface SkipLiffMatchResult {
  matched: boolean;
  clickId?: string;
  trackedLinkId?: string;
  strategy?: string;
  confidence?: number;
  capiPromoted?: boolean;
  /** 紐付けた tracked_link の af_confirm_type。webhook 側で即時 CAPI 発火判定に使う。 */
  afConfirmType?: 'immediate' | '1h' | '3h' | '24h' | null;
  /** 紐付けた tracked_link の af_amount (円)。CAPI の eventValue に渡す。 */
  afAmount?: number | null;
}

/**
 * CAPI 送信を許可する confidence の下限。
 * time_only (0.40) は偽CV を防ぐためここで足切りする。
 */
const CAPI_PROMOTION_MIN_CONFIDENCE = 0.70;

/**
 * follow webhook 受信時に呼ぶ。
 * @param db D1 database
 * @param friendId 新しく追加された friend のID
 * @param opts.windowSeconds 時間窓（デフォルト600秒=10分）
 * @returns マッチ成否と情報
 *
 * 注意: findRecentAnonymousClickMatch は DB layer で skip_liff=1 のtracked_link に限定済み。
 * よってここで link.skip_liff を再チェックする必要はない（DB layer で保証）。
 */
export async function trySkipLiffMatch(
  db: D1Database,
  friendId: string,
  opts: { windowSeconds?: number; lineAccountId?: string | null } = {},
): Promise<SkipLiffMatchResult> {
  const windowSeconds = opts.windowSeconds ?? 600;

  // webhook には IP/UA が来ないので、time_only マッチのみ実行可能。
  // High fix: tracked_link を先に取得（attach の前に自動アクション準備のため）。
  // High fix: lineAccountId で multi-account 境界を保つ。
  const match = await findRecentAnonymousClickMatch(db, {
    windowSeconds,
    lineAccountId: opts.lineAccountId,
  });
  if (!match) {
    return { matched: false };
  }

  // 時間窓マッチが見つかった → friend_id を埋める。
  // High fix: 競合制御のため戻り値を確認。同時 follow で既に他friendがマッチしていれば false が返る。
  const attached = await attachFriendToClick(
    db,
    match.click.id,
    friendId,
    match.strategy,
    match.confidence,
  );
  if (!attached) {
    // 既に別follow がマッチ済み（友だち追加が webhook 同時着信のレアケース）
    return { matched: false };
  }

  // tracked_link の自動アクション実行（findRecentAnonymousClickMatch で skip_liff=1 保証済み）
  const link = await getTrackedLinkById(db, match.click.tracked_link_id);
  if (link) {
    const actions: Promise<unknown>[] = [];
    if (link.tag_id) actions.push(addTagToFriend(db, friendId, link.tag_id));
    if (link.scenario_id) actions.push(enrollFriendInScenario(db, friendId, link.scenario_id));
    if (actions.length > 0) await Promise.allSettled(actions);

    // friends.first_tracked_link_id を設定（既存ロジックと同じ first-touch attribution）
    await db
      .prepare(
        `UPDATE friends
           SET first_tracked_link_id = ?
         WHERE id = ?
           AND (first_tracked_link_id IS NULL)`,
      )
      .bind(link.id, friendId)
      .run();
  }

  // CAPI 昇格: link_clicks に保存された fbclid/gclid/twclid/ttclid を
  // ref_tracking にコピーする。これで既存の sendAdConversions() が拾える。
  //
  // 重要: time_only マッチ (confidence=0.40) は偽CV になるので除外。
  // 現状 webhook には IP/UA が来ないので、ip_ua / ua_only マッチは事実上来ない
  // 想定だが、将来 LP用タグ等で先行 attach が可能になった時を見据えてガードする。
  let capiPromoted = false;
  let promotedRefTrackingId: string | null = null;
  if (match.confidence >= CAPI_PROMOTION_MIN_CONFIDENCE) {
    const click = match.click;
    const hasClickId =
      !!click.fbclid || !!click.gclid || !!click.twclid || !!click.ttclid;
    if (hasClickId) {
      try {
        const ref = await recordRefTracking(db, {
          // tracked_link は ref_code を持たないので合成キーで識別
          refCode: `tl_${match.click.tracked_link_id}`,
          friendId,
          entryRouteId: null,
          sourceUrl: null,
          fbclid: click.fbclid,
          gclid: click.gclid,
          twclid: click.twclid,
          ttclid: click.ttclid,
          utmSource: click.utm_source,
          utmMedium: click.utm_medium,
          utmCampaign: click.utm_campaign,
          userAgent: click.user_agent,
          ipAddress: click.ip_address,
          ltp: click.ltp,
          country: click.country,
        });
        capiPromoted = true;
        promotedRefTrackingId = ref.id;
      } catch (err) {
        console.error('[skip-liff] CAPI promotion failed:', err);
      }
    }
  }

  // 遅延確定: af_confirm_type が 1h/3h/24h なら確定キューに enqueue。
  // 即時は webhook 側で sendAdConversions を直接発火するためここでは何もしない。
  const af = link?.af_confirm_type ?? 'immediate';
  if (capiPromoted && (af === '1h' || af === '3h' || af === '24h')) {
    try {
      await enqueueAfConfirm(db, {
        friendId,
        trackedLinkId: link?.id ?? match.click.tracked_link_id,
        refTrackingId: promotedRefTrackingId,
        afConfirmType: af,
      });
    } catch (err) {
      console.error('[skip-liff] enqueue af_confirm failed:', err);
    }
  }

  return {
    matched: true,
    clickId: match.click.id,
    trackedLinkId: match.click.tracked_link_id,
    strategy: match.strategy,
    confidence: match.confidence,
    capiPromoted,
    afConfirmType: (link?.af_confirm_type as
      | 'immediate'
      | '1h'
      | '3h'
      | '24h'
      | undefined) ?? null,
    afAmount: link?.af_amount ?? null,
  };
}
