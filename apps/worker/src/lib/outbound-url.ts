import { AsyncLocalStorage } from 'node:async_hooks';

export interface OutboundConfig {
  OUTBOUND_URL_POLICY?: string;
  OUTBOUND_ALLOWED_PORTS?: string;
  OUTBOUND_ALLOWED_HOSTS?: string;
  WORKER_URL?: string;
  WORKER_PUBLIC_URL?: string;
  ADMIN_ORIGIN?: string;
  ADMIN_PUBLIC_URL?: string;
  REQUEST_ORIGIN?: string;
}
const context = new AsyncLocalStorage<Readonly<OutboundConfig>>();
/** Only public policy values enter async context; never credentials or payloads. */
export function runWithOutboundConfig<T>(env: OutboundConfig, action: () => T, requestOrigin?: string): T {
  return context.run(Object.freeze({ OUTBOUND_URL_POLICY:env.OUTBOUND_URL_POLICY, OUTBOUND_ALLOWED_PORTS:env.OUTBOUND_ALLOWED_PORTS, OUTBOUND_ALLOWED_HOSTS:env.OUTBOUND_ALLOWED_HOSTS, WORKER_URL:env.WORKER_URL, WORKER_PUBLIC_URL:env.WORKER_PUBLIC_URL, ADMIN_ORIGIN:env.ADMIN_ORIGIN, ADMIN_PUBLIC_URL:env.ADMIN_PUBLIC_URL, REQUEST_ORIGIN:requestOrigin }), action);
}
export function getOutboundConfig(): Readonly<OutboundConfig> { return context.getStore() ?? {}; }
export function outboundUrlPolicy(env: OutboundConfig): 'warn' | 'enforce' | 'off' {
  const policy=env.OUTBOUND_URL_POLICY?.trim().toLowerCase();
  return !policy || policy==='warn' ? 'warn' : policy==='off' ? 'off' : 'enforce';
}
function hostname(value:string):string { return value.toLowerCase().replace(/\.+$/,''); }
function privateV4(parts:number[]):boolean {
  const [a,b]=parts;
  return a===0 || a===10 || a===127 || a>=224 || (a===172&&b>=16&&b<=31) || (a===192&&b===168) || (a===169&&b===254) || (a===100&&b>=64&&b<=127);
}
function privateV6(raw:string):boolean {
  const value=raw.replace(/^\[|\]$/g,'');
  const halves=value.split('::');
  const left=halves[0]?halves[0].split(':'):[];
  const right=halves.length===2&&halves[1]?halves[1].split(':'):[];
  const parts=halves.length===2?[...left,...Array(8-left.length-right.length).fill('0'),...right]:left;
  const words=parts.map(v=>parseInt(v,16));
  if(words.length!==8||words.some(v=>!Number.isFinite(v)))return true;
  if(words.every(v=>v===0)||(words.slice(0,7).every(v=>v===0)&&words[7]===1))return true;
  if((words[0]&0xfe00)===0xfc00||(words[0]&0xffc0)===0xfe80||(words[0]&0xff00)===0xff00)return true;
  if(words.slice(0,5).every(v=>v===0)&&(words[5]===0xffff||words[5]===0)){
    return privateV4([words[6]>>>8,words[6]&255,words[7]>>>8,words[7]&255]);
  }
  return false;
}
export type OutboundUrlResult = {ok:true;url:URL}|{ok:false;reason:string};
export function validateOutboundUrl(raw:unknown, env:OutboundConfig={}):OutboundUrlResult {
  const reject=(reason:string):OutboundUrlResult=>({ok:false,reason});
  if(typeof raw!=='string'||!raw.trim())return reject('url_required');
  let url:URL;try{url=new URL(raw);}catch{return reject('invalid_url');}
  if(url.protocol!=='https:')return reject('https_required');
  if(url.username||url.password)return reject('credentials_not_allowed');
  const ports=(env.OUTBOUND_ALLOWED_PORTS??'').split(',').map(x=>x.trim()).filter(Boolean);
  if(ports.some(p=>!/^\d+$/.test(p)||Number(p)<1||Number(p)>65535))return reject('invalid_allowed_ports');
  if(url.port&&!new Set(ports.map(p=>String(Number(p)))).has(url.port))return reject('port_not_allowed');
  const host=hostname(url.hostname);
  if(!host||host.includes('..'))return reject('invalid_hostname');
  if(['localhost','local','internal','lan'].some(s=>host===s||host.endsWith('.'+s)))return reject('private_hostname');
  if(/^\d+\.\d+\.\d+\.\d+$/.test(host)&&privateV4(host.split('.').map(Number)))return reject('non_public_address');
  if(!host.includes('.')&&!host.startsWith('['))return reject('private_hostname');
  if(host.startsWith('[')&&privateV6(host))return reject('non_public_address');
  const own=[env.WORKER_URL,env.WORKER_PUBLIC_URL,env.ADMIN_ORIGIN,env.ADMIN_PUBLIC_URL,env.REQUEST_ORIGIN]
    .flatMap(v=>v?.split(/[\s,]+/).filter(Boolean)??[]).flatMap(v=>{try{return [hostname(new URL(v).hostname)];}catch{return [];}});
  if(own.includes(host))return reject('self_host');
  if(env.OUTBOUND_ALLOWED_HOSTS?.trim()){
    let allowed=false;
    for(const rawEntry of env.OUTBOUND_ALLOWED_HOSTS.split(',').map(v=>v.trim()).filter(Boolean)){
      const wildcard=rawEntry.startsWith('*.');const entry=wildcard?rawEntry.slice(2):rawEntry;
      if(/[\s/@?#*]/.test(entry)||(entry.includes(':')&&!(entry.startsWith('[')&&entry.endsWith(']'))))return reject('invalid_allowed_hosts');
      let normalized:string;try{normalized=hostname(new URL('https://'+entry).hostname);}catch{return reject('invalid_allowed_hosts');}
      if(host===normalized&&!wildcard || wildcard&&host.endsWith('.'+normalized))allowed=true;
    }
    if(!allowed)return reject('host_not_allowed');
  }
  return {ok:true,url};
}
export function checkOutboundUrl(raw:unknown,env:OutboundConfig=getOutboundConfig()):{allowed:boolean;url:string;warnings:string[]} {
  const policy=outboundUrlPolicy(env);
  if(policy==='off')return {allowed:true,url:String(raw??''),warnings:[]};
  const result=validateOutboundUrl(raw,env);
  if(result.ok)return {allowed:true,url:result.url.href,warnings:[]};
  if(policy==='warn')console.warn(`[outbound-url] would_block reason=${result.reason}`);
  return {allowed:policy==='warn',url:typeof raw==='string'?raw:'',warnings:[result.reason]};
}
export function checkWebhookActions(actions:unknown,env:OutboundConfig):{allowed:boolean;warnings:string[]} {
  if(!Array.isArray(actions))return {allowed:false,warnings:['actions_must_be_array']};
  const warnings:string[]=[];let allowed=true;
  for(const action of actions){
    if(!action||typeof action!=='object'||Array.isArray(action)||typeof action.type!=='string')return {allowed:false,warnings:['invalid_action']};
    if(action.type==='send_webhook'){
      const result=checkOutboundUrl(action.params?.url,env);allowed&&=result.allowed;warnings.push(...result.warnings);
    }
  }
  return {allowed,warnings:[...new Set(warnings)]};
}
export async function sendOutboundWebhook(raw:string,init:RequestInit,env:OutboundConfig=getOutboundConfig()):Promise<Response> {
  const decision=checkOutboundUrl(raw,env);
  if(!decision.allowed)throw new Error('webhook_url_invalid: '+decision.warnings[0]);
  let response:Response;
  try { response=await fetch(decision.url,{...init,redirect:'manual',signal:AbortSignal.timeout(10_000)}); }
  catch { throw new Error('Outbound webhook request failed or timed out'); }
  // Never persist a response body or URL (which may contain credentials/query tokens).
  await response.body?.cancel().catch(()=>{});
  if(!response.ok)throw new Error(`Outbound webhook returned HTTP ${response.status}`);
  return response;
}
