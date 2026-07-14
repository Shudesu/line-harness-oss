# Cursor実装依頼: 1つのLINE公式アカウントで複数製品Bot（ai-shain + henshin-hisho）

このファイルをCursorに渡して、この内容に従って実装を進めてください。設計・調査は完了済みで、これは実装計画そのものです。不明点があれば末尾の「デフォルト判断」に従って進めてよい（都度質問で止まらない）。

対象リポジトリ: このリポジトリ（`line-harness-oss`）
前提タスク: `CURSOR-TASK-groq-line-bot.md`（タスク1〜8完了・テスト全緑）の上に積む。
関連プロジェクト: `ai-shain.link`（既存Bot対象）、`henshin-hisho`（今回追加。君斗りんくのAI返信秘書。リポジトリ `C:\Users\info\OneDrive\デスクトップ\Resilio\github\henshin-hisho`）

---

## 背景・目的

LINE公式アカウント「Kimito-Link Project」は現在 `ai-shain.link` の自由文AIサポートBot（Groq + RAG + キャッシュ）専用になっている。ここに第2製品 `henshin-hisho`（AI返信秘書）のサポートBotを**同じLINE公式アカウント上に**追加する。

司令塔決定済みの前提（変更禁止）:

- 新規LINE公式アカウントは作らない（友だち追加導線を二重化しない）
- 毎メッセージのLLM製品判定はしない（誤判定リスク）
- **友だち追加経路（`friends.ref_code` → `entry_routes`）で製品を確定し、以後そのfriendは恒久的にその製品のknowledge-packで応答する**

## 調査で判明した重要事実（この前提で作業すること）

### 1. knowledge-packの実体は「バンドルされたTS定数」であり、ランタイムでファイルは読まない

- `knowledge-packs/ai-shain/*.md` / `canned/*.txt` は**正本（人間が編集する原稿）**。
- Workers実行時に使われるのは `apps/worker/src/services/groq-knowledge-content.ts` にハードコードされた `PERSONA_MD` / `GUARDRAILS_MD` / `CANNED_*` 定数と `buildSystemPrompt()` / `matchCannedResponse()` / `getFailClosedEscalationText()`。
- したがって「knowledgePackパスの切り替え」は実際には**プロジェクト別のバンドル済みコンテンツモジュールの切り替え**として実装する。`bot.config.json` の `knowledgePack` パスは正本ディレクトリの所在表示にすぎない。

### 2. Groqパイプラインの現在の形（製品軸がない）

- `apps/worker/src/routes/webhook.ts` L689-734: auto_replies未マッチ かつ `ai_reply_mode !== 'human'` かつ `groqApiKey` 有りのとき `runGroqSupportPipeline({ db, apiKey, lineAccountId, friendId, incomingText })` を呼ぶ。**project引数は存在しない**。
- `apps/worker/src/services/groq-pipeline.ts`: Tier1キャッシュ → Tier1.5 canned → Tier2 RAG+Groq。`buildSystemPrompt()` / `matchCannedResponse()` / `getFailClosedEscalationText()` を無条件にai-shain版で呼んでいる。
- `apps/worker/src/services/groq-config.ts`: `import botConfigJson from '../../../../bot.config.json'`（ビルド時import）。`getBotConfig()` は単一 `project` 前提。

### 3. D1テーブルに製品軸がない（同一line_account_id共用なので汚染リスク）

- `llm_response_cache`（051）: キーは `question_hash + line_account_id`。両製品が同じアカウントなので、**ai-shain向けのキャッシュ回答がhenshin-hishoユーザーにヒットしてしまう**。要project列。
- `kb_articles`（052）: `line_account_id` と `tags`（現状はseed元ファイル名）のみ。`apps/worker/src/services/kb-search.ts` のFTS/LIKE検索は `line_account_id` でしか絞らない。**両製品のRAG文書が混ざる**。要project列。
- `groq_usage_daily`（053）: `line_account_id + usage_date`。日次予算はGroqキー（共有）を守る安全弁なので**共有のままでよい**（デフォルト判断参照）。

### 4. ref_code基盤は完成済み・転用可能（司令塔の仮説は正しい）

- `packages/db/migrations/003_entry_routes.sql`: `entry_routes(ref_code UNIQUE, name, tag_id, scenario_id, redirect_url, is_active)` + `ref_tracking` + `friends.ref_code`。
- 書き込み: `apps/worker/src/routes/liff.ts` L880前後・L1318・L1390 で `UPDATE friends SET ref_code = ? WHERE id = ? AND ref_code IS NULL`（**first touch wins = 一度付いたref_codeは不変**。「以後ずっとその製品」の要件と完全に一致）。
- follow時: `webhook.ts` L237-258 で `friend.ref_code` を取得（OAuth並走レースのため200ms×5回リトライ）し `getEntryRouteByRefCode()` で解決済み。
- 管理API: `apps/worker/src/routes/entry-routes.ts` に CRUD（`POST /api/entry-routes` 等）あり。ref付き友だち追加URLは既存のai-shain経路と同じ形式（`/auth/line?ref=<code>&...` → `/auth/callback` でref記録 → `line.me/R/ti/p/{basicId}` へリダイレクト）。**実装時に管理UIが表示する実URL形式を確認して踏襲すること**。

### 5. Tier0（auto_replies）はアカウント単位で共有

キーワード自動応答は製品を区別せず両方のユーザーに発火する。コード変更はしない（運用ルール: 製品固有キーワードをauto_repliesに置かない。挨拶等の製品中立文言のみ）。

---

## 設計判断（理由付き）

### 判断A: 製品判定は「friend.ref_code → entry_routes.project 列」で行う

- `entry_routes` に `project TEXT` 列を追加（NULL = デフォルト製品）。ref_codeの命名規約（`hh-*`）だけに頼らず、DBで明示する（規約は人間向けの目印としては使う）。
- メッセージ受信時の解決規則（**すべてfail-closedでデフォルト製品に落ちる**）:
  1. `friend.ref_code` が NULL → `defaultProject`（= `ai-shain-link`）
  2. ref_code はあるが `entry_routes` に行がない → `defaultProject`
  3. 行はあるが `project` が NULL → `defaultProject`
  4. `project` が config の `projects` に存在しないID → `defaultProject`（+ console.warn）
  5. それ以外 → その project
- これにより**既存friend（全員ref_code NULLか ai-shain系ref）は一切挙動が変わらない** = 移行作業ゼロ。
- friendsテーブルへのproject列の非正規化はしない（ref_codeが不変なので毎回1クエリ引くだけで安定。webhookは既に複数クエリを打っており1 SELECT追加は許容）。

### 判断B: 設定は「1ファイル・projectsマップ・後方互換ローダー」

`bot.config.json` はビルド時importなので分割ファイルにするとimport配線が増えるだけ。1ファイルに `projects` マップを持たせ、ローダーが旧形式（トップレベル `project`）も読めるようにする。llm/line/cache/retrievalは共有のまま（同一Groqキー・同一LINEアカウントなので分ける理由がない）。

### 判断C: バンドル済みコンテンツは「pack registry」に再編（既存exportは温存）

`groq-knowledge-content.ts` の既存export（`buildSystemPrompt` 等）はテストからも参照されているため削除しない。新設のregistryが project ID → packオブジェクトを返し、pipelineはregistry経由で引く。

---

## 実装タスク（この順に進める）

### タスク1: マイグレーション `packages/db/migrations/054_multi_product_bot.sql`

（053が最新であることを確認してから採番）

```sql
-- 製品軸の追加。NULL = デフォルト製品(ai-shain-link)扱い＝既存データ無変更で後方互換
ALTER TABLE entry_routes ADD COLUMN project TEXT;
ALTER TABLE kb_articles ADD COLUMN project TEXT;
ALTER TABLE llm_response_cache ADD COLUMN project TEXT;
CREATE INDEX IF NOT EXISTS idx_kb_articles_project ON kb_articles (project);
CREATE INDEX IF NOT EXISTS idx_llm_response_cache_project ON llm_response_cache (project);
```

- `groq_usage_daily` には**追加しない**（予算は共有キーの安全弁。デフォルト判断参照）。
- 既存行のbackfillはしない（NULL=デフォルトのCOALESCE規則で読む）。

### タスク2: `bot.config.json` / `bot.config.schema.json` の複数プロジェクト化

新形式（既存のai-shain値は1文字も変えず、置き場所だけ `projects` 配下へ移す）:

```jsonc
{
  "$schema": "./bot.config.schema.json",
  "defaultProject": "ai-shain-link",
  "llm": { "provider": "groq", "model": "llama-3.3-70b-versatile", "apiKeySecretName": "GROQ_API_KEY", "maxOutputTokens": 500, "timeoutMs": 10000, "dailyCallBudget": 800 },
  "line": { "channelSecretName": "LINE_CHANNEL_SECRET", "channelAccessTokenSecretName": "LINE_CHANNEL_ACCESS_TOKEN" },
  "cache": { "enabled": true, "ttlHours": 72 },
  "retrieval": { "topK": 3, "minScore": 0.0 },
  "escalation": { "mode": "conversation-inbox" },
  "projects": {
    "ai-shain-link":  { "knowledgePack": "./knowledge-packs/ai-shain" },
    "henshin-hisho":  { "knowledgePack": "./knowledge-packs/henshin-hisho" }
  }
}
```

- `apps/worker/src/services/groq-config.ts`:
  - `getBotConfig()` を後方互換ローダーに: `projects` があれば新形式、なければ旧形式（`project` + `knowledgePack`）を `{ defaultProject: raw.project, projects: { [raw.project]: {...} } }` に正規化。
  - 追加API: `getDefaultProject(): string` / `isKnownProject(id: string): boolean`。
- `bot.config.schema.json` は新旧両形式を許容（oneOf）に更新。

### タスク3: 製品リゾルバ新規作成 `apps/worker/src/services/bot-project.ts`

```ts
export async function resolveBotProject(
  db: D1Database,
  friend: { ref_code?: string | null },
): Promise<string>
```

- 設計判断Aの規則1〜5を実装。`getEntryRouteByRefCode(db, ref_code)` を再利用し、返り値の `project`（型追加が必要なら `packages/db` の EntryRoute 型に `project?: string | null` を追加）を見る。
- webhook.tsのtext handler時点の `friend` オブジェクトに `ref_code` が含まれるか確認し（`SELECT *` 由来なら含まれる）、含まれない場合のみ `getFriendById` で引き直す。

### タスク4: pack registry 新規作成 `apps/worker/src/services/knowledge-packs.ts`

```ts
export interface BundledKnowledgePack {
  project: string;
  buildSystemPrompt(kbContext: string): string;
  matchCannedResponse(text: string): string | null;
  getFailClosedEscalationText(): string;
}
export function getKnowledgePack(project: string): BundledKnowledgePack; // 不明IDはデフォルトpackを返す(fail-closed)
```

- ai-shain実装: 既存 `groq-knowledge-content.ts` の関数をそのままラップ（**同ファイルは変更しない**）。
- henshin-hisho実装: 新規 `apps/worker/src/services/henshin-hisho-knowledge-content.ts`（タスク6の正本md群と同内容をバンドル。ファイル冒頭に「正本は knowledge-packs/henshin-hisho/。両方更新すること」コメント必須 — ai-shain版の慣行踏襲）。

### タスク5: パイプラインとwebhookの配線

- `apps/worker/src/services/groq-pipeline.ts`:
  - `GroqPipelineParams` に `project: string` を追加。
  - `matchCannedResponse` / `buildSystemPrompt` / `getFailClosedEscalationText` を `getKnowledgePack(project)` 経由に差し替え。
  - `lookupCachedAnswer` / `saveCachedAnswer`（`apps/worker/src/services/llm-cache.ts`）に `project` を追加し、SQLを `AND COALESCE(project, '<defaultProject>') = ?` で絞る（保存時は必ずprojectを書く）。
  - `searchKbArticles`（`apps/worker/src/services/kb-search.ts`）に `project` を追加し、FTS/LIKE両方のWHEREに `AND COALESCE(ka.project, '<defaultProject>') = ?` を追加。defaultProject文字列はハードコードせず `getDefaultProject()` から取る。
  - `groq_usage_daily` 系（`incrementGroqUsage` / `isGroqBudgetExceeded`）は**無変更**。
- `apps/worker/src/routes/webhook.ts`（L702前後の1箇所のみ）:
  - `runGroqSupportPipeline` 呼び出しの直前で `const project = await resolveBotProject(db, friend);` を追加し、paramsに `project` を渡す。**それ以外のwebhook.tsのロジック（follow処理・auto_replies・Claudeフォールバック・chats）は一切変更しない**。

### タスク6: `knowledge-packs/henshin-hisho/` 正本の作成

ディレクトリ構成はai-shain版と同型。内容の骨子（これをそのまま清書してよい）:

#### `persona.md`（人格・トーン）
- あなたは「君斗りんくのAI返信秘書」（henshin-hisho）の**製品サポート担当**。LINE上で丁寧な日本語で答える。
- 対象ユーザー = メール対応に追われる事業者。専門用語を避け、短い文で。煽らない（「完全自動」「ワンクリック」等の誇張禁止 — ai-shain版と同じ禁則）。
- 製品の基本語彙: 受信メールの仕分け4分類「今すぐ見て / お金・契約 / 要返信 / 後回し」、トーン指定の返信下書き、危険な返信（返金・契約・クレーム）は送信前に人間確認必須、**送信は必ずユーザー自身が行う**。
- 差別化機能「アカウント方針エンジン」: 値引き上限・最低受注額・まとめ売り方針・標準トーン・業種テンプレを一度設定すれば以後の下書きに自動反映される、を正しく説明できること。

#### `guardrails.md`（毎回のシステムプロンプトに固定注入。RAG外れ時の事故防止）
- **代行禁止**: メールの自動送信・返信実行をBotが代行しない/できると答えない。下書きまで。送信は必ずユーザー本人。
- **立場の区別**: このBotは「henshin-hisho利用者からの製品に関する問い合わせ」に答える。**利用者の顧客（メールの相手）とのやり取りを代行する立場ではない**。「うちのお客様にこう返信して」的な依頼には、アプリ内の下書き機能の使い方を案内する。
- **未配信を「使える」と言わない**: Chrome拡張（Gmail向け）= 公開済み / Web版 = 公開中 / iOSアプリ = 審査通過・配信準備中（まだストアにない）/ Androidアプリ = 審査中・未配信。※配信状況が変わったらこのファイルとdocsを更新する運用。
- **価格・返金は断定しない**: 確実なのは「月額2,980円・14日間お試し」のみ。返金ポリシー・個別の課金トラブルは回答せず担当者へ（応答末尾 `[ESCALATE]`）。
- **秘密情報**: APIキー・パスワード・トークンを出力しない/入力を求めない（ai-shain版と同文でよい）。
- **エスカレーション**: 契約条件交渉・課金トラブル・個別画面の不具合確認は `[ESCALATE]`。

#### `docs/`（RAG対象。##見出しでチャンクされる — seed-kb-articles.tsの分割仕様に合わせる）
- `product-overview.md`: 何ができるか（仕分け4分類・下書き生成・人間確認ゲート）、誰向けか。
- `platforms-status.md`: 4面展開の現在地（Chrome拡張=公開済/Web=公開中/iOS=配信準備中/Android=審査中）と各面の始め方。
- `policy-engine.md`: アカウント方針エンジンの設定項目（値引き上限・最低受注額・まとめ売り方針・標準トーン・業種テンプレ）と反映のされ方。
- `pricing-trial.md`: 月額2,980円・14日間お試し・お試し開始手順。
- `safety-and-limits.md`: 危険返信（返金・契約・クレーム）の人間確認フロー、自動送信をしない設計思想、未対応事項。
- 内容はhenshin-hishoリポジトリの `web-app/`（LP・UI文言）と矛盾しないよう、実装時にLP実文言を参照して書くこと。

#### `canned/`（LLM不要の定型応答）
- `greeting.txt`: 挨拶+「AI返信秘書のサポート窓口です」宣言。
- `usage-overview.txt`: 「何ができるか」への全体像（4分類仕分け→下書き→自分で送信、の3行 + どの面(Chrome/Web/iOS/Android)を使うか聞き返す）。
- `escalation.txt`: エスカレーション文言（ai-shain版と同型・製品名だけ差し替え）。

### タスク7: seed スクリプトの汎用化 `scripts/seed-kb-articles.ts`

- 引数化: `tsx scripts/seed-kb-articles.ts --pack knowledge-packs/henshin-hisho --project henshin-hisho`（無引数時は従来どおり ai-shain ディレクトリ + `--project ai-shain-link` 相当にして後方互換）。
- INSERT文の `project` 列に値を入れる。
- 既知の問題（今回直してよい）: 現状はidがrandomUUIDのため再実行で重複行が増える。`id` を `hash(project + title)` 等の決定的な値にして INSERT OR REPLACE を本当に冪等にする。

### タスク8: henshin-hisho用 entry_routes の発行（運用手順をREADMEかdocsに追記）

管理API（`POST /api/entry-routes`）で以下を作成。`project` カラムに `henshin-hisho` を設定（APIのバリデーション/型に `project` 受け入れを追加すること）:

| ref_code | name | 用途 |
|---|---|---|
| `hh-web` | henshin-hisho Web版LP | Web版からの友だち追加 |
| `hh-chrome` | henshin-hisho Chrome拡張 | 拡張内・Chrome向け案内から |
| `hh-ios` | henshin-hisho iOSアプリ | iOS面から |
| `hh-android` | henshin-hisho Android | Android面から |
| `hh-lp` | henshin-hisho LP汎用 | 面を特定しない導線用 |

- 友だち追加URLは既存ai-shain経路と同形式（`/auth/line?ref=hh-web` 系 → callbackで `friends.ref_code` 記録 → `line.me/R/ti/p/{basicId}` へ）。実URLの組み立ては管理UIの既存表示に合わせる。
- `hh-` プレフィックスは人間向け規約。判定はあくまでDBの `project` 列（タスク1・3）。

---

## テスト・検収項目

1. **後方互換（最重要）**: 既存テスト全緑のまま。`ref_code` NULL のfriendへの応答が従来と完全一致（ai-shain persona / canned / KB）。
2. `ref_code = 'hh-web'`（entry_routes.project='henshin-hisho'）のfriendに対し、システムプロンプトにhenshin-hisho persona/guardrailsが使われる（groq-reply呼び出しのsystemPromptをassert）。
3. **キャッシュ隔離**: 同一質問文でai-shain friendが作ったキャッシュが、henshin friendにヒットしない（逆も）。
4. **KB隔離**: `project='henshin-hisho'` のkb_articlesだけがhenshin friendの検索に出る。NULL行はai-shain扱い。
5. fail-closed解決: 未知ref_code / entry_routes行なし / project列NULL / config未知ID → すべてai-shain-linkにフォールバック。
6. henshin guardrails実効性: 「Android版使えますか」→「審査中・未配信」/「自動で送信して」→「送信はご自身で」/「返金できますか」→ 断定せず `[ESCALATE]`。
7. 価格質問「いくら?」→「月額2,980円・14日間お試し」がdocsから引ける。
8. `groq_usage_daily` の日次予算が両製品合算で効く（henshin側の呼び出しでもカウントが増える）。
9. `pnpm --dir apps/worker test` + `typecheck` 全緑。

---

## デフォルト判断（不明点があれば、ここに従って進めてよい）

- **dailyCallBudgetは共有のまま**: 予算は共有Groqキーの無料枠を守る安全弁であり、製品別に割る必要はない。製品別分析が欲しくなったら後で `groq_usage_daily.project` を足す（今回はやらない）。
- **friendsテーブルにproject列は足さない**: ref_codeがfirst-touch不変なので、毎回の1 SELECTで十分安定。非正規化は同期バグの温床。
- **auto_replies（Tier0）は触らない**: 運用ルール（製品固有キーワードを置かない）で回避。コードでのproject分岐は今回のスコープ外。
- **既存Claude連携フォールバック（`generateLlmReply`）は触らない**: groqApiKey存在時はそちらに到達しない既存分岐のまま。
- **`groq-knowledge-content.ts` は変更しない**: registry側でラップする。既存exportへの参照(テスト含む)を壊さない。
- **henshin-hishoのdocs文言に迷ったら**: 断定を避ける側に倒す（特に価格・返金・配信状況）。「未配信のものを使えると言う」事故だけは絶対に起こさない。
- **エスカレーション先**: 両製品とも既存のConversation Inbox（`chats`）共用。inbox側での製品識別が必要になったら、friendの`ref_code`を管理画面で見れば分かる（追加実装不要）。

---

## LP導線の方針提案（司令塔向け・実装対象外）

henshin-hisho LPの「使いたい場所で、りんくが待っています」4カード（Chrome拡張・iOS・Android・Web）には、**カードごとにボタンを増やさず、セクション直下に1本のLINE友だち追加ストリップ**（例:「困ったらLINEで質問 — AI秘書のサポート窓口」+ `ref=hh-lp` の追加URL/QR）を置くのを推奨。理由: 4カードの主役はアプリ導入CTAであり、各カードにLINEボタンを並べると主CTAが薄まる。面別の流入分析がどうしても欲しくなった時だけ、各カードのリンクを `hh-chrome`/`hh-ios`/`hh-android`/`hh-web` に差し替えればよい（entry_routesは本設計で最初から5本発行してあるので差し替えは文字列変更のみ）。なおAndroidカードは未配信のため、LINE導線を「配信開始通知を受け取る」文脈にすると自然。

---

## 関連ドキュメント

- `CURSOR-TASK-groq-line-bot.md`（前提タスク・様式の元）
- `KIT-EXTRACTION-NOTES.md`（共通/固有の切り分けメモ。今回の変更で「project軸は共通コード」と追記すること）
- `packages/db/migrations/003_entry_routes.sql` / `051`〜`053`
- `apps/worker/src/routes/webhook.ts`（follow: L237-258 / Groq統合: L689-734）
- `apps/worker/src/services/`: `groq-pipeline.ts` / `groq-config.ts` / `groq-knowledge-content.ts` / `kb-search.ts` / `llm-cache.ts` / `groq-reply.ts`

実装後、変更ファイル一覧とテスト結果をこのファイル末尾に追記すること。
