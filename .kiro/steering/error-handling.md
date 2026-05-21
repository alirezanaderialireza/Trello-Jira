---
inclusion: always
---

# Error Handling Rules

This document is the source of truth for how runtime errors are caught,
contained, reported, and recovered from in the web app. Read it before
adding a new feature that mounts a heavy component, before disabling a
boundary, or when chasing "why doesn't this error show up in our logs?".

> Without these boundaries, a runtime bug inside a single card renders the
> whole board white. With them, the failure is contained to its smallest
> reasonable scope, the user sees a recoverable fallback, and the team
> sees a structured fingerprint in the platform logs.

---

## Containment hierarchy

```
┌──────────────────────────────────────────────────────────────────┐
│ <RootErrorBoundary>                                              │
│   in app/layout.tsx                                              │
│   catches: shell crashes, provider failures, root navigation     │
│   fallback: full-page minimal HTML, "Reload" button              │
│                                                                  │
│   ┌─────────────────────────────────────────────────────────┐    │
│   │ <BoardErrorBoundary boardId={...}>                      │    │
│   │   in BoardView                                          │    │
│   │   catches: DnD context, sync orchestrator, store        │    │
│   │   fallback: "این بورد را نمی‌توان نمایش داد" + retry      │    │
│   │                                                         │    │
│   │   ┌────────────────────────────────────────────────┐    │    │
│   │   │ <ListErrorBoundary listId={...}>               │    │    │
│   │   │   wraps every list column                      │    │    │
│   │   │   fallback: red column stub at correct width   │    │    │
│   │   │                                                │    │    │
│   │   │   ┌──────────────────────────────────────┐     │    │    │
│   │   │   │ <CardErrorBoundary cardId={...}>     │     │    │    │
│   │   │   │   wraps every CardItem               │     │    │    │
│   │   │   │   (including VirtualizedCardItem)    │     │    │    │
│   │   │   │   fallback: red 64px stub            │     │    │    │
│   │   │   └──────────────────────────────────────┘     │    │    │
│   │   └────────────────────────────────────────────────┘    │    │
│   │                                                         │    │
│   │   ┌─────────────────────────────────────────────────┐   │    │
│   │   │ <ModalErrorBoundary>                            │   │    │
│   │   │   wraps the card detail modal                   │   │    │
│   │   │   fallback: default "encountered an error" pill │   │    │
│   │   └─────────────────────────────────────────────────┘   │    │
│   └─────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

The golden rule: an error is caught by the **deepest** boundary whose
subtree throws. A buggy card never escapes its `<CardErrorBoundary>`
to land at the board boundary; the rest of the list keeps rendering
fine.

In addition, `<GlobalErrorListener>` (mounted next to
`<RootErrorBoundary>`) subscribes to `window.error` and
`window.unhandledrejection` and forwards both to `reportError`, so
errors that React's render-phase catcher cannot see (async work,
event handlers, `setTimeout` callbacks, promise rejections) still
land in the same observability pipeline.

Finally, Next.js conventions cover the segments React boundaries
cannot reach:

| File                                | Catches                          |
|-------------------------------------|----------------------------------|
| `app/error.tsx`                     | per-route segment errors         |
| `app/board/[boardId]/error.tsx`     | the board route specifically     |
| `app/global-error.tsx`              | failures inside the root layout  |

---

## The reporting pipeline

```
componentDidCatch / window.error / unhandledrejection
                       │
                       ▼
              buildFingerprint(...)            ← lib/error/reportError.ts
                       │
                       ▼
                 reportError(fp)
                       │
   ┌───────────────────┼───────────────────────┐
   ▼                   ▼                       ▼
in-memory dedup   POST /api/errors    on transport failure:
(60-second TTL)   (keepalive: true)   localStorage queue,
                                      flushed on next success
                       │
                       ▼
        api/errors/route.ts (server)
                       │
                       ├── Zod-validate body
                       ├── rate-limit per IP
                       ├── enrich with server-side userId
                       └── console.error(JSON.stringify(...))
                                  │
                                  ▼
                       platform log drain
                       (greppable severity/scope tags)
```

The server endpoint deliberately writes to `console.error` for the MVP.
Vercel / Fly / Railway all surface `stderr` in their log dashboards;
moving to a dedicated audit table or an external service (Sentry,
Highlight, PostHog) is a one-function-body swap inside the route
handler, and an explicit non-goal for Phase 0.5.

### Fingerprint shape

```ts
type ErrorFingerprint = {
  scope: "Root" | "Board" | "List" | "Card" | "Modal" | "Async" | "Promise" | "Unknown";
  entityKind?: "board" | "list" | "card";
  entityId?: string;
  message: string;        // ≤ 500 chars
  stack?: string;         // ≤ 2000 chars
  componentStack?: string;// ≤ 1000 chars
  timestamp: string;      // ISO-8601 UTC
  url?: string;
  userAgent?: string;
  buildSha?: string;      // NEXT_PUBLIC_BUILD_SHA, falls back to "dev"
  context?: Record<string, unknown>;
};
```

The server NEVER trusts the body for identity. `userId` is read from
the auth session on the server side; the client cannot impersonate
another user in the logs.

---

## Recovery strategy

| Severity                             | UX                                            |
|--------------------------------------|-----------------------------------------------|
| Card / List / Modal — first failure  | Inline "Try again" button (soft retry)        |
| Card / List / Modal — > 3 failures   | Disable retry, suggest "Refresh the page"     |
| Board — boundary trips               | Centred fallback with retry                   |
| Root — layout itself crashed         | Full-page minimal HTML with "Reload"          |

The retry counter is intentional: a soft retry that *immediately* throws
again (e.g. the data is corrupted, not just transiently unrenderable)
will loop. After three failed retries the boundary stops offering retry
and tells the user to refresh, which gets a clean tree.

---

## Pitfalls

### 1. React Strict Mode runs `componentDidCatch` twice
This is intentional and matches the React docs. Our reporting pipeline
dedups identical fingerprints inside a 60-second window, so the second
invocation is silently dropped. **Do not** add side effects to
`getDerivedStateFromError` — it's pure-by-contract and will be called
twice as well.

### 2. `componentDidCatch` does NOT catch async errors
Promise rejections, `useEffect` errors, `setTimeout` callbacks, event
handlers — none of these reach the React boundary. That's why we mount
`<GlobalErrorListener>` next to the root boundary; the two together
cover render-phase + async error sources.

### 3. Errors inside the fallback itself
A fallback that throws creates an infinite loop. All four scope
fallbacks (Root / Board / List / Card / Modal) are written in plain
HTML / Tailwind; do not introduce data-fetching, `useState`, or
custom hooks inside a fallback.

### 4. `localStorage` queue must be bounded
The queue caps at 50 entries (`MAX_QUEUE_SIZE`) so a long offline
session cannot inflate localStorage indefinitely. New entries push
older ones out FIFO.

### 5. The dev console is always written
We log to `console.error` regardless of environment so a developer can
see the fingerprint immediately, even when the network POST fails.
**This means**: don't rely on the absence of a console error to mean
"reportError didn't fire" — check the dedup window first.

### 6. SSR vs client error.tsx
`app/error.tsx` is a CLIENT component (Next.js requires `"use client"`)
and runs only when the route's React tree throws on the client. SSR
crashes are handled by Next.js's own framework page and our
`global-error.tsx` only catches errors inside the root LAYOUT.

### 7. Boundary reset on key change
`<ErrorBoundary key={boardId}>` — when the user navigates between
boards, React unmounts the old boundary and mounts a fresh one with a
clean `errorCount`. Without this, a once-failed boundary would
remember its failure across navigation.

### 8. Strict typing through `ErrorScope`
The fingerprint scope is a closed union of seven values. The Zod
schema in `api/errors/route.ts` mirrors this list, so any new scope
must be added to BOTH places. The TypeScript compiler will flag the
client side; remember the server.

---

## How to add a new boundary

1. Pick the smallest scope that makes sense. A new top-level page?
   `<RootErrorBoundary>` already covers it — no action needed. A new
   feature inside a board (e.g. a sidebar widget)? Add a new
   `<ErrorBoundary scope="..." entityKind="..." entityId={...}>`
   wrapper around the widget root.
2. If the widget needs its own scope label (e.g. `"Widget"`), add it
   to the `ErrorScope` union in `lib/error/reportError.ts` AND the
   Zod enum in `app/api/errors/route.ts`. Both must agree.
3. Provide a fallback that's the same shape / size as the widget so
   the layout doesn't shift.
4. If the widget can throw async (timers, promises) AND the
   surrounding code does not already use `reportError`, add an
   explicit call site:
   ```ts
   import { buildFingerprint, reportError } from "@/lib/error/reportError";
   try { /* ... */ } catch (err) {
     reportError(buildFingerprint(err, "Widget", { entityId }));
   }
   ```

---

## Smoke-test playbook

```text
1. Throw inside a CardItem on click:
     onClick={() => { throw new Error("smoke") }}
   → only that card turns red. Other cards in the same list still
     render. The list and the rest of the board are untouched.
2. Throw inside a useEffect (microtask):
     useEffect(() => { Promise.reject(new Error("smoke")) }, [])
   → the React boundary does NOT trip; the GlobalErrorListener
     fires. Check console for `[reportError:Promise]`.
3. Trigger /api/errors POST:
     curl -X POST localhost:3000/api/errors \
       -H "Content-Type: application/json" \
       -d '{"scope":"Card","message":"manual","timestamp":"2025-01-01T00:00:00Z"}'
   → 200 with { "accepted": true }. Server logs a `client_error` line.
4. Trigger schema rejection:
     ... -d '{"scope":"Bogus"}' → 200 { "accepted": false, "reason": "schema_error" }
5. Trigger rate limit by replaying the curl 61 times in 15 min:
     → 429 with retry-after.
```

---

## What is intentionally deferred

- **Sentry / external observability**. The platform log drain is
  enough until we have real volume; swap one function in
  `api/errors/route.ts`.
- **Build SHA injection in `next.config`**. The constant
  `NEXT_PUBLIC_BUILD_SHA` is read defensively with a `"dev"` fallback;
  wiring `git rev-parse HEAD` into the build is a separate ops task.
- **Feature flag (`ERROR_BOUNDARIES_ENABLED`)**. The boundaries are
  pure UI plumbing — they cannot regress runtime behaviour. Flag-gating
  them would add complexity for no benefit.
- **Client-side dedup of `console.error` interception**. We do NOT
  override `console.error` — it would surface React's own dev
  warnings as errors and create noise. Browser devtools already show
  what we need at dev time.
- **Per-card render skeletons during retry**. The current "Try again"
  button immediately re-renders the children; if the children show
  their own loading state, the user sees that. A bespoke skeleton
  shared by all boundaries is a UX polish task for later.
