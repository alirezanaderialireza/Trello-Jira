"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Granular Error Boundaries (Phase 0.2 — checklist 0.5)
//
// Why:  Without these, a runtime error inside a single card renders the whole
//       board white. With them, the failure is contained to its smallest
//       reasonable scope and the rest of the UI keeps working.
//
// Scopes (matches the architecture map):
//   • <BoardErrorBoundary>   — outermost; catches anything from the DnD
//                              context, layout, or sync orchestrator.
//   • <ListErrorBoundary>    — wraps each list column.
//   • <CardErrorBoundary>    — wraps each card item.
//   • <ModalErrorBoundary>   — wraps the card detail modal.
//
// Fingerprint:  every report carries `{ scope, entityKind, entityId, message,
// componentStack }` so the same broken card across tabs / users surfaces with
// the same fingerprint in our logs.
// ─────────────────────────────────────────────────────────────────────────────

import React from "react";

// ============================================================================
// Types
// ============================================================================

export type ErrorScope =
  | "Board"
  | "List"
  | "Card"
  | "Modal"
  | "Unknown";

export interface ErrorFingerprint {
  scope: ErrorScope;
  /** Domain entity kind ("board" | "list" | "card" | undefined). */
  entityKind?: "board" | "list" | "card";
  /** Specific entity id (boardId, listId, cardId). */
  entityId?: string;
  message: string;
  /** First 500 chars of the React component stack — enough to locate the
   *  failing component without bloating the log payload. */
  componentStack?: string;
  /** ISO-8601 UTC timestamp. */
  timestamp: string;
  /** Page URL at the time of the error (best-effort, only in browser). */
  url?: string;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
  scope: ErrorScope;
  /** Domain entity kind (board/list/card) — used for fingerprinting. */
  entityKind?: "board" | "list" | "card";
  /** Specific entity id (boardId/listId/cardId) — used for fingerprinting. */
  entityId?: string;
  fallback?: React.ReactNode;
  showRetry?: boolean;
  onError?: (fingerprint: ErrorFingerprint) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorCount: number;
}

// ============================================================================
// Core class component
// ============================================================================

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {
    hasError: false,
    error: null,
    errorCount: 0,
  };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const fingerprint: ErrorFingerprint = {
      scope: this.props.scope,
      entityKind: this.props.entityKind,
      entityId: this.props.entityId,
      message: error.message,
      componentStack: info.componentStack?.slice(0, 500) ?? undefined,
      timestamp: new Date().toISOString(),
      url:
        typeof window !== "undefined"
          ? window.location.href
          : undefined,
    };

    // Always log structured to console — even in dev, for fast triage.
    console.error(
      `[ErrorBoundary:${fingerprint.scope}]`,
      JSON.stringify(fingerprint),
      error,
    );

    // Best-effort report to backend in production.
    if (process.env.NODE_ENV === "production" && typeof window !== "undefined") {
      try {
        fetch("/api/report-error", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...fingerprint,
            stack: error.stack?.slice(0, 1000),
          }),
          keepalive: true,
        }).catch(() => {});
      } catch {
        // Swallow transport failures — never let logging break the UI.
      }
    }

    this.props.onError?.(fingerprint);
    this.setState((prev) => ({ errorCount: prev.errorCount + 1 }));
  }

  private _handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    const showRetry = this.props.showRetry !== false;
    const tooManyErrors = this.state.errorCount > 3;
    const label = this.props.entityId
      ? `${this.props.scope} (${this.props.entityId.slice(0, 8)})`
      : this.props.scope;

    return (
      <div className="flex items-center justify-center rounded-lg border border-red-800/50 bg-red-900/20 p-4">
        <div className="text-center">
          <p className="text-sm font-medium text-red-300">
            {label} encountered an error
          </p>
          {!tooManyErrors && showRetry && (
            <button
              onClick={this._handleRetry}
              className="mt-2 rounded bg-red-800/50 px-3 py-1 text-xs text-red-200 hover:bg-red-800/70"
            >
              Try again
            </button>
          )}
          {tooManyErrors && (
            <p className="mt-2 text-xs text-red-400">
              This section keeps failing. Please refresh the page.
            </p>
          )}
        </div>
      </div>
    );
  }
}

// ============================================================================
// Scope-specific wrappers (cheap to render, easy to drop in)
// ============================================================================

/**
 * Outermost boundary for the whole board view. Catches DnD context / sync
 * orchestrator failures. Falls through to a centred error card if nothing
 * else handles it.
 */
export function BoardErrorBoundary({
  children,
  boardId,
  fallback,
}: {
  children: React.ReactNode;
  boardId?: string;
  fallback?: React.ReactNode;
}) {
  return (
    <ErrorBoundary
      scope="Board"
      entityKind="board"
      entityId={boardId}
      fallback={
        fallback ?? (
          <div className="flex h-full min-h-[200px] items-center justify-center">
            <div className="rounded-lg border border-red-800/50 bg-red-900/20 px-6 py-4 text-center">
              <p className="text-base font-semibold text-red-300">
                این بورد را نمی‌توان نمایش داد
              </p>
              <p className="mt-2 text-sm text-red-400">
                صفحه را تازه کنید. اگر مشکل ادامه داشت، با تیم پشتیبانی تماس بگیرید.
              </p>
            </div>
          </div>
        )
      }
    >
      {children}
    </ErrorBoundary>
  );
}

/** Wraps a single list column so a broken list does not crash siblings. */
export function ListErrorBoundary({
  children,
  listId,
}: {
  children: React.ReactNode;
  listId?: string;
}) {
  return (
    <ErrorBoundary
      scope="List"
      entityKind="list"
      entityId={listId}
      fallback={
        <div className="w-72 shrink-0 rounded-xl border border-red-800/50 bg-red-900/10 p-4 text-center">
          <p className="text-sm font-medium text-red-300">List error</p>
          <p className="mt-1 text-xs text-red-400">
            این لیست بارگذاری نشد.
          </p>
        </div>
      }
    >
      {children}
    </ErrorBoundary>
  );
}

/** Wraps a single card so a broken card does not crash its list. */
export function CardErrorBoundary({
  children,
  cardId,
}: {
  children: React.ReactNode;
  cardId?: string;
}) {
  return (
    <ErrorBoundary
      scope="Card"
      entityKind="card"
      entityId={cardId}
      fallback={
        <div className="flex h-16 items-center justify-center rounded-lg border border-red-800/30 bg-red-900/10 text-xs text-red-400">
          Card error
        </div>
      }
    >
      {children}
    </ErrorBoundary>
  );
}

/** Wraps the card detail modal so a broken modal does not crash the board. */
export function ModalErrorBoundary({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ErrorBoundary scope="Modal" showRetry>
      {children}
    </ErrorBoundary>
  );
}
