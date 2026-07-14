# Cursor実装依頼: LINE公式アカウント向け Groq無料枠 自由文AIサポートBot

このファイルをCursorに渡して、この内容に従って実装を進めてください。設計・調査は完了済みで、これは実装計画そのものです。不明点があれば、まず本ファイル末尾の「デフォルト判断」に従って進めてよい（都度質問で止まらない）。

対象リポジトリ: このリポジトリ（`line-harness-oss`）
関連プロジェクト: `ai-shain.link`（LP。このBotは`ai-shain.link`の購入後導入サポート用）

---

## 背景・目的

`ai-shain.link`のLINE公式アカウントで、購入後の導入サポートを自由文AIチャットボットとして提供する。既存の`auto_replies`（キーワード完全一致/部分一致）に加えて、自由文の質問に答え、エラーメッセージから原因を診断し、必要なら人間へエスカレーションする機能を追加する。

**コスト制約が最優先**: 開発者に資金的余裕がなく、有料のClaude APIではなく無料枠のGroq API（`llama-3.3-70b-versatile`）を使う。

## 調査で判明した重要事実（この前提で作業すること）

このリポジトリには**既に自由文LLM応答機能（Claude API版）が実装済み**。ゼロから作るのではなく、これに並行する形でGroq版を追加する。

- `apps/worker/src/services/llm-reply.ts`: 既存のClaude連携。`generateLlmReply()`が直近20件の会話履歴を持ってAnthropic Messages APIを呼ぶ。**このファイルは変更しない**（テンプレートとして参照するのみ）
- `friends.ai_reply_mode`（`bot`/`human`）フラグと`switchToHumanMode()`: 既に実装済み。LLM応答に`[ESCALATE]`マーカーが含まれると自動でhumanモードに切り替わる。**そのまま使う**
- `chats`テーブル・`apps/worker/src/routes/chats.ts`・`unanswered-inbox.ts`: Conversation Inbox（人間へのエスカレーション先）が実装済み。**そのまま使う**
- Groq連携・D1 FTS5（RAG検索）・回答キャッシュ: **未実装。これが今回の新規開発対象**

### 現在のWebhookフロー（`apps/worker/src/routes/webhook.ts`）

```
POST /webhook (L77-178)
  → 署名検証 → JSON parse → handleEvent() を waitUntil で非同期実行

handleEvent() (L180-735)
  message.type === 'text' の場合 (L529-734):
    1. messages_log に受信ログ記録
    2. auto_replies を SELECT (L606-620)、exact/contains でマッチ判定 (L622-670)
    3. 未マッチ時、friend.ai_reply_mode !== 'human' なら generateLlmReply() を呼ぶ (L677-717)
    4. LLM応答が [ESCALATE] を含む → switchToHumanMode() → ai_reply_mode='human'
    5. 未マッチ&未LLM対応 → upsertChatOnMessage(db, friend.id) で Conversation Inbox の unread へ
```

---

## 実装タスク（この順に進める）

### タスク1: Groq APIクライアント新規作成
- ファイル: `apps/worker/src/services/groq-reply.ts`（`llm-reply.ts`と並列に新設、既存ファイルは変更しない）
- 内容: Groq API（`llama-3.3-70b-versatile`）へのリクエスト・タイムアウト（10秒）・429ハンドリング・**fail-closed分岐**（レート制限・タイムアウト・エラー時は例外を投げず、エスカレーション扱いのレスポンスを返す。Botが黙る/エラーを晒すことは絶対に避ける）
- 応答に`[ESCALATE]`マーカーの仕組みは`llm-reply.ts`と同様の方式を踏襲し、`switchToHumanMode()`にそのまま接続できるようにする
- 出力トークン上限: 500トークン程度に制限（システムプロンプトで指定）
- Env型定義に`GROQ_API_KEY?: string`を追加（`apps/worker/src/index.ts` L117付近、既存の`ANTHROPIC_API_KEY?: string`に倣う）
- `wrangler secret put GROQ_API_KEY`で投入する運用。`.env.example`にも`GROQ_API_KEY=gsk_...`のパターンを追記

### タスク2: 回答キャッシュテーブル（コスト節約用）
- 新規マイグレーション: `packages/db/migrations/047_llm_response_cache.sql`（既存の`046_ai_reply_mode.sql`の次番号。実際の最新番号を確認してから採番すること）
- テーブル: `llm_response_cache(id, question_hash, question_normalized, answer, line_account_id, created_at, expires_at)`
- 運用ルール: **canonical質問のみキャッシュ、TTL 72時間、個人情報を含む会話はキャッシュしない**（エラー診断など個別文脈のある会話は対象外）

### タスク3: RAG検索（D1 FTS5）
- 新規マイグレーション: `packages/db/migrations/048_kb_articles_fts.sql`
- テーブル: `kb_articles(id, title, content, line_account_id)` + `CREATE VIRTUAL TABLE kb_articles_fts USING fts5(title, content, content='kb_articles')`
- **重要な注意**: D1のFTS5は日本語の分かち書きが素では弱い。実装の最初に小さな検証（bigramトークナイズで日本語検索が機能するか、サンプル文書2-3件で試す）を行うこと。うまくいかない場合はLIKE検索＋タグ引きにフォールバックしてよい（完璧を目指さず、動くものを優先）
- デプロイ時投入スクリプト: `knowledge-packs/ai-shain/docs/`配下の文書をチャンク分割してD1へ投入するスクリプトを`scripts/`配下に新規作成（ランタイムではなくデプロイ時に実行、Cloudflare Queues等は使わない）

### タスク4: webhook.tsの統合
- `apps/worker/src/routes/webhook.ts` L672-717の`if (!matched && anthropicApiKey ...)`ブロックを拡張
- 新しい順序:
  1. Tier0: 既存auto_replies（変更なし）
  2. Tier1: 回答キャッシュ照会（新規、ヒットで即返信・Groq/Claude呼び出しなし）
  3. Tier2: D1 FTS5でトップ3件検索 → `knowledge-packs/ai-shain/guardrails.md` + `persona.md` + 検索結果 + 直近3往復の会話履歴 をプロンプトに構成してGroq呼び出し
  4. Tier2の応答が正常なら返信（canonical質問ならキャッシュへ保存）、`[ESCALATE]`ならswitchToHumanMode()
  5. Groqがfail-closed（429/タイムアウト/エラー）を返した場合、または日次呼び出し上限（後述タスク6）を超えた場合は、**既存のClaude連携(`generateLlmReply`)は呼ばず**、直接`upsertChatOnMessage`でConversation Inboxへ（コスト優先のデフォルト判断、詳細は末尾参照）
- **既存の`generateLlmReply`・`switchToHumanMode`・`chats`テーブル関連のコードは一切変更しない**

### タスク5: ナレッジパック配置
- ディレクトリ: `knowledge-packs/ai-shain/`
  - `persona.md`: システムプロンプトの人格・トーン部分（`ai-shain.link`の`src/index.html` `#start`セクションと同じ文体。丁寧・専門用語を避ける・煽らない）
  - `guardrails.md`: 常時システムプロンプトに注入する制約。以下を必ず含める:
    - 未対応のこと: メール送信・返信の実行、Chatwork連携（準備中）、クレジットカード等の自動課金、申込み直後の無人利用開始、全業種一律対応
    - 秘密情報（APIキー・トークン・パスワード）を会話に出力しない
    - 送信・本番反映・OAuth認証など人間承認が必要な操作をBotが代行しない、と答える
    - これらは検索結果に頼らず毎回のプロンプトに固定で含めること（RAG検索が外れたときに事故が起きるため）
  - `docs/`: RAG対象文書。`ai-shain.link`の`src/index.html` `#start`セクションの内容（導入4ステップ、Google認証の説明、スマホ利用、最初のひと言例）をMarkdown化して配置。加えて、既存の`CODEX-HANDOFF-line-support-bot.md`にある「エラー診断パターン」の例（Google認証エラー時の原因仮説リスト等）も文書化して含める
  - `canned/`: LLM不要の定型応答。挨拶文、「使い方を教えて」への全体像提示（4ステップ一覧）、エスカレーション時の文言、フォローアップ文（`CODEX-HANDOFF-line-support-bot.md`のA〜F章のテンプレをそのまま使ってよい）

### タスク6: 使用量カウンタ（無料枠監視）
- 新規マイグレーション or 既存`account_settings`拡張で、日次のGroq呼び出し回数・キャッシュヒット率・エスカレーション率を記録するカウンタを追加
- `bot.config.json`の`dailyCallBudget`（後述）を超えたら、即座にTier3（Conversation Inbox）へエスカレーションする（fail-closed。Groq無料枠の日次上限に達する前に自主停止する安全弁）

### タスク7: 設定ファイル
- `bot.config.json` + `bot.config.schema.json`を新規作成:

```jsonc
{
  "$schema": "./bot.config.schema.json",
  "project": "ai-shain-link",
  "llm": {
    "provider": "groq",
    "model": "llama-3.3-70b-versatile",
    "apiKeySecretName": "GROQ_API_KEY",
    "maxOutputTokens": 500,
    "timeoutMs": 10000,
    "dailyCallBudget": 800
  },
  "line": {
    "channelSecretName": "LINE_CHANNEL_SECRET",
    "channelAccessTokenSecretName": "LINE_CHANNEL_ACCESS_TOKEN"
  },
  "knowledgePack": "./knowledge-packs/ai-shain",
  "escalation": {
    "mode": "conversation-inbox"
  },
  "cache": { "enabled": true, "ttlHours": 72 },
  "retrieval": { "topK": 3, "minScore": 0.0 }
}
```

### タスク8: 将来のkit化への「安い縫い目」（今から入れる、追加コストほぼゼロ）
- プロジェクト固有値（モデル名・閾値・文言）をコード内にハードコードしない。すべて`bot.config.json`かナレッジパックへ
- `KIT-EXTRACTION-NOTES.md`をリポジトリ直下に新規作成し、実装しながら「これは共通コード/これは ai-shain.link 固有」の判断を随時1行メモしていく（後で他プロジェクトに展開する際の抽出マニフェストになる）
- `templates/`化や自動kitifyスクリプトは**作らない**（今回は不要、時期尚早）

---

## テスト・検収項目

1. 「使い方を教えて」に対し、`ai-shain.link`の`#start`セクションと矛盾しない4ステップが返る
2. Chatwork連携・自動送信・自動課金について聞かれた際、「未対応」と正直に答える（guardrails.mdが効いているか）
3. エラー文言を送った際、原因の仮説と確認手順が返る
4. Bot側で判断できない質問は`[ESCALATE]`相当の挙動でhumanモードに切り替わる
5. **429を人為的に起こしてfail-closed動作を確認**（Groqのレート制限到達時、黙らず・エラーを晒さず、エスカレーション文言で人間に落ちること）
6. dailyCallBudget超過時、Conversation Inboxへ即座にエスカレーションすること
7. 会話ログに秘密情報（APIキー・トークン）が記録されていないこと
8. LINE公式アカウントマネージャーの標準応答（「AIチャットボット(β)」）とこの機能が同時発火しないこと（これはユーザー側でβ機能をオフにする運用作業、コードでは対処不要だが、README等に「β機能は必ずオフにすること」と明記する）

---

## デフォルト判断（不明点があれば、ここに従って進めてよい。都度質問で止まらないこと）

- **既存Claude連携(`generateLlmReply`)の扱い**: Tier2(Groq)がfail-closedを返した場合、既存Claude連携は**呼ばない**。コスト優先のため、直接Conversation Inboxへエスカレーションする。これがコスト最優先という開発者の意向に最も合致する
- **Groq APIキー**: 新規に専用キーを発行する前提でコードを書いてよい。実際のキー値はユーザーが後で`wrangler secret put`する
- **D1 FTS5の日本語精度が低い場合**: 完璧を求めず、LIKE検索＋タグへのフォールバックで妥協してよい
- **既存コードへの改変は最小限に**: `llm-reply.ts`・`chats`関連・`auto_replies`関連のロジックは変更しない。新規ファイル・新規テーブルの追加を優先する
- **利用期限がある**ため、実装が複数セッション・複数ツールにまたがってもよい。作業を中断する場合は、完了したタスク番号とファイル一覧をコミットメッセージまたはこのファイルの末尾に追記して引き継ぐこと

---

## 関連ドキュメント（参照用、このリポジトリ外）

- `C:\Users\info\OneDrive\デスクトップ\Resilio\github\ai-shain.link\CODEX-HANDOFF-line-support-bot.md`（Bot設計の原案、ThreadsPost実例分析、応答例テンプレ）
- `C:\Users\info\OneDrive\デスクトップ\Resilio\github\ai-shain.link\FABLE-DESIGN-line-bot-groq-kit.md`（今回のFable設計、詳細な設計判断根拠）
- `C:\Users\info\OneDrive\デスクトップ\Resilio\github\ai-shain.link\docs\LINE-BOT-GROQ-IMPLEMENTATION-PLAN.md`（実装計画の元）

実装後、変更ファイル一覧とテスト結果を報告すること。

---

## 実装進捗（Cursor 2026-07-14）

- [x] タスク1: `groq-reply.ts` + `GROQ_API_KEY` Env
- [x] タスク2: マイグレーション `051_llm_response_cache.sql`
- [x] タスク3: マイグレーション `052_kb_articles_fts.sql` + `scripts/seed-kb-articles.ts`
- [x] タスク4: `webhook.ts` Groq パイプライン統合（Claude fail-closed フォールバックなし）
- [x] タスク5: `knowledge-packs/ai-shain/` 一式
- [x] タスク6: マイグレーション `053_groq_usage_daily.sql` + 日次カウンタ
- [x] タスク7: `bot.config.json` + `bot.config.schema.json`
- [x] タスク8: `KIT-EXTRACTION-NOTES.md`
- テスト: `pnpm --dir apps/worker test` 全緑、`typecheck` OK
- 残作業（ユーザー）: `wrangler secret put GROQ_API_KEY`、D1 051–053 適用、KB seed、LINE β オフ
