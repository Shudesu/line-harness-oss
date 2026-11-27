import { describe, it, expect, vi } from 'vitest';
import { normalizeAutomationAction, createAutomation, updateAutomation, AutomationActionError } from '../src/automations.js';

describe('automation action compatibility', () => {
  it.each(['add_tag', 'remove_tag'])('normalizes legacy flat %s', type => {
    expect(normalizeAutomationAction({ type, tagId: 'tag-1' })).toEqual({ type, params: { tagId: 'tag-1' } });
  });
  it('preserves canonical parameters', () => {
    const action = { type: 'send_message', params: { messageType: 'text', content: 'hello' } };
    expect(normalizeAutomationAction(action)).toEqual(action);
  });
  it.each([null, { type: 'add_tag' }, { type: 'add_tag', tagId: 3 }, { type: 'add_tag', tagId: 'a', params: { tagId: 'b' } }, { type: 'unknown' }, { type: 'send_message', params: {} }])('rejects malformed action %j', action => {
    expect(() => normalizeAutomationAction(action)).toThrow(AutomationActionError);
  });
  it('rejects invalid writes before any SQL execution', async () => {
    const run = vi.fn();
    const db = { prepare: () => ({ bind: () => ({ run }) }) } as unknown as D1Database;
    await expect(createAutomation(db, { name: 'bad', eventType: 'follow', actions: [{ type: 'add_tag' }] })).rejects.toThrow(AutomationActionError);
    await expect(updateAutomation(db, 'a', { name: 'bad', actions: [{ type: 'add_tag' }] })).rejects.toThrow(AutomationActionError);
    expect(run).not.toHaveBeenCalled();
  });
});
