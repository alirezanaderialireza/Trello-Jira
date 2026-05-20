"use client";

import { useState } from "react";
import { trpc } from "../../../../utils/trpc";

interface Props { cardId: string; boardId: string; }

export function CardDueDate({ cardId, boardId }: Props) {
  const { data, refetch } = trpc.v1.public.dueDate.get.useQuery({ cardId });
  const [editing, setEditing] = useState(false);
  const [dateValue, setDateValue] = useState("");

  const setMutation = trpc.v1.public.dueDate.set.useMutation({
    onSuccess: () => { refetch(); setEditing(false); },
  });

  const dueDate = data?.dueDate;
  const isOverdue = dueDate ? new Date(dueDate) < new Date() : false;

  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase text-slate-400">Due Date</h3>

      {!editing ? (
        <div className="flex items-center gap-2">
          {dueDate ? (
            <>
              <span className={`rounded px-2 py-1 text-xs font-medium ${
                isOverdue ? "bg-red-900/50 text-red-300" : "bg-slate-700 text-slate-300"
              }`}>
                {new Date(dueDate).toLocaleDateString()} {new Date(dueDate).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
              <button onClick={() => setMutation.mutate({ cardId, dueDate: null })} className="text-[10px] text-slate-500 hover:text-red-400">Clear</button>
            </>
          ) : (
            <span className="text-xs text-slate-500">No due date set</span>
          )}
          <button onClick={() => { setEditing(true); setDateValue(dueDate ?? ""); }} className="text-xs text-blue-400 hover:text-blue-300">
            {dueDate ? "Edit" : "Set"}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <input
            type="datetime-local"
            value={dateValue ? dateValue.slice(0, 16) : ""}
            onChange={(e) => setDateValue(e.target.value ? new Date(e.target.value).toISOString() : "")}
            className="rounded border border-slate-600 bg-slate-700 px-2 py-1 text-xs text-white"
          />
          <button onClick={() => { if (dateValue) setMutation.mutate({ cardId, dueDate: dateValue }); }} disabled={!dateValue} className="rounded bg-blue-600 px-2 py-1 text-xs text-white disabled:opacity-50">Save</button>
          <button onClick={() => setEditing(false)} className="text-xs text-slate-500">Cancel</button>
        </div>
      )}
    </div>
  );
}
