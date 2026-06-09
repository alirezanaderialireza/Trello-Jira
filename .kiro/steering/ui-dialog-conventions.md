---
inclusion: always
---

# UI Dialog & Confirmation Conventions

Source of truth for confirmation UX and the board-header star control.
Read this before adding any "are you sure?" interaction or a native
browser dialog.

---

## No native browser dialogs

`window.confirm`, `window.alert`, and `window.prompt` are **banned** in
the web app. They are unstyled, untranslatable, not RTL-aware, and break
focus management.

- A **confirmation** ("are you sure?") → use the shared
  `ConfirmDialog` (`apps/web/src/components/ui/ConfirmDialog.tsx`).
- An **informational message** (success / error / info) → use a Persian
  `sonner` toast (`toast.success` / `toast.error` / `toast.info`).

> ✅ **F1.4.4** removed the last raw dialogs. The audit (separate globs
> per extension — note `rg "...{ts,tsx}"` brace expansion silently
> matches nothing in this toolchain) found **8** sites, not the 1 that a
> faulty earlier grep reported:
> board delete (`BoardSettingsDropdown`), board archive (`DangerTab`),
> board member remove (`MembersTab`, `BoardMembersPanel`), workspace
> leave (`DangerZone`), workspace member remove (`MembersTable`),
> invitation revoke (`PendingInvitationsList`), and two `alert()` calls
> in `create-card-form`. All now use `ConfirmDialog` / Persian toasts.

## `ConfirmDialog` contract

Bespoke (no Radix — the repo has zero `@radix-ui` deps; every dialog is
hand-built). a11y contract:

- `role="alertdialog"` + `aria-modal`, labelled by the title and
  described by the optional description.
- Initial focus lands on **Cancel** (safe default for destructive
  actions); Tab / Shift+Tab are trapped inside the dialog.
- **Escape** and a **backdrop click** both invoke `onCancel` — never
  `onConfirm`. Confirmation must be deliberate.
- On close, focus is restored to the element that opened the dialog.
- `variant="danger"` → red confirm button; `isPending` disables both
  buttons and swaps the confirm label to «در حال انجام...».

### Rendering inside tables

`ConfirmDialog` renders a fixed-position `<div>`, which is **not** a
valid child of a `<tr>`. For per-row confirmations in a table, lift the
"which row is targeted" state up to the parent table component and render
a single `ConfirmDialog` there (mirrors the existing
`TransferOwnershipDialog` / `transferTarget` pattern). Row components
that live inside a `<div>` list (e.g. board `MembersTab`) may render the
dialog inline.

Existing **type-the-name-to-confirm** dialogs (`DeleteWorkspaceDialog`,
`DeleteBoardDialog`, `DeleteChecklistDialog`, `DeleteLabelDialog`) are a
deliberately stronger pattern for high-blast-radius deletes and are left
as-is — `ConfirmDialog` is for the lighter "are you sure?" cases.

## Board header star button

`BoardStarButton`
(`apps/web/src/features/board/components/BoardStarButton.tsx`) is the
board-page header affordance for starring (the sidebar `BoardLink` was
previously the only place to toggle). It is self-contained: derives the
flag from `userBoardMetadata.getStarred`, flips optimistically on click,
rolls back + toasts on error, and on settle invalidates both
`getStarred` and `sidebar.bootstrap`. It sits on the start side of the
header, grouped with `ConnectionStatusBanner`. `aria-label` /
`aria-pressed` are Persian.
