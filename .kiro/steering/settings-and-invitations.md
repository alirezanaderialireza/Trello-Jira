---
title: Settings & Invitations
inclusion: always
---

# Settings & Invitations Conventions

Architecture and UX rules established by F5a for workspace-settings
pages, the invitation accept flow, the outbox-worker handler
registry, and the Persian email templates. Apply to every change
inside:

- `apps/web/src/app/(app)/workspaces/[slug]/settings/**`
- `apps/web/src/app/invitations/**`
- `apps/web/src/features/settings/**`
- `apps/web/src/features/invitation/**`
- `apps/outbox-worker/src/handlers/**`
- `packages/infrastructure/src/email/templates/**`

---

## 1. Settings layout role gate

The `workspaces/[slug]/settings/layout.tsx` is the SINGLE place where
role-based access to the settings tree is enforced. It runs as a
Server Component, calls `v1.public.workspace.getBySlug({ slug })`,
then redirects on failure:

| State | Outcome |
|---|---|
| No session | `redirect("/login?callbackUrl=...")` (defensive — middleware already guards `(app)/*`) |
| `getBySlug` throws (NOT_FOUND / FORBIDDEN) | `redirect("/workspaces")` |
| Role is `MEMBER` | `redirect("/workspaces/[slug]")` |
| Role is `OWNER` or `ADMIN` | render |

Per-tab finer gates (e.g. delete is OWNER-only) live INSIDE the tab
page and the relevant component, not in the layout. This keeps the
layout role check a single 1-of-3 redirect.

Do NOT re-implement the role gate inside individual tab pages.
Server Components inside the settings tree may re-fetch
`getBySlug` for their own data needs (the React request memoization
+ Server Component caching make the duplicate cheap), but the
redirect is the layout's job.

## 2. Server Action prop pattern (features ↔ app)

Same Lesson F4 rule applies: features cannot import from `app/*`.
Settings tab pages live in the `app` boundary; their feature
components live in `features/settings/workspace/`. To wire a Server
Action from the action shelf into a feature component:

1. Server Action lives in `app/(app)/_actions/<name>.ts` with
   `"use server"`.
2. Feature component declares a structural prop type for the
   action. Do NOT `import type` from the action file — keep the
   feature's contract self-contained.
3. The page (in `app`) imports the action and passes it as a prop.

Example:

```tsx
// features/settings/workspace/GeneralForm.tsx
export type UpdateWorkspaceAction = (input: { ... }) => Promise<{ ok: boolean; ... }>;

export function GeneralForm({ onSubmit, ...rest }: { onSubmit: UpdateWorkspaceAction; ... }) {
  // ...
}
```

```tsx
// app/(app)/workspaces/[slug]/settings/general/page.tsx
import { updateWorkspaceAction } from "../../../../_actions/updateWorkspace";
import { GeneralForm } from "@/features/settings/workspace/GeneralForm";

return <GeneralForm onSubmit={updateWorkspaceAction} ... />;
```

The boundaries linter flags any direct `@/app/*` import inside
`features/`. Fix by hoisting the action up to a page or layout.

## 3. Server Action result contract

Every workspace-settings Server Action returns a discriminated
`{ ok: boolean; error?: string; ... }` result, never throws.
Persian error messages come from the upstream tRPC procedure
verbatim (the F3a routers already produce them). The action wraps
the call and:

- Surfaces the procedure's Persian message on `err.message` (capped
  at 200 chars).
- Falls back to a generic Persian message for unknown error shapes.
- Calls `revalidatePath("/", "layout")` on success so the (app)
  layout's bootstrap fetch refreshes the sidebar.

This contract lets callers (forms / modals) write straightforward
`if (result.ok) { toast.success(...) } else { toast.error(result.error) }`
without parsing exceptions.

Special-case: `acceptInvitation` adds `isEmailMismatch?: boolean`
detected by Persian substring match (the procedure does not return
a structured failure code). The card UI uses this flag to swap the
accept button for a sign-out CTA. If a future API change rewords
the EMAIL_MISMATCH message, update both the substring matcher in
`acceptInvitation.ts` AND the corresponding test.

## 4. Type-name-to-confirm pattern (D7)

Destructive actions (currently: workspace delete) require the user
to type the resource name into a free-text input. The match is:

- Case-insensitive (`toLocaleLowerCase("fa")` — Persian collation
  is needed for letter-form variants).
- Whitespace-trimmed on both sides.

Submit stays disabled until the typed value matches. A select-able
preformatted block shows the expected name verbatim above the input
so the user can copy-paste if the keyboard layout fights them. Use
`select-all` + `font-mono` Tailwind utilities so RTL/LTR mixing
reads naturally.

## 5. Grace-window toast (D6)

After a successful soft-delete, fire a sonner toast with:

```tsx
toast(`فضای کاری «${name}» حذف شد.`, {
  duration: 10_000,
  action: { label: "بازگردانی", onClick: async () => { ... } },
});
router.push("/workspaces");
```

The 10-second duration is intentionally short — the server has its
own 30-day grace before hard-delete; the toast is purely UX. The
toast survives navigation because `<Toaster />` lives at the root
layout. When the toast's action fires, it calls the restore Server
Action and navigates back to the settings page on success.

Do not block the redirect waiting for the user to dismiss the
toast — the user no longer has access to the just-deleted
workspace, so leaving them on the settings page would be a confusing
404-on-next-click.

## 6. Public invitation route (`/invitations/[token]`)

Invitation accept lives at the ROOT level (not inside `(app)/`)
because logged-out users land here from email deep-links. The
middleware whitelist allows it through:

```ts
const PUBLIC_PAGE_PREFIXES = ["/invitations/"];
```

Distinct from `AUTH_PAGES`:

| List | Logged out | Logged in |
|---|---|---|
| `AUTH_PAGES` (login / signup / …) | passes through | redirects to /workspaces |
| `PUBLIC_PAGE_PREFIXES` (/invitations/) | passes through | passes through |

The page renders an `AcceptInvitationCard` that branches on auth
state + invitation state (revoked / expired / already-accepted /
logged-out / accept-button / email-mismatch-recovery). All six
states are exhaustive — handle a new invitation flag with a new
branch, not by combining flags.

When adding a new public-but-auth-aware route, add its prefix to
`PUBLIC_PAGE_PREFIXES` and document it in this section.

## 7. Outbox-worker handler registry

Per-event-type side-effect handlers live in
`apps/outbox-worker/src/handlers/`. The flow inside `processClaimed`:

1. `redis.publish(channel, message)` — existing realtime fan-out.
2. `getEventHandler(row.type)` — registry lookup.
3. If a handler exists, `await handler({ tx, event: row })`.
4. `UPDATE outbox_events SET processed_at = NOW()` — mark done.

A handler that throws causes a normal retry (`retry_count++`); the
row eventually goes to the DLQ if retries exhaust. Handlers run
INSIDE the claim transaction, so any DB queries they make
participate in the same crash-consistent unit.

Adding a new handler:

1. Create `handlers/<eventType>.handler.ts`.
2. Export a function matching `EventHandler` from `../types`.
3. Register in `handlers/index.ts` by adding one line to the static
   `HANDLERS` map.

Idempotency: handlers are at-least-once. External side-effects
(emails, webhooks, …) may execute more than once on retry. For
F5a, this is acceptable for the invitation email — duplicate sends
are annoying but not catastrophic. Future PRs that add more
side-effects should add an idempotency marker (e.g.
`workspace_invitations.email_sent_at`) and skip re-sending on
retry.

RLS context: handlers query `workspaces`, `workspace_invitations`,
and `users` directly. These tables are NOT under ROW LEVEL
SECURITY — only board tables are. Do NOT add `SET LOCAL
app.current_tenant_id` for these; if a future migration enables
RLS on a workspace-scoped table the worker queries, the
appropriate fix is to switch the worker connection to the
`app_service` BYPASSRLS role rather than scattering GUC sets across
handlers.

## 8. Persian email template structure

Templates live in `packages/infrastructure/src/email/templates/`,
one file per template, exporting a Params type plus `*Subject`,
`*Html`, and `*Text` functions. Re-export from `email/index.ts`.

Required conventions:

- `escapeHtml()` from `_shared.ts` for every user-controlled value
  interpolated into HTML.
- `wrapHtmlBody()` for the outer layout — gives consistent
  Persian-friendly font fallback (Tahoma / Vazirmatn) and table-
  based RTL chrome that survives Gmail / Outlook / Yahoo
  rendering.
- Date formatting is the CALLER's responsibility. Templates accept
  pre-formatted strings (`expiresAtFormatted`) so
  `@repo/infrastructure` stays free of `dayjs` / `jalaliday` and
  remains usable from both Node (worker) and Next.js.
- Text fallback mandatory — spam-filter scoring + accessibility.

## 9. Tab navigation (`SettingsTabs`)

Tabs are a Client Component because they need `usePathname()` to
highlight the active tab. The Server Component layout renders the
component once with the `slug` and `role`. Tabs render
unconditionally — per-tab role gates live inside each tab's page
and components, not in the tab nav.

Tab href: `/workspaces/[slug]/settings/<segment>`. Active match
allows `pathname === href` OR `pathname.startsWith(href + "/")`
so future nested routes (e.g. `/settings/members/[userId]`) keep
the parent tab highlighted.

## 10. Cross-feature import boundary

`features/invitation/` and `features/settings/` are sibling features
under the boundaries linter — they cannot import from each other.
Persian role labels (مالک / مدیر / عضو) are duplicated in each
feature that needs them rather than imported from
`features/shell/lib/roleLabels.ts`. When moving a label set into
shared territory, hoist it to `apps/web/src/lib/` (which the
boundaries linter classifies as `shared`).



# Board Settings Drawer Conventions (F5b)

Architecture and UX rules established by F5b for the board-level
settings drawer. Apply to every change inside:

- `apps/web/src/app/board/[boardId]/_components/`
- `apps/web/src/app/board/[boardId]/_actions/`
- `apps/web/src/features/board-settings/**`
- `packages/api/src/routers/board-management.ts` (where the
  `getBoardSettings` procedure lives)

## 11. Drawer URL state

The board settings drawer's open/close + active tab live in a
single URL query param: `?settings=<tab>`. Five valid values:
`about`, `members`, `background`, `permissions`, `danger`. Anything
else is treated as "drawer closed".

Why URL state (not React state):
- Share-able links to a specific tab.
- Back / forward navigation cleanly returns to the previous tab.
- Refresh preserves the open drawer.
- The trigger button is a one-line URL update — no global drawer
  context.

The wrapper (`BoardSettings.tsx`) owns the param and uses
`router.replace` (not `push`) for tab switches so each switch
isn't a separate history entry — only open / close transitions
count.

When adding a new param to the board page that might collide with
`settings`, namespace it (e.g. `?card=...`). Both params can
coexist because the wrapper preserves all other params via
`URLSearchParams.toString()`.

## 12. Server Action prop bag pattern

The board page imports all 10 board-settings Server Actions and
groups them into a single `BOARD_SETTINGS_ACTIONS` const at module
scope:

```ts
const BOARD_SETTINGS_ACTIONS = {
  onRename: renameBoardAction,
  onArchive: archiveBoardAction,
  // ...
} as const;
```

The bag is passed as a single `actions` prop to `<BoardSettings>`,
which forwards it to the drawer, which destructures into per-tab
props. This keeps the drawer's surface narrow (one prop) and the
page's wiring obvious (one literal).

The bag MUST be defined at module scope (not inside the page
component) so the action references are stable across renders.
React's prop-comparison would otherwise flag a "new function
identity per render" and re-mount tab components.

## 13. CSS variable preview pattern

Live-preview UX (hover a swatch -> board background updates in
real time) is implemented via a single `--board-bg` CSS custom
property on `document.body`:

| Step | Actor | Effect |
|---|---|---|
| First paint | `<main style={{ background: 'var(--board-bg, <persistedCss>)' }}>` | SSR uses the persisted CSS as the var() fallback — no flash. |
| Hydration | `<BoardBackgroundController initialCss={...}>` | Sets `--board-bg` on body to the persisted CSS. |
| Hover swatch | `BackgroundTab` `onMouseEnter` | Writes `--board-bg` = preview CSS. |
| Hover leave | `BackgroundTab` `onMouseLeave` | Restores `--board-bg` = persistedRef.current. |
| Click commit | `BackgroundTab` `onClick` | Calls setBackgroundAction, updates persistedRef. |
| Tab unmount / drawer close | `BackgroundTab` cleanup | Restores `--board-bg` = persistedRef.current. |
| Page navigation | `BoardBackgroundController` cleanup | Removes `--board-bg` from body. |

The variable name is single-sourced from
`features/board-settings/lib/applyBackground.ts` as
`BOARD_BG_CSS_VAR`. NEVER hardcode `--board-bg` elsewhere — import
the constant.

Why this beats Context lifting: the preview path crosses three
component layers (BackgroundTab -> drawer -> page main).
Threading state through props or context would require every
intermediate to forward it. The CSS variable is observable
globally without instrumenting the path.

## 14. Background data persistence (token-based)

Backgrounds are stored as a tiny JSON object in `boards.background_data`:

```json
{ "type": "color", "id": "blue" }
{ "type": "gradient", "id": "sunset" }
```

The DB column has only a "must be a JSON object" CHECK — no Zod
schema, no shape enforcement at the persistence layer. The token
resolver `renderBackgroundCss` lives in
`features/board-settings/lib/applyBackground.ts` and is the SINGLE
place that turns a token into a CSS value.

Resilience to legacy / corrupted rows: `renderBackgroundCss`
defensively type-guards via `isBackgroundData` before lookup;
unknown shapes fall back to `DEFAULT_BACKGROUND_CSS` (matching the
pre-F5b hardcoded `bg-blue-600`). This is why the live preview's
revert path can safely use `persistedRef.current` even if the
persisted JSONB is malformed — the resolver always returns a
valid CSS string.

Adding a new preset: edit `backgroundPresets.ts` (add to
`COLOR_PRESETS` or `GRADIENT_PRESETS`). Existing boards keep
working because they reference stable ids — no migration needed.

## 15. Boards have a workspace-member-first invariant

Inviting a user to a board only works when they are already a
member of the parent workspace (enforced by the
`addBoardMember` domain use case via
`assertTargetIsWorkspaceMember`). The MembersTab invite picker
therefore:

1. Reads `workspaceId` from `getBoardSettings`.
2. Fetches `workspace.members.list({ workspaceId })`.
3. Subtracts the existing board members.
4. Renders the addable pool in a select.

When the addable pool is empty, the modal shows an explainer
pointing the admin at the workspace settings invite flow ("ابتدا
عضو جدیدی به فضای کاری دعوت کنید"). This is a UX-level mirror of
the server invariant — preventing the user from triggering a
guaranteed-failure flow.

## 16. boardManagement.getBoardSettings authorization

The `getBoardSettings` procedure is `boardMemberProcedure` (read
access for any active member) — NOT admin-gated. The drawer's
role gate lives on the client; a MEMBER who URL-hacks the
`?settings=...` param sees a read-only view of the data without an
unauthorized error. Per-tab capability gates inside the drawer
hide the action affordances.

This is intentional defence-in-depth: writes are still
admin-gated server-side via `boardAdminWriteProcedure` etc., so a
URL-hack can't escalate privilege. Showing a read-only view is
better UX than a 403.

## TODOs (parked for follow-up)

- **Description editor (About tab)** — currently read-only.
  Either extend `boardManagement.renameBoard` to accept an
  optional `description` input, or add a new
  `boardManagement.updateBoardMetadata` procedure. F1.2 candidate.

- **Naming cleanup** — ✓ **Done (F1.4.1)**. `boardManagement.deleteBoard`
  (which performs a SOFT delete) was renamed to `softDeleteBoard` for parity
  with the workspace softDelete / restore pair. All consumers (Server Action
  `softDeleteBoardAction`, page.tsx, BoardSettingsDropdown) were updated
  atomically — no alias (monorepo, no external consumers).

- **Sidebar archived board filter** — ✅ **CLOSED in F5c**.
  Added `isNull(boards.archivedAt)` to the WHERE clauses of both
  `userBoardMetadata.listStarred` and `listRecent` so archived
  boards no longer appear in the sidebar starred / recent sections.
  See packages/db/src/repositories/userBoardMetadata.repository.ts.

- **Focus trap library on the drawer** — the F5b drawer uses
  basic Tab cycling. A Radix or `focus-trap-react` library would
  give proper focus containment with shift+tab + sentinel
  elements. Polish followup.

- **Replace `window.confirm` in MembersTab** — same as F5a's
  members table. A custom confirm dialog (with Persian copy)
  ships in the polish phase.

- **Description edit + rich text** — once the editor lands, the
  About tab also needs a simple Markdown / mentions surface.
  Scope-defining PR before implementation.
