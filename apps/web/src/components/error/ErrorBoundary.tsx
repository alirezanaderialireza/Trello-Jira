"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Granular Error Boundaries (Phase 0.5)
//
// Why:  Without these, a runtime error inside a single card renders the whole
//       board white. With them, the failure is contained to its smallest
//       reasonable scope and the rest of the UI keeps working.
//
// Scopes (matches the architecture map):
//   • <RootErrorBoundary>    — outermost; catches anything anywhere in the
//                              tree that no narrower boundary already
//                              caught. Mounted in app/layout.tsx.
//   • <BoardErrorBoundary>   — catches the DnD context, layout, and sync
//                              orchestrator inside a board.
//   • <ListErrorBoundary>    — wraps each list column.
//   • <CardErrorBoundary>    — wraps each card item.
//   • <ModalErrorBoundary>   — wraps the card detail modal.
//
// Reporting flow:
//   componentDidCatch  →  buildFingerprint  →  reportError
//                                                 │
//                                                 ├── dedup
//                                                 ├── POST /api/errors
//                                                 └── localStorage queue
//
// All transport / dedup logic lives in `@/lib/error/reportError`. This
// file only owns the React lifecycle plumbing and the per-scope fallback
// UI.
// ─────────────────────────────────────────────────────────────────────────────

import React from "react";
import { buildFingerprint, reportError, type ErrorScope, type ErrorFingerprint } from "@/lib/error/reportError";

// ============================================================================
// Types
// ============================================================================

interface ErrorBoundaryProps {
  children: React.ReactNode;
  scope: ErrorScope;
  /** Domain entity kind (board/list/card) — used for fingerprinting. */
  entityKind?: "board" | "list" | "card";
  /** Specific entity id (boardId/listId/cardId) — used for fingerprinting. */
  entityId?: string;
  /** Optional: render-prop fallback that receives the error and a reset fn. */
  fallback?: React.ReactNode | ((error: Error, reset: () => void) => React.ReactNode);
  showRetry?: boolean;
  /** Hook for callers that need to react to the error (e.g. close a modal). */
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
//
// Intentionally a class component. React still has no hook equivalent of
// `getDerivedStateFromError` / `componentDidCatch`, so this is the one
// place in the codebase where we accept a class component.

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
    // Pure transition — no side effects. React calls this twice in Strict
    // Mode; we keep it idempotent by not touching anything outside state.
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const fp = buildFingerprint(error, this.props.scope, {
      entityKind: this.props.entityKind,
      entityId: this.props.entityId,
      componentStack: info.componentStack?.slice(0, 1000) ?? undefined,
    });

    // Centralised dedup + transport lives in reportError.
    reportError(fp);

    // Caller-supplied side-effect hook (e.g. close a modal, reset a store).
    this.props.onError?.(fp);

    this.setState((prev) => ({ errorCount: prev.errorCount + 1 }));
  }

  private _handleRetry = () => {
    // Soft retry: just clear the error flag. The React tree re-renders
    // children, which usually recovers when the cause was a transient
    // bug. If it throws again, errorCount climbs and the fallback
    // disables the retry button at >3 (see `tooManyErrors`).
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    // Caller-supplied fallback wins — render-prop or static node.
    if (this.props.fallback) {
      return typeof this.props.fallback === "function"
        ? (this.props.fallback as (e: Error, r: () => void) => React.ReactNode)(
            this.state.error!,
            this._handleRetry,
          )
        : this.props.fallback;
    }

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
 * Top-of-tree boundary for the entire app. Mounted in `app/layout.tsx`.
 * Catches anything that escaped the per-route / per-feature boundaries —
 * usually shell crashes (providers, devtools, root navigation).
 *
 * Uses a deliberately unstyled / minimal fallback because the design
 * system itself may be the thing that crashed. The user gets a plain
 * "Reload" button; everything else is the browser default.
 */
export function RootErrorBoundary({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ErrorBoundary
      scope="Root"
      fallback={
        <div
          dir="rtl"
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#fbfbfd",
            color: "#1d1d1f",
            padding: "1rem",
            fontFamily: "system-ui, -apple-system, sans-serif",
          }}
        >
          <div
            style={{
              maxWidth: 480,
              width: "100%",
              backgroundColor: "white",
              padding: "2rem",
              borderRadius: 16,
              boxShadow: "0 8px 30px rgba(0,0,0,0.04)",
              border: "1px solid #f0f0f0",
              textAlign: "center",
            }}
          >
            <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>
              مشکلی غیرمنتظره پیش آمد
            </h1>
            <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 24 }}>
              صفحه را بارگذاری مجدد کنید. اگر مشکل ادامه داشت با پشتیبانی تماس
              بگیرید.
            </p>
            <button
              onClick={() => {
                if (typeof window !== "undefined") window.location.reload();
              }}
              style={{
                padding: "10px 20px",
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 500,
                color: "white",
                backgroundColor: "#0A2540",
                border: "none",
                cursor: "pointer",
              }}
            >
              بارگذاری مجدد
            </button>
          </div>
        </div>
      }
    >
      {children}
    </ErrorBoundary>
  );
}

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

// Re-export helper types for consumers who want to write their own hooks.
export type { ErrorFingerprint, ErrorScope };
