export interface WebhookGateForm {
  fields: Array<{ name: string }>;
  onSubmitWebhookUrl?: string | null;
}

export interface FriendRequiredResponse {
  addFriendUrl?: string;
}

export function shouldUseWebhookGate(formDef: WebhookGateForm | null | undefined): boolean {
  return Boolean(
    formDef?.onSubmitWebhookUrl &&
      formDef.fields.some((field) => field.name === 'x_username'),
  );
}

export function parseFriendRequiredResponse(payload: unknown): FriendRequiredResponse | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const response = payload as Record<string, unknown>;
  if (response.error !== 'friend_required') return null;
  return typeof response.addFriendUrl === 'string'
    ? { addFriendUrl: response.addFriendUrl }
    : {};
}
