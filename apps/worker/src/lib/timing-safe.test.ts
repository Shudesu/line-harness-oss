import { describe, expect, it } from 'vitest';
import { timingSafeEqualBytes, timingSafeEqualString } from '@line-crm/shared';
import { verifySignature } from '@line-crm/line-sdk';

describe('timing-safe secret comparison', () => {
  it.each([['abc','abc',true],['abc','abd',false],['a','aa',false],['日本語','日本語',true],['日本語','日本誤',false],['','',false],[null,'x',false],[undefined,'x',false]])('compares %s and %s', async (a,b,expected) => {
    expect(await timingSafeEqualString(a,b)).toBe(expected);
  });
  it('compares fixed bytes and includes length in the result', () => {
    expect(timingSafeEqualBytes(new Uint8Array([1,2]),new Uint8Array([1,2]))).toBe(true);
    expect(timingSafeEqualBytes(new Uint8Array([1,2]),new Uint8Array([1,3]))).toBe(false);
    expect(timingSafeEqualBytes(new Uint8Array([1]),new Uint8Array([1,0]))).toBe(false);
  });
  it('verifies a LINE HMAC and rejects changed bodies and noncanonical base64', async () => {
    const key=await crypto.subtle.importKey('raw',new TextEncoder().encode('test-secret'),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const mac=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('body')));
    const signature=btoa(String.fromCharCode(...mac));
    expect(await verifySignature('test-secret','body',signature)).toBe(true);
    expect(await verifySignature('test-secret','changed',signature)).toBe(false);
    for(const value of ['!!!',signature+'\n',signature.slice(0,-1),'']) expect(await verifySignature('test-secret','body',value)).toBe(false);
  });
});
