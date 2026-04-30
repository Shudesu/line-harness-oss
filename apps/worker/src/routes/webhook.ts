import { Hono } from 'hono';
import { verifySignature, LineClient } from '@line-crm/line-sdk';
import type { WebhookRequestBody, WebhookEvent, TextEventMessage } from '@line-crm/line-sdk';
import {
  upsertFriend,
  updateFriendFollowStatus,
  getFriendByLineUserId,
  getScenarios,
  enrollFriendInScenario,
  getScenarioSteps,
  advanceFriendScenario,
  completeFriendScenario,
  upsertChatOnMessage,
  getLineAccounts,
  addTagToFriend,
  removeTagFromFriend,
  jstNow,
} from '@line-crm/db';
import { fireEvent } from '../services/event-bus.js';
import { buildMessage, expandVariables } from '../services/step-delivery.js';
import { buildMiniDiagnosisReportFlex } from '../services/diagnosis-report-flex.js';
import { DEMO_INDUSTRIES, DEMO_INDUSTRY_INTROS, DEMO_ACTIONS, DEMO_RICH_MENU_IDS, INDUSTRY_TAG_IDS, type DemoIndustryKey } from '../config/demo-config.js';
import type { Env } from '../index.js';

const webhook = new Hono<Env>();

webhook.post('/webhook', async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header('X-Line-Signature') ?? '';
  const db = c.env.DB;

  let body: WebhookRequestBody;
  try {
    body = JSON.parse(rawBody) as WebhookRequestBody;
  } catch {
    console.error('Failed to parse webhook body');
    return c.json({ status: 'ok' }, 200);
  }

  // Multi-account: resolve credentials from DB by destination (channel user ID)
  // or fall back to environment variables (default account)
  let channelSecret = c.env.LINE_CHANNEL_SECRET;
  let channelAccessToken = c.env.LINE_CHANNEL_ACCESS_TOKEN;
  let matchedAccountId: string | null = null;

  if ((body as { destination?: string }).destination) {
    const accounts = await getLineAccounts(db);
    for (const account of accounts) {
      if (!account.is_active) continue;
      const isValid = await verifySignature(account.channel_secret, rawBody, signature);
      if (isValid) {
        channelSecret = account.channel_secret;
        channelAccessToken = account.channel_access_token;
        matchedAccountId = account.id;
        break;
      }
    }
  }

  // Verify with resolved secret
  const valid = await verifySignature(channelSecret, rawBody, signature);
  if (!valid) {
    console.error('Invalid LINE signature');
    return c.json({ status: 'ok' }, 200);
  }

  const lineClient = new LineClient(channelAccessToken);

  // 非同期処理 — LINE は ~1s 以内のレスポンスを要求
  const processingPromise = (async () => {
    for (const event of body.events) {
      try {
        await handleEvent(db, lineClient, event, channelAccessToken, matchedAccountId, c.env.WORKER_URL || new URL(c.req.url).origin, c.env.LIFF_URL);
      } catch (err) {
        console.error('Error handling webhook event:', err);
      }
    }
  })();

  c.executionCtx.waitUntil(processingPromise);

  return c.json({ status: 'ok' }, 200);
});

async function handleEvent(
  db: D1Database,
  lineClient: LineClient,
  event: WebhookEvent,
  lineAccessToken: string,
  lineAccountId: string | null = null,
  workerUrl?: string,
  liffUrl?: string,
): Promise<void> {
  if (event.type === 'follow') {
    const userId =
      event.source.type === 'user' ? event.source.userId : undefined;
    if (!userId) return;

    console.log(`[follow] userId=${userId} lineAccountId=${lineAccountId}`);

    // プロフィール取得 & 友だち登録/更新
    let profile;
    try {
      profile = await lineClient.getProfile(userId);
    } catch (err) {
      console.error('Failed to get profile for', userId, err);
    }

    console.log(`[follow] profile=${profile?.displayName ?? 'null'}`);

    const friend = await upsertFriend(db, {
      lineUserId: userId,
      displayName: profile?.displayName ?? null,
      pictureUrl: profile?.pictureUrl ?? null,
      statusMessage: profile?.statusMessage ?? null,
    });

    console.log(`[follow] friend.id=${friend.id} friend.line_account_id=${(friend as any).line_account_id}`);

    // Set line_account_id for multi-account tracking (always update on follow)
    if (lineAccountId) {
      await db.prepare('UPDATE friends SET line_account_id = ?, updated_at = ? WHERE id = ?')
        .bind(lineAccountId, jstNow(), friend.id).run();
      console.log(`[follow] line_account_id set to ${lineAccountId} for friend ${friend.id}`);
    }

    // 友だち追加時に【状態】未診断タグを付与
    await addTagToFriend(db, friend.id, '87acf0ef-c218-4de3-bffe-66e53177d911').catch(() => {});

    // friend_add シナリオに登録（このアカウントのシナリオのみ）
    const scenarios = await getScenarios(db);
    for (const scenario of scenarios) {
      // Only trigger scenarios belonging to this account (or unassigned for backward compat)
      const scenarioAccountMatch = !scenario.line_account_id || !lineAccountId || scenario.line_account_id === lineAccountId;
      if (scenario.trigger_type === 'friend_add' && scenario.is_active && scenarioAccountMatch) {
        try {
          // INSERT OR IGNORE handles dedup via UNIQUE(friend_id, scenario_id)
          const friendScenario = await enrollFriendInScenario(db, friend.id, scenario.id);
          if (!friendScenario) continue; // already enrolled

            // Immediate delivery: bundle consecutive leading steps with delay=0 and no condition
            // into a single replyMessage (LINE allows up to 5 messages per reply)
            const steps = await getScenarioSteps(db, scenario.id);
            const leading = [];
            for (const s of steps) {
              if (leading.length >= 5) break;
              if (s.delay_minutes !== 0) break;
              if (s.condition_type) break;
              leading.push(s);
            }

            if (leading.length > 0 && friendScenario.status === 'active') {
              try {
                const messages = leading.map((step) => {
                  const expanded = expandVariables(step.message_content, friend as { id: string; display_name: string | null; user_id: string | null });
                  return buildMessage(step.message_type, expanded);
                });
                await lineClient.replyMessage(event.replyToken, messages);
                console.log(`Immediate delivery: sent ${leading.length} step(s) to ${userId}`);

                // Log outgoing messages (replyMessage = 無料)
                for (const step of leading) {
                  const logId = crypto.randomUUID();
                  await db
                    .prepare(
                      `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, delivery_type, created_at)
                       VALUES (?, ?, 'outgoing', ?, ?, NULL, ?, 'reply', ?)`,
                    )
                    .bind(logId, friend.id, step.message_type, step.message_content, step.id, jstNow())
                    .run();
                }

                // Advance or complete the friend_scenario
                const lastSent = leading[leading.length - 1];
                const nextStep = steps[leading.length] ?? null;
                if (nextStep) {
                  const nextDeliveryDate = new Date(Date.now() + 9 * 60 * 60_000);
                  nextDeliveryDate.setMinutes(nextDeliveryDate.getMinutes() + nextStep.delay_minutes);
                  // Enforce 9:00-21:00 JST delivery window
                  const h = nextDeliveryDate.getUTCHours();
                  if (h < 9 || h >= 21) {
                    if (h >= 21) nextDeliveryDate.setUTCDate(nextDeliveryDate.getUTCDate() + 1);
                    nextDeliveryDate.setUTCHours(9, 0, 0, 0);
                  }
                  await advanceFriendScenario(db, friendScenario.id, lastSent.step_order, nextDeliveryDate.toISOString().slice(0, -1) + '+09:00');
                } else {
                  await completeFriendScenario(db, friendScenario.id);
                }
              } catch (err) {
                console.error('Failed immediate delivery for scenario', scenario.id, err);
              }
            }
        } catch (err) {
          console.error('Failed to enroll friend in scenario', scenario.id, err);
        }
      }
    }

    // イベントバス発火: friend_add（replyToken は Step 0 で使用済みの可能性あり）
    await fireEvent(db, 'friend_add', { friendId: friend.id, eventData: { displayName: friend.display_name } }, lineAccessToken, lineAccountId);
    return;
  }

  if (event.type === 'unfollow') {
    const userId =
      event.source.type === 'user' ? event.source.userId : undefined;
    if (!userId) return;

    await updateFriendFollowStatus(db, userId, false);

    // ブロック/解除時にアクティブなシナリオを打ち切る（再追加で作り直される）
    const friend = await getFriendByLineUserId(db, userId);
    if (friend) {
      await db
        .prepare(`UPDATE friend_scenarios SET status = 'cancelled', next_delivery_at = NULL, updated_at = ? WHERE friend_id = ? AND status = 'active'`)
        .bind(jstNow(), friend.id)
        .run();
    }
    return;
  }

  // Postback events — triggered by Flex buttons with action.type: "postback"
  // Uses the same auto_replies matching but without displaying text in chat
  if (event.type === 'postback') {
    const userId = event.source.type === 'user' ? event.source.userId : undefined;
    if (!userId) return;

    const friend = await getFriendByLineUserId(db, userId);
    if (!friend) return;

    const postbackData = (event as unknown as { postback: { data: string } }).postback.data;

    // ─── 業種別デモのショールーム導線 ─────────────────────────────
    // 文面正本: 配信文面.md §業種別デモ入口文面
    //   demo_intro=<industry>: メインRMの業種ボタン押下時。店主向け説明書2バルーン+「デモを開始する」CTAのみ送る。
    //                          RM切替・業種タグ付与はしない。
    //   demo=<industry>: 説明書内「デモを開始する」CTA押下時、または main 戻り。
    //                    RM切替+業種タグ+お客さん向けあいさつ1バルーン。
    //   demo_action=<key>: 業種別RM内の各機能ボタン。
    if (postbackData.startsWith('demo_intro=')) {
      const key = postbackData.slice('demo_intro='.length) as Exclude<DemoIndustryKey, 'main'>;
      const intro = DEMO_INDUSTRY_INTROS[key];
      if (intro) {
        const messages = [
          buildMessage('text', intro.bubble1Text),
          buildMessage('flex', intro.bubble2Flex, 'デモの説明'),
        ];
        try {
          await lineClient.replyMessage(event.replyToken, messages);
        } catch (err) {
          console.error('demo_intro replyMessage failed, falling back to push', err);
          try {
            await lineClient.pushMessage(userId, messages);
          } catch (e2) {
            console.error('demo_intro pushMessage fallback failed', e2);
          }
        }
        return;
      }
    }

    if (postbackData.startsWith('demo=')) {
      const key = postbackData.slice('demo='.length) as DemoIndustryKey;
      const def = DEMO_INDUSTRIES[key];
      if (def) {
        if (def.richMenuId) {
          try {
            await lineClient.linkRichMenuToUser(userId, def.richMenuId);
          } catch (err) {
            console.error('linkRichMenuToUser failed', err);
          }
        }
        for (const tid of INDUSTRY_TAG_IDS) {
          await removeTagFromFriend(db, friend.id, tid).catch(() => {});
        }
        if (def.industryTagId) {
          await addTagToFriend(db, friend.id, def.industryTagId).catch(() => {});
        }
        await addTagToFriend(db, friend.id, def.actionTagId).catch(() => {});
        const messages: ReturnType<typeof buildMessage>[] = [];
        if (def.explain) messages.push(buildMessage('text', def.explain));
        if (def.greeting) messages.push(buildMessage('text', def.greeting));
        if (messages.length > 0) {
          try {
            await lineClient.replyMessage(event.replyToken, messages);
          } catch (err) {
            console.error('demo industry replyMessage failed, falling back to push', err);
            try {
              await lineClient.pushMessage(userId, messages);
            } catch (e2) {
              console.error('demo industry pushMessage fallback failed', e2);
            }
          }
        }
        return;
      }
    }

    if (postbackData.startsWith('demo_action=')) {
      const key = postbackData.slice('demo_action='.length);
      const def = DEMO_ACTIONS[key];
      if (def) {
        // 登録ガチャ1回制限: 演出を見せる前にチェック（ワクワクさせてシャットアウトを防ぐ）
        if (key === '飲食_登録ガチャ表示') {
          const gachaResultDef = DEMO_ACTIONS['飲食_ガチャ結果表示'];
          const gachaTagId = gachaResultDef?.actionTagId;
          if (gachaTagId) {
            const alreadyGacha = await db.prepare(
              'SELECT 1 FROM friend_tags WHERE friend_id = ? AND tag_id = ? LIMIT 1'
            ).bind(friend.id, gachaTagId).first();
            if (alreadyGacha) {
              const msg = buildMessage('text', 'ガチャの特典はすでにお受け取り済みです✨\n\n「本日のおすすめ」や「席を予約する」もぜひ試してみてください。');
              await lineClient.replyMessage(event.replyToken, [msg]).catch(async () => {
                await lineClient.pushMessage(userId, [msg]).catch(() => {});
              });
              return;
            }
          }
        }

        if (def.actionTagId) await addTagToFriend(db, friend.id, def.actionTagId).catch(() => {});
        if (def.switchRmToMain) {
          await lineClient.linkRichMenuToUser(userId, DEMO_RICH_MENU_IDS.main).catch((err) => {
            console.error('switchRmToMain failed', err);
          });
        }
        // 複数バルーン送信（3バルーン等）
        if (def.contentMultiple && def.contentMultiple.length > 0) {
          const messages = def.contentMultiple.map(c => buildMessage('text', c));
          try {
            await lineClient.replyMessage(event.replyToken, messages);
          } catch (err) {
            console.error('demo action (multiple) replyMessage failed, falling back to push', err);
            try {
              await lineClient.pushMessage(userId, messages);
            } catch (e2) {
              console.error('demo action (multiple) pushMessage fallback failed', e2);
            }
          }
          return;
        }

        let message: ReturnType<typeof buildMessage> | null = null;
        if ((def.kind === 'text' || def.kind === 'flex') && def.contentOptions && def.contentOptions.length > 0) {
          const picked = def.contentOptions[Math.floor(Math.random() * def.contentOptions.length)];
          message = buildMessage(def.kind, picked, def.altText);
        } else if ((def.kind === 'text' || def.kind === 'flex') && def.content) {
          message = buildMessage(def.kind, def.content, def.altText);
        } else if (def.kind === 'lookup' && def.lookupKeyword) {
          const row = await db
            .prepare(`SELECT response_type, response_content FROM auto_replies WHERE keyword = ? AND is_active = 1 LIMIT 1`)
            .bind(def.lookupKeyword)
            .first<{ response_type: string; response_content: string }>();
          if (row) {
            const expanded = expandVariables(row.response_content, friend as { id: string; display_name: string | null; user_id: string | null }, workerUrl, liffUrl);
            message = buildMessage(row.response_type, expanded);
          }
        } else if (def.kind === 'form' && def.formId && liffUrl) {
          const separator = liffUrl.includes('?') ? '&' : '?';
          const formUrl = `${liffUrl}${separator}page=form&id=${def.formId}`;
          const flex = {
            type: 'bubble',
            body: {
              type: 'box',
              layout: 'vertical',
              contents: [
                { type: 'text', text: def.altText ?? 'フォームを開く', wrap: true, size: 'md', weight: 'bold' },
                { type: 'text', text: '下のボタンから開いてください。', wrap: true, size: 'sm', color: '#555555', margin: 'md' },
              ],
            },
            footer: {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              contents: [
                {
                  type: 'button',
                  style: 'primary',
                  color: '#06C755',
                  action: { type: 'uri', label: 'フォームを開く', uri: formUrl },
                },
              ],
            },
          };
          message = buildMessage('flex', JSON.stringify(flex));
        }
        if (message) {
          try {
            await lineClient.replyMessage(event.replyToken, [message]);
          } catch (err) {
            console.error('demo action replyMessage failed, falling back to push', err);
            try {
              await lineClient.pushMessage(userId, [message]);
            } catch (e2) {
              console.error('demo action pushMessage fallback failed', e2);
            }
          }
        }
        return;
      }
    }

    // Match postback data against auto_replies (exact match on keyword)
    const autoReplyQuery = lineAccountId
      ? `SELECT * FROM auto_replies WHERE is_active = 1 AND (line_account_id IS NULL OR line_account_id = ?) ORDER BY created_at ASC`
      : `SELECT * FROM auto_replies WHERE is_active = 1 AND line_account_id IS NULL ORDER BY created_at ASC`;
    const autoReplyStmt = db.prepare(autoReplyQuery);
    const autoReplies = await (lineAccountId ? autoReplyStmt.bind(lineAccountId) : autoReplyStmt)
      .all<{
        id: string;
        keyword: string;
        match_type: 'exact' | 'contains';
        response_type: string;
        response_content: string;
      }>();

    for (const rule of autoReplies.results) {
      const isMatch = rule.match_type === 'exact'
        ? postbackData === rule.keyword
        : postbackData.includes(rule.keyword);

      if (isMatch) {
        try {
          const { resolveMetadata } = await import('../services/step-delivery.js');
          const resolvedMeta = await resolveMetadata(db, { user_id: (friend as unknown as Record<string, string | null>).user_id, metadata: (friend as unknown as Record<string, string | null>).metadata });
          const expandedContent = expandVariables(rule.response_content, { ...friend, metadata: resolvedMeta } as Parameters<typeof expandVariables>[1], workerUrl);
          const replyMsg = buildMessage(rule.response_type, expandedContent);
          await lineClient.replyMessage(event.replyToken, [replyMsg]);
        } catch (err) {
          console.error('Failed to send postback reply', err);
        }
        break;
      }
    }
    return;
  }

  if (event.type === 'message' && event.message.type === 'text') {
    const textMessage = event.message as TextEventMessage;
    const userId =
      event.source.type === 'user' ? event.source.userId : undefined;
    if (!userId) return;

    const friend = await getFriendByLineUserId(db, userId);
    if (!friend) return;

    const incomingText = textMessage.text;
    const now = jstNow();
    const logId = crypto.randomUUID();

    // 受信メッセージをログに記録
    await db
      .prepare(
        `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, created_at)
         VALUES (?, ?, 'incoming', 'text', ?, NULL, NULL, ?)`,
      )
      .bind(logId, friend.id, incomingText, now)
      .run();

    // チャットを作成/更新（ユーザーの自発的メッセージのみ unread にする）
    // ボタンタップ等の自動応答キーワードは除外
    const autoKeywords = ['料金', '機能', 'API', 'フォーム', 'ヘルプ', 'UUID', 'UUID連携について教えて', 'UUID連携を確認', '配信時間', '導入支援を希望します', 'アカウント連携を見る', '体験を完了する', 'BAN対策を見る', '連携確認'];
    const isAutoKeyword = autoKeywords.some(k => incomingText === k);
    const isTimeCommand = /(?:配信時間|配信|届けて|通知)[はを]?\s*\d{1,2}\s*時/.test(incomingText);
    if (!isAutoKeyword && !isTimeCommand) {
      await upsertChatOnMessage(db, friend.id);
    }

    // 配信時間設定: 「配信時間は○時」「○時に届けて」等のパターンを検出
    const timeMatch = incomingText.match(/(?:配信時間|配信|届けて|通知)[はを]?\s*(\d{1,2})\s*時/);
    if (timeMatch) {
      const hour = parseInt(timeMatch[1], 10);
      if (hour >= 6 && hour <= 22) {
        // Save preferred_hour to friend metadata
        const existing = await db.prepare('SELECT metadata FROM friends WHERE id = ?').bind(friend.id).first<{ metadata: string }>();
        const meta = JSON.parse(existing?.metadata || '{}');
        meta.preferred_hour = hour;
        await db.prepare('UPDATE friends SET metadata = ?, updated_at = ? WHERE id = ?')
          .bind(JSON.stringify(meta), jstNow(), friend.id).run();

        // Reply with confirmation
        try {
          const period = hour < 12 ? '午前' : '午後';
          const displayHour = hour <= 12 ? hour : hour - 12;
          await lineClient.replyMessage(event.replyToken, [
            buildMessage('flex', JSON.stringify({
              type: 'bubble',
              body: { type: 'box', layout: 'vertical', contents: [
                { type: 'text', text: '配信時間を設定しました', size: 'lg', weight: 'bold', color: '#1e293b' },
                { type: 'box', layout: 'vertical', contents: [
                  { type: 'text', text: `${period} ${displayHour}:00`, size: 'xxl', weight: 'bold', color: '#f59e0b', align: 'center' },
                  { type: 'text', text: `（${hour}:00〜）`, size: 'sm', color: '#64748b', align: 'center', margin: 'sm' },
                ], backgroundColor: '#fffbeb', cornerRadius: 'md', paddingAll: '20px', margin: 'lg' },
                { type: 'text', text: '今後のステップ配信はこの時間以降にお届けします。', size: 'xs', color: '#64748b', wrap: true, margin: 'lg' },
              ], paddingAll: '20px' },
            })),
          ]);
        } catch (err) {
          console.error('Failed to reply for time setting', err);
        }
        return;
      }
    }

    // Cross-account trigger: send message from another account via UUID
    if (incomingText === '体験を完了する' && lineAccountId) {
      try {
        const friendRecord = await db.prepare('SELECT user_id FROM friends WHERE id = ?').bind(friend.id).first<{ user_id: string | null }>();
        if (friendRecord?.user_id) {
          // Find the same user on other accounts
          const otherFriends = await db.prepare(
            'SELECT f.line_user_id, la.channel_access_token FROM friends f INNER JOIN line_accounts la ON la.id = f.line_account_id WHERE f.user_id = ? AND f.line_account_id != ? AND f.is_following = 1'
          ).bind(friendRecord.user_id, lineAccountId).all<{ line_user_id: string; channel_access_token: string }>();

          for (const other of otherFriends.results) {
            const otherClient = new LineClient(other.channel_access_token);
            const { buildMessage: bm } = await import('../services/step-delivery.js');
            await otherClient.pushMessage(other.line_user_id, [bm('flex', JSON.stringify({
              type: 'bubble', size: 'giga',
              header: { type: 'box', layout: 'vertical', paddingAll: '20px', backgroundColor: '#fffbeb',
                contents: [{ type: 'text', text: `${friend.display_name || ''}さんへ`, size: 'lg', weight: 'bold', color: '#1e293b' }],
              },
              body: { type: 'box', layout: 'vertical', paddingAll: '20px',
                contents: [
                  { type: 'text', text: '別アカウントからのアクションを検知しました。', size: 'sm', color: '#06C755', weight: 'bold', wrap: true },
                  { type: 'text', text: 'アカウント連携が正常に動作しています。体験ありがとうございました。', size: 'sm', color: '#1e293b', wrap: true, margin: 'md' },
                  { type: 'separator', margin: 'lg' },
                  { type: 'text', text: 'ステップ配信・フォーム即返信・アカウント連携・リッチメニュー・自動返信 — 全て無料、全てOSS。', size: 'xs', color: '#64748b', wrap: true, margin: 'lg' },
                ],
              },
              footer: { type: 'box', layout: 'vertical', paddingAll: '16px',
                contents: [
                  { type: 'button', action: { type: 'message', label: '導入について相談する', text: '導入支援を希望します' }, style: 'primary', color: '#06C755' },
                  ...(liffUrl ? [{ type: 'button', action: { type: 'uri', label: 'フィードバックを送る', uri: `${liffUrl}?page=form` }, style: 'secondary', margin: 'sm' }] : []),
                ],
              },
            }))]);
          }

          // Reply on Account ② confirming
          await lineClient.replyMessage(event.replyToken, [buildMessage('flex', JSON.stringify({
            type: 'bubble',
            body: { type: 'box', layout: 'vertical', paddingAll: '20px',
              contents: [
                { type: 'text', text: 'Account ① にメッセージを送りました', size: 'sm', color: '#06C755', weight: 'bold', align: 'center' },
                { type: 'text', text: 'Account ① のトーク画面を確認してください', size: 'xs', color: '#64748b', align: 'center', margin: 'md' },
              ],
            },
          }))]);
          return;
        }
      } catch (err) {
        console.error('Cross-account trigger error:', err);
      }
    }

    // 診断フロー: DIAG_N* / DIAG_N*_L* / DIAG_FIN_N*_L*_G* を受けたら
    // 該当タグを付与して次のカードを auto_reply で返す。
    // DIAG_FIN_* のみ結果カードを直接送ってリターンする。
    const DIAG_TAGS = {
      N: {
        '1': 'a33f7bf2-817d-4b5d-8634-5d93d4b12396', // 悩み:リピート強化
        '2': '4c5534dd-52ba-4341-9106-526e89cbb4a4', // 悩み:客単価向上
        '3': '4d19320b-9f8a-4163-9ac5-84b199a255f5', // 悩み:業務効率化
        '4': '46c1bfc4-7b42-40cc-afef-139ce276503e', // 悩み:休眠掘り起こし
      },
      L: {
        '1': 'b45233b3-5fc3-4391-bf80-b64b963b6efc', // LINE:未運用
        '2': '10e45f4e-acb9-405a-a19e-fae31d6597a1', // LINE:公式のみ未活用
        '3': 'e4bd1028-5e35-4564-becb-01097f3ab3f7', // LINE:手動配信中
        '4': 'e8997d6c-0ace-4580-92ad-476e064da721', // LINE:拡張ツール運用中
      },
      G: {
        '1': 'c6ab487b-f7a5-4640-9457-e2420658b3f1', // 業種:美容サロン
        '2': '1762a8d1-ba85-4941-b03e-178b15f09c47', // 業種:フィットネス
        '3': 'c7344832-126a-4f0d-8a39-1fc457b12b9a', // 業種:教育
        '4': '84b8f921-b78f-4fd5-a404-5510ced49115', // 業種:飲食
      },
    } as const;
    const TAG_UNDIAGNOSED = '87acf0ef-c218-4de3-bffe-66e53177d911';
    const TAG_DIAGNOSED = '247db502-3e68-4951-8d3a-a68a6e0a7180';
    const TAG_TEMP_CONSULT = 'e8cb3455-5da0-4036-bd94-cb2468e13130';
    const TAG_TEMP_CASE = 'c210d3a1-facc-4973-94b6-5ed4772a66bd';
    const TAG_CASE_GUIDED = '0df633bb-7247-4cb1-9d17-309e48111c7a';
    const TAG_CONSULT_GUIDED = '8ee745a8-a046-4e13-9ff2-1128311f014b';

    // 相談フォームに進む / ちょっと相談する: 温度感を保存してLIFFフォームへ直行。
    if (incomingText === '相談フォームに進む' || incomingText === 'ちょっと相談する') {
      await removeTagFromFriend(db, friend.id, TAG_TEMP_CASE).catch(() => {});
      await addTagToFriend(db, friend.id, TAG_TEMP_CONSULT).catch(() => {});
      await addTagToFriend(db, friend.id, TAG_CONSULT_GUIDED).catch(() => {});

      const FORM_ID = '032491b8-563f-4736-bf0d-e91b911c87ac';
      if (liffUrl) {
        const separator = liffUrl.includes('?') ? '&' : '?';
        const formUrl = `${liffUrl}${separator}page=form&id=${FORM_ID}`;
        const flexContent = {
          type: 'bubble',
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: 'ありがとうございます！', wrap: true, size: 'md', weight: 'bold' },
              { type: 'text', text: '下のボタンから相談フォームを開いてください。\n\n30秒で終わります。\n送信後、折り返しご連絡します。', wrap: true, size: 'sm', color: '#555555', margin: 'md' },
            ],
          },
          footer: {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            contents: [
              { type: 'button', style: 'primary', color: '#06C755', action: { type: 'uri', label: '相談フォームを開く', uri: formUrl } },
            ],
          },
        };
        try {
          await lineClient.replyMessage(event.replyToken, [buildMessage('flex', JSON.stringify(flexContent))]);
        } catch (err) {
          console.error('Failed to send form link:', err);
        }
      } else {
        console.error('LIFF_URL not configured; cannot send form link');
      }
      return;
    }

    if (incomingText === 'まず事例を見てみる') {
      await removeTagFromFriend(db, friend.id, TAG_TEMP_CONSULT).catch(() => {});
      await addTagToFriend(db, friend.id, TAG_TEMP_CASE).catch(() => {});
      await addTagToFriend(db, friend.id, TAG_CASE_GUIDED).catch(() => {});

      await lineClient.replyMessage(event.replyToken, [
        buildMessage('text', [
          'ありがとうございます！',
          '',
          '事例ページは現在リニューアル中です。',
          '',
          '準備ができたらお届けしますね。',
          '',
          'もし先に相談してみたくなったら、いつでも「ちょっと相談する」と送ってください。',
        ].join('\n')),
      ]);
      return;
    }

    const finMatch = incomingText.match(/^DIAG_FIN_N([1-4])_L([1-4])_G([1-4])$/);
    if (finMatch) {
      const [, n, l, g] = finMatch;
      try {
        await addTagToFriend(db, friend.id, DIAG_TAGS.N[n as '1']);
        await addTagToFriend(db, friend.id, DIAG_TAGS.L[l as '1']);
        await addTagToFriend(db, friend.id, DIAG_TAGS.G[g as '1']);
        await removeTagFromFriend(db, friend.id, TAG_UNDIAGNOSED);
        await addTagToFriend(db, friend.id, TAG_DIAGNOSED);

        const resultFlex = buildMiniDiagnosisReportFlex({
          need: n as '1' | '2' | '3' | '4',
          lineState: l as '1' | '2' | '3' | '4',
          industry: g as '1' | '2' | '3' | '4',
          displayName: friend.display_name,
        });
        await lineClient.replyMessage(event.replyToken, [
          buildMessage('flex', JSON.stringify(resultFlex), 'ミニ診断レポート'),
        ]);
      } catch (err) {
        console.error('Diagnostic FIN handler error:', err);
      }
      return;
    }

    const q2Match = incomingText.match(/^DIAG_N([1-4])_L([1-4])$/);
    if (q2Match) {
      const [, , l] = q2Match;
      try {
        await addTagToFriend(db, friend.id, DIAG_TAGS.L[l as '1']);
      } catch (err) {
        console.error('Diagnostic Q2 tag error:', err);
      }
      // fall through → auto_reply returns Q3 card
    } else {
      const q1Match = incomingText.match(/^DIAG_N([1-4])$/);
      if (q1Match) {
        const [, n] = q1Match;
        try {
          await addTagToFriend(db, friend.id, DIAG_TAGS.N[n as '1']);
        } catch (err) {
          console.error('Diagnostic Q1 tag error:', err);
        }
        // fall through → auto_reply returns Q2 card
      }
    }

    // 自動返信チェック（このアカウントのルール + グローバルルールのみ）
    // NOTE: Auto-replies use replyMessage (free, no quota) instead of pushMessage
    // The replyToken is only valid for ~1 minute after the message event
    const autoReplyQuery = lineAccountId
      ? `SELECT * FROM auto_replies WHERE is_active = 1 AND (line_account_id IS NULL OR line_account_id = ?) ORDER BY created_at ASC`
      : `SELECT * FROM auto_replies WHERE is_active = 1 AND line_account_id IS NULL ORDER BY created_at ASC`;
    const autoReplyStmt = db.prepare(autoReplyQuery);
    const autoReplies = await (lineAccountId ? autoReplyStmt.bind(lineAccountId) : autoReplyStmt)
      .all<{
        id: string;
        keyword: string;
        match_type: 'exact' | 'contains';
        response_type: string;
        response_content: string;
        is_active: number;
        created_at: string;
      }>();

    let matched = false;
    let replyTokenConsumed = false;
    for (const rule of autoReplies.results) {
      const isMatch =
        rule.match_type === 'exact'
          ? incomingText === rule.keyword
          : incomingText.includes(rule.keyword);

      if (isMatch) {
        try {
          // Expand template variables ({{name}}, {{uid}}, {{auth_url:CHANNEL_ID}})
          const { resolveMetadata: resolveMeta2 } = await import('../services/step-delivery.js');
          const resolvedMeta2 = await resolveMeta2(db, { user_id: (friend as unknown as Record<string, string | null>).user_id, metadata: (friend as unknown as Record<string, string | null>).metadata });
          const expandedContent = expandVariables(rule.response_content, { ...friend, metadata: resolvedMeta2 } as Parameters<typeof expandVariables>[1], workerUrl);
          const replyMsg = buildMessage(rule.response_type, expandedContent);
          await lineClient.replyMessage(event.replyToken, [replyMsg]);
          replyTokenConsumed = true;

          // 送信ログ（replyMessage = 無料）
          const outLogId = crypto.randomUUID();
          await db
            .prepare(
              `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, delivery_type, created_at)
               VALUES (?, ?, 'outgoing', ?, ?, NULL, NULL, 'reply', ?)`,
            )
            .bind(outLogId, friend.id, rule.response_type, rule.response_content, jstNow())
            .run();
        } catch (err) {
          console.error('Failed to send auto-reply', err);
          // replyToken may still be unused if replyMessage threw before LINE accepted it
        }

        matched = true;
        break;
      }
    }

    // イベントバス発火: message_received
    // Pass replyToken only when auto_reply didn't actually consume it
    await fireEvent(db, 'message_received', {
      friendId: friend.id,
      eventData: { text: incomingText, matched },
      replyToken: replyTokenConsumed ? undefined : event.replyToken,
    }, lineAccessToken, lineAccountId);

    return;
  }
}

export { webhook };
