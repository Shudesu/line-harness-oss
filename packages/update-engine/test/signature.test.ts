import { describe,it,expect,vi,afterEach } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { fetchManifest } from '../src/manifest.js';
import { verifyManifestSignature, trustedReleaseKeys, signaturePolicy } from '../src/signature.js';
const pair=generateKeyPairSync('ed25519');
const publicKey=pair.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64');
const bytes=new TextEncoder().encode('{"schema_version":1,"latest":"1.0.0","releases":[]}');
const envelope={v:1,kid:'test',alg:'Ed25519',sig:sign(null,bytes,pair.privateKey).toString('base64')};
afterEach(()=>vi.unstubAllGlobals());
describe('signed manifest',()=>{
 it('verifies exact bytes with explicitly trusted keys',async()=>{
  const keys=trustedReleaseKeys('test:'+publicKey);
  expect(await verifyManifestSignature(bytes,envelope,keys)).toEqual({verified:true,kid:'test'});
  const modified=bytes.slice();modified[1]^=1;
  expect((await verifyManifestSignature(modified,envelope,keys)).verified).toBe(false);
  for(const changed of [{kid:'unknown'},{alg:'HS256'},{v:2},{sig:'bad'}])expect((await verifyManifestSignature(bytes,{...envelope,...changed},keys)).verified).toBe(false);
 });
 it('rejects malformed configuration and prototype key IDs',async()=>{
  expect(()=>trustedReleaseKeys('x:bad')).toThrow();expect(()=>signaturePolicy('required')).toThrow();
  expect((await verifyManifestSignature(bytes,{...envelope,kid:'toString'},{})).verified).toBe(false);
 });
 it('requires signature before parsing, and warn preserves unsigned releases',async()=>{
  const mock=vi.fn(async(url:string)=>url.endsWith('.sig')?new Response('',{status:404}):new Response(bytes));vi.stubGlobal('fetch',mock);
  await expect(fetchManifest('https://example.test/manifest.json',{policy:'require'})).rejects.toThrow('manifest_signature_invalid');
  expect((await fetchManifest('https://example.test/manifest.json')).latest).toBe('1.0.0');
 });
 it('checks valid signatures through fetch with appended pathname and original query',async()=>{
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.includes('.sig?')?Response.json(envelope):new Response(bytes)));
  const status=vi.fn();await fetchManifest('https://example.test/manifest.json?v=1',{policy:'require',trustedKeys:'test:'+publicKey,onSignature:status});
  expect(status).toHaveBeenCalledWith({verified:true,kid:'test'});
 });
 it('does not trust a signature key embedded in a manifest',async()=>{
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.endsWith('.sig')?Response.json({...envelope,publicKey}):new Response(bytes)));
  await expect(fetchManifest('https://example.test/manifest.json',{policy:'require'})).rejects.toThrow('manifest_signature_invalid');
 });
});
