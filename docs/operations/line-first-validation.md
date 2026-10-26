# LINE先行キャンペーンの検証記録

2026-10-27。合成データ・ローカルDBのみを使用。実メッセージ・カレンダー操作・本番移行・公開は実施していません。

## 検証

| 対象 | 結果 |
|---|---|
| Worker | 136ファイル、1,673テスト成功（並列worker数2） |
| DB | 205テスト成功。bootstrapとmigration replay一致 |
| 管理画面 | 84テスト成功 |
| LIFF | 3テスト成功 |
| SDK | 53テスト成功 |
| update-engine | 291テスト成功 |
| 導入CLI | 210テスト成功 |
| scripts | 73テスト成功 |
| 全typecheck / ビルド | Worker・管理画面・LIFF・SDK・CLI・MCP・pluginを確認 |
| MCP protocol | 31ツールのスキーマ一覧、無効入力のAPI呼び出し前拒否 |
| production依存監査 | 既知の警告0件 |

Workerの追加テストは署名、アカウント境界、idempotency、シナリオ重複防止、LIFFのchannel照合、Turnstile、reply/push競合、古い応答で確定状態が戻らないことを確認します。画像生成や両repoの契約テストはX側にあります。

## 再現

通常のチェックアウトでは `pnpm install --frozen-lockfile` 後、以下を実行します。

```sh
pnpm -r --if-present typecheck
pnpm --filter worker exec vitest run --maxWorkers=2 --minWorkers=1
pnpm --workspace-concurrency=2 --filter web --filter liff --filter @line-harness/update-engine --filter @line-harness/sdk --filter create-line-harness --filter @line-crm/db test
pnpm test:scripts
pnpm exec tsx scripts/check-migrations.ts packages/db/migrations/NNN_x_line_first_gates.sql
pnpm -r build
pnpm --filter @line-harness/mcp-server test:protocol
pnpm audit --prod
```

migrationの`NNN`はマージ時に採番します。最終番号へ変更後にbootstrapを再生成し、上記のファイル名も合わせます。外部ディスクへ依存のvirtual storeを置く場合は、通常と同じ`.pnpm`というディレクトリ名を使い、Nodeの型解決が変わらないようにしてください。

## 公開前に残る確認

実iOS/AndroidでのX起動、実OAuth・Turnstile、実送信、対象本番のバックアップ・migration履歴・実スキーマ確認は未実施です。ソースのタグ公開と本番配信は別です。LINEの公開OSSは本番制御面ではありません。
