export function buildLineExperienceUrl(
  workerUrl: string | undefined,
  ref = 'dashboard',
): string | null {
  const baseUrl = workerUrl?.trim().replace(/\/+$/, '')
  if (!baseUrl) return null

  return `${baseUrl}/auth/line?ref=${encodeURIComponent(ref)}`
}
