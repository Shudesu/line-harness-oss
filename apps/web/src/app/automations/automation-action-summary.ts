export interface AutomationActionSummary {
  actionCount: number
  templateReferenceCount: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Summarize persisted automation actions without trusting legacy JSON shape.
 * Older rows may contain actions with missing/null params, and one malformed
 * action must not make the entire Automations screen unusable.
 */
export function summarizeAutomationActions(actions: unknown): AutomationActionSummary {
  if (!Array.isArray(actions)) {
    return { actionCount: 0, templateReferenceCount: 0 }
  }

  const templateReferenceCount = actions.filter((action) => {
    if (!isRecord(action) || action.type !== 'send_message' || !isRecord(action.params)) {
      return false
    }
    return typeof action.params.template_id === 'string' && action.params.template_id.trim().length > 0
  }).length

  return { actionCount: actions.length, templateReferenceCount }
}
