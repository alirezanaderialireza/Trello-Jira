// apps/web/src/features/board/store/sync/collaboration/index.ts
//
// ─── Responsibility ──────────────────────────────────────────────────────────
// Single public API surface for the entire collaboration layer.
//
// This file:
//   1. Re-exports every public type, class, and hook from each sub-module.
//   2. Instantiates one singleton manager per sub-system, all wired together.
//   3. Exposes a `collaboration` facade object — the only import that
//      BoardPage.tsx, BoardSocketClient, and useOptimisticMutation need.
//
// ─── Singleton wiring ────────────────────────────────────────────────────────
// All managers are constructed lazily (the first time `collaboration` is
// accessed) rather than at module-load time.  This prevents SSR crashes when
// BroadcastChannel or requestAnimationFrame are not available.
//
// ─── Usage in BoardPage.tsx ──────────────────────────────────────────────────
//
//   import { collaboration } from "@/features/board/store/sync/collaboration";
//
//   useEffect(() => {
//     collaboration.init({ boardId, userId, sendFn: boardSocket.sendCollab });
//     return () => collaboration.destroy();
//   }, [boardId, userId]);
//
// ─── Usage in BoardSocketClient ──────────────────────────────────────────────
//
//   // On "presence.heartbeat" message:
//   collaboration.presence.applyRemotePresence(payload);
//
//   // On "awareness.update" message:
//   collaboration.awareness.applyRemoteVector(msg);
//
//   // On "mutation.ack" message:
//   collaboration.ackBridge.applyAckMessage(msg);
//
// ─── Usage in useOptimisticMutation ──────────────────────────────────────────
//
//   // In onMutate:
//   collaboration.ackBridge.register(pendingMutation);
//
//   // In onError (before restoreSnapshot):
//   collaboration.ackBridge.onRollbackStart(correlationId);
//   store.restoreSnapshot(snapshot);
//   collaboration.ackBridge.onRollbackComplete(correlationId);
//
// ─────────────────────────────────────────────────────────────────────────────

// ============================================================================
// 1.  Re-export all public types and hooks
// ============================================================================

// ── presenceManager ──────────────────────────────────────────────────────────
export type {
  PresenceState,
  PresenceMessage,
} from "./presenceManager";
export {
  PresenceManager,
  useRemotePresence,
  useLocalPresence,
} from "./presenceManager";

// ── typingManager ────────────────────────────────────────────────────────────
export type {
  TypingField,
  TypingContext,
  TypingEntry,
  TypingMessage,
} from "./typingManager";
export {
  TypingManager,
  useTypingUsers,
  useIsLocalTyping,
} from "./typingManager";

// ── cursorManager ────────────────────────────────────────────────────────────
export type {
  CursorPosition,
  CursorEntry,
  CursorMessage,
} from "./cursorManager";
export {
  CursorManager,
  getCursorColor,
  useRemoteCursors,
  useLocalCursor,
  usePeerCursor,
} from "./cursorManager";

// ── selectionManager ─────────────────────────────────────────────────────────
export type {
  SelectableKind,
  SelectionItem,
  SelectionPermission,
  SelectionEntry,
  SelectionMessage,
  AclFn,
} from "./selectionManager";
export {
  SelectionManager,
  useLocalSelection,
  useRemoteSelections,
  useItemSelectors,
  useIsSelected,
} from "./selectionManager";

// ── awarenessProtocol ────────────────────────────────────────────────────────
export type {
  Stamped,
  AwarenessVector,
  PartialAwarenessVector,
  AwarenessMessage,
} from "./awarenessProtocol";
export {
  AwarenessProtocol,
  useLocalAwareness,
  usePeerAwareness,
  usePeerVector,
  useActivePeerCount,
} from "./awarenessProtocol";

// ── mutationAckBridge ────────────────────────────────────────────────────────
export type {
  MutationStatus,
  MutationRecord,
  MutationAckMessage,
} from "./mutationAckBridge";
export {
  MutationAckBridge,
  useMutationStatus,
  useMutationRecord,
  useAnyPending,
  useMutationStats,
  useFailedMutations,
} from "./mutationAckBridge";

// ============================================================================
// 2.  Collab send function contract
//     BoardSocketClient must implement this interface and pass it on init().
// ============================================================================

import type { PresenceMessage }  from "./presenceManager";
import type { TypingMessage }    from "./typingManager";
import type { CursorMessage }    from "./cursorManager";
import type { SelectionMessage } from "./selectionManager";
import type { AwarenessMessage } from "./awarenessProtocol";
import type { AclFn }           from "./selectionManager";

/**
 * The send function injected into each manager.
 * BoardSocketClient must implement all five overloads — TypeScript
 * will enforce completeness at the call site.
 */
export type CollabSendFn = (
  msg:
    | PresenceMessage
    | TypingMessage
    | CursorMessage
    | SelectionMessage
    | AwarenessMessage,
) => void;

// ============================================================================
// 3.  Init configuration
// ============================================================================

export interface CollaborationConfig {
  boardId:  string;
  userId:   string;
  /** The live WS send function — injected so this layer stays transport-agnostic. */
  sendFn:   CollabSendFn;
  /**
   * Optional ACL function for selection gates.
   * If omitted, all selections are permitted (safe open default).
   */
  aclFn?:  AclFn;
}

// ============================================================================
// 4.  Singleton facade
// ============================================================================

import { PresenceManager }   from "./presenceManager";
import { TypingManager }     from "./typingManager";
import { CursorManager }     from "./cursorManager";
import { SelectionManager }  from "./selectionManager";
import { AwarenessProtocol } from "./awarenessProtocol";
import { MutationAckBridge } from "./mutationAckBridge";

/**
 * The single object that consumers import.
 *
 * Managers are created once and reused across board navigations.
 * Call `collaboration.init()` on board mount and `collaboration.destroy()`
 * on unmount / board change.
 */
class CollaborationFacade {
  // ── Public sub-system references ─────────────────────────────────────────
  //    Typed directly so callers get full IntelliSense.
  readonly presence:  PresenceManager;
  readonly typing:    TypingManager;
  readonly cursor:    CursorManager;
  readonly selection: SelectionManager;
  readonly awareness: AwarenessProtocol;
  readonly ackBridge: MutationAckBridge;

  // ── Lifecycle state ───────────────────────────────────────────────────────
  private _active = false;

  constructor() {
    // Managers are constructed here but not started.
    // sendFn is injected lazily in init() via _makeSend().
    // We use placeholder no-ops so TypeScript is satisfied before init().
    const noop = () => {};

    this.presence  = new PresenceManager(noop);
    this.typing    = new TypingManager(noop);
    this.cursor    = new CursorManager(noop);
    this.selection = new SelectionManager(noop);
    this.awareness = new AwarenessProtocol(noop);
    this.ackBridge = new MutationAckBridge();
  }

  // ==========================================================================
  // init — call once per board mount
  // ==========================================================================

  init(config: CollaborationConfig) {
    if (this._active) {
      // Re-init on board change — destroy old session first.
      this._teardown();
    }

    const { boardId, userId, sendFn, aclFn } = config;

    // Wire live sendFn into each manager that needs it.
    // TypeScript already narrowed each manager's sendFn type in its constructor;
    // we cast here because the facade is the composition root and knows each
    // manager's accepted message types.
    (this.presence  as any)["sendFn"]  = sendFn;
    (this.typing    as any)["sendFn"]  = sendFn;
    (this.cursor    as any)["sendFn"]  = sendFn;
    (this.selection as any)["sendFn"]  = sendFn;
    (this.awareness as any)["sendFn"]  = sendFn;

    // Inject ACL function if provided.
    if (aclFn) {
      (this.selection as any)["aclFn"] = aclFn;
    }

    // Start sub-systems in dependency order.
    this.presence.init(boardId, userId);
    this.typing.init(boardId, userId);
    this.cursor.init(boardId, userId);
    this.selection.init(boardId, userId);

    // AwarenessProtocol gets references to all four sub-managers.
    this.awareness.init(boardId, userId, {
      presence:  this.presence,
      typing:    this.typing,
      cursor:    this.cursor,
      selection: this.selection,
    });

    // MutationAckBridge has no board-scoped state — just start the GC timer.
    this.ackBridge.init();

    this._active = true;
  }

  // ==========================================================================
  // destroy — call on board unmount or userId change
  // ==========================================================================

  destroy() {
    if (!this._active) return;
    this._teardown();
  }

  // ==========================================================================
  // onReconnect — call from BoardSocketClient.handleOpen after a reconnect
  // ==========================================================================

  onReconnect() {
    if (!this._active) return;
    this.awareness.onReconnect();
  }

  // ==========================================================================
  // Internal
  // ==========================================================================

  private _teardown() {
    // Destroy in reverse dependency order.
    this.ackBridge.destroy();
    this.awareness.destroy();
    this.selection.destroy();
    this.cursor.destroy();
    this.typing.destroy();
    this.presence.destroy();
    this._active = false;
  }
}

/**
 * The single exported instance.
 *
 * Import this everywhere:
 *   import { collaboration } from "@/features/board/store/sync/collaboration";
 */
export const collaboration = new CollaborationFacade();
