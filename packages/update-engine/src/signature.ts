import { TRUSTED_RELEASE_KEYS } from './trusted-keys.js';

export type SignatureStatus = { verified: true; kid: string } | { verified: false; reason: string };
export interface SignatureOptions {
  policy?: string;
  trustedKeys?: string;
  onSignature?: (status: SignatureStatus) => void;
}
export class ManifestSignatureError extends Error {
  constructor(public readonly reason: string) { super('manifest_signature_invalid'); }
}
export function signaturePolicy(value?: string): 'warn' | 'require' {
  if (!value || value === 'warn') return 'warn';
  if (value === 'require') return 'require';
  throw new Error('invalid UPDATE_SIGNATURE_POLICY');
}
function decode(value: unknown, length: number): Uint8Array {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('invalid_base64');
  const raw = atob(value);
  if (raw.length !== length || btoa(raw) !== value) throw new Error('invalid_base64');
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
export function trustedReleaseKeys(extra?: string): Record<string, string> {
  const keys: Record<string,string> = Object.assign(Object.create(null), TRUSTED_RELEASE_KEYS);
  if (!extra) return keys;
  for (const entry of extra.split(',')) {
    const parts = entry.trim().split(':');
    if (parts.length !== 2 || !/^[a-zA-Z0-9._-]{1,80}$/.test(parts[0])) throw new Error('invalid UPDATE_TRUSTED_KEYS');
    decode(parts[1], 32);
    if (Object.hasOwn(keys,parts[0]) && keys[parts[0]] !== parts[1]) throw new Error('conflicting trusted key');
    keys[parts[0]] = parts[1];
  }
  return keys;
}
export async function verifyManifestSignature(bytes: Uint8Array, envelope: unknown, keys: Record<string,string>): Promise<SignatureStatus> {
  try {
    const value = envelope as {v?:number; alg?:string; kid?:string; sig?:string}|null;
    if (!value || value.v !== 1 || value.alg !== 'Ed25519' || typeof value.kid !== 'string') return {verified:false,reason:'invalid_envelope'};
    if (!Object.hasOwn(keys,value.kid)) return {verified:false,reason:'unknown_kid'};
    const key = await crypto.subtle.importKey('raw',decode(keys[value.kid],32) as BufferSource,'Ed25519',false,['verify']);
    const valid = await crypto.subtle.verify('Ed25519',key,decode(value.sig,64) as BufferSource,bytes as BufferSource);
    return valid ? {verified:true,kid:value.kid} : {verified:false,reason:'bad_signature'};
  } catch { return {verified:false,reason:'invalid_signature'}; }
}
/** One companion fetch, bounded time/size, no key discovery from untrusted input. */
export async function checkManifestSignature(url:string, bytes:Uint8Array, options:SignatureOptions={}):Promise<SignatureStatus> {
  const policy = signaturePolicy(options.policy);
  const keys = trustedReleaseKeys(options.trustedKeys);
  let status:SignatureStatus;
  try {
    const signatureUrl = new URL(url);
    signatureUrl.pathname += '.sig';
    const response = await fetch(signatureUrl.toString(),{cache:'no-store',signal:AbortSignal.timeout(10_000)});
    if (!response.ok) { await response.body?.cancel(); status={verified:false,reason:'signature_missing'}; }
    else {
      const body = await readBounded(response,16_384);
      status=await verifyManifestSignature(bytes,JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body)),keys);
    }
  } catch { status={verified:false,reason:'signature_unavailable'}; }
  options.onSignature?.(status);
  if (!status.verified) {
    if (policy==='require') throw new ManifestSignatureError(status.reason);
    console.warn('[update] 署名を確認できませんでした: '+status.reason);
  }
  return status;
}
export async function readBounded(response:Response,maxBytes:number):Promise<Uint8Array> {
  const reader=response.body?.getReader();
  if(!reader)throw new Error('empty response');
  const chunks:Uint8Array[]=[];let size=0;
  try {
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes)throw new Error('response too large');chunks.push(value);}
  } catch(error){await reader.cancel();throw error;} finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;
}
