---
inclusion: always
---

# Accessibility, RTL & Mobile Conventions

Source of truth for accessibility, right-to-left layout, and mobile
responsiveness in the web app (`apps/web`). Read this before adding a form,
an icon button, an overlay, or any directional layout. Established in
F1.4.5.

The app is **Persian, RTL-only** (`<html lang="fa" dir="rtl">` in the root
layout). All user-facing text is Persian — there is no i18n framework yet
(multi-language is post-MVP).

---

## Forms & inputs

- Every input MUST have an accessible name: either a `<label htmlFor>`
  pointing at the input's unique `id`, or an `aria-label`. Prefer a real
  `<label>`. When the design is placeholder-only, use a `sr-only` label
  (still associated via `htmlFor`) so it stays invisible but is announced
  by screen readers **and** matched by Playwright `getByLabel`.
- Give inputs a stable `id` (e.g. `login-email`, `signup-password`). E2E
  selectors depend on these.
- Set `name` + `autoComplete` on credential fields:
  - email → `name="email" autoComplete="email"`
  - current password → `autoComplete="current-password"`
  - new password → `autoComplete="new-password"`
- Form-level error boxes carry `role="alert"` (and an `id` referenced by
  the inputs' `aria-describedby`) so errors are announced.
- Email/URL example placeholders (`you@example.com`, `https://...`) are
  language-neutral and intentionally left in Latin.

## Icon-only buttons

- Any `<button>` whose only content is an icon MUST have a Persian
  `aria-label`, and the icon itself MUST be `aria-hidden="true"`:
  ```tsx
  <button aria-label="بستن"><X aria-hidden="true" /></button>
  ```
- The standard close-button label is «بستن».

## Overlays (modals, dialogs, popovers, dropdowns, drawers)

No Radix — every overlay is hand-built (reference implementations:
`ConfirmDialog`, `NotificationsBell`). Each overlay MUST:

- Close on **Escape**.
- Close on **outside / backdrop click** (backdrop click is cancel-only,
  never confirm).
- **Trap focus** (Tab/Shift+Tab cycle inside) for modals.
- Set **initial focus** to the first interactive element (or the safest,
  e.g. Cancel for destructive confirmations).
- **Restore focus** to the trigger element when it closes.
- Expose `role="dialog"`/`"alertdialog"` + `aria-modal="true"` +
  `aria-labelledby` (and `aria-describedby` when there's body text).

## RTL — logical, not physical, directional classes

Tailwind v4 logical utilities are fully supported and are the convention.
Use them wherever a class is genuinely directional:

| Physical | Logical |
|----------|---------|
| `ml-*` / `mr-*` | `ms-*` / `me-*` |
| `pl-*` / `pr-*` | `ps-*` / `pe-*` |
| `text-left` / `text-right` | `text-start` / `text-end` |
| `left-*` / `right-*` (absolute) | `start-*` / `end-*` |

- Symmetric utilities (`mx-*`, `px-*`, `gap-*`) are direction-neutral —
  leave them alone.
- Keep an absolutely-positioned element and the padding that reserves
  space for it on the **same logical side** (e.g. a close button at
  `end-4` pairs with `pe-8` on the title).
- Dropdown panels anchor with `absolute end-0 top-full` (matches
  `NotificationsBell` / `ProfileDropdown` / `WorkspaceSwitcher`).
- Directional chevrons must point correctly in RTL.
- `dir="ltr"` is intentional on email addresses, reset tokens, slugs and
  other Latin/technical strings — do not "fix" those.
- User-generated content uses `dir="auto"` (it may be mixed-script).

## Color contrast

- Target **WCAG AA**: ≥ 4.5:1 for normal text, ≥ 3:1 for large text.
- Light surfaces (white / `gray-50`): `text-slate-400` fails — use
  `text-slate-500`/`600` for readable text. Icons that are decorative and
  `aria-hidden` are exempt.
- Dark auth/workspaces surfaces (`slate-800`/`900`): `text-slate-500`
  fails — use `text-slate-300`/`400`.

## Mobile (375px baseline)

- No unintended horizontal overflow. Full-screen wrappers get `p-4` so
  cards don't bleed to the edges; cards stay `w-full max-w-*`.
- Grids collapse to one column (`grid-cols-1 sm:grid-cols-2 …`).
- Horizontal scroll regions (board lists, tab bars) use `overflow-x-auto`.
- Modals are near-full-width with `w-full max-w-* max-h-[90vh]` and a
  scrollable body.
- The sidebar collapses to `MobileDrawer`, opened by the `md:hidden`
  burger in `TopNav`.
- Aim for touch targets ≥ 44×44px on primary controls.

## Verifying (Lighthouse / axe)

Run these locally / in CI — they need a real browser and are **NOT RUN**
in the agent sandbox (no Chromium, no `node_modules`, network is
integrations-only):

```bash
pnpm install
pnpm -F web build && pnpm -F web start   # serve on :3000
# Lighthouse (target Accessibility >= 95):
npx lighthouse http://localhost:3000/login \
  --only-categories=accessibility,best-practices --view
# repeat for /workspaces and /board/<id>
```

For automated regression, add `@axe-core/playwright` to an e2e spec and
assert zero `serious`/`critical` violations on the key pages.
