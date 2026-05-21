// apps/web/src/features/board/store/sync/syncStateMachine.ts
// -----------------------------------------------------------------------------
// Full event-driven Sync State Machine (FSM).
//
// States:
//   idle        — no board loaded, no WS connection
//   synced      — WS connected, sequence monotonic, healthy
//   catching_up — pulling missed events (gap detected), WS connected
//   resyncing   — full state resync required (gap unrecoverable)
//   reconnecting— WS disconnected, attempting reconnection
//   offline     — all reconnect attempts exhausted, user must act
//
// Design:
//   - Explicit transition table — only valid transitions are allowed
//   - Observer pattern — UI and devtools subscribe to state changes
//   - Multi-tab support — BroadcastChannel coordination
//   - Deterministic — same events always produce same state
//   - Testable — pure FSM logic, no side effects in transition function
// -----------------------------------------------------------------------------

// ============================================================================
// Types
// ============================================================================

export type SyncState =
  | "idle"
  | "synced"
  | "catching_up"
  | "resyncing"
  | "reconnecting"
  | "offline";

export type SyncEvent =
  | { type: "BOARD_LOADED"; boardId: string }
  | { type: "WS_CONNECTED" }
  | { type: "WS_DISCONNECTED"; code?: number; reason?: string }
  | { type: "SUBSCRIBED" }
  | { type: "EVENT_RECEIVED"; sequence: string }
  | { type: "GAP_DETECTED"; expectedSeq: string; receivedSeq: string }
  | { type: "GAP_RECOVERED" }
  | { type: "GAP_UNRECOVERABLE" }
  | { type: "RESYNC_COMPLETE" }
  | { type: "RECONNECT_ATTEMPT"; attempt: number }
  | { type: "RECONNECT_EXHAUSTED" }
  | { type: "MANUAL_RECONNECT" }
  | { type: "BOARD_UNLOADED" }
  | { type: "TAB_BECAME_LEADER" }
  | { type: "TAB_LOST_LEADERSHIP" };

export interface SyncContext {
  boardId: string | null;
  reconnectAttempts: number;
  lastSequence: string;
  gapStart: string | null;
  gapEnd: string | null;
  isLeaderTab: boolean;
  enteredStateAt: number;
}

export interface SyncTransitionResult {
  state: SyncState;
  context: SyncContext;
  /** Side effects to execute (non-blocking, handled by orchestrator) */
  effects: SyncEffect[];
}

export type SyncEffect =
  | { type: "CONNECT_WS"; boardId: string; lastSequence: string }
  | { type: "DISCONNECT_WS" }
  | { type: "PULL_MISSED_EVENTS"; boardId: string; fromSequence: string }
  | { type: "REQUEST_FULL_RESYNC"; boardId: string }
  | { type: "SCHEDULE_RECONNECT"; attempt: number; delayMs: number }
  | { type: "NOTIFY_USER_OFFLINE" }
  | { type: "BROADCAST_TAB_STATE"; state: SyncState }
  | { type: "LOG"; level: "info" | "warn" | "error"; message: string; data?: Record<string, unknown> };

// ============================================================================
// Transition Table
// ============================================================================
// Each row: [currentState, eventType] → [nextState, effects[]]
// Invalid transitions are rejected (no state change, warning logged).
// ============================================================================

type TransitionFn = (
  ctx: SyncContext,
  event: SyncEvent,
) => SyncTransitionResult | null;

const TRANSITIONS: Record<SyncState, Partial<Record<SyncEvent["type"], TransitionFn>>> = {
  // --------------------------------------------------------------------------
  // IDLE — waiting for board to load
  // --------------------------------------------------------------------------
  idle: {
    BOARD_LOADED: (ctx, event) => {
      if (event.type !== "BOARD_LOADED") return null;
      const nextCtx: SyncContext = {
        ...ctx,
        boardId: event.boardId,
        reconnectAttempts: 0,
        enteredStateAt: Date.now(),
      };
      return {
        state: "reconnecting",
        context: nextCtx,
        effects: [
          { type: "CONNECT_WS", boardId: event.boardId, lastSequence: ctx.lastSequence },
          { type: "BROADCAST_TAB_STATE", state: "reconnecting" },
        ],
      };
    },
  },

  // --------------------------------------------------------------------------
  // SYNCED — healthy, receiving events in sequence
  // --------------------------------------------------------------------------
  synced: {
    EVENT_RECEIVED: (ctx, event) => {
      if (event.type !== "EVENT_RECEIVED") return null;
      return {
        state: "synced",
        context: { ...ctx, lastSequence: event.sequence, enteredStateAt: ctx.enteredStateAt },
        effects: [],
      };
    },

    GAP_DETECTED: (ctx, event) => {
      if (event.type !== "GAP_DETECTED") return null;
      return {
        state: "catching_up",
        context: {
          ...ctx,
          gapStart: event.expectedSeq,
          gapEnd: event.receivedSeq,
          enteredStateAt: Date.now(),
        },
        effects: [
          { type: "PULL_MISSED_EVENTS", boardId: ctx.boardId!, fromSequence: event.expectedSeq },
          { type: "LOG", level: "warn", message: "Gap detected", data: { expected: event.expectedSeq, received: event.receivedSeq } },
          { type: "BROADCAST_TAB_STATE", state: "catching_up" },
        ],
      };
    },

    WS_DISCONNECTED: (ctx) => ({
      state: "reconnecting",
      context: { ...ctx, reconnectAttempts: 0, enteredStateAt: Date.now() },
      effects: [
        { type: "SCHEDULE_RECONNECT", attempt: 1, delayMs: 1000 },
        { type: "BROADCAST_TAB_STATE", state: "reconnecting" },
      ],
    }),

    BOARD_UNLOADED: (ctx) => ({
      state: "idle",
      context: { ...ctx, boardId: null, enteredStateAt: Date.now() },
      effects: [{ type: "DISCONNECT_WS" }, { type: "BROADCAST_TAB_STATE", state: "idle" }],
    }),
  },

  // --------------------------------------------------------------------------
  // CATCHING_UP — pulling missed events to close gap
  // --------------------------------------------------------------------------
  catching_up: {
    GAP_RECOVERED: (ctx) => ({
      state: "synced",
      context: { ...ctx, gapStart: null, gapEnd: null, enteredStateAt: Date.now() },
      effects: [
        { type: "LOG", level: "info", message: "Gap recovered" },
        { type: "BROADCAST_TAB_STATE", state: "synced" },
      ],
    }),

    GAP_UNRECOVERABLE: (ctx) => ({
      state: "resyncing",
      context: { ...ctx, enteredStateAt: Date.now() },
      effects: [
        { type: "REQUEST_FULL_RESYNC", boardId: ctx.boardId! },
        { type: "LOG", level: "error", message: "Gap unrecoverable — full resync" },
        { type: "BROADCAST_TAB_STATE", state: "resyncing" },
      ],
    }),

    EVENT_RECEIVED: (ctx, event) => {
      if (event.type !== "EVENT_RECEIVED") return null;
      // Buffer events while catching up — sequence tracking continues
      return {
        state: "catching_up",
        context: { ...ctx, lastSequence: event.sequence },
        effects: [],
      };
    },

    WS_DISCONNECTED: (ctx) => ({
      state: "reconnecting",
      context: { ...ctx, reconnectAttempts: 0, enteredStateAt: Date.now() },
      effects: [{ type: "SCHEDULE_RECONNECT", attempt: 1, delayMs: 1000 }],
    }),
  },

  // --------------------------------------------------------------------------
  // RESYNCING — full state resync (wipe + rebuild)
  // --------------------------------------------------------------------------
  resyncing: {
    RESYNC_COMPLETE: (ctx) => ({
      state: "synced",
      context: { ...ctx, gapStart: null, gapEnd: null, enteredStateAt: Date.now() },
      effects: [
        { type: "LOG", level: "info", message: "Full resync complete" },
        { type: "BROADCAST_TAB_STATE", state: "synced" },
      ],
    }),

    WS_DISCONNECTED: (ctx) => ({
      state: "reconnecting",
      context: { ...ctx, reconnectAttempts: 0, enteredStateAt: Date.now() },
      effects: [{ type: "SCHEDULE_RECONNECT", attempt: 1, delayMs: 1000 }],
    }),
  },

  // --------------------------------------------------------------------------
  // RECONNECTING — WS down, attempting to reconnect
  // --------------------------------------------------------------------------
  reconnecting: {
    WS_CONNECTED: (ctx) => ({
      state: "synced",
      context: { ...ctx, reconnectAttempts: 0, enteredStateAt: Date.now() },
      effects: [{ type: "BROADCAST_TAB_STATE", state: "synced" }],
    }),

    SUBSCRIBED: (ctx) => ({
      state: "synced",
      context: { ...ctx, reconnectAttempts: 0, enteredStateAt: Date.now() },
      effects: [
        { type: "LOG", level: "info", message: "Subscribed to board" },
        { type: "BROADCAST_TAB_STATE", state: "synced" },
      ],
    }),

    RECONNECT_ATTEMPT: (ctx, event) => {
      if (event.type !== "RECONNECT_ATTEMPT") return null;
      const delay = Math.min(1000 * Math.pow(2, event.attempt - 1), 15000);
      return {
        state: "reconnecting",
        context: { ...ctx, reconnectAttempts: event.attempt, enteredStateAt: Date.now() },
        effects: [
          { type: "CONNECT_WS", boardId: ctx.boardId!, lastSequence: ctx.lastSequence },
          { type: "SCHEDULE_RECONNECT", attempt: event.attempt + 1, delayMs: delay },
        ],
      };
    },

    RECONNECT_EXHAUSTED: (ctx) => ({
      state: "offline",
      context: { ...ctx, enteredStateAt: Date.now() },
      effects: [
        { type: "NOTIFY_USER_OFFLINE" },
        { type: "LOG", level: "error", message: "All reconnect attempts exhausted" },
        { type: "BROADCAST_TAB_STATE", state: "offline" },
      ],
    }),

    WS_DISCONNECTED: (ctx) => ({
      state: "reconnecting",
      context: ctx,
      effects: [], // Already reconnecting — ignore duplicate disconnects
    }),
  },

  // --------------------------------------------------------------------------
  // OFFLINE — user must manually reconnect
  // --------------------------------------------------------------------------
  offline: {
    MANUAL_RECONNECT: (ctx) => ({
      state: "reconnecting",
      context: { ...ctx, reconnectAttempts: 0, enteredStateAt: Date.now() },
      effects: [
        { type: "CONNECT_WS", boardId: ctx.boardId!, lastSequence: ctx.lastSequence },
        { type: "LOG", level: "info", message: "Manual reconnect triggered" },
        { type: "BROADCAST_TAB_STATE", state: "reconnecting" },
      ],
    }),

    BOARD_UNLOADED: (ctx) => ({
      state: "idle",
      context: { ...ctx, boardId: null, enteredStateAt: Date.now() },
      effects: [{ type: "BROADCAST_TAB_STATE", state: "idle" }],
    }),
  },
};

// ============================================================================
// Pure Transition Function
// ============================================================================

export function transition(
  currentState: SyncState,
  currentContext: SyncContext,
  event: SyncEvent,
): SyncTransitionResult {
  const stateTransitions = TRANSITIONS[currentState];
  const handler = stateTransitions?.[event.type];

  if (!handler) {
    // Invalid transition — log and stay in current state
    return {
      state: currentState,
      context: currentContext,
      effects: [
        {
          type: "LOG",
          level: "warn",
          message: `Invalid transition: ${currentState} + ${event.type}`,
          data: { currentState, event },
        },
      ],
    };
  }

  const result = handler(currentContext, event);
  if (!result) {
    return { state: currentState, context: currentContext, effects: [] };
  }

  return result;
}

// ============================================================================
// Initial Context Factory
// ============================================================================

export function createInitialSyncContext(): SyncContext {
  return {
    boardId: null,
    reconnectAttempts: 0,
    lastSequence: "0",
    gapStart: null,
    gapEnd: null,
    isLeaderTab: true,
    enteredStateAt: Date.now(),
  };
}

// ============================================================================
// Observer Pattern
// ============================================================================

export type SyncObserver = (state: SyncState, context: SyncContext, event: SyncEvent) => void;

export class SyncStateMachine {
  private state: SyncState = "idle";
  private context: SyncContext = createInitialSyncContext();
  private observers: Set<SyncObserver> = new Set();
  private effectHandler: ((effect: SyncEffect) => void) | null = null;

  // BroadcastChannel for multi-tab coordination
  private channel: BroadcastChannel | null = null;

  constructor(options?: { enableMultiTab?: boolean }) {
    if (options?.enableMultiTab && typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel("sync-fsm");
      this.channel.onmessage = (msg) => this.handleTabMessage(msg.data);
    }
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  getState(): SyncState {
    return this.state;
  }

  getContext(): Readonly<SyncContext> {
    return this.context;
  }

  send(event: SyncEvent): void {
    const result = transition(this.state, this.context, event);

    const previousState = this.state;
    this.state = result.state;
    this.context = result.context;

    // Notify observers
    if (previousState !== result.state || result.effects.length > 0) {
      this.notifyObservers(event);
    }

    // Execute effects
    for (const effect of result.effects) {
      if (effect.type === "BROADCAST_TAB_STATE") {
        this.channel?.postMessage({ type: "STATE_CHANGE", state: effect.state });
      }
      this.effectHandler?.(effect);
    }
  }

  subscribe(observer: SyncObserver): () => void {
    this.observers.add(observer);
    return () => this.observers.delete(observer);
  }

  onEffect(handler: (effect: SyncEffect) => void): void {
    this.effectHandler = handler;
  }

  destroy(): void {
    this.observers.clear();
    this.channel?.close();
    this.channel = null;
  }

  // ==========================================================================
  // Private
  // ==========================================================================

  private notifyObservers(event: SyncEvent): void {
    for (const observer of this.observers) {
      try {
        observer(this.state, this.context, event);
      } catch {
        // Observer failure must not crash FSM
      }
    }
  }

  private handleTabMessage(data: any): void {
    if (data?.type === "STATE_CHANGE") {
      // Another tab's state — useful for devtools and UI sync indicators
      // Does NOT mutate this FSM's state — each tab manages its own FSM
      this.notifyObservers({ type: "TAB_BECAME_LEADER" });
    }
  }
}
