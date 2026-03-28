# 24. MCP Server

LINE Harness MCP Server は [Model Context Protocol](https://modelcontextprotocol.io/) に準拠したサーバー。Claude Code や他の MCP クライアントから LINE 公式アカウントを自然言語で操作できる。

---

## セットアップ

### npx (推奨)

```json
// .mcp.json
{
  "mcpServers": {
    "line-harness": {
      "command": "npx",
      "args": ["-y", "@line-harness/mcp-server@latest"],
      "env": {
        "LINE_HARNESS_API_URL": "https://your-worker.workers.dev",
        "LINE_HARNESS_API_KEY": "your-api-key"
      }
    }
  }
}
```

### ローカルビルド

```bash
cd packages/mcp-server
pnpm install
pnpm build

# 実行
LINE_HARNESS_API_URL=https://your-worker.workers.dev \
LINE_HARNESS_API_KEY=your-api-key \
node dist/index.js
```

---

## ツール一覧 (17個)

### 読み取り系

| ツール | 説明 | パラメータ |
|--------|------|-----------|
| `account_summary` | アカウント概要 | `accountId?` |
| `list_friends` | 友だち一覧 | `limit?`, `offset?`, `tagId?` |
| `get_friend_detail` | 友だち詳細 | `friendId` |
| `get_form_submissions` | フォーム回答 | `formId` |
| `get_link_clicks` | リンククリック分析 | `linkId` |
| `list_crm_objects` | CRMオブジェクト一覧 | `objectType` (scenarios/forms/tags/rich_menus/tracked_links/broadcasts) |

### 書き込み系

| ツール | 説明 | パラメータ |
|--------|------|-----------|
| `send_message` | 個別メッセージ送信 | `friendId`, `content`, `messageType?` |
| `broadcast` | 一斉配信 | `title`, `content`, `targetType?`, `targetTagId?` |
| `create_scenario` | シナリオ作成 | `name`, `triggerType`, `steps[]` |
| `enroll_in_scenario` | シナリオ登録 | `friendId`, `scenarioId` |
| `manage_tags` | タグ管理 | `action` (create/delete/add/remove), `name?`, `friendId?`, `tagId?` |
| `manage_staff` | スタッフ管理 | `action` (create/list/get/update/delete/regenerate_key/me), `name?`, `role?`, `staffId?` |
| `create_form` | フォーム作成 | `name`, `fields[]` |
| `create_rich_menu` | リッチメニュー作成 | `name`, `areas[]`, `chatBarText?` |
| `create_tracked_link` | トラッキングリンク作成 | `name`, `originalUrl`, `tagId?`, `scenarioId?` |

### Resources (MCP Resources)

| URI | 説明 |
|-----|------|
| `line-harness://friends` | 友だち一覧 (最新20件) |
| `line-harness://scenarios` | シナリオ一覧 |
| `line-harness://tags` | タグ一覧 |

---

## URL自動追跡

v0.4.0 より、`send_message` と `broadcast` で送信するメッセージ中の URL は自動的にトラッキングリンクに変換される。

### 動作

1. メッセージ中の URL を検出
2. トラッキングリンクを自動生成
3. テキストメッセージは Flex メッセージ（ボタン付き）に自動変換
4. LINE アプリ内クリック → LIFF 経由でユーザー特定
5. PC ブラウザクリック → 直接リダイレクト（クリック数のみ記録）

### スキップされる URL

- 既存のトラッキングリンク (`/t/{uuid}`)
- LIFF URL (`liff.line.me`)
- LINE ディープリンク (`line.me/R/`)
- Worker 内部 URL

---

## 使用例

### Claude Code での操作例

```
> 友だち数を教えて

→ account_summary ツールが呼ばれ、友だち数・タグ・シナリオの概要を表示

> VIPタグのついた友だちに「キャンペーン開始！ https://example.com 」と配信して

→ broadcast ツールが呼ばれ、VIPタグで絞り込み配信
→ URL は自動的にトラッキングリンク + Flex ボタンに変換

> さっきの配信のクリック数を見せて

→ get_link_clicks ツールで誰がクリックしたか確認
```

---

## アーキテクチャ

```
Claude Code / MCP Client
    ↓ (stdio)
MCP Server (@line-harness/mcp-server)
    ↓ (HTTP)
@line-harness/sdk
    ↓ (HTTP + API Key)
CF Workers API
    ↓
D1 Database + LINE Messaging API
```

MCP Server は SDK のラッパー。SDK の全機能を MCP ツールとして公開している。

---

## 開発

```bash
cd packages/mcp-server

# ビルド
pnpm build

# ウォッチモード
pnpm dev

# 依存パッケージ
# - @line-harness/sdk (workspace)
# - @modelcontextprotocol/sdk
# - zod
```
