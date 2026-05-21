"use client";

// apps/web/src/features/board/components/realtime/PresenceAvatars.tsx
//
// ─────────────────────────────────────────────────────────────────────────────
// Presence avatars
//
// Renders the small stack of avatars that shows which other users are
// currently viewing the same board. Reads directly from the presence store
// (`useRemotePresence` / `useLocalPresence`) which is fed by `usePresenceSync`
// at the BoardView root.
//
// Design choices
// ──────────────
// • The local user is intentionally NOT rendered. Trello-style UIs only show
//   "other people here" — including yourself in the bar is just visual noise.
// • Identity comes from `userId` only at this layer; the presence store does
//   not carry display names or avatars yet (a future PR will join through
//   the workspaces.members tRPC query). Until then we derive a short label
//   from the userId and a deterministic colour from a tiny hash so each
//   peer's bubble stays the same colour every reconnect.
// • Cap at 5 visible avatars + "+N" overflow chip. With more than ~5 the
//   stack stops being scannable and we'd rather hide the rest behind a
//   tooltip than wrap onto two rows.
// ─────────────────────────────────────────────────────────────────────────────

import {
  useRemotePresence,
  useLocalPresence,
} from "../../store/sync/collaboration/presenceManager";

const MAX_VISIBLE = 5;

/**
 * Stable colour for a userId. We pick from a curated palette of 8 hues that
 * all read well over the dark board background, then index by a small
 * string hash. Using a hash (not random) means a given user always gets
 * the same colour across reloads, which makes "who is who" obvious.
 */
const PALETTE = [
  "bg-rose-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-sky-500",
  "bg-violet-500",
  "bg-pink-500",
  "bg-teal-500",
  "bg-orange-500",
] as const;

function hashColor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) {
    h = (h * 31 + userId.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(h) % PALETTE.length]!;
}

/** Two-letter monogram derived from a userId (or its prefix when it's a uuid). */
function monogram(userId: string): string {
  // userIds in this codebase are uuids. The hex characters are still
  // readable as a tiny token if we shrink and uppercase them.
  const stripped = userId.replace(/-/g, "");
  return (stripped.slice(0, 2) || "??").toUpperCase();
}

interface AvatarProps {
  userId: string;
  status: "viewing" | "editing";
  /** Tooltip detail. */
  context?: string;
}

function Avatar({ userId, status, context }: AvatarProps) {
  const colour = hashColor(userId);
  const isEditing = status === "editing";
  const tooltip = [
    `User ${userId.slice(0, 8)}`,
    isEditing ? "editing" : "viewing",
    context,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <span
      title={tooltip}
      className={[
        "relative inline-flex h-7 w-7 select-none items-center justify-center rounded-full text-[10px] font-bold uppercase tracking-wider text-white shadow ring-2 ring-slate-900/60 transition-transform hover:z-10 hover:scale-110",
        colour,
      ].join(" ")}
    >
      {monogram(userId)}
      {isEditing && (
        <span
          aria-hidden
          className="absolute -bottom-0.5 -right-0.5 inline-block h-2.5 w-2.5 rounded-full bg-amber-400 ring-2 ring-slate-900/60"
        />
      )}
    </span>
  );
}

interface Props {
  /** Used to filter out our own presence record. */
  currentUserId: string | null | undefined;
  className?: string;
}

export function PresenceAvatars({ currentUserId, className }: Props) {
  const remote = useRemotePresence();
  const local = useLocalPresence(); // subscribed for re-renders, but not displayed

  // Fall back to the local-store local presence if the page-level userId
  // hasn't propagated yet (e.g. session still loading).
  const meId = currentUserId ?? local?.userId ?? null;

  const peers = Object.values(remote)
    .filter((p) => p.userId !== meId)
    // Most-recently-active first — matches the order users intuitively
    // expect for "who is here right now".
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt);

  if (peers.length === 0) return null;

  const visible = peers.slice(0, MAX_VISIBLE);
  const overflow = peers.length - visible.length;

  return (
    <div
      role="group"
      aria-label={`${peers.length} other user${peers.length === 1 ? "" : "s"} on this board`}
      className={["inline-flex items-center -space-x-2", className ?? ""].join(" ")}
    >
      {visible.map((p) => {
        // Heuristic: if the peer's presence record points at a card, treat
        // them as "editing"; otherwise just "viewing" the board. This is a
        // UI-only label — the underlying presence message kind ("heartbeat"
        // vs "leave") is not the same dimension.
        const status: "viewing" | "editing" = p.cardId ? "editing" : "viewing";
        const context = p.cardId
          ? `card ${p.cardId.slice(0, 8)}`
          : p.listId
            ? `list ${p.listId.slice(0, 8)}`
            : undefined;
        return <Avatar key={p.userId} userId={p.userId} status={status} context={context} />;
      })}
      {overflow > 0 && (
        <span
          title={`${overflow} more`}
          aria-label={`${overflow} more users`}
          className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-slate-700 px-1.5 text-[10px] font-bold text-white shadow ring-2 ring-slate-900/60"
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}
