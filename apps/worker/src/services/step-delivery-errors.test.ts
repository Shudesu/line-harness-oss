import { describe, expect, it, vi } from 'vitest';
import { describeStepDeliveryError, recordStepDeliveryError } from './step-delivery-errors.js';

describe('step delivery diagnostics', () => {
  it('records quota classification without the API response body', () => {
    const error = new Error('LINE API error: 429 Too Many Requests — {"message":"You have reached your monthly limit.","to":"private-user","token":"secret"}');
    const result = describeStepDeliveryError(error);
    expect(result).toMatchObject({ reason: 'monthly_message_limit', httpStatus: 429 });
    expect(JSON.stringify(result)).not.toMatch(/private-user|secret/);
  });
  it('captures schema identifier without arbitrary error values', () => {
    expect(describeStepDeliveryError(new Error('D1_ERROR: no such column: link_key; secret private-value')).reason).toBe('no such column: link_key');
    expect(describeStepDeliveryError(new Error('customer@example.com secret')).reason).toBe('unexpected_error');
  });
  it('deduplicates by enrollment and never queues an external notification', async () => {
    const run = vi.fn().mockResolvedValue({});
    const bind = vi.fn().mockReturnValue({ run });
    const prepare = vi.fn().mockReturnValue({ bind });
    await recordStepDeliveryError({ prepare } as unknown as D1Database, 'fs-1', new Error('fetch failed'));
    expect(prepare.mock.calls[0][0]).toContain('ON CONFLICT(id) DO UPDATE');
    expect(prepare.mock.calls[0][0]).toContain("'internal', 'failed'");
    expect(bind.mock.calls[0][0]).toBe('step-delivery-error:fs-1');
    expect(bind.mock.calls[0][3]).toBeNull();
  });
  it('stores the delivery account on both the insert and the update path', async () => {
    const run = vi.fn().mockResolvedValue({});
    const bind = vi.fn().mockReturnValue({ run });
    const prepare = vi.fn().mockReturnValue({ bind });
    await recordStepDeliveryError({ prepare } as unknown as D1Database, 'fs-1', new Error('fetch failed'), 'account-a');
    expect(prepare.mock.calls[0][0]).toMatch(/metadata, line_account_id\)/);
    expect(prepare.mock.calls[0][0]).toContain('line_account_id=excluded.line_account_id');
    expect(bind.mock.calls[0][3]).toBe('account-a');
  });
  it('does not fail delivery processing when diagnostic storage fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(recordStepDeliveryError({ prepare() { throw new Error('offline'); } } as unknown as D1Database, 'fs-1', null)).resolves.toBeUndefined();
    log.mockRestore();
  });
});
