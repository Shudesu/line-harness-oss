export type ManagedFormField = {
  name: string
  label: string
  type: string
  required?: boolean
  options?: string[]
  placeholder?: string
  columns?: number
  imageUrl?: string
  imageAlt?: string
}

export function normalizeFormFields(fields: ManagedFormField[] | string | null | undefined): ManagedFormField[] {
  if (Array.isArray(fields)) return fields
  try {
    const parsed = JSON.parse(fields || '[]') as ManagedFormField[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function slugFieldName(value: string, fallback: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^\w]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return slug || fallback
}

export function parseFormOptions(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function buildFormUrl(liffBaseUrl: string, formId: string) {
  const base = liffBaseUrl.trim()
  if (!base) return `/?page=form&id=${encodeURIComponent(formId)}`
  const separator = base.includes('?') ? '&' : '?'
  return `${base}${separator}page=form&id=${encodeURIComponent(formId)}`
}

export function buildDirectFormUrl(workerBaseUrl: string, formId: string) {
  const base = workerBaseUrl.trim().replace(/\/+$/, '')
  if (!base) return `/form/${encodeURIComponent(formId)}`
  return `${base}/form/${encodeURIComponent(formId)}`
}
