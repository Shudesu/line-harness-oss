import { describe, expect, it } from 'vitest';
import { broadcastStatus } from './broadcast-status';

describe('broadcast outcome labels', () => {
  it('does not show a failed or uncertain terminal outcome as normal completion', () => {
    expect(broadcastStatus({status:'sent',lastError:'受付結果不明',failedAccountIds:null})).toEqual({label:'要確認',variant:'warning'});
    expect(broadcastStatus({status:'sent',lastError:null,failedAccountIds:['a']})).toEqual({label:'要確認',variant:'warning'});
  });
  it('shows unresolved retry failures while the queue is still sending', () => {
    expect(broadcastStatus({status:'sending',lastError:'LINE拒否',failedAccountIds:null})).toEqual({label:'送信中・要確認',variant:'warning'});
  });
  it('keeps genuine completion and editable draft labels', () => {
    expect(broadcastStatus({status:'sent',lastError:null,failedAccountIds:null})).toEqual({label:'送信完了',variant:'success'});
    expect(broadcastStatus({status:'draft',lastError:'送信元未指定',failedAccountIds:null}).label).toBe('下書き');
  });
});
