# PPAL シナリオ

このディレクトリにはPPAL固有のシナリオ定義を格納します。

現在のシナリオは `../scripts/migrate-ppal-scenarios.ts` 内に定義されています。

## シナリオ一覧

| シナリオ名 | トリガー | ステップ数 |
|-----------|---------|---------|
| Welcome | 友だち追加 | 5ステップ（0〜7200分） |
| Launch_Countdown | sts:見込み客 タグ追加 | 5ステップ（0〜10220分） |
| Member_Onboarding | sts:購入済み タグ追加 | 5ステップ（0〜43200分） |

## 移行方法

```bash
cd ppal/scripts
WORKER_URL=https://your-worker.workers.dev API_KEY=your-key npx tsx migrate-ppal-scenarios.ts
```
