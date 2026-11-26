/** Operator-controlled compatibility for already published form URLs.
 * Never infer this from client input, form age, or a wildcard. New forms
 * continue to use the LINE-first gate flow unless explicitly listed. */
export function allowsLegacyXForm(configuredIds: string | undefined, formId: string): boolean {
  return Boolean(formId) && (configuredIds ?? '').split(',').map(id => id.trim()).filter(Boolean).includes(formId);
}
