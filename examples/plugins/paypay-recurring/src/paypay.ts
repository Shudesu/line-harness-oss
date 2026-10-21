import { createHash } from 'node:crypto';

const CONTENT_TYPE = 'application/json;charset=UTF-8;';

type PayPayEnvironment = 'sandbox' | 'staging' | 'production';

export interface PayPayResultInfo {
  code: string;
  message: string;
  codeId?: string;
}

export interface PayPayResponse<T> {
  resultInfo: PayPayResultInfo;
  data?: T | null;
}

export interface PayPayPaymentData {
  paymentId: string;
  merchantPaymentId: string;
  userAuthorizationId: string;
  status: string;
  acceptedAt?: number;
}

export type PayPayBindings = {
  ENVIRONMENT?: string;
  PAYPAY_API_KEY?: string;
  PAYPAY_API_SECRET?: string;
  PAYPAY_CLIENT_ID?: string;
  PAYPAY_MERCHANT_ID?: string;
  PAYPAY_ENVIRONMENT?: string;
  PAYPAY_STORE_ID?: string;
};

function payPayBindings(env: PayPayBindings): PayPayBindings {
  return env as unknown as PayPayBindings;
}

/** Never offer checkout against an unconfigured or wrong-environment merchant. */
export function isPayPayCheckoutAvailable(env: PayPayBindings): boolean {
  const bindings = payPayBindings(env);
  const runtime = (env as unknown as { ENVIRONMENT?: string }).ENVIRONMENT;
  if (!bindings.PAYPAY_API_KEY?.trim() || !bindings.PAYPAY_API_SECRET?.trim() || !bindings.PAYPAY_MERCHANT_ID?.trim()) return false;
  if (runtime === 'production') return bindings.PAYPAY_ENVIRONMENT === 'production';
  if (runtime === 'staging') return bindings.PAYPAY_ENVIRONMENT === 'sandbox' || bindings.PAYPAY_ENVIRONMENT === 'staging';
  return bindings.PAYPAY_ENVIRONMENT === 'sandbox';
}

function required(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`${name} is not configured`);
  return value.trim();
}

function baseUrl(env: PayPayBindings): string {
  const environment = required(payPayBindings(env).PAYPAY_ENVIRONMENT, 'PAYPAY_ENVIRONMENT') as PayPayEnvironment;
  if (environment === 'production') return 'https://apigw.paypay.ne.jp';
  if (environment === 'staging') return 'https://apigw.stg.paypay.ne.jp';
  if (environment === 'sandbox') return 'https://apigw.sandbox.paypay.ne.jp';
  throw new Error(`Unsupported PAYPAY_ENVIRONMENT: ${environment}`);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const decoded = atob(padded);
  return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
}

export async function createPayPayAuthorizationHeader(input: {
  apiKey: string;
  apiSecret: string;
  requestPath: string;
  method: string;
  body?: string;
  nonce?: string;
  epoch?: number;
}): Promise<string> {
  const nonce = input.nonce ?? crypto.randomUUID().replaceAll('-', '').slice(0, 16);
  const epoch = input.epoch ?? Math.floor(Date.now() / 1000);
  const hasBody = input.body !== undefined;
  const contentType = hasBody ? CONTENT_TYPE : 'empty';
  const contentHash = hasBody
    ? createHash('md5').update(`${CONTENT_TYPE}${input.body}`, 'utf8').digest('base64')
    : 'empty';
  const dataToSign = [
    input.requestPath,
    input.method.toUpperCase(),
    nonce,
    String(epoch),
    contentType,
    contentHash,
  ].join('\n');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(input.apiSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(dataToSign)));
  return `hmac OPA-Auth:${input.apiKey}:${bytesToBase64(signature)}:${nonce}:${epoch}:${contentHash}`;
}

async function payPayRequest<T>(
  env: PayPayBindings,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ response: PayPayResponse<T>; requestId: string | null; httpStatus: number }> {
  const bindings = payPayBindings(env);
  const apiKey = required(bindings.PAYPAY_API_KEY, 'PAYPAY_API_KEY');
  const apiSecret = required(bindings.PAYPAY_API_SECRET, 'PAYPAY_API_SECRET');
  const method = init.method ?? 'GET';
  const body = init.body === undefined ? undefined : JSON.stringify(init.body);
  const authorization = await createPayPayAuthorizationHeader({ apiKey, apiSecret, requestPath: path, method, body });
  const response = await fetch(`${baseUrl(env)}${path}`, {
    method,
    headers: {
      Authorization: authorization,
      ...(body ? { 'Content-Type': CONTENT_TYPE } : {}),
      ...(bindings.PAYPAY_MERCHANT_ID ? { 'X-ASSUME-MERCHANT': bindings.PAYPAY_MERCHANT_ID } : {}),
    },
    body,
  });
  const payload = await response.json<PayPayResponse<T>>().catch(() => ({
    resultInfo: { code: 'INVALID_RESPONSE', message: 'PayPay returned a non-JSON response' },
  }));
  return { response: payload, requestId: response.headers.get('X-REQUEST-ID'), httpStatus: response.status };
}

export async function createPayPayAccountLink(
  env: PayPayBindings,
  input: { nonce: string; redirectUrl: string; referenceId: string; userAgent?: string },
): Promise<string> {
  const result = await payPayRequest<{ linkQRCodeURL: string }>(env, '/v1/qr/sessions', {
    method: 'POST',
    body: {
      scopes: ['continuous_payments'],
      nonce: input.nonce,
      redirectType: 'WEB_LINK',
      redirectUrl: input.redirectUrl,
      referenceId: input.referenceId,
      ...(input.userAgent ? { userAgent: input.userAgent.slice(0, 255) } : {}),
    },
  });
  if (result.httpStatus !== 201 || !result.response.data?.linkQRCodeURL) {
    throw new Error(`PayPay account link failed: ${result.response.resultInfo.code}`);
  }
  return result.response.data.linkQRCodeURL;
}

export async function createPayPayContinuousPayment(
  env: PayPayBindings,
  input: { merchantPaymentId: string; userAuthorizationId: string; amount: number; description: string },
): Promise<{ response: PayPayResponse<PayPayPaymentData>; requestId: string | null; httpStatus: number }> {
  const bindings = payPayBindings(env);
  return payPayRequest<PayPayPaymentData>(env, '/v1/subscription/payments', {
    method: 'POST',
    body: {
      merchantPaymentId: input.merchantPaymentId,
      userAuthorizationId: input.userAuthorizationId,
      amount: { amount: input.amount, currency: 'JPY' },
      requestedAt: Math.floor(Date.now() / 1000),
      ...(bindings.PAYPAY_STORE_ID ? { storeId: bindings.PAYPAY_STORE_ID } : {}),
      orderDescription: input.description.slice(0, 255),
      paymentMethodType: 'WALLET',
    },
  });
}

export async function getPayPayPaymentDetails(
  env: PayPayBindings,
  merchantPaymentId: string,
): Promise<{ response: PayPayResponse<PayPayPaymentData>; requestId: string | null; httpStatus: number }> {
  return payPayRequest<PayPayPaymentData>(env, `/v2/payments/${encodeURIComponent(merchantPaymentId)}`);
}

export async function unlinkPayPayUser(
  env: PayPayBindings,
  userAuthorizationId: string,
): Promise<{ response: PayPayResponse<Record<string, never>>; requestId: string | null; httpStatus: number }> {
  return payPayRequest<Record<string, never>>(
    env,
    `/v2/user/authorizations/${encodeURIComponent(userAuthorizationId)}`,
    { method: 'DELETE' },
  );
}

export async function verifyPayPayResponseToken(
  env: PayPayBindings,
  token: string,
): Promise<Record<string, unknown>> {
  if (token.split('.').length !== 3) throw new Error('Invalid PayPay response token');
  const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
  if (!encodedHeader || !encodedPayload || !encodedSignature) throw new Error('Invalid PayPay response token');
  const header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(encodedHeader))) as { alg?: string; typ?: string };
  if (header.alg !== 'HS256' || header.typ !== 'JWT') throw new Error('Unexpected PayPay JWT header');
  const bindings = payPayBindings(env);
  const secret = required(bindings.PAYPAY_API_SECRET, 'PAYPAY_API_SECRET');
  const signingKey = base64UrlToBytes(secret);
  const key = await crypto.subtle.importKey('raw', signingKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    base64UrlToBytes(encodedSignature),
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
  );
  if (!valid) throw new Error('Invalid PayPay response signature');
  const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(encodedPayload))) as Record<string, unknown>;
  if (payload.iss !== 'paypay.ne.jp') throw new Error('Invalid PayPay token issuer');
  if (typeof payload.exp !== 'number' || payload.exp <= Math.floor(Date.now() / 1000)) throw new Error('Expired PayPay response token');
  // PayPay signs account-link callbacks for the client ID, not the numeric merchant ID
  // used by X-ASSUME-MERCHANT on API requests.
  const clientId = required(bindings.PAYPAY_CLIENT_ID, 'PAYPAY_CLIENT_ID');
  if (payload.aud !== clientId) throw new Error('Invalid PayPay token audience');
  return payload;
}
