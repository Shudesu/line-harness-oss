# L Harness — AI エージェント向けガイド

このリポジトリは **API ファースト** の LINE 公式アカウント CRM（L Harness）です。変更は REST API または MCP ツール経由で行い、管理画面は主に状態の確認用です。

## 推奨接続（Cursor）

1. MCP: `.cursor/mcp.json` に `@line-harness/mcp-server` を登録（`create-line-harness` のセットアップで自動生成可）
2. 環境変数: `LINE_HARNESS_API_URL`, `LINE_HARNESS_API_KEY`, （単一アカウント時は）`LINE_HARNESS_ACCOUNT_ID`
3. 詳細: `docs/wiki/29-Cursor-Integration.md`, `docs/wiki/24-MCP-Server.md`

## その他のエージェント

- **Claude Code**: プロジェクトルートの `.mcp.json`（同じ MCP サーバー）
- **Codex CLI / 汎用 MCP クライアント**: `.mcp.json` 形式が使えるツールで同等の設定

## セキュリティ

- API キーやシークレットを `AGENTS.md` / ルールファイル / コミットに含めない
- `.mcp.json` と `.cursor/mcp.json` は gitignore 対象（ローカルのみ）
