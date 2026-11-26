## Summary

<!-- Describe the problem and fix in 2-5 bullets. -->

- Problem:
- Solution:
- What changed:
- What did NOT change:

## Related Issue

<!-- Fixes #123, relates to #123, or N/A -->

## Change Type

- [ ] Bug fix
- [ ] Feature
- [ ] Security hardening
- [ ] Documentation
- [ ] Tests only
- [ ] Chore / infra
- [ ] Private sync

## Scope

<!-- Check every area touched by this PR. -->

- [ ] Admin web UI
- [ ] Worker API
- [ ] LINE webhook / postback / reply token
- [ ] Broadcast / multicast / step delivery / reminders
- [ ] Auth / API keys / cookies / CORS / staff permissions
- [ ] D1 schema / migrations / account scoping
- [ ] SDK / MCP / create-line-harness CLI
- [ ] Cloudflare deploy / release / update workflow
- [ ] Docs only

## Verification

<!-- Commands run, screenshots checked, or reason tests were not run. -->

- Commands:
- Manual checks:
- Screenshots/logs:
- Not tested:

## Security Impact

- New permissions/capabilities? (`Yes/No`)
- Secrets/tokens handling changed? (`Yes/No`)
- New/changed network calls? (`Yes/No`)
- Message sending behavior changed? (`Yes/No`)
- Customer/friend data access changed? (`Yes/No`)
- D1 migration or data deletion changed? (`Yes/No`)

If any answer is `Yes`, explain the risk and mitigation:

## Safety Checklist

- [ ] This PR is focused on one problem and contains no unrelated commits.
- [ ] I searched for existing issues/PRs to avoid duplicates.
- [ ] No secrets, tokens, customer data, friend IDs, private URLs, or private configuration are included.
- [ ] No generated build output, `.tsbuildinfo`, local env files, or formatting-only churn is included.
- [ ] Docs or tests were updated when useful.
- [ ] Deployment impact is understood.
- [ ] For high-risk areas, I included a clear rollback or recovery note.
- [ ] I personally verified the behavior described above.

## Rollback / Recovery

<!-- How should maintainers recover if this change causes a problem? Write N/A for docs-only PRs. -->

## Cloudflareの処理量

DB/定期処理/ポーリング/再試行を変更する場合は [設計・リリースチェック](../docs/engineering/cloudflare-cost-review.md) に従う。該当なしの場合も理由を書く。

- 入口・頻度・対象人数・同時実行・再試行上限：
- 1回のSQL数、D1 read/write行数、Workers request/CPUの根拠：
- 無関係なデータ／本人履歴／対象数が100倍・1000倍になったとき：
- 実行計画・`pnpm check:cost` 結果・月次予算とアカウント共有枠：
- 監視担当・通知・利用者影響・復旧手順：

SQLite VM命令数をD1課金rowsとしない。未測定の値は未測定と書く。
