# HANDOFF: Claude Code → Codex

> 2026-06-07 深夜作成。Claude Code の使用上限到達のため、ここから先の作業を Codex に引き継ぎます。
> Codex は **このファイルだけ読めば即座に作業継続できる** ように書いてあります。
> 関連: [docs/REMAINING_ISSUES.md](./REMAINING_ISSUES.md) (残課題台帳) / [RUNBOOK.md](../RUNBOOK.md) (運用) / `~/hyhome/brain/hot.md` (申し送り)

---

## 0. 最初に守ること

| 項目 | 方針 |
|---|---|
| 本番デプロイ | **しない**。前田さん「LINE Harness は今使ってない、エラーがなくなるまで何回も根本治療」方針。`wrangler deploy --config wrangler-prod.toml` 禁止 |
| `git push` | 前田さん判断待ち。Codex が勝手に push しない |
| `git force push` | 確認なし禁止 |
| secret 値 | チャット/ログ/出力に絶対含めない。`set -a; source .env.local; set +a` を `bash -x` 配下で叩かない (過去 token 漏洩事故あり、`feedback_bash_x_env_leak` 参照) |
| migration | DROP TABLE / ALTER RENAME TO 禁止 (CI の `scripts/check-migrations.ts` が落ちる)。番号は **070 以降を使う** (066/068 が既に二重採番、これ以上増やさない) |
| Codex の MCP / Bash | `~/hyhome/ads/line/harness/fork/` を cwd に。前田さんから許可された範囲のみ |

成果物提出前に **Claude Code 側のレビューに通す**ルールが `~/.codex/AGENTS.md` 側にあります (Claude ↔ Codex 相互レビュー)。ただし今夜は Claude が上限到達中なので、**前田さんが翌朝に「Claude レビュー入れて」と指示するまで保留** で OK。

---

## 1. 現状サマリ (2026-06-07 深夜時点)

### git
- cwd: `/Users/maedashinya/hyhome/ads/line/harness/fork`
- branch: `main`
- HEAD: `84e8744` "fix(P1 第四弾): 7 並列+Codex レビュー再監査で判明した残致命傷を血止め"
- **未 push** (前田さん判断待ち)
- 本番 Worker は **1 commit 前の `a13f746` のまま稼働** (使ってないのでデプロイ急がない)

### 今夜やったこと
1. 7 並列専門エージェントで深掘り再監査 → 致命傷 15+ 件発見
2. webhook.ts:609 `c.env` 未定義 (ReferenceError 確実) / friends 必須化で UI 全死 / 暗号化 token 復号漏れ 17 サイト / APNs 全テナント越境 / Stripe 無認証受け入れ / 等を血止め
3. Codex に最終レビュー → 追加で tag broadcast 越境 / NULL 救済過剰 / 暗号化残 4 サイトを発見 → 即反映
4. 残課題 24 件を [docs/REMAINING_ISSUES.md](./REMAINING_ISSUES.md) に集約

### 残ってる主要 P1 (構造的・次に着手するべき)
1. **`/api/forms/:id/submit` LIFF ID token 認証必須化** ← Codex 推奨「これを最優先で」
2. **multi-account friends UNIQUE 再設計** (`friends.line_user_id` 単一 UNIQUE で行 collapse)
3. **broadcast 永久 stuck 解消** (batch_offset 永続化 + recoverStalled 修正)
4. **line_accounts FK 化 + soft delete** (8 テーブル dangling 防止)
5. **messages_log / crm_forward_logs retention cron** (`pruneCrmForwardLogs` 配線含む)
6. **cron mutex の 6h ジョブ skip** (`event.cron` 文字列ガード廃止)
7. **APNs テナント越境根本治療** (migration 069 適用 + JOIN 絞り込み + APNS_ENABLED 解禁)

### 残ってる P2 / P3
[docs/REMAINING_ISSUES.md](./REMAINING_ISSUES.md) 参照。P2 10 件 + P3 7 件。

---

## 2. Codex への推奨作業順序

### 🥇 Round 1: `/api/forms/:id/submit` の認証強化 (Codex 推奨最優先)

**なぜ最優先**: 外部から攻撃できる経路。friendId を body 信頼で受けるので、攻撃者が任意の friend に対して metadata 上書き・tag 付与・scenario enroll・Lark 通知発火を起こせる。

**対象**:
- `apps/worker/src/routes/forms.ts:284-326` (POST `/api/forms/:id/submit`)
- `apps/worker/src/routes/forms.ts:251-281` (POST `/api/forms/:id/partial`)
- `apps/worker/src/middleware/auth.ts:43-45` (上記 endpoint を auth skip にしている設定)
- `apps/worker/src/routes/forms.ts:648-695` (`callFormWebhook` — SSRF 対策も追加)

**やること**:
1. LIFF SDK の ID token を body 必須に: `body.idToken`
2. server 側で LINE Login Channel ID (`LINE_LOGIN_CHANNEL_ID`) で audience 検証 (LINE OAuth `/oauth2/v2.1/verify` POST)
3. ID token の `sub` (= LINE userId) から friend を逆引きする。**body の `friendId` は無視**
4. form の `line_account_id` と friend の `line_account_id` が一致するか assert
5. `callFormWebhook` の URL を allow-list 化: private IP (`10.*`, `172.16-31.*`, `192.168.*`, `127.*`, `169.254.*`) と loopback を deny。host 解決して再チェック (DNS rebinding 防止)
6. `/api/liff/link` (`routes/liff.ts`) が同様の ID token 検証パターンを既に持っているので、ヘルパに抽出して再利用するのが綺麗

**検証**:
```bash
cd ~/hyhome/ads/line/harness/fork/apps/worker && pnpm run build
```
ビルド通過 + 既存テストが落ちないこと。

---

### 🥈 Round 2: tsc --noEmit 79 件のエラー潰し (低リスク・大ボリューム)

Round 1 と並行可。機械的作業多め。

**対象**: 79 件のうち主要内訳
- `c.req.param('id')` の `string | undefined` 68 件 — 各 endpoint で `if (!id) return c.json({...}, 400)` を追加
- `lark-client.ts` の `parsed: typeof parsed` バグ → 今夜修正済 ✅
- `Broadcast` interface に migration で追加されたカラム (`alt_text`, `line_request_id`, `aggregation_unit`, `line_account_id`, `batch_offset`, `segment_conditions`) が欠落 → 追加すれば 50+ 箇所の `as unknown as Record<string, unknown>` キャストが削除可能
- `friend as unknown as Record<string, string | null>` の不要キャスト 13 箇所
- `(c.env as unknown as { LARK_APP_ID?: string })` 4 箇所 (`Env` 型に既に定義あり、不要)
- `pushMessage([introMessage as any])` 2 箇所 → 型整合

詳細は [docs/REMAINING_ISSUES.md](./REMAINING_ISSUES.md) の「残バグ⑦」と、Codex がもう一度 `pnpm --filter worker exec tsc --noEmit` を叩いて確認。

**注意**: `tsconfig.tsbuildinfo` を含めて commit する場合は build artifact なので避ける。

---

### 🥉 Round 3: multi-account friends UNIQUE 再設計

**ボリューム大、慎重に**

**対象**:
- migration 070 を新規作成 (069 は既に staff_members 用、未適用)
- `friends.line_user_id` 単一 UNIQUE → `UNIQUE(line_user_id, line_account_id)` に変更
- `packages/db/src/friends.ts`: `getFriendByLineUserId(lineUserId, lineAccountId)`、`upsertFriend(lineUserId, lineAccountId)` 必須化
- caller (~50 箇所): webhook / LIFF / forms / meet-callback / tracked-links / external-events 等で `lineAccountId` を必ず渡す

**手順**:
1. まず caller を grep: `rg -l 'getFriendByLineUserId|upsertFriend' apps/worker packages`
2. 各 caller がどの `lineAccountId` を渡すか整理
3. migration: `ALTER TABLE` で UNIQUE 変更不可なので **テーブル再構築** (`friends_new` → INSERT SELECT → DROP → RENAME)。**ただし check-migrations.ts に違反する**ので、特例として `scripts/check-migrations.ts` の `POLICY_CUTOFF_PREFIX` を `070` に上げて grandfather 化するか、別 migration 戦略 (新カラム → 移行 cron → 旧カラム削除) を取る
4. fallback: 既存 NULL 行を `staff_account_access` の主たる line_account_id にひも付け、もしくは「unknown」アカウント (ダミー line_account を作成して埋める) を作って割り当て

**着手前に前田さんに確認** (どの程度の停止時間を許容するか) してから migration を打つ。

---

### Round 4 以降

[docs/REMAINING_ISSUES.md](./REMAINING_ISSUES.md) の P1 #2 / #3 / #4 / #5 / #6 / #7 を順次。各タスクに「対応」「工数」が書いてあるので参照。

---

## 3. リポジトリ構造

```
~/hyhome/ads/line/harness/fork/
├── apps/
│   ├── worker/                    ← Cloudflare Worker (Hono ベース)
│   │   ├── src/
│   │   │   ├── index.ts           ← scheduled() + Hono mount
│   │   │   ├── routes/            ← 全 endpoint (file 名 = path)
│   │   │   ├── services/          ← booking / broadcast / token-refresh 等
│   │   │   ├── lib/               ← account-token / token-crypto / lark-client
│   │   │   ├── middleware/        ← auth / rate-limit
│   │   │   └── utils/             ← account-boundary / retry-key
│   │   ├── wrangler.toml          ← dev 設定 (name=hyhome-harness-dev)
│   │   └── wrangler-prod.toml     ← 本番設定 (name=hyhome-harness)
│   └── web/                       ← Next.js 15.5 (output: export, 静的書き出し)
│       └── src/
│           ├── app/               ← App Router pages
│           ├── components/        ← UI primitives + 機能別
│           └── lib/api.ts         ← Worker への fetch クライアント
├── packages/
│   ├── db/
│   │   ├── migrations/            ← SQL migration 001-069
│   │   ├── src/                   ← DB ヘルパ (各テーブル毎の関数)
│   │   ├── schema.sql             ← 最新スキーマ
│   │   └── scripts/generate-bootstrap.mjs
│   ├── line-sdk/                  ← LINE Messaging API client
│   ├── shared/
│   ├── sdk/
│   ├── mcp-server/                ← Claude Code MCP server
│   └── update-engine/
├── docs/
│   ├── REMAINING_ISSUES.md        ← ★残課題台帳 (Codex はここを起点に)
│   ├── HANDOFF_TO_CODEX.md        ← このファイル
│   └── iOS_HANDOFF.md             ← iOS アプリ別セッション用 (この件は無関係)
├── scripts/
│   └── check-migrations.ts        ← migration 安全性チェック (CI で実行)
├── RUNBOOK.md                     ← 運用ランブック
├── AGENTS.md                      ← Codex 用 (短い、Next.js 16 警告のみ)
└── CLAUDE.md                      ← @AGENTS.md を読むだけ
```

---

## 4. よく使うコマンド

```bash
cd ~/hyhome/ads/line/harness/fork

# ビルド
pnpm --filter worker run build
pnpm --filter web run build

# TS チェック (worker は 79 件のエラーあり、純減目指す)
pnpm --filter worker exec tsc --noEmit
pnpm --filter web exec tsc --noEmit

# Migration 安全性チェック
pnpm tsx scripts/check-migrations.ts

# 本番 D1 schema 確認 (Codex でやる場合は前田さん許可取って)
cd apps/worker
pnpm exec wrangler d1 execute hyhome-harness --remote \
  --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name" \
  --config wrangler-prod.toml

# 適用済 migration 確認
pnpm exec wrangler d1 execute hyhome-harness --remote \
  --command="SELECT name FROM _migrations ORDER BY name" \
  --config wrangler-prod.toml
```

---

## 5. 環境変数 / Secret (RUNBOOK の最新版を参照)

[RUNBOOK.md#worker-secrets-管理](../RUNBOOK.md) に最新のカテゴリ分け表あり:
- Webhook/認証系 (`LINE_CHANNEL_*`, `API_KEY`, `STRIPE_WEBHOOK_SECRET`, `MEET_CALLBACK_HMAC_SECRET`)
- LINE Login (`LINE_LOGIN_CHANNEL_ID/SECRET`)
- Lark / Meta CAPI / 暗号化 (`LARK_*`, `LINE_TOKEN_ENC_KEY`, `META_*`)
- APNs (`APNS_ENABLED` 含む、現在 OFF)

**`APNS_ENABLED` は migration 069 適用 + ios-notifier.ts の JOIN 実装が完了するまで未設定 (=OFF) のままに**。

---

## 6. 今夜の主要修正サマリ (Codex が文脈把握用)

| ファイル | 変更内容 |
|---|---|
| `apps/worker/src/routes/webhook.ts` | handleEvent に env? 追加、l.609 の `c.env` 未定義解消 |
| `apps/worker/src/routes/friends.ts` / `scoring.ts` / `inbox.ts` | lineAccountId 互換モード → Codex 指摘で厳密境界に再強化 |
| `apps/worker/src/routes/meet-callback.ts` / `forms.ts` / `profile-refresh.ts` / `liff.ts` / `rich-menu-groups.ts` / `services/dedup-broadcast.ts` / `routes/line-accounts.ts` / `routes/events.ts` / `services/ban-monitor.ts` | `resolveAccessToken(env, ...)` 経由に統一 (17 サイト) |
| `apps/worker/src/services/broadcast.ts` + `routes/broadcasts.ts` + `services/dedup-broadcast.ts` + `packages/db/src/tags.ts` | env 透過 + tag broadcast に account filter |
| `apps/worker/src/services/ios-notifier.ts` | `APNS_ENABLED !== 'true'` で全 trigger 早期 return |
| `apps/worker/src/routes/stripe.ts` | secret 未設定で 503 fail-closed |
| `apps/worker/src/lib/lark-client.ts` | `LarkSendResponse` 名前付き型 (typeof parsed バグ解消) |
| `apps/worker/src/utils/account-boundary.ts` + `src/services/lark-notifier-hooks.ts` | `OR line_account_id IS NULL` 削除 (厳密境界) |
| `apps/worker/src/services/crm-forward-retry.ts` + `packages/db/src/crm-forwards.ts` | `deferCrmForwardQueueItem` で 24h 遅延 (bucket 巻き戻しバグ解消) |
| `apps/worker/wrangler.toml` | `[env.production]` 削除 + `name = "hyhome-harness-dev"` (誤デプロイ防止) |
| `apps/web/src/lib/api.ts` + 4 caller | `lineAccountId` 透過 |
| `apps/web/src/lib/update-client.ts` + `app/updates/page.tsx` | `NEXT_PUBLIC_ADMIN_API_KEY` 削除 + self-update disable |
| `RUNBOOK.md` | secret 表をカテゴリ分割、必須項目補完 |
| `packages/db/migrations/069_staff_members_line_account.sql` | APNs テナント越境の根本治療準備 (未適用) |

---

## 7. 前田さんの方針メモ (Codex も従う)

- 「LINE Harness は今は使ってない」→ デプロイの緊急性ゼロ。**焦らず根本治療**
- 「何回も何回も課題解決する予定」→ 1 セッションで全部終わらせる必要なし。**1 ラウンド 1〜3 件で十分**
- 「徹底的に」→ 浅く広くじゃなく、各タスクで Codex は **コード読んで** 直す
- secret や PII は出さない
- 提案/疑問は前田さんに直接聞く (深夜は寝てる可能性高い、朝に確認)

---

## 8. Codex が最初にやるべきこと (チェックリスト)

```
□ ~/hyhome/ads/line/harness/fork/ に cwd 移動
□ git log -5 で HEAD = 84e8744 確認
□ git status でクリーンか確認
□ docs/REMAINING_ISSUES.md を読破
□ Round 1 (form submit 認証) のコード読み: forms.ts:251-326 + middleware/auth.ts + liff.ts の ID token 検証参考
□ 修正方針を整理して前田さんに「これで進めて良いか」確認 (朝)
□ 実装 → ビルド → commit (push と本番反映は前田さん判断)
```

---

## 9. 質問・つまずいたとき

- このファイル / `docs/REMAINING_ISSUES.md` / `RUNBOOK.md` を再読
- `~/hyhome/brain/hot.md` (最新申し送り) / `~/hyhome/brain/README.md` (索引)
- 過去 commit (`git log --oneline -20`) で類似修正パターンを参照
- 前田さんに直接質問 (深夜は応答なし、朝待ち)

---

おつかれさまでした。次のラウンド、よろしくお願いします 🤝

— Claude (2026-06-07 深夜・上限到達直前)
