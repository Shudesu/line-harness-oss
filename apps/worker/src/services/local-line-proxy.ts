import { lineProxy } from '../routes/line-proxy.js';
import type { Env } from '../index.js';

/** 公開URLへの自己 fetch を避け、Harness proxy の同じ handler をWorker内で実行する。 */
export function dispatchLineProxyLocally(
  request: Request,
  env: Env['Bindings'],
  executionCtx?: ExecutionContext,
): Promise<Response> {
  return Promise.resolve(lineProxy.fetch(request, env, executionCtx as ExecutionContext));
}
