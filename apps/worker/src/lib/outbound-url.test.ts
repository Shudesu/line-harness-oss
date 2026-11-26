import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkOutboundUrl, checkWebhookActions, runWithOutboundConfig, sendOutboundWebhook, validateOutboundUrl } from './outbound-url';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('outbound webhook destinations',()=>{
 it.each(['http://example.com','https://u:p@example.com','https://example.com:8443','https://localhost','https://LOCALHOST.','https://a.localhost','https://metadata.google.internal','https://host.lan','https://host.local','https://127.0.0.1','https://127.1','https://2130706433','https://0x7f000001','https://0177.0.0.1','https://10.0.0.1','https://172.16.0.1','https://172.31.1.1','https://192.168.1.1','https://169.254.169.254','https://100.64.0.1','https://100.127.255.254','https://0.0.0.0','https://[::]','https://[::1]','https://[fc00::1]','https://[fdff::1]','https://[fe80::1]','https://[::ffff:127.0.0.1]','https://[::ffff:192.168.0.1]','https://[::127.0.0.1]'])('rejects %s',url=>{
  expect(validateOutboundUrl(url).ok).toBe(false);
 });
 it.each(['https://example.com','https://8.8.8.8','https://172.32.0.1','https://100.128.0.1','https://[2606:4700:4700::1111]'])('accepts public destination %s',url=>{
  expect(validateOutboundUrl(url).ok).toBe(true);
 });
 it('enforces explicit ports, complete host boundaries and the current request origin',()=>{
  expect(validateOutboundUrl('https://example.com:8443',{OUTBOUND_ALLOWED_PORTS:'8443'}).ok).toBe(true);
  expect(validateOutboundUrl('https://sub.example.com',{OUTBOUND_ALLOWED_HOSTS:'*.example.com'}).ok).toBe(true);
  expect(validateOutboundUrl('https://badexample.com',{OUTBOUND_ALLOWED_HOSTS:'*.example.com'}).ok).toBe(false);
  expect(validateOutboundUrl('https://example.com',{OUTBOUND_ALLOWED_HOSTS:'*.example.com'}).ok).toBe(false);
  expect(validateOutboundUrl('https://worker.example.com/path',{REQUEST_ORIGIN:'https://worker.example.com'})).toEqual({ok:false,reason:'self_host'});
  expect(validateOutboundUrl('https://admin.example.com/path',{ADMIN_ORIGIN:'https://other.example.com, https://admin.example.com'}).ok).toBe(false);
  expect(validateOutboundUrl('https://example.com',{OUTBOUND_ALLOWED_PORTS:'oops'}).ok).toBe(false);
 });
 it('preserves warn/off compatibility and enforces configured restrictions',()=>{
  const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
  expect(checkOutboundUrl('http://example.com',{OUTBOUND_URL_POLICY:'warn'}).allowed).toBe(true);
  expect(checkOutboundUrl('http://example.com',{OUTBOUND_URL_POLICY:'enforce'}).allowed).toBe(false);
  expect(checkOutboundUrl('http://example.com',{OUTBOUND_URL_POLICY:'off'}).warnings).toEqual([]);
  expect(checkWebhookActions([{type:'send_webhook',params:{url:'http://example.com'}}],{OUTBOUND_URL_POLICY:'warn'}).warnings).toEqual(['https_required']);
  expect(JSON.stringify(warn.mock.calls)).not.toContain('example.com');
 });
 it('isolates simultaneous tenant/request policies across await boundaries',async()=>{
  vi.spyOn(console,'warn').mockImplementation(()=>{});
  const fetcher=vi.fn(async(_input:unknown,_init?:RequestInit)=>new Response(null,{status:204}));vi.stubGlobal('fetch',fetcher);
  const results=await Promise.allSettled([
   runWithOutboundConfig({OUTBOUND_URL_POLICY:'enforce'},async()=>{await Promise.resolve();return sendOutboundWebhook('http://example.com',{method:'POST'});}),
   runWithOutboundConfig({OUTBOUND_URL_POLICY:'warn'},async()=>{await Promise.resolve();return sendOutboundWebhook('http://example.com',{method:'POST'});}),
  ]);
  expect(results.map(r=>r.status)).toEqual(['rejected','fulfilled']);expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0][1]).toMatchObject({redirect:'manual',signal:expect.any(AbortSignal)});
 });
 it('does not follow redirects or expose URL secrets in transport errors',async()=>{
  const fetcher=vi.fn(async(_input:unknown,_init?:RequestInit)=>new Response(null,{status:302,headers:{Location:'https://127.0.0.1'}}));vi.stubGlobal('fetch',fetcher);
  await expect(sendOutboundWebhook('https://example.com',{method:'POST'},{OUTBOUND_URL_POLICY:'enforce'})).rejects.toThrow('HTTP 302');
  expect(fetcher).toHaveBeenCalledOnce();
  fetcher.mockRejectedValueOnce(new Error('sensitive URL https://u:p@example.com?token=secret'));
  await expect(sendOutboundWebhook('https://example.com?token=secret',{method:'POST'})).rejects.toThrow('Outbound webhook request failed or timed out');
 });
});
