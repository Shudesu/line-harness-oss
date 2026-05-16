export interface GmailLabel {
  id: string;
  name: string;
  type?: string;
}

export interface GmailMessageSummary {
  id: string;
  threadId?: string;
}

export interface GmailMessageText {
  id: string;
  threadId?: string;
  labelIds: string[];
  internalDate?: string;
  text: string;
}

export class GoogleGmailClient {
  constructor(private readonly config: { accessToken: string }) {}

  async listLabels(): Promise<GmailLabel[]> {
    const json = await this.request<{ labels?: GmailLabel[] }>('https://gmail.googleapis.com/gmail/v1/users/me/labels');
    return json.labels ?? [];
  }

  async listMessages(input: { labelIds: string[]; q?: string | null; maxResults?: number }): Promise<GmailMessageSummary[]> {
    const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
    for (const labelId of input.labelIds) url.searchParams.append('labelIds', labelId);
    if (input.q?.trim()) url.searchParams.set('q', input.q.trim());
    url.searchParams.set('maxResults', String(Math.min(Math.max(input.maxResults ?? 10, 1), 50)));
    const json = await this.request<{ messages?: GmailMessageSummary[] }>(url.toString());
    return json.messages ?? [];
  }

  async getMessageText(messageId: string): Promise<GmailMessageText> {
    const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}`);
    url.searchParams.set('format', 'full');
    const json = await this.request<{
      id: string;
      threadId?: string;
      labelIds?: string[];
      internalDate?: string;
      payload?: GmailPayloadPart;
    }>(url.toString());
    return {
      id: json.id,
      threadId: json.threadId,
      labelIds: json.labelIds ?? [],
      internalDate: json.internalDate,
      text: extractText(json.payload),
    };
  }

  async modifyLabels(messageId: string, input: { addLabelIds?: string[]; removeLabelIds?: string[] }): Promise<void> {
    await this.request(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/modify`,
      {
        method: 'POST',
        body: JSON.stringify({
          addLabelIds: input.addLabelIds ?? [],
          removeLabelIds: input.removeLabelIds ?? [],
        }),
      },
    );
  }

  private async request<T>(url: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Gmail API error ${res.status}: ${body}`);
    }
    return res.json() as Promise<T>;
  }
}

interface GmailPayloadPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPayloadPart[];
}

function extractText(payload?: GmailPayloadPart): string {
  if (!payload) return '';
  const candidates: string[] = [];
  collectTextParts(payload, candidates);
  return candidates.join('\n\n').trim();
}

function collectTextParts(part: GmailPayloadPart, out: string[]): void {
  if (part.mimeType === 'text/plain' && part.body?.data) {
    out.push(decodeBase64Url(part.body.data));
    return;
  }
  if (part.mimeType === 'text/html' && part.body?.data && out.length === 0) {
    out.push(stripHtml(decodeBase64Url(part.body.data)));
  }
  for (const child of part.parts ?? []) collectTextParts(child, out);
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}
