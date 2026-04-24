export const DEFAULT_CC = 'fixbox-biz@fixbox.jp';

export interface SendEmailInput {
  webhookUrl: string;
  secret: string;
  to: string | string[];
  cc?: string[];
  subject: string;
  html: string;
}

export async function sendEmail(input: SendEmailInput): Promise<{ ok: true }> {
  const body = {
    secret: input.secret,
    to: Array.isArray(input.to) ? input.to : [input.to],
    cc: input.cc ?? [DEFAULT_CC],
    subject: input.subject,
    html: input.html,
  };

  const res = await fetch(input.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
    redirect: 'follow',
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`GAS mail error ${res.status}: ${detail}`);
  }

  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (json.error) {
    throw new Error(`GAS mail rejected: ${json.error}`);
  }
  return { ok: true };
}
