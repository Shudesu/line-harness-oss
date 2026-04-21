# soulflow-proxy-vnew

TruthSphere / SoulFlow の webhook を受け取り、

1. Google Apps Script (GAS) に転送して Google Sheets (IQB MASTER) に書き込む
2. 成功後、Supabase `iqb_entries` テーブルへ UPSERT する

という 2 段転送を行う Cloudflare Worker。

## 背景

Cloudflare Dashboard で直接編集されていた Worker を git 管理下に移行した
(2026-04-21, `strategic_brief__soul_memories_pipeline_v2__20260421_175000.md`)。
旧ソースは GAS 転送のみを行っていたが、`docs/guides/week12_pipeline_dataflow.md`
の GAP 1 (Google Sheets → Supabase iqb_entries) を解消するため Supabase UPSERT
を追加した。

## 設計不変条件

- **`/webhook/soul-diagnosis` の既存レスポンス shape を壊さない** (水鏡が依存)
- GAS 転送は 1 行も変えない。Supabase UPSERT は**独立した副作用**として追加
- GAS 失敗時 (resp.ok = false) は Supabase UPSERT をスキップする
- Supabase 接続情報 (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) が未設定なら UPSERT をスキップ
  (dev/staging 環境で secret 未設定でも動作する後方互換のため)

## Secrets

```bash
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

## デプロイ

```bash
cd apps/soulflow-proxy-vnew
wrangler deploy
```

## エンドポイント

| Method | Path | 動作 |
|---|---|---|
| GET  | `/health`, `/v2/health` | ヘルスチェック |
| POST | `/webhook/soul-diagnosis`, `/v2/webhook/soul-diagnosis` | GAS 転送 + Supabase UPSERT |
| OPTIONS | (all) | CORS preflight |

## iqb_entries UPSERT の payload マッピング

Worker は incoming JSON から以下のフィールドを抽出し、存在しない場合は UPSERT をスキップする:

| iqb_entries 列 | 候補キー |
|---|---|
| tenant_id | `tenant_id` / `tenantId` |
| user_id | `user_id` / `userId` |
| week_number | `week_number` / `weekNumber` / `week` |
| week_label | `week_label` / `weekLabel` |
| entry_data | `entry_data` / `entryData` / `data` / (fallback: incoming 全体) |
| version | `version` (default: 1) |
| source_gpt_number | `source_gpt_number` / `sourceGptNumber` |
| source_gpt_name | `source_gpt_name` / `sourceGptName` |
| is_finalized | `is_finalized` / `isFinalized` (default: false) |
| finalized_at | `finalized_at` / `finalizedAt` |

UPSERT conflict target: `(tenant_id, user_id, week_number, version)` — 再送信でも重複行を作らない。

## 関連

- モノレポ migration: `supabase/migrations/20260421090000_add_embedding_to_iqb_entries.sql`
- GHA embedding workflow: `.github/workflows/embed-iqb-entries.yml`
- データフロー全体図: `docs/guides/week12_pipeline_dataflow.md`
