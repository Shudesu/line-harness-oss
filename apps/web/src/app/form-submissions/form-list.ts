export interface SortableForm {
  id: string
  name: string
  createdAt: string
  lastSubmittedAt: string | null
}

/** Convert accidental escaped line breaks and uneven whitespace into a readable title. */
export function displayFormName(name: string): string {
  return name.replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Answered forms come first, newest answer first. Unanswered forms stay at the bottom. */
export function sortFormsByLatestAnswer<T extends SortableForm>(forms: T[]): T[] {
  return [...forms].sort((a, b) => {
    if (a.lastSubmittedAt && b.lastSubmittedAt) {
      const latestDiff = new Date(b.lastSubmittedAt).getTime() - new Date(a.lastSubmittedAt).getTime()
      if (latestDiff !== 0) return latestDiff
    } else if (a.lastSubmittedAt) {
      return -1
    } else if (b.lastSubmittedAt) {
      return 1
    }

    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })
}

