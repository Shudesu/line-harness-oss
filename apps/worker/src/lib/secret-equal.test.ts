import { expect, test } from 'vitest';
import { createHmac } from 'node:crypto';
import { secretEqual } from './secret-equal.js';
import { verifySignature } from '@line-crm/line-sdk';

test('credential comparison handles UTF-8, missing values and mismatches', () => {
  expect(secretEqual('日本語', '日本語')).toBe(true);
  for (const value of [undefined, '', '日本誤', 'wrong', 'x'.repeat(100)]) expect(secretEqual('日本語', value)).toBe(false);
  expect(secretEqual('', '')).toBe(false);
});
test('real LINE HMAC accepts exact bytes and rejects altered payloads and invalid encodings', async () => {
  const body = JSON.stringify({ events: [], text: '日本語' });
  const signature = createHmac('sha256', 'secret').update(body).digest('base64');
  expect(await verifySignature('secret', body, signature)).toBe(true);
  expect(await verifySignature('secret', body + ' ', signature)).toBe(false);
  expect(await verifySignature('wrong', body, signature)).toBe(false);
  for (const invalid of ['', 'x'.repeat(44), '!'.repeat(43) + '=', signature.slice(1)]) {
    expect(await verifySignature('secret', body, invalid)).toBe(false);
  }
  expect(await verifySignature('', body, signature)).toBe(false);
});
