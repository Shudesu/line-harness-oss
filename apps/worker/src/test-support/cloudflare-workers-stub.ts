/**
 * `cloudflare:workers` は Workers ランタイム内でのみ解決できるビルトインモジュール。
 * このリポジトリの vitest 設定は `environment: 'node'` (vitest-pool-workers 無し)
 * なので、テスト実行時は実体を読み込めない — vitest.config.ts の alias で
 * このファイルに差し替えている。
 *
 * DurableObject 基底クラスは、durable-objects/tenant-scheduler.ts が
 * `extends DurableObject<Env>` する際に ctx/env を受け取って保持できれば
 * 十分で、それ以外のランタイム機能 (RPC ブランド等) はテストでは使わない。
 * index.ts 経由で間接的にこのモジュールへ辿り着くテストファイルが多数ある
 * ため (webhook.ts 等が TenantScheduler を実 import している)、個々のテスト
 * ファイルで vi.mock するのではなくここで一括して解決できるようにしている。
 */
export abstract class DurableObject<Env = unknown, Props = unknown> {
  protected ctx: unknown;
  protected env: Env;

  constructor(ctx: unknown, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}
