# 実装記録: soushin-suggest向けマルチプロダクトBot

`CURSOR-TASK-multi-product-bot.md`（henshin-hisho向けに書かれた設計）と同じパターンを、
`soushin-suggest`（Windows常駐ツール、¥980買い切り、soushin-suggest.link）向けに適用して実装した。

設計判断・地雷はすべて`CURSOR-TASK-multi-product-bot.md`を踏襲。henshin-hisho固有の言及箇所は
soushin-suggestの製品内容に置き換えている。

## 変更ファイル一覧

- `packages/db/migrations/054_multi_product_bot.sql`（新規） — `entry_routes`/`kb_articles`/`llm_response_cache`に`project`列追加
- `bot.config.json` — `project`単一形式 → `defaultProject` + `projects`マップ形式へ移行（ai-shainの値は無変更）
- `bot.config.schema.json` — 新旧両形式をoneOfで許容
- `apps/worker/src/services/groq-config.ts` — `getBotConfig()`を後方互換ローダーに。`getDefaultProject()`/`isKnownProject()`を追加
- `apps/worker/src/services/bot-project.ts`（新規） — `resolveBotProject()`。ref_code→entry_routes.projectの解決、fail-closedでdefaultProjectへ
- `apps/worker/src/services/knowledge-packs.ts`（新規） — pack registry。project ID→バンドル済みコンテンツを返す
- `apps/worker/src/services/soushin-suggest-knowledge-content.ts`（新規） — soushin-suggest向けpersona/guardrails/canned定数
- `apps/worker/src/services/groq-pipeline.ts` — `GroqPipelineParams`に`project`追加。`getKnowledgePack(project)`経由に差し替え
- `apps/worker/src/services/llm-cache.ts` — `lookupCachedAnswer`/`saveCachedAnswer`に`project`パラメータ追加、SQLを`COALESCE(project, defaultProject) = ?`で絞り込み
- `apps/worker/src/services/kb-search.ts` — `searchKbArticles`（FTS/LIKE両方）に`project`パラメータ追加、同様のCOALESCE絞り込み
- `apps/worker/src/routes/webhook.ts` — Groq呼び出し直前で`resolveBotProject(db, friend)`を呼び、`project`をパイプラインへ渡す（1箇所のみ変更）
- `apps/worker/src/routes/entry-routes.ts` — serialize/POST/PATCHに`project`フィールド追加
- `packages/db/src/entry-routes.ts` — `EntryRoute`/`CreateEntryRouteInput`に`project`追加、INSERT/UPDATE文を対応
- `packages/db/src/friends.ts` — `Friend`型に`ref_code`フィールドを追加（既存DBカラムだが型定義に欠けていたため）
- `apps/worker/src/routes/webhook.test.ts` — `Friend`モックに`ref_code: null`を追加（型エラー修正）
- `scripts/seed-kb-articles.ts` — `--pack`/`--project`引数化（無引数時はai-shain相当で後方互換）。決定的ID（`hash(project+title)`）でINSERT OR REPLACEを真に冪等化
- `knowledge-packs/soushin-suggest/`（新規） — `persona.md` / `guardrails.md` / `docs/`（product-overview, installation-and-warnings, troubleshooting, pricing-and-purchase） / `canned/`（greeting, usage-overview, escalation）

## テスト結果

```
pnpm --dir apps/worker typecheck   # exit 0
pnpm --dir apps/worker test        # 64 files, 687 tests passed
```

既存のai-shain向けテストは無修正で全緑（後方互換確認済み）。soushin-suggest固有のパイプライン単体テストは未追加（次のタスク）。

## 未実施（別途対応が必要）

1. **マイグレーション054の本番/開発D1への適用**（`wrangler d1 execute` の実行はデプロイ操作のため、この場では実施していない）
2. **soushin-suggest用entry_routesの発行**（`POST /api/entry-routes`で以下を作成する想定）

   | ref_code | name | project | 用途 |
   |---|---|---|---|
   | `ss-lp` | soushin-suggest LP | `soushin-suggest` | LPフッターのLINE友だち追加リンクから |

   友だち追加URLは既存ai-shain経路と同形式（`/auth/line?ref=ss-lp&...` → callbackで`friends.ref_code`記録 → `line.me/R/ti/p/{basicId}`へ）。実URLの組み立ては管理UIの表示に合わせる。

3. **kb_articlesのseed実行**: `npx tsx scripts/seed-kb-articles.ts --pack knowledge-packs/soushin-suggest --project soushin-suggest | wrangler d1 execute <DB_NAME> --remote --file -` 相当のコマンドで投入
4. **soushin-suggest.link側のLP変更**: フッターの「公式LINEで質問する」リンクを`ref=ss-lp`付きに変更（下記参照）
