---
title: Shell & Navigation
inclusion: always
---

# Shell & Navigation Conventions

Architecture and UX rules for the post-login app shell (`(app)/` route
group, the sidebar, the topnav, and the post-login navigation flows).
Established by F4. Apply to every change inside `apps/web/src/app/(app)`,
`apps/web/src/features/shell/`, or `apps/web/middleware.ts`.

---

## 1. Server vs Client Components

The `(app)/` layout shell is a **Server Component** by default. Hand off
to a `"use client"` wrapper only when one of these is actually needed:

- `useState` / `useReducer` (e.g. AppShell holds the mobile-drawer
  open state)
- React Query hooks (e.g. `Sidebar.tsx` runs
  `trpc.sidebar.bootstrap.useQuery({ initialData })`)
- DOM event listeners (e.g. WorkspaceSwitcher's outside-click handler)
- Browser-only APIs (`localStorage`, `BroadcastChannel`, …)

Default to Server unless one of those applies. Pre-fetch tRPC data in
the server layout via `appRouter.createCaller(await createContext({ session }))`
and pass it as `initialData` to the client query — this keeps the
initial paint zero-JS for the data and avoids a client-side waterfall.

**Anti-pattern**: making `(app)/layout.tsx` a Client Component just to
co-locate state. Hoist that state into a child Client wrapper
(`AppShell.tsx`) and keep the layout server-side.

---

## 2. Where state lives

Three homes — pick the right one:

| Where | What | Why |
|---|---|---|
| URL | active workspace slug, board id, tab | shareable, browser-back-aware |
| DB (`users.preferences` JSONB) | locale, timezone, theme | cross-device sync |
| `uiPreferencesStore` (Zustand+persist) | sidebar collapsed, expanded workspaces, open section | session-local, no need to sync |

Putting locale in the Zustand store would mean two devices show
different languages for the same user — broken invariant. Putting
sidebar collapse in DB would mean the user's mobile choice forces
their desktop sidebar open — unwanted coupling.

---

## 3. RTL & Persian-first

The root layout sets `<html dir="rtl">`. **Do not re-set `dir`** on
descendant containers. Use Tailwind logical utilities everywhere:

| ❌ Bad (LTR-only) | ✅ Good (logical) |
|---|---|
| `border-r` | `border-e` (inline-end) |
| `border-l` | `border-s` (inline-start) |
| `pl-4` / `pr-4` | `ps-4` / `pe-4` |
| `ml-2` / `mr-2` | `ms-2` / `me-2` |
| `left-0` / `right-0` | `start-0` / `end-0` |

`dir="auto"` belongs on every text input where users may type Persian,
Arabic, or English (search bars, name fields). It lets the input
follow the typed content's direction.

**Icon flip**: chevron icons that mean "navigate forward" need to flip
in RTL. Use `ChevronLeft` (which visually points "into" the row in RTL)
or `class="rtl:rotate-180"` on a `ChevronRight`. Do **not** flip
direction-neutral icons like `Home`, `Star`, `Bell`, `Settings`, etc.

**Avatar initials**: use `getFirstGrapheme()` from
`@/lib/persianGrapheme.ts`, never `name[0]`. The naive index is wrong
for Persian text with combining marks (ZWNJ + diacritics).

**Numerals**: use `number.toLocaleString('fa-IR')` for any user-visible
count or label. Pure-ASCII `2` reads as "two" to a Latin reader; Persian
readers expect `۲`.

**Dates**: every date display goes through `@/lib/date.ts`. Direct
`dayjs(...)` imports are blocked by the date-engine boundary linter.

---

## 4. Sidebar bootstrap caching

`(app)/layout.tsx` fetches `sidebar.bootstrap` server-side and passes
the result as `initialData` to the client query. The client query uses:

```ts
useQuery(undefined, {
  initialData,
  staleTime: 60_000, // 1 minute
})
```

Re-fetch is triggered by:
- The 60s staleTime expiring on its own.
- Explicit `utils.v1.public.sidebar.bootstrap.invalidate()` after a
  mutation that changes any of: workspace list, starred boards,
  invitation count.

Mutations that **must** invalidate:
- `workspace.create`, `workspace.delete`, `workspace.restore`
- `userBoardMetadata.toggleStar`
- `workspace.invitations.accept`, `workspace.invitations.revoke`

Adding a new mutation that touches the bootstrap data? Add a
`utils.v1.public.sidebar.bootstrap.invalidate()` to its onSettled
handler.

---

## 5. Server Actions placement

Server Actions go under `apps/web/src/app/(app)/_actions/`. They live
in the `app` boundaries-linter element which is the only element
allowed to import `@repo/api` runtime. Putting actions inside
`features/shell/actions/` would tickle the boundaries rule (features
can't reach `@repo/db` transitively even via the API caller).

Action contract:
- Top of file: `"use server"`
- Receive either `FormData` (form submissions) or a typed object
- Always return `{ ok: boolean, error?: string, ...}` — no thrown
  exceptions for user-actionable failures
- Persian error messages, capped < 200 chars to avoid logging stack
  traces back at the UI
- Call `revalidatePath(...)` to invalidate Next.js cache for any
  pages that show the changed data; call `revalidatePath('/', 'layout')`
  when the change affects layout-level fetches like `sidebar.bootstrap`

---

## 6. Mobile breakpoint

`md:` (768px) is the desktop ↔ mobile cut-off. Below `md:`:
- Sidebar is hidden by default; shown via `MobileDrawer` overlay
- TopNav burger button toggles the drawer
- Search bar is hidden (Cmd/K still works on physical keyboards)

Above `md:`:
- Sidebar is a persistent grid column (260px)
- Burger button is hidden
- Search bar is visible centered in topnav

Always test at `375px` (iPhone SE) — the narrowest realistic viewport.
Drawer width caps at `max-w-[80vw]` so a sliver of the underlying page
remains tappable as a "tap-to-close" affordance.

---

## 7. Middleware constraints

`apps/web/middleware.ts` runs in the **Edge runtime**. Hard rules:

- ❌ No `node:crypto`, `node:fs`, etc.
- ❌ No `@repo/db` imports (transitive imports of `@node-rs/argon2-wasm32-wasi`
  don't work in Edge)
- ❌ No DB queries
- ❌ No imports from `@/auth` (the full Auth.js config drags in DB)
- ✅ Cookie checks (`req.cookies.get(name)`)
- ✅ Header checks
- ✅ URL/path manipulation, `NextResponse.redirect`

Fine-grained authorization (membership, role, deleted-workspace 404)
happens in Server Components via `getWebSession()` because those
checks need DB access.

---

## 8. Mobile drawer is custom (no Radix dep)

The shell intentionally does not depend on `@radix-ui/react-dialog` or
similar. The `MobileDrawer` component is a custom fixed overlay that
covers the four contracts a Dialog primitive would handle (backdrop
click close, Escape close, body scroll lock, `aria-modal=true`).

Keep this rule. Adding Radix later is acceptable but only as a
deliberate, project-wide design-system decision — not as a one-off
import for a single popover.
