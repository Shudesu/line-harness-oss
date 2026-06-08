import FormSubmissionsPage from '../../form-submissions/page'
import type { ConsoleForm, ConsoleTag, FormDraft } from '../types'

export function FormsTab(_: {
  forms: ConsoleForm[]
  tags: ConsoleTag[]
  draft: FormDraft
  setDraft: (draft: FormDraft) => void
  creating: boolean
  onCreateForm: () => void
}) {
  return (
    <div className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
      <FormSubmissionsPage />
    </div>
  )
}
