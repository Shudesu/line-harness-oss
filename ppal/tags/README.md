# PPAL タグ定義

このディレクトリにはPPAL固有のタグ定義を格納します。

現在のタグ定義は `../scripts/migrate-ppal-tags.ts` 内に定義されています。

## タグ一覧

| カテゴリ | タグ |
|---------|------|
| Segment | seg:初心者, seg:中級者, seg:経営者, seg:副業希望 |
| Status | sts:見込み客, sts:購入済み, sts:受講中, sts:受講完了, sts:解約済み |
| Engagement | eng:高, eng:中, eng:低 |
| Source | src:X, src:YouTube, src:紹介, src:広告 |
| Article | art:AI活用, art:副業 |
| Test | test:A, test:B |

## 移行方法

```bash
cd ppal/scripts
WORKER_URL=https://your-worker.workers.dev API_KEY=your-key npx tsx migrate-ppal-tags.ts
```
