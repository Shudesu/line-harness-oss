# 広告CV連携 実装仕様書

## 概要
LINE Harness に広告プラットフォームのオフラインCV送信機能を追加する。
ユーザーが広告クリック → LINE友だち追加 → LINE内でアクション（MCV） → 広告媒体にCV返送。
これにより広告のROAS計測がLINE内行動まで一気通貫で取れる。

## 対象リポジトリ
https://github.com/Shudesu/line-harness-oss

## 対応媒体
1. Meta (Facebook/Instagram広告) — Conversions API (CAPI)
2. X (旧Twitter広告) — Conversion API
3. Google Ads — Offline Conversion Import
4. TikTok — Events API

---

## 変更箇所一覧

### 1. DBスキーマ変更（packages/db）

#### 1-1. ref_tracking テーブルにクリックIDカラム追加

```sql
-- packages/db/schema.sql に追加
ALTER TABLE ref_tracking ADD COLUMN fbclid TEXT;
ALTER TABLE ref_tracking ADD COLUMN gclid TEXT;
ALTER TABLE ref_tracking ADD COLUMN twclid TEXT;
ALTER TABLE ref_tracking ADD COLUMN ttclid TEXT;
ALTER TABLE ref_tracking ADD COLUMN utm_source TEXT;
ALTER TABLE ref_tracking ADD COLUMN utm_medium TEXT;
ALTER TABLE ref_tracking ADD COLUMN utm_campaign TEXT;
ALTER TABLE ref_tracking ADD COLUMN user_agent TEXT;
ALTER TABLE ref_tracking ADD COLUMN ip_address TEXT;
```

#### 1-2. 新規テーブル: ad_platforms

```sql
CREATE TABLE ad_platforms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,               -- 'meta' | 'x' | 'google' | 'tiktok'
  display_name TEXT,                -- '管理画面表示名'
  config TEXT NOT NULL DEFAULT '{}', -- JSON: 媒体固有の認証情報
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- config JSON の中身（媒体ごと）:
-- Meta:   { "pixel_id": "xxx", "access_token": "xxx", "test_event_code": "TEST123" }
-- X:      { "pixel_id": "xxx", "api_key": "xxx", "api_secret": "xxx" }
-- Google: { "customer_id": "xxx", "conversion_action_id": "xxx", "oauth_token": "xxx" }
-- TikTok: { "pixel_code": "xxx", "access_token": "xxx" }
```

#### 1-3. 新規テーブル: ad_conversion_logs

```sql
CREATE TABLE ad_conversion_logs (
  id TEXT PRIMARY KEY,
  ad_platform_id TEXT NOT NULL,
  friend_id TEXT NOT NULL,
  conversion_point_id TEXT,
  event_name TEXT NOT NULL,
  click_id TEXT,                    -- fbclid/twclid/gclid/ttclid
  click_id_type TEXT,               -- 'fbclid' | 'twclid' | 'gclid' | 'ttclid'
  status TEXT DEFAULT 'pending',    -- 'pending' | 'sent' | 'failed'
  request_body TEXT,                -- 送信したJSONの記録
  response_body TEXT,               -- 媒体からのレスポンス
  error_message TEXT,
  created_at TEXT NOT NULL
);
```

---

### 2. ref_tracking クエリ関数の拡張（packages/db/src/entry-routes.ts）

```typescript
// CreateRefTrackingInput に追加
export interface CreateRefTrackingInput {
  refCode: string;
  friendId?: string | null;
  entryRouteId?: string | null;
  sourceUrl?: string | null;
  // ↓ 新規追加
  fbclid?: string | null;
  gclid?: string | null;
  twclid?: string | null;
  ttclid?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  userAgent?: string | null;
  ipAddress?: string | null;
}

// createRefTracking 関数を拡張して新カラムを保存

// 新規関数: friend_id からクリックID付き ref_tracking を取得
export async function getRefTrackingWithClickIds(
  db: D1Database,
  friendId: string,
): Promise<RefTracking | null> {
  return db
    .prepare(
      `SELECT * FROM ref_tracking
       WHERE friend_id = ?
       AND (fbclid IS NOT NULL OR gclid IS NOT NULL OR twclid IS NOT NULL OR ttclid IS NOT NULL)
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .bind(friendId)
    .first<RefTracking>();
}
```

---

### 3. ad_platforms クエリ関数（packages/db/src/ad-platforms.ts）新規ファイル

```typescript
import { jstNow } from './utils.js';

export interface AdPlatform {
  id: string;
  name: string;
  display_name: string | null;
  config: string; // JSON string
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface AdPlatformConfig {
  // Meta
  pixel_id?: string;
  access_token?: string;
  test_event_code?: string;
  // X
  api_key?: string;
  api_secret?: string;
  // Google
  customer_id?: string;
  conversion_action_id?: string;
  oauth_token?: string;
  // TikTok
  pixel_code?: string;
}

export async function getActiveAdPlatforms(db: D1Database): Promise<AdPlatform[]> {
  const result = await db
    .prepare(`SELECT * FROM ad_platforms WHERE is_active = 1`)
    .all<AdPlatform>();
  return result.results;
}

export async function getAdPlatformByName(
  db: D1Database,
  name: string,
): Promise<AdPlatform | null> {
  return db
    .prepare(`SELECT * FROM ad_platforms WHERE name = ? AND is_active = 1`)
    .bind(name)
    .first<AdPlatform>();
}

// CRUD: createAdPlatform, updateAdPlatform, deleteAdPlatform
// ... 標準的なCRUD（LINE Harness の他テーブルと同じパターン）
```

---

### 4. 広告CV送信サービス（apps/worker/src/services/ad-conversion.ts）新規ファイル

```typescript
import { getActiveAdPlatforms, AdPlatformConfig } from '@x-harness/db';
import { getRefTrackingWithClickIds } from '@x-harness/db';

// ===== メインのCV送信関数 =====

export async function sendAdConversions(
  db: D1Database,
  friendId: string,
  eventName: string,
  eventValue?: number,
): Promise<void> {
  // 1. friend の ref_tracking からクリックID取得
  const ref = await getRefTrackingWithClickIds(db, friendId);
  if (!ref) return; // クリックIDなし = 広告経由じゃない

  // 2. アクティブな広告プラットフォーム取得
  const platforms = await getActiveAdPlatforms(db);

  // 3. 各媒体にCV送信
  for (const platform of platforms) {
    const config: AdPlatformConfig = JSON.parse(platform.config);

    try {
      switch (platform.name) {
        case 'meta':
          if (ref.fbclid) {
            await sendMetaConversion(config, ref, eventName, eventValue);
            await logConversion(db, platform.id, friendId, eventName, ref.fbclid, 'fbclid', 'sent');
          }
          break;
        case 'x':
          if (ref.twclid) {
            await sendXConversion(config, ref, eventName, eventValue);
            await logConversion(db, platform.id, friendId, eventName, ref.twclid, 'twclid', 'sent');
          }
          break;
        case 'google':
          if (ref.gclid) {
            await sendGoogleConversion(config, ref, eventName, eventValue);
            await logConversion(db, platform.id, friendId, eventName, ref.gclid, 'gclid', 'sent');
          }
          break;
        case 'tiktok':
          if (ref.ttclid) {
            await sendTikTokConversion(config, ref, eventName, eventValue);
            await logConversion(db, platform.id, friendId, eventName, ref.ttclid, 'ttclid', 'sent');
          }
          break;
      }
    } catch (error) {
      await logConversion(db, platform.id, friendId, eventName,
        ref.fbclid || ref.twclid || ref.gclid || ref.ttclid || '',
        platform.name, 'failed', String(error));
    }
  }
}

// ===== Meta Conversions API (CAPI) =====

async function sendMetaConversion(
  config: AdPlatformConfig,
  ref: any,
  eventName: string,
  eventValue?: number,
): Promise<void> {
  const url = `https://graph.facebook.com/v21.0/${config.pixel_id}/events`;

  const eventData: any = {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    action_source: 'website',
    user_data: {
      fbc: `fb.1.${Date.now()}.${ref.fbclid}`,  // fbclid → fbc フォーマット
      client_ip_address: ref.ip_address || undefined,
      client_user_agent: ref.user_agent || undefined,
    },
  };

  // メールや電話があればハッシュ化して追加（マッチング精度向上）
  // user_data.em = SHA256(email)
  // user_data.ph = SHA256(phone)

  if (eventValue) {
    eventData.custom_data = {
      currency: 'JPY',
      value: eventValue,
    };
  }

  const body: any = {
    data: [eventData],
    access_token: config.access_token,
  };

  // テスト用イベントコード（開発時に使用、本番では削除）
  if (config.test_event_code) {
    body.test_event_code = config.test_event_code;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Meta CAPI error: ${response.status} ${errorBody}`);
  }
}

// ===== X Conversion API =====

async function sendXConversion(
  config: AdPlatformConfig,
  ref: any,
  eventName: string,
  eventValue?: number,
): Promise<void> {
  // X Conversion API v2
  // https://developer.x.com/en/docs/x-ads-api/measurement/web-conversions
  const url = 'https://ads-api.x.com/12/measurement/conversions';

  const body = {
    conversions: [{
      conversion_time: new Date().toISOString(),
      event_id: crypto.randomUUID(),
      identifiers: [{
        twclid: ref.twclid,
      }],
      conversion_id: config.pixel_id,
      event_name: eventName,
      ...(eventValue && { value: { currency: 'JPY', amount: String(eventValue) } }),
    }],
  };

  // OAuth 1.0a 署名が必要 — config.api_key + api_secret で署名
  // 実装注意: X Ads API は OAuth 1.0a を使う
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Authorization: OAuth 1.0a 署名ヘッダー
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`X Conversion API error: ${response.status} ${errorBody}`);
  }
}

// ===== Google Ads Offline Conversion =====

async function sendGoogleConversion(
  config: AdPlatformConfig,
  ref: any,
  eventName: string,
  eventValue?: number,
): Promise<void> {
  // Google Ads API - Upload Offline Conversions
  // https://developers.google.com/google-ads/api/docs/conversions/upload-clicks
  const url = `https://googleads.googleapis.com/v17/customers/${config.customer_id}:uploadClickConversions`;

  const body = {
    conversions: [{
      gclid: ref.gclid,
      conversion_action: `customers/${config.customer_id}/conversionActions/${config.conversion_action_id}`,
      conversion_date_time: new Date().toISOString().replace('Z', '+09:00'),
      ...(eventValue && { conversion_value: eventValue, currency_code: 'JPY' }),
    }],
    partial_failure: true,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.oauth_token}`,
      'developer-token': config.developer_token || '',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Google Ads API error: ${response.status} ${errorBody}`);
  }
}

// ===== TikTok Events API =====

async function sendTikTokConversion(
  config: AdPlatformConfig,
  ref: any,
  eventName: string,
  eventValue?: number,
): Promise<void> {
  // TikTok Events API
  // https://business-api.tiktok.com/portal/docs?id=1741601162187777
  const url = 'https://business-api.tiktok.com/open_api/v1.3/event/track/';

  const body = {
    pixel_code: config.pixel_code,
    event: eventName,
    event_id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    context: {
      user_agent: ref.user_agent || '',
      ip: ref.ip_address || '',
    },
    properties: {
      ...(ref.ttclid && { ttclid: ref.ttclid }),
      ...(eventValue && { currency: 'JPY', value: eventValue }),
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Access-Token': config.access_token || '',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`TikTok Events API error: ${response.status} ${errorBody}`);
  }
}

// ===== ログ記録 =====

async function logConversion(
  db: D1Database,
  platformId: string,
  friendId: string,
  eventName: string,
  clickId: string,
  clickIdType: string,
  status: 'sent' | 'failed',
  errorMessage?: string,
): Promise<void> {
  const id = crypto.randomUUID();
  const now = jstNow();

  await db
    .prepare(
      `INSERT INTO ad_conversion_logs
       (id, ad_platform_id, friend_id, event_name, click_id, click_id_type, status, error_message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, platformId, friendId, eventName, clickId, clickIdType, status, errorMessage || null, now)
    .run();
}
```

---

### 5. event-bus へのフック追加（apps/worker/src/services/event-bus.ts）

```typescript
// 既存の fireEvent 関数に1行追加するだけ

import { sendAdConversions } from './ad-conversion.js';

export async function fireEvent(
  db: D1Database,
  eventType: string,
  payload: EventPayload,
): Promise<void> {
  // 既存処理（変更なし）
  await fireOutgoingWebhooks(db, eventType, payload);
  await processScoring(db, payload.friendId, eventType);
  await processAutomations(db, eventType, payload);
  await processNotifications(db, eventType, payload);

  // ★ 新規追加: 広告CV送信
  if (payload.friendId && payload.conversionEventName) {
    await sendAdConversions(
      db,
      payload.friendId,
      payload.conversionEventName,
      payload.conversionValue,
    );
  }
}
```

---

### 6. auth/line ルートの改修（apps/worker/src/routes/liff.ts）

```typescript
// LINE Login / 友だち追加のリダイレクト処理で、クエリパラメータを保存

// 既存の処理に追加:
const fbclid = url.searchParams.get('fbclid');
const gclid = url.searchParams.get('gclid');
const twclid = url.searchParams.get('twclid');
const ttclid = url.searchParams.get('ttclid');
const utmSource = url.searchParams.get('utm_source');
const utmMedium = url.searchParams.get('utm_medium');
const utmCampaign = url.searchParams.get('utm_campaign');
const userAgent = c.req.header('User-Agent') || null;
const ipAddress = c.req.header('CF-Connecting-IP') || null;

await createRefTracking(db, {
  refCode: ref,
  friendId: friend.id,
  entryRouteId: entryRoute?.id,
  sourceUrl: url.toString(),
  // ↓ 新規
  fbclid,
  gclid,
  twclid,
  ttclid,
  utmSource,
  utmMedium,
  utmCampaign,
  userAgent,
  ipAddress,
});
```

---

### 7. API ルート追加（apps/worker/src/routes/ad-platforms.ts）新規ファイル

```typescript
import { Hono } from 'hono';

const app = new Hono();

// GET  /api/ad-platforms         — 一覧
// POST /api/ad-platforms         — 作成
// PUT  /api/ad-platforms/:id     — 更新
// DELETE /api/ad-platforms/:id   — 削除
// GET  /api/ad-platforms/:id/logs — CV送信ログ

// POST /api/ad-platforms/test    — テストCV送信
//   → test_event_code 付きで Meta CAPI にテスト送信
//   → 管理画面やAPIから接続テストに使う

export default app;
```

---

## データフロー全体図

```
[広告媒体]
  │
  │ ユーザーが広告クリック
  │ ?fbclid=abc123&ref=campaign_001
  ↓
[LINE Harness Worker]
  /auth/line?ref=campaign_001&fbclid=abc123
  │
  ├── ref_tracking に保存:
  │   { ref_code: "campaign_001", fbclid: "abc123", ip, ua }
  │
  ├── entry_routes 処理 → タグ付与 "ad_campaign_001"
  │
  └── LINE友だち追加 → friend 作成
        │
        │ ...数日後...
        │
        │ LINE内でボタンタップ / フォーム送信 / 購入
        ↓
  fireEvent(db, 'form_submission', {
    friendId: "xxx",
    conversionEventName: "Lead",     // ← Meta の標準イベント名
    conversionValue: 5000,           // ← 円
  })
        │
        ├── 既存処理: webhook, scoring, automation
        │
        └── ★新規: sendAdConversions()
              │
              ├── ref_tracking から fbclid="abc123" 取得
              │
              ├── Meta CAPI に送信:
              │   POST graph.facebook.com/{pixel_id}/events
              │   { event_name: "Lead", fbc: "fb.1.xxx.abc123" }
              │
              └── ad_conversion_logs に記録
                  { status: "sent", click_id: "abc123" }
```

---

## セットアップ手順（ユーザー向け）

### Meta (Facebook/Instagram) 広告連携

1. Meta Events Manager で Pixel を作成
2. System User を作成し、Access Token を取得
3. LINE Harness API で広告プラットフォーム登録:
```bash
curl -X POST https://your-worker.example/api/ad-platforms \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "meta",
    "displayName": "Meta広告",
    "config": {
      "pixel_id": "YOUR_PIXEL_ID",
      "access_token": "YOUR_ACCESS_TOKEN",
      "test_event_code": "TEST12345"
    }
  }'
```
4. テスト送信:
```bash
curl -X POST https://your-worker.example/api/ad-platforms/test \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{ "platform": "meta", "eventName": "Lead" }'
```
5. Meta Events Manager でテストイベント確認
6. 確認OK → test_event_code を削除して本番運用

### X (旧Twitter) 広告連携

1. X Ads Manager で Conversion Pixel 作成
2. X Developer Portal で Ads API アクセス申請
3. LINE Harness API で登録:
```bash
curl -X POST https://your-worker.example/api/ad-platforms \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "name": "x",
    "config": {
      "pixel_id": "YOUR_PIXEL_ID",
      "api_key": "YOUR_API_KEY",
      "api_secret": "YOUR_API_SECRET"
    }
  }'
```

### Google Ads 連携

1. Google Ads でオフラインコンバージョンアクションを作成
2. Google Ads API の OAuth 認証設定
3. LINE Harness API で登録（同様）

### TikTok 広告連携

1. TikTok Business Center で Pixel 作成
2. Events API の Access Token 取得
3. LINE Harness API で登録（同様）

---

## 標準イベント名マッピング

LINE Harness 内のイベントを各媒体の標準イベント名にマッピング:

| LINE Harness イベント | Meta | X | Google | TikTok |
|---|---|---|---|---|
| friend_add | Lead | SIGN_UP | Conversion | Registration |
| form_submission | SubmitApplication | LEAD | Conversion | SubmitForm |
| purchase | Purchase | PURCHASE | Conversion | PlaceAnOrder |
| richmenu_tap | ViewContent | CONTENT_VIEW | - | ViewContent |
| scenario_complete | CompleteRegistration | COMPLETE_REGISTRATION | Conversion | CompleteRegistration |
| button_tap | AddToCart | ADD_TO_CART | - | AddToCart |

---

## 注意事項

1. **Meta CAPI は HTTPS 必須** — CF Workers はデフォルトHTTPSなので問題なし
2. **fbclid の有効期限** — 7日間。それ以降のCVはマッチ精度が落ちる
3. **gclid の有効期限** — 90日間
4. **IP/User-Agent** — Meta CAPI のマッチング精度向上に重要。必ず保存する
5. **個人情報のハッシュ化** — email/phone をMeta に送る場合はSHA256ハッシュ必須
6. **レート制限** — Meta CAPI: 制限なし（バッチ推奨）、Google: 2000件/日
7. **テスト** — 必ず test_event_code で動作確認してから本番化
