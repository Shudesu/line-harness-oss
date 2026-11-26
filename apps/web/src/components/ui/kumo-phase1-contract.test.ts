import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const migratedFiles = [
  '../../app/staff/page.tsx',
  '../../app/auto-replies/page.tsx',
  '../../app/webhooks/page.tsx',
  '../../app/templates/page.tsx',
  '../../app/accounts/page.tsx',
  '../../app/automations/page.tsx',
  '../../app/friends/page.tsx',
  '../../app/broadcasts/page.tsx',
  '../../app/scenarios/page.tsx',
  '../../app/notifications/page.tsx',
  '../../app/page.tsx',
  '../../app/login/page.tsx',
  '../../app/pools/page.tsx',
  '../../app/conversions/page.tsx',
  '../../app/duplicates/page.tsx',
  '../../app/updates/page.tsx',
  '../../app/scoring/page.tsx',
  '../../app/inflow-links/page.tsx',
  '../../app/inflow-links/_components/edit-route-modal.tsx',
  '../../app/booking/bookings/page.tsx',
  '../../app/booking/menus/page.tsx',
  '../../app/booking/menus/staff/page.tsx',
  '../../app/booking/staff/page.tsx',
  '../../app/booking/staff/shifts/page.tsx',
  '../../app/form-submissions/page.tsx',
  '../../app/reminders/page.tsx',
  '../../app/rich-menus/page.tsx',
  '../../app/rich-menus/new/page.tsx',
  '../../app/health/page.tsx',
  '../../app/events/bookings/page.tsx',
  '../../app/scenarios/detail/scenario-detail-client.tsx',
  '../../app/affiliates/page.tsx',
  '../../app/webinars/edit/page.tsx',
  '../../app/emergency/page.tsx',
  '../../app/friend-add-settings/page.tsx',
  '../../app/users/page.tsx',
  '../layout/sidebar.tsx',
  '../auto-replies/edit-dialog.tsx',
  '../accounts/account-edit-modal.tsx',
  '../accounts/account-form-fields.tsx',
  '../accounts/account-settings-section.tsx',
  '../accounts/account-setup-urls.tsx',
  '../accounts/follower-import-button.tsx',
  '../accounts/link-base-url-setting.tsx',
  '../accounts/reorder-mode.tsx',
  '../accounts/test-recipients-setting.tsx',
  '../friends/friend-list-row.tsx',
  '../friends/friend-list-table.tsx',
  '../friends/friend-table.tsx',
  '../friends/tag-badge.tsx',
  '../broadcasts/broadcast-form.tsx',
  '../broadcasts/broadcast-detail.tsx',
  '../broadcasts/segment-builder.tsx',
  '../broadcasts/test-send-section.tsx',
  '../broadcasts/multi-account-dedup-section.tsx',
  '../broadcasts/send-confirm-dialog.tsx',
  '../inbox/inbox-filters.tsx',
  '../inbox/inbox-list.tsx',
  '../inbox/inbox-row.tsx',
  '../inbox/inbox-summary-bar.tsx',
  '../scenarios/scenario-list.tsx',
  '../scenarios/scenario-mode-picker.tsx',
  '../scenarios/schedule-input.tsx',
  '../scenarios/step-editor.tsx',
  '../scenarios/bulk-preview-modal.tsx',
  '../events/event-form.tsx',
  '../webinars/webinar-form.tsx',
  '../users/users-filters.tsx',
  '../chats/friend-info-sidebar.tsx',
  '../prompt-modal.tsx',
  '../cc-prompt-button.tsx',
  '../layout/update-banner.tsx',
  '../update/progress-modal.tsx',
  '../update/update-button.tsx',
  '../rich-menus/apply-to-tag-modal.tsx',
  '../users/user-row.tsx',
  '../users/users-table.tsx',
  '../shared/og-editor.tsx',
].map((path) => ({
  path,
  source: readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8'),
}))

describe('Kumo phase 1 migration contract', () => {
  it('migrated screens do not recreate generic native controls', () => {
    for (const file of migratedFiles) {
      expect(file.source, file.path).not.toMatch(/<(?:button|input|select|textarea|table)(?:\s|>)/)
      expect(file.source, file.path).not.toContain('confirm(')
      expect(file.source, file.path).not.toContain('#06C755')
    }
  })

  it('destructive flows use Kumo Dialog', () => {
    const destructivePages = [
      '../../app/staff/page.tsx',
      '../../app/auto-replies/page.tsx',
      '../../app/webhooks/page.tsx',
      '../../app/templates/page.tsx',
      '../../app/accounts/page.tsx',
      '../../app/automations/page.tsx',
      '../../app/broadcasts/page.tsx',
      '../../app/pools/page.tsx',
      '../../app/conversions/page.tsx',
      '../../app/booking/bookings/page.tsx',
      '../../app/booking/menus/page.tsx',
      '../../app/booking/staff/page.tsx',
      '../../app/booking/staff/shifts/page.tsx',
      '../../app/reminders/page.tsx',
      '../../app/rich-menus/page.tsx',
      '../../app/events/bookings/page.tsx',
      '../../app/scenarios/detail/scenario-detail-client.tsx',
      '../events/event-form.tsx',
      '../rich-menus/apply-to-tag-modal.tsx',
      '../broadcasts/send-confirm-dialog.tsx',
      '../scenarios/scenario-list.tsx',
    ]
    for (const file of migratedFiles.filter(({ path }) => destructivePages.includes(path))) {
      expect(file.source, file.path).toContain('@cloudflare/kumo/components/dialog')
      expect(file.source, file.path).toContain('role="alertdialog"')
    }
  })

  it('keeps the active LINE account visible in the shared shell', () => {
    const sidebar = migratedFiles.find(({ path }) => path === '../layout/sidebar.tsx')
    expect(sidebar?.source).toContain('操作中のLINEアカウント')
    expect(sidebar?.source).toContain('@cloudflare/kumo/components/dropdown')
    expect(sidebar?.source).toContain('variant="success" appearance="dot"')
    expect(sidebar?.source).toMatch(
      /<DropdownMenu\.Group>[\s\S]*<DropdownMenu\.Label>切り替えるLINEアカウント<\/DropdownMenu\.Label>[\s\S]*<\/DropdownMenu\.Group>/,
    )
  })

  it('keeps compound Kumo controls inside their required parents', () => {
    const scenarioPicker = migratedFiles.find(({ path }) => path === '../scenarios/scenario-mode-picker.tsx')
    expect(scenarioPicker?.source).toMatch(/<Radio\.Group[\s\S]*<Radio\.Item[\s\S]*<\/Radio\.Group>/)

    const broadcasts = migratedFiles.find(({ path }) => path === '../../app/broadcasts/page.tsx')
    expect(broadcasts?.source).toMatch(/<Table[\s\S]*<Table\.Header>[\s\S]*<Table\.Body>[\s\S]*<\/Table>/)
  })
})
