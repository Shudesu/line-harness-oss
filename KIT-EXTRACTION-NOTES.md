# KIT Extraction Notes — Groq LINE Bot (ai-shain.link)

実装中の「共通コード / プロジェクト固有」の判断メモ。将来 kit 化するときの抽出マニフェスト。

| 資産 | 分類 | メモ |
|------|------|------|
| `bot.config.json` | プロジェクト固有 | モデル名・dailyCallBudget・knowledgePack パス |
| `bot.config.schema.json` | 共通 | 他プロジェクトでも再利用可 |
| `knowledge-packs/ai-shain/**` | プロジェクト固有 | persona/guardrails/docs/canned は ai-shain.link 専用 |
| `apps/worker/src/services/groq-config.ts` | 共通 | bot.config.json を読むだけ |
| `apps/worker/src/services/groq-reply.ts` | 共通 | Groq API クライアント |
| `apps/worker/src/services/llm-cache.ts` | 共通 | canonical 質問キャッシュ |
| `apps/worker/src/services/kb-search.ts` | 共通 | FTS5 + LIKE フォールバック |
| `apps/worker/src/services/groq-pipeline.ts` | 共通 | Tier オーケストレーション |
| `apps/worker/src/services/groq-knowledge-content.ts` | プロジェクト固有 | Workers バンドル用。knowledge-packs と同期 |
| `apps/worker/src/services/llm-reply.ts` | 共通（既存） | Claude 版。変更なし |
| `packages/db/migrations/051-053_*.sql` | 共通 | キャッシュ・KB・使用量テーブル |
| `scripts/seed-kb-articles.ts` | 共通 | knowledgePack パスを引数化すれば転用可 |
| `account_settings.groq_reply_enabled` | 共通 | per-account opt-in |
| fail-closed → Inbox（Claude 呼ばない） | プロジェクト方針 | コスト優先。他案件では設定で切替可能に |

## 進捗（2026-07-14）

- タスク1〜8 実装完了
- マイグレーション: 051_llm_response_cache, 052_kb_articles_fts, 053_groq_usage_daily
- ユーザー作業: `wrangler secret put GROQ_API_KEY`、LINE Manager「AIチャットボット(β)」オフ
