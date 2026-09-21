# 29. Cursor 連携ガイド

L Harness は **MCP（Model Context Protocol）** で AI エージェントと接続します。Claude Code に限らず、**Cursor** でも同じ `@line-harness/mcp-server` を使って LINE 公式アカウントを操作できます。

## セットアップ（新規インストール）

`npx create-line-harness` の Step 14 で MCP 設定を追加する際、**Cursor** を選択すると次が生成されます。

| ファイル | 用途 |
|----------|------|
| `.cursor/mcp.json` | Cursor の MCP サーバー定義 |
| `.cursor/rules/l-harness.mdc` | Agent 向けの基本ルール（API ファースト・シークレット禁止など） |

Claude Code を使う場合は従来どおり `.mcp.json` を選択してください。両方使う場合はマルチ選択できます。

## 手動設定（既存プロジェクト）

`.cursor/mcp.json` の例:

```json
{
  "mcpServers": {
    "line-harness": {
      "command": "npx",
      "args": ["-y", "@line-harness/mcp-server@latest"],
      "env": {
        "LINE_HARNESS_API_URL": "https://your-worker.example.workers.dev",
        "LINE_HARNESS_API_KEY": "your-api-key",
        "LINE_HARNESS_ACCOUNT_ID": "optional-single-account-uuid"
      }
    }
  }
}
```

設定後、Cursor を再起動するか MCP 一覧をリロードしてください。

## 管理画面でのエージェント切替

管理画面サイドバーの **「使用する AI エージェント」** で、プロンプトテンプレート（画面右下の依頼ボタン）の表示名を切り替えられます。選択はブラウザの `localStorage` に保存され、MCP 接続そのものは各ツールの設定ファイル側で行います。

## 操作例（Cursor Agent）

- 「今週の一斉配信予定を一覧して」
- 「タグ VIP の友だちにリマインドシナリオを登録して」
- 「このウェビナー用に seminar.mp4 をアップロードして」（`manage_webinar_video`）

ツール一覧は [24-MCP-Server.md](24-MCP-Server.md) を参照してください。

## Claude Code との違い

| 項目 | Claude Code | Cursor |
|------|-------------|--------|
| MCP 設定ファイル | `.mcp.json` | `.cursor/mcp.json` |
| プロジェクトルール | `CLAUDE.md` 等 | `.cursor/rules/*.mdc` |
| L Harness API / MCP ツール | 同一 | 同一 |

本体の REST API と MCP ツールは共通です。どちらのエージェントでも同じ操作が可能です。
