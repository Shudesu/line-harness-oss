# 25. スタッフ管理 (Staff Management)

LINE Harness のスタッフ管理機能。APIキーごとにロール（owner / admin / staff）を割り当て、操作権限を制御する。

---

## 概要

従来の単一APIキー認証を拡張し、複数のスタッフが個別のAPIキーでログイン・操作できる。

- **owner** — 全権限。スタッフ管理・LINE アカウント設定を含む
- **admin** — 運用全般。スタッフ管理以外の全機能
- **staff** — 日常CRM操作。設定変更・緊急操作は不可

---

## 権限マトリクス

| 操作 | owner | admin | staff |
|------|:-----:|:-----:|:-----:|
| 友だち閲覧・検索 | o | o | o |
| メッセージ送信 | o | o | o |
| タグ管理 | o | o | o |
| シナリオ操作 | o | o | o |
| ブロードキャスト | o | o | o |
| フォーム・リッチメニュー | o | o | o |
| テンプレート管理 | o | o | o |
| スコアリング | o | o | o |
| **スタッフ管理** | o | x | x |
| **APIキー発行・削除** | o | x | x |
| **LINEアカウント設定** | o | x | x |
| **アカウント設定** | o | o | x |
| **緊急コントロール** | o | o | x |

---

## 認証フロー

```
リクエスト (Authorization: Bearer <key>)
  → staff_members テーブルで api_key を検索
    → 見つかった: ロールをリクエストコンテキストに設定
    → 見つからない: 環境変数 API_KEY と比較
      → 一致: owner として扱う
      → 不一致: 401 Unauthorized
  → ルートハンドラーでロールチェック
    → 許可: 処理続行
    → 拒否: 403 "この操作にはowner権限が必要です"
```

### 後方互換性

- 環境変数 `API_KEY` は常に owner として機能（従来通り）
- `staff_members` テーブルが空でも、既存の API_KEY で全機能が使える

---

## API エンドポイント

### `GET /api/staff/me`
現在のユーザー情報を取得。全ロールで利用可能。

```json
{ "success": true, "data": { "id": "xxx", "name": "田中太郎", "role": "staff", "email": null } }
```

### `GET /api/staff` (owner only)
スタッフ一覧。APIキーはマスク表示（末尾4文字のみ）。

### `POST /api/staff` (owner only)
スタッフ作成。APIキーは作成時のみフル表示。

```json
// Request
{
  "name": "田中太郎",
  "email": "tanaka@example.com",
  "role": "staff",
  "senderName": "田中 太郎",
  "senderIconUrl": "https://example.com/tanaka.png"
}

// Response
{ "success": true, "data": { "id": "xxx", "name": "田中太郎", "role": "staff", "apiKey": "lh_a1b2c3d4..." } }
```

### `PATCH /api/staff/:id` (owner only)
名前・メール・ロール・有効/無効・送信者プロフィールを更新。

## 送信者プロフィール（チャット返信のアイコン・表示名）

`senderName` / `senderIconUrl` を設定すると、**そのスタッフがチャット画面から返信したメッセージが、本人のアイコンと表示名で相手に届く**。自動返信ではなく担当者から直接届いたように見えるため、1:1のやりとりで反応率が上がる。

未設定のスタッフはこれまでどおりアカウント名義で送信される（後方互換）。

| 項目 | 制約 |
|---|---|
| `senderName` | 20文字以内。`LINE` を含む名前は使用不可（なりすまし防止のためLINE側が拒否する） |
| `senderIconUrl` | 2000文字以内の **https** URL。JPEG または PNG |

不正な値は `POST` / `PATCH` の時点で 400 を返すので、返信時に不可解な失敗が起きることはない。

**仕様上の注意**

- 表示名の後ろに **`from 'アカウント名'` がLINEによって自動付加される**。消せないので、他社を装う用途には使えない。
- **トークルーム上部のアカウント名は変わらない**。変わるのは吹き出し横のアイコンと名前だけ。
- 効くのは Messaging API 経由の送信のみ。**LINE公式アカウントマネージャー側のあいさつメッセージ・応答メッセージには適用されない**。

参考: [アイコンと表示名をカスタマイズする | LINE Developers](https://developers.line.biz/ja/docs/messaging-api/icon-nickname-switch/)

### `DELETE /api/staff/:id` (owner only)
スタッフ削除。自分自身の削除、最後のアクティブownerの削除は不可。

### `POST /api/staff/:id/regenerate-key` (owner only)
APIキー再発行。旧キーは即時無効化。

---

## MCP で操作

```
> スタッフ「田中」をadminロールで追加して

→ manage_staff ツール: action=create, name="田中", role="admin"
→ APIキーが生成され表示

> スタッフ一覧を見せて

→ manage_staff ツール: action=list

> 田中のロールをstaffに変更して

→ manage_staff ツール: action=update, staffId="xxx", role="staff"
```

---

## SDK で操作

```typescript
import { LineHarness } from '@line-harness/sdk'

const lh = new LineHarness({ apiUrl: '...', apiKey: '...' })

// スタッフ作成
const member = await lh.staff.create({ name: '田中太郎', role: 'staff' })
console.log(member.apiKey) // lh_xxxx... (一度だけ表示)

// 一覧
const members = await lh.staff.list()

// 自分の情報
const me = await lh.staff.me()

// ロール変更
await lh.staff.update(member.id, { role: 'admin' })

// APIキー再発行
const { apiKey } = await lh.staff.regenerateKey(member.id)

// 削除
await lh.staff.delete(member.id)
```

---

## 管理画面

サイドバーの「設定」→「スタッフ管理」から操作可能（owner のみ表示）。

- スタッフ追加フォーム（名前・メール・ロール選択・送信者プロフィール）
- APIキーのワンタイム表示 + コピーボタン
- 一覧テーブル（ロールバッジ・有効/無効トグル・キー再生成・削除）
- サイドバーにログイン中のスタッフ名とロールバッジを表示

---

## DB スキーマ

```sql
CREATE TABLE staff_members (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  email           TEXT,
  role            TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'staff')),
  api_key         TEXT UNIQUE NOT NULL,
  is_active       INTEGER NOT NULL DEFAULT 1,
  sender_name     TEXT,  -- チャット返信時の表示名（NULL = アカウント名義）
  sender_icon_url TEXT,  -- チャット返信時のアイコン（NULL = アカウント名義）
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
```

マイグレーション: `packages/db/migrations/011_staff_members.sql`
