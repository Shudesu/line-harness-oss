export interface WebhookGateForm {
  fields: Array<{ name: string }>;
  onSubmitWebhookUrl?: string | null;
}

export function shouldUseWebhookGate(formDef: WebhookGateForm | null | undefined): boolean {
  return Boolean(
    formDef?.onSubmitWebhookUrl &&
      formDef.fields.some((field) => field.name === 'x_username'),
  );
}
