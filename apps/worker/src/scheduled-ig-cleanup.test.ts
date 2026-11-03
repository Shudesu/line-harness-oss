import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { sqliteD1 } from './test-support/sqlite-d1.js';
import type { Env } from './index.js';
// Stop after the cleanup boundary: unrelated delivery jobs must never execute here.
vi.mock('./services/x-gate-client.js',()=>({flushXGateEvents:async()=>{throw new Error('synthetic-stop-after-cleanup');}}));
import { scheduled } from './scheduled.js';
const opened:ReturnType<typeof sqliteD1>[]=[];
afterEach(()=>{opened.splice(0).forEach(s=>s.sqlite.close());vi.restoreAllMocks();});
describe('scheduled IG token cleanup',()=>{
  it.each([
    ['* * * * *',0,true],['*/5 * * * *',0,true],['* * * * *',1,false],['0 */6 * * *',0,false],
  ] as const)('%s at minute %i: hourly cleanup=%s, including after policy rollback',async(cron,minute,cleaned)=>{
    const s=sqliteD1();opened.push(s);
    s.sqlite.exec(readFileSync(new URL('../../../packages/db/migrations/075_ig_link_token_uses.sql',import.meta.url),'utf8'));
    s.sqlite.exec("INSERT INTO ig_link_token_uses VALUES ('synthetic-nonce','synthetic-friend',0,1)");
    const prepare=vi.spyOn(s.db,'prepare');
    await expect(scheduled({cron,scheduledTime:Date.UTC(2026,10,4,0,minute)} as ScheduledEvent,
      {DB:s.db,IG_LINK_TOKEN_POLICY:'off'} as Env['Bindings'],{} as ExecutionContext)).rejects.toThrow('synthetic-stop-after-cleanup');
    expect(prepare).toHaveBeenCalledTimes(cleaned?1:0);
    expect(s.sqlite.prepare('SELECT count(*) n FROM ig_link_token_uses').get()).toEqual({n:cleaned?0:1});
  });
  it('storage failure does not prevent the remaining scheduled jobs',async()=>{
    const s=sqliteD1();opened.push(s);
    const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
    await expect(scheduled({cron:'* * * * *',scheduledTime:Date.UTC(2026,10,4)} as ScheduledEvent,
      {DB:s.db} as Env['Bindings'],{} as ExecutionContext)).rejects.toThrow('synthetic-stop-after-cleanup');
    expect(warn).toHaveBeenCalledWith('[ig-link] cleanup_failed');
  });
});
