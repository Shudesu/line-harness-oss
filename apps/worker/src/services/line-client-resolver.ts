import { getLineAccountById, resolveDefaultLineAccount, type LineAccount } from '@line-crm/db';
import { LineClient } from '@line-crm/line-sdk';
export type LineResolutionReason = 'account_required' | 'account_missing' | 'account_inactive' | 'token_missing' | 'lookup_failed';
const messages:Record<LineResolutionReason,string>={
 account_required:'送信元が未指定のため停止しました。送信元と配信状況を確認してください。',
 account_missing:'送信元アカウントが見つからないか、無効・未設定です。アカウント設定を確認してください。',
 account_inactive:'送信元アカウントが無効です。アカウント設定を確認してください。',
 token_missing:'送信元アカウントのトークンが未設定です。アカウント設定を確認してください。',
 lookup_failed:'送信元情報を確認できないため、処理を停止しました。時間をおいて確認してください。',
};
export class LineAccountResolutionError extends Error {
 readonly code='line_account_unresolved';
 readonly status:409|503;
 constructor(readonly reason:LineResolutionReason){super(messages[reason]);this.name='LineAccountResolutionError';this.status=reason==='lookup_failed'?503:409;}
}
export interface LineResolutionOptions { allowSoleAccount?:boolean; allowInactive?:boolean }
export function assertOperationAccount<T extends Pick<LineAccount,'id'|'is_active'|'channel_access_token'>>(account:T|null,options:LineResolutionOptions={}):T {
 if(!account?.id)throw new LineAccountResolutionError('account_missing');
 if(!options.allowInactive&&account.is_active!==1)throw new LineAccountResolutionError('account_inactive');
 if(!account.channel_access_token?.trim())throw new LineAccountResolutionError('token_missing');
 return account;
}
/** NULL means verified account-less legacy mode, never an unresolved account. */
export async function resolveOperationAccount(db:D1Database,accountId:string|null|undefined,purpose:string,options:LineResolutionOptions={}):Promise<LineAccount|null>{
 try{
  let account:LineAccount|null=null;
  if(accountId!=null){
   account=await getLineAccountById(db,accountId);
   if(!account)throw new LineAccountResolutionError('account_missing');
  }else{
   if(options.allowSoleAccount)account=await resolveDefaultLineAccount(db);
   if(!account){
    const registered=await db.prepare('SELECT id FROM line_accounts LIMIT 1').first<{id:string}>();
    if(registered)throw new LineAccountResolutionError('account_required');
    return null;
   }
  }
  return assertOperationAccount(account, options);
 }catch(error){
  const failure=error instanceof LineAccountResolutionError?error:new LineAccountResolutionError('lookup_failed');
  console.warn(`[line-token] fallback_refused purpose=${purpose} reason=${failure.reason}`);
  throw failure;
 }
}
/** Construction alone makes no request; callers still resolve per-record senders. */
export function legacyLineClient(env:{LINE_CHANNEL_ACCESS_TOKEN?:string}):LineClient{return new LineClient(env.LINE_CHANNEL_ACCESS_TOKEN??'');}
export async function resolveLineClient(db:D1Database,env:{LINE_CHANNEL_ACCESS_TOKEN?:string},accountId:string|null|undefined,purpose:string,options:LineResolutionOptions={}):Promise<LineClient>{
 const account=await resolveOperationAccount(db,accountId,purpose,options);
 if(account)return new LineClient(account.channel_access_token);
 if(!env.LINE_CHANNEL_ACCESS_TOKEN?.trim())throw new LineAccountResolutionError('token_missing');
 return legacyLineClient(env);
}
export async function resolveLineClientWithDefault(db:D1Database,defaultClient:LineClient,accountId:string|null|undefined,purpose:string,options:LineResolutionOptions={}):Promise<LineClient>{
 const account=await resolveOperationAccount(db,accountId,purpose,options);
 return account?new LineClient(account.channel_access_token):defaultClient;
}
