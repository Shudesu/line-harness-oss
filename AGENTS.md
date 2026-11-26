# Contributor Agent Instructions

- Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing this repository. Follow its contribution, verification, and security-reporting guidance.
- Keep changes focused on the requested issue, preserve unrelated work, and report the checks run and any remaining limitations.
- Use synthetic data for local verification. Keep credentials, customer information, and operator-specific instructions out of committed files.
- When changing proxy message logging, preserve the distinction between individual staff replies and automated messages. Review `apps/worker/src/routes/line-proxy.ts` for the `X-Line-Harness-Source: manual` contract and its push-only validation.
- When changing consultation scheduling, review `apps/worker/src/routes/meet-consultations.ts` and `apps/worker/src/services/meet-consultation-reminders.ts` together so registration, updates, cancellation, and reminder behavior stay consistent.
- A code change does not itself authorize production deployment, real message delivery, or changes to a user's calendar.


## Cloudflareの処理量と費用

- DB・Cron・ポーリング・再試行を変更するときは `docs/engineering/cloudflare-cost-review.md` を読み、呼出し回数×読み書き範囲を仕様に記載する。
- 仕様には設計メモを記載し、PR前に `pnpm check:cost` で100倍・1000倍の合成データ検査とCost Safetyを実行する。本番で負荷試験や診断用の全件走査をしない。
- SQLite VM命令数とD1課金rowsを混同せず、未観測を正常/0円扱いしない。通知は課金上限ではない。
- 顧客処理の自動停止・ポイント抑制・新規通知先/認証/有料サービスは、その変更の承認を得てから行う。
