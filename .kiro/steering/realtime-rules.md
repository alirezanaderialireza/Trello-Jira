---
inclusion: always
---

# Realtime Rules

This document is the source of truth for how realtime state synchronisation
works in this codebase. Read it before adding a new event type, touching the
sync FSM, or wiring a new collaborative feature.

> Realtime is the bedrock of multi-user collaboration. Get it right and many
> users edit the same board with no conflicts. Get it wrong and you have
> divergent state, ghost cards, and CPU-pegged tabs replaying old events.

---

## Priority of Truth (the golden ordering)

When the local store, an in-flight optimistic mutation, an incoming server
event, and a background refetch all want to write to the same field, this is
the order in which writes "win":

```
┌──────────────────────────────────────────────────────┐
│ 1. In-flight optimistic mutation (uncommitted)       │  ← highest
│    The user is mid-edit (typing, dragging). A patch  │
│    from the server for the same field is BUFFERED    │
│    until the edit ends.                              │
├──────────────────────────────────────────────────────┤
│ 2. Confirmed mutation response (server ACK)          │
│    The mutation we just sent came back — the value   │
│    is authoritative; replace optimistic with it.     │
├──────────────────────────────────────────────────────┤
│ 3. Realtime patch (incoming WS event)                │
│    From another user. If we are not currently        │
│    editing the field, apply.                         │
├──────────────────────────────────────────────────────┤
│ 4. Background refetch / full snapshot                │  ← lowest
│    Used only to recover from an unrecoverable gap.   │
└──────────────────────────────────────────────────────┘
```

`reconcileIncomingEvent` is the canonical implementation of this ordering.
Do not bypass it by writing directly to the store from a WebSocket handler —
the priority gates exist to keep typing, dragging and live updates from
trampling each other.

---

## Sequence semantics

The server publishes a monotonically increasing `boardSequence`. Every event
carries `seq=N`. Three rules govern how the client reacts:

1. `seq <= localSeq` → **stale**, drop silently. This is normal during
   reconnects and idempotency replays.
2. `seq === localSeq + 1` → **next**, apply and advance `localSeq`.
3. `seq > localSeq + 1` → **gap**, buffer the event, request the missing
   range from the server, and apply in order once the gap fills.

If the gap cannot be filled within ~30 seconds, the FSM transitions to
`resyncing` and the client requests a fresh snapshot of the board state.

Two things follow from this:

- **Never use timestamps for ordering.** Client and server clocks drift,
  daylight-savings transitions exist, and tab throttling makes timestamps
  even less reliable. Always order by `seq`.
- **Per-aggregate revisions are an additional check.** Each card / list also
  carries its own `revision`. If `incomingEvent.aggregateRevision <= local`,
  drop the event even if the board sequence is fine. This guards replay /
  out-of-order delivery on a single aggregate.

---

## Connection FSM (transport layer)

```
   DISCONNECTED → CONNECTING → AUTHENTICATING → SYNCING → HEALTHY
                                                            │
                                                            ▼
                                                       RECONNECTING
                                                            │ (exhausted)
                                                            ▼
                                                         DEGRADED
```

UI should react to each state, not to socket internals:

| State           | UI affordance                                        |
|-----------------|------------------------------------------------------|
| `HEALTHY`       | Small green "Live" pill                              |
| `SYNCING` / `catching_up` | Sky pulse "Syncing…"                       |
| `RECONNECTING`  | Amber pulse with attempt counter, "Retry now" button |
| `RESYNCING_REQUIRED` | Amber, "Reload" button (FSM has bailed)         |
| `DEGRADED` / `OFFLINE` | Rose, "Reconnect" button + banner             |

Consume `useSyncStatus()` (in `apps/web/src/features/board/api/realtime/`)
which collapses transport × syncFSM × storeStatus into a single
`UISyncStatus` enum. **Do not subscribe directly to the lower-level FSMs**
from a UI component — the derivation in `deriveUiStatus()` is the
single source of UI truth.

---

## When to use what

### `protectedProcedure` mutations (tRPC)
For commands like `createCard`, `updateList`, `moveCard`. They run inside
the RLS-enforced transaction (Phase 0.3) and the server is responsible for
publishing the resulting events through the outbox to other clients.

### Optimistic UI
Wrap user-visible writes (`useCreateCard`, `useMoveCard`, etc.) so the
caller sees the change immediately and the network round-trip happens in
the background. Always:

1. Generate a `clientGenId` (UUID) for the new entity.
2. Apply the optimistic state with `isOptimistic: true`.
3. Send the mutation through tRPC carrying the `clientGenId`.
4. On ACK: replace `clientGenId` with the server id and clear the flag.
5. On failure: rollback the optimistic state and surface a retry toast.

### Realtime events (WS)
Read-only on the client. Drive `reconcileIncomingEvent` to update the
store. Never use a WS event as the trigger to send another mutation
back to the server — that creates feedback loops.

### Presence (heartbeat)
Lower priority than data events. Use `usePresenceSync` (or the higher-level
`useBoardPresence` wrapper) once per BoardView mount. Throttle cursor
updates aggressively (50 ms) and dedupe across tabs via the BroadcastChannel
leader election that `presenceManager` already implements.

---

## Pitfalls (the ones that bit us)

### 1. Memory leak under React Strict Mode
`useEffect` runs twice in dev. Without a `useRef` guard you get two open
sockets, two subscription messages, and the close handler runs against the
stale instance. `boardSocketClient` is a module-level singleton specifically
to make this safe — always go through it, never `new WebSocket()` inline.

### 2. Race between optimistic and patch
The user clicks "Save". Before the ACK arrives, a realtime event for the
same field arrives from another tab. Naive apply produces a flicker. Fix:
`reconcileIncomingEvent` checks `pendingMutations` by `correlationId`; if
the inbound event is our own ACK (correlationId match), apply it as
"confirmed". If it's from someone else, queue it until our pending
mutation resolves.

### 3. Subscription leak across boards
User navigates from board A to board B. If we don't unsubscribe, the server
keeps pushing A's events to a tab that no longer renders A. Always
`disconnect()` on unmount and gate `connect()` on the new boardId — see
the cleanup in `useSyncOrchestrator`.

### 4. WebSocket throttling in background tabs
Browsers throttle WS message processing in hidden tabs. Events queue up,
and on `visibilitychange` to `visible` we get a flood. The `eventCoalescer`
collapses redundant events per aggregate, and the FSM forces a `catching_up`
sync on visibility-change to fast-forward state instead of replaying every
buffered event one-by-one.

### 5. Heartbeat false positives on Wi-Fi → cellular handoff
The TCP socket can stay "open" but silently drop packets. The transport
heartbeat sends a `ping` every 20 s and expects `pong` within 10 s; missing
the deadline force-closes the socket so the FSM can re-enter
`RECONNECTING` instead of trusting a dead connection.

### 6. Presence echo
Without filtering, the server broadcasts your own presence record back to
you. `<PresenceAvatars>` filters by `currentUserId !== peer.userId` to keep
the avatar bar showing only "other people".

### 7. Stale presence (zombie tabs)
A user closes the tab without a graceful unsubscribe. The server side TTL
(30 s) sweeps the row away — until it does, peers see a phantom user.
Don't try to "fix" this with shorter TTLs; the heartbeat refresh interval
already makes 30 s the steady-state worst case.

### 8. Multiple tabs from the same user
Two tabs on the same board would each emit presence and would each retry
the same outbox entry. `presenceManager` and `outboxProcessor` both
participate in BroadcastChannel-based leader election: only one tab is
"leader" at any time. Other tabs read the shared store but don't transmit.

### 9. RLS interaction with realtime
The server should re-check membership on each WS push. A user removed from
a board mid-session must stop receiving events immediately. This is
implemented in the WS gateway (see `wsAclEnforcer`), but if you add a new
event type, make sure its publish path goes through the same enforcer.

### 10. Long-running transactions on subscriptions
Phase 0.3's `protectedProcedure` opens a DB transaction for the lifetime
of the request. **Do not** use `protectedProcedure` for streaming /
subscription endpoints — the transaction would stay open for the entire
stream, holding a pool connection and pinning the GUC. Use
`publicProcedure` plus manual auth + RLS wiring there.

---

## Composing a new tenant-scoped realtime event

A new event flows from server-side mutation → outbox → WS gateway →
client store. The boilerplate for adding one:

1. **Define the event** in `packages/domain/src/events/<aggregate>.events.ts`.
   Pick a stable `type` string and document the payload shape.
2. **Publish from the use-case.** In the command handler, after the DB
   write, append an `outboxEvents` row inside the same transaction (Phase
   0.3 ensures this is RLS-correct). Never publish directly to Redis from
   the request handler.
3. **Apply on the client.** Add a reducer in
   `apps/web/src/features/board/store/event-application/` and register it
   with the `dispatcher`. The dispatcher already enforces the sequence
   guard — the reducer just trusts that the event is in-order.
4. **Optimistic mutation hook** (if user-facing). In
   `apps/web/src/features/board/store/mutations/`, follow the pattern of
   `useCreateCard` — clientGenId, snapshot, ACK reconcile, rollback.

---

## Smoke test

```bash
# 1. Two browser windows on the same board.
#    Confirm avatars appear for the second user within ~1 s in window 1.
# 2. In window 1, edit a card title; window 2 should reflect within ~500 ms.
# 3. In window 1, kill network (devtools → offline).
#    The status pill turns amber, then "Offline".
# 4. Restore network. Pill returns to "Live"; missed events flow through
#    the catch-up path (you can see this in the devtools overlay).
# 5. Close window 1 abruptly. Window 2's avatar bar drops the avatar
#    within ~30 s (presence TTL).
```

---

## What is intentionally deferred

- **Cursor overlay rendering.** `cursorManager` already collects positions;
  drawing remote cursors over the board canvas is a future PR.
- **Conflict-resolution modal.** Currently we use last-write-wins +
  toast. A proper merge UI (mine vs theirs) is on the roadmap once we
  see real conflict data in production.
- **Polling fallback.** If a network blocks WS entirely, the user gets a
  static board. A 30 s polling refetch could fill the gap; not added yet
  to keep the request budget tight.
- **Per-environment feature flag.** `REALTIME_ENABLED` would let us roll
  this out gradually. Not added because the WS stack ships with this PR;
  if it's broken we revert the PR rather than gate it.
