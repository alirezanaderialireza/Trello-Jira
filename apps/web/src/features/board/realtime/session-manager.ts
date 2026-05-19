// apps/web/src/features/board/realtime/session-manager.ts
//
// Phase-1.1 — SessionManager
//
// Owns session identity, connectionEpoch, and resume cursor.
//
// Why a separate class?
//   ConnectionFSM owns the WebSocket lifecycle.
//   SessionManager owns the *logical* session identity.
//   Keeping them separate means:
//     - Multiple socket reconnects can share the same logical session
//     - Stale-socket protection: events tagged with old connectionEpoch are dropped
//     - Resume vs full-connect decision is localised here
//
// Design:
//   • Pure class — no Zustand, no React
//   • Persists to sessionStorage so a page-reload can attempt resume
//   • connectionEpoch is a monotonic counter per page-load
//     (NOT persisted — each page-load starts fresh to prevent phantom-resume loops)

// ============================================================================
// Types
// ============================================================================

export interface SessionState {
  /** Stable session identifier, generated on first connect. */
  sessionId:          string;

  /** Board this session is scoped to. */
  boardId:            string;

  /**
   * Monotonic counter, incremented on every connect() call.
   * Used to detect stale reconnect callbacks and zombie sockets.
   */
  connectionEpoch:    number;

  /**
   * Last board sequence the client successfully applied.
   * Sent to the server on RESUME so it can replay from this point.
   */
  lastAckedSequence:  string;

  /** When the session was first created (epoch ms). */
  createdAt:          number;

  /** When the session was last resumed / refreshed (epoch ms). */
  lastActiveAt:       number;
}

/** Subset persisted to sessionStorage for resume-after-reload. */
interface PersistedSession {
  sessionId:         string;
  boardId:           string;
  lastAckedSequence: string;
  createdAt:         number;
}

// ============================================================================
// Constants
// ============================================================================

/** sessionStorage key prefix */
const SS_KEY_PREFIX = "board-session:";

/**
 * Sessions older than this are considered stale and will not be resumed.
 * Forces a fresh CONNECT instead of RESUME after long inactivity.
 */
const SESSION_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

// ============================================================================
// SessionManager
// ============================================================================

export class SessionManager {
  private state: SessionState | null = null;

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Start or resume a session for the given boardId.
   *
   * - If a valid persisted session exists for this board → resume (increment epoch)
   * - Otherwise → create a fresh session (epoch = 1)
   *
   * Returns the active SessionState.
   */
  start(boardId: string): SessionState {
    const persisted = this._loadPersisted(boardId);

    if (persisted && this._isResumable(persisted)) {
      this.state = {
        sessionId:         persisted.sessionId,
        boardId,
        connectionEpoch:   (this.state?.connectionEpoch ?? 0) + 1,
        lastAckedSequence: persisted.lastAckedSequence,
        createdAt:         persisted.createdAt,
        lastActiveAt:      Date.now(),
      };
    } else {
      this.state = {
        sessionId:         this._generateId(),
        boardId,
        connectionEpoch:   1,
        lastAckedSequence: "0",
        createdAt:         Date.now(),
        lastActiveAt:      Date.now(),
      };
    }

    this._persist();
    return { ...this.state };
  }

  /**
   * Called when a new connect attempt is made (e.g. after reconnect).
   * Increments connectionEpoch — any pending work tagged with the old epoch is stale.
   */
  incrementEpoch(): number {
    if (!this.state) throw new Error("[SessionManager] incrementEpoch called before start()");
    this.state = { ...this.state, connectionEpoch: this.state.connectionEpoch + 1 };
    return this.state.connectionEpoch;
  }

  /**
   * Record that a sequence was successfully applied to the store.
   * This advances the resume cursor.
   */
  ackSequence(sequence: string): void {
    if (!this.state) return;
    this.state = {
      ...this.state,
      lastAckedSequence: sequence,
      lastActiveAt:      Date.now(),
    };
    this._persist();
  }

  /**
   * Clear the session (e.g. on intentional disconnect or desynced state).
   * The next start() will create a fresh session.
   */
  clear(): void {
    if (this.state?.boardId) {
      this._removePersisted(this.state.boardId);
    }
    this.state = null;
  }

  /**
   * True if this session has a real sessionId and can attempt RESUME.
   * False if epoch = 1 and lastAckedSequence = "0" (brand-new session).
   */
  get canResume(): boolean {
    if (!this.state) return false;
    return (
      this.state.connectionEpoch > 1 ||
      this.state.lastAckedSequence !== "0"
    );
  }

  get current(): SessionState | null {
    return this.state ? { ...this.state } : null;
  }

  get sessionId(): string | null {
    return this.state?.sessionId ?? null;
  }

  get connectionEpoch(): number {
    return this.state?.connectionEpoch ?? 0;
  }

  get lastAckedSequence(): string {
    return this.state?.lastAckedSequence ?? "0";
  }

  /**
   * True when a message tagged with `epoch` belongs to the current connection.
   * Stale sockets from previous attempts are rejected.
   */
  isCurrentEpoch(epoch: number): boolean {
    return this.state?.connectionEpoch === epoch;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private _generateId(): string {
    // Use globalThis.crypto so this works in browser + test environments
    return globalThis.crypto?.randomUUID?.() ?? `sess-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  private _storageKey(boardId: string): string {
    return `${SS_KEY_PREFIX}${boardId}`;
  }

  private _loadPersisted(boardId: string): PersistedSession | null {
    try {
      const raw = sessionStorage?.getItem(this._storageKey(boardId));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as PersistedSession;
      if (!parsed.sessionId || !parsed.boardId) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private _persist(): void {
    if (!this.state) return;
    try {
      const data: PersistedSession = {
        sessionId:         this.state.sessionId,
        boardId:           this.state.boardId,
        lastAckedSequence: this.state.lastAckedSequence,
        createdAt:         this.state.createdAt,
      };
      sessionStorage?.setItem(this._storageKey(this.state.boardId), JSON.stringify(data));
    } catch {
      // sessionStorage may not be available in SSR or private mode
    }
  }

  private _removePersisted(boardId: string): void {
    try {
      sessionStorage?.removeItem(this._storageKey(boardId));
    } catch {
      // ignore
    }
  }

  private _isResumable(s: PersistedSession): boolean {
    const age = Date.now() - s.createdAt;
    return age < SESSION_MAX_AGE_MS;
  }
}
