"use client";

import { trpc } from "../../../../utils/trpc";

interface Props { cardId: string; }

const ACTION_LABELS: Record<string, string> = {
  "card.created": "Card created",
  "card.updated": "Card updated",
  "card.moved": "Card moved",
  "card.deleted": "Card deleted",
  "label_added": "Label added",
  "label_removed": "Label removed",
  "checklist.created": "Checklist added",
  "checklist.item_added": "Item added",
  "checklist.item_updated": "Item updated",
  "comment.created": "Comment added",
  "comment.deleted": "Comment deleted",
};

export function CardActivity({ cardId }: Props) {
  const { data, isLoading } = trpc.v1.public.activity.getByCard.useQuery({ cardId, limit: 30 });

  if (isLoading) {
    return <div className="py-4 text-center text-sm text-slate-500">Loading activity...</div>;
  }

  const events = data?.events ?? [];

  if (events.length === 0) {
    return <div className="py-4 text-center text-sm text-slate-500">No activity yet</div>;
  }

  return (
    <div className="space-y-3">
      {events.map((event: any) => (
        <div key={event.id} className="flex gap-3 border-l-2 border-slate-700 pl-3">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-300">
                {ACTION_LABELS[event.action] ?? event.action}
              </span>
              <span className="text-[10px] text-slate-500">
                by {event.actorId?.slice(0, 8)}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {new Date(event.createdAt).toLocaleString()}
            </p>
            {/* Show state change details */}
            {event.afterState && Object.keys(event.afterState).length > 0 && (
              <pre className="mt-1 rounded bg-slate-900/50 p-1.5 text-[10px] text-slate-400 overflow-x-auto">
                {JSON.stringify(event.afterState, null, 2)}
              </pre>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
