"use client";

// apps/web/src/features/board/components/realtime/ConnectionStatusBanner.tsx
//
// ─────────────────────────────────────────────────────────────────────────────
// Connection status indicator
//
// The realtime FSM is hidden behind `useSyncStatus()`, which already collapses
// the rich (transport × syncFSM × store) state space into a small UI-friendly
// enum: synced | catching_up | reconnecting | resyncing | resyncing_required |
// offline | idle. We just turn that into a coloured pill.
//
// "Reload" / "Reconnect" affordances:
//   • The banner is intentionally small in the happy path — a 6-pixel green
//     dot with a tooltip — so that a healthy connection does not eat any
//     visual real estate.
//   • Once the status leaves "synced", the pill widens to surface the cause
//     (reconnecting / resyncing / offline) and exposes a button:
//       - manual reconnect for `reconnecting` / `offline`
//       - full reload for `resyncing_required` (the connection FSM has
//         already given up; only a fresh fetch can recover).
// ─────────────────────────────────────────────────────────────────────────────

import { useSyncStatus, type UISyncStatus } from "../../api/realtime/useSyncStatus";

interface Props {
  /** Provided by the host (BoardView) so the user can manually retry. */
  onManualReconnect?: () => void;
  /** Optional className for layout integration. */
  className?: string;
}

interface Visual {
  label: string;
  detail?: string;
  dotClass: string;
  pillClass: string;
  /** When set, the pill renders an action button with this label. */
  action?: { label: string; intent: "reconnect" | "reload" };
}

function describe(status: UISyncStatus, attempts: number): Visual {
  switch (status) {
    case "synced":
      return {
        label: "Live",
        dotClass: "bg-emerald-400",
        pillClass: "bg-emerald-500/15 text-emerald-200 ring-emerald-500/30",
      };
    case "idle":
      return {
        label: "Idle",
        dotClass: "bg-slate-400",
        pillClass: "bg-slate-500/15 text-slate-200 ring-slate-500/30",
      };
    case "catching_up":
      return {
        label: "Catching up",
        detail: "Filling a small gap…",
        dotClass: "bg-sky-400 animate-pulse",
        pillClass: "bg-sky-500/15 text-sky-200 ring-sky-500/30",
      };
    case "reconnecting":
      return {
        label: "Reconnecting",
        detail: attempts > 0 ? `Attempt ${attempts}` : "Working on it…",
        dotClass: "bg-amber-400 animate-pulse",
        pillClass: "bg-amber-500/15 text-amber-200 ring-amber-500/30",
        action: { label: "Retry now", intent: "reconnect" },
      };
    case "resyncing":
      return {
        label: "Resyncing",
        detail: "Rebuilding state…",
        dotClass: "bg-sky-400 animate-pulse",
        pillClass: "bg-sky-500/15 text-sky-200 ring-sky-500/30",
      };
    case "resyncing_required":
      return {
        label: "Out of sync",
        detail: "Reload to refresh",
        dotClass: "bg-amber-400",
        pillClass: "bg-amber-500/15 text-amber-200 ring-amber-500/30",
        action: { label: "Reload", intent: "reload" },
      };
    case "offline":
    default:
      return {
        label: "Offline",
        detail: "Realtime updates paused",
        dotClass: "bg-rose-500",
        pillClass: "bg-rose-500/15 text-rose-200 ring-rose-500/30",
        action: { label: "Reconnect", intent: "reconnect" },
      };
  }
}

export function ConnectionStatusBanner({ onManualReconnect, className }: Props) {
  const status = useSyncStatus();
  const visual = describe(status.uiStatus, status.reconnectAttempts);

  // Tooltip exposes the lower-level detail so power users can debug in dev
  // without opening the devtools panel.
  const tooltip = [
    `transport: ${status.connState}`,
    `sync: ${status.syncState}`,
    status.latencyMs != null ? `rtt: ${status.latencyMs}ms` : null,
    status.gapCount ? `gaps: ${status.gapCount}` : null,
    status.dlqSize ? `dlq: ${status.dlqSize}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const isHappy = status.uiStatus === "synced" || status.uiStatus === "idle";

  const handleAction = () => {
    if (!visual.action) return;
    if (visual.action.intent === "reload") {
      // The store's FSM has bailed; only a fresh boot can recover.
      window.location.reload();
      return;
    }
    onManualReconnect?.();
  };

  return (
    <div
      role="status"
      aria-live="polite"
      title={tooltip}
      className={[
        "inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium ring-1 backdrop-blur-sm transition-colors",
        visual.pillClass,
        className ?? "",
      ].join(" ")}
    >
      <span
        aria-hidden
        className={["inline-block h-2 w-2 rounded-full", visual.dotClass].join(" ")}
      />
      <span className="leading-none">{visual.label}</span>
      {!isHappy && visual.detail && (
        <span className="leading-none text-current/80">· {visual.detail}</span>
      )}
      {visual.action && (
        <button
          type="button"
          onClick={handleAction}
          className="ml-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
        >
          {visual.action.label}
        </button>
      )}
    </div>
  );
}
