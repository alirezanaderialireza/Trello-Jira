"use client";

import React from "react";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  section?: string;
  showRetry?: boolean;
  onError?: (error: Error, info: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorCount: number;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null, errorCount: 0 };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const section = this.props.section ?? "unknown";
    console.error(`[ErrorBoundary:${section}]`, error, info);

    // Report to backend (best-effort)
    if (process.env.NODE_ENV === "production") {
      fetch("/api/report-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section, error: error.message, stack: error.stack?.slice(0, 1000),
          componentStack: info.componentStack?.slice(0, 500),
          url: window.location.href, timestamp: new Date().toISOString(),
        }),
        keepalive: true,
      }).catch(() => {});
    }

    this.props.onError?.(error, info);
    this.setState((prev) => ({ errorCount: prev.errorCount + 1 }));
  }

  private _handleRetry = () => { this.setState({ hasError: false, error: null }); };

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    const section = this.props.section ?? "Component";
    const showRetry = this.props.showRetry !== false;
    const tooManyErrors = this.state.errorCount > 3;

    return (
      <div className="flex items-center justify-center rounded-lg border border-red-800/50 bg-red-900/20 p-4">
        <div className="text-center">
          <p className="text-sm font-medium text-red-300">{section} encountered an error</p>
          {!tooManyErrors && showRetry && (
            <button onClick={this._handleRetry} className="mt-2 rounded bg-red-800/50 px-3 py-1 text-xs text-red-200 hover:bg-red-800/70">Try again</button>
          )}
          {tooManyErrors && <p className="mt-2 text-xs text-red-400">This section keeps failing. Please refresh the page.</p>}
        </div>
      </div>
    );
  }
}

export function CardErrorBoundary({ children }: { children: React.ReactNode }) {
  return <ErrorBoundary section="Card" fallback={<div className="h-16 rounded-lg border border-red-800/30 bg-red-900/10 flex items-center justify-center text-xs text-red-400">Card error</div>}>{children}</ErrorBoundary>;
}

export function ListErrorBoundary({ children }: { children: React.ReactNode }) {
  return <ErrorBoundary section="List">{children}</ErrorBoundary>;
}

export function ModalErrorBoundary({ children }: { children: React.ReactNode }) {
  return <ErrorBoundary section="Modal" showRetry>{children}</ErrorBoundary>;
}
