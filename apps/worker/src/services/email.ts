export const DEFAULT_CC = 'fixbox-biz@fixbox.jp';
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export interface SendEmailInput {
  apiKey: string;
  from: string;
  to: string | string[];
  cc?: string[];
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(input: SendEmailInput): Promise<{ id: string }> {
  const body = {
    from: input.from,
    to: Array.isArray(input.to) ? input.to : [input.to],
    cc: input.cc ?? [DEFAULT_CC],
    subject: input.subject,
    html: input.html,
    ...(input.text ? { text: input.text } : {}),
  };

  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Resend error ${res.status}: ${detail}`);
  }

  return (await res.json()) as { id: string };
}
