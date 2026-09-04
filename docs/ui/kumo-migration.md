# Kumo migration rules

Status: Private standardization production candidate. Do not sync to the OSS repository until the gate below is approved.

Private pilot screens:

- Tags (`/tags`)
- Staff (`/staff`)
- Auto replies (`/auto-replies`, including its edit dialog)
- Webhooks (`/webhooks`, including secret rotation and deletion dialogs)
- Templates (`/templates`, while keeping LINE-specific Flex and image previews)
- Accounts (`/accounts`, including current-account visibility and nested settings)
- Automations (`/automations`, including create and destructive confirmation dialogs)
- Friends (`/friends`, including filters, pagination, and inline tag controls)
- Broadcasts (`/broadcasts`, including list, creation controls, and send/delete confirmation)
- Scenarios (`/scenarios`, including mode selection and global-scope confirmation)
- Unanswered inbox (`/notifications`, including summary, filters, and pagination)
- Shared navigation shell (including the current LINE account switcher)

Private standard screens added in the full control-panel pass:

- Dashboard and authentication (`/`, `/login`)
- Pools, conversions, duplicate analysis, scoring, and update status
- Inflow links, including route editing and destructive confirmation
- Booking operations: bookings, menus, menu staff, staff, and shifts
- Form submissions, reminders, event bookings, and health monitoring
- Rich-menu list, creation, editing shell, and tag application
- Scenario detail operations and shared user tables
- Chat search, filters, direct-message controls, and loading controls
- Friend detail tables, broadcast details, test sends, and audience segmentation
- Event configuration, webinar configuration/editing, and scenario schedule/step editors
- Affiliate reporting, affiliate creation, offer editing, and conversion approval
- Emergency actions, user filters, friend-add settings, prompt/update surfaces

## Product identity

- The Harness is the control-panel brand only.
- LINE Harness uses LINE green (`#06C755`) as its Kumo brand token.
- X Harness and Instagram Harness use their own product themes. Shared behavior must not erase product identity.
- Product names and colors belong in the shell and theme. Feature components should use semantic Kumo tokens.

## Component policy

Use granular imports such as `@cloudflare/kumo/components/button`.

Use Kumo directly for generic UI:

- `Button`, `Input`, `InputArea`, `Select`, `Checkbox`, `Radio`, `Switch`
- `Dialog`, `DropdownMenu`, `Popover`, `Tooltip`
- `Table`, `Pagination`, `Tabs`
- `Banner`, `Toasty`, `Loader`, `Empty`, `Meter`
- `Surface`, `LayerCard`, `Grid`, `Sidebar`

Keep product-specific components when Kumo does not model the workflow:

- LINE rich-menu canvas and Flex Message preview
- chat conversation layout
- scenario step editing and delivery rules
- broadcast segmentation and booking-slot generation
- image upload behavior and account switching

Those components now use Kumo controls internally while preserving their product-specific workflows.

## Intentional native-control boundary

The following interactions remain native because replacing the browser primitive would change the workflow rather than only its appearance:

- hidden file inputs used by image uploaders
- rich-menu canvas hit areas and drag/resize interactions
- the chat IME composer and full-row conversation selector
- date/time and color inputs where Kumo has no equivalent semantic control

Their surrounding actions, feedback, filters, and destructive confirmation must use Kumo. Large domain builders (event/webinar configuration, broadcast segmentation, and affiliate reporting) are migrated by feature boundary and are not allowed to introduce new ad-hoc generic controls.

## Styling rules

- Prefer Kumo semantic tokens (`text-kumo-*`, `bg-kumo-*`, `ring-kumo-*`) over raw Tailwind colors.
- Do not hard-code `#06C755` inside generic feature components. The product theme owns the brand value.
- Use Kumo variants for action hierarchy: `primary`, `secondary`, `ghost`, `destructive`, `secondary-destructive`.
- A page should have one primary action per task context.
- Use `loading` and `disabled` props instead of rebuilding loading behavior.
- Native controls are allowed only for domain-specific controls that Kumo does not provide, such as a color well or canvas interaction. Document the exception next to the component.

## Accessibility rules

- Icon-only buttons require an accessible name.
- Destructive confirmation uses `Dialog.Root role="alertdialog"`; do not use `window.confirm`.
- Inputs use `label` or an explicit `aria-label`.
- Preserve semantic table markup through the Kumo `Table` compound component.

## Migration order

1. Generic controls and feedback
2. Tables, dialogs, tabs, pagination
3. App shell and sidebar after product-theme verification (completed for LINE Harness)
4. Domain-specific editors only when that feature is actively changed

## OSS sync gate

Sync only after all of these are true in the Private repository:

- typecheck, unit tests, and production build pass
- migrated pages preserve API behavior and loading/error states
- LINE branding remains clearly identifiable
- keyboard/focus behavior has no known regression
- no deprecated Kumo API is introduced
- the pilot is approved before copying the same commit into OSS

## Shared shell rule

- The sidebar must always label the currently selected LINE account as `操作中`.
- Account switching uses Kumo `DropdownMenu`; it remains a product-specific workflow backed by `AccountContext`.
- The shell owns LINE green through `bg-kumo-brand`. Feature screens must not hard-code the brand hex value.
- X Harness and Instagram Harness will reuse the interaction pattern with their own theme tokens, not LINE green.
