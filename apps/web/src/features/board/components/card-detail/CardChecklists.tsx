"use client";

import { useState } from "react";
import { trpc } from "../../../../utils/trpc";

interface Props { cardId: string; boardId: string; }

export function CardChecklists({ cardId, boardId }: Props) {
  const { data, refetch } = trpc.v1.public.checklist.getByCard.useQuery({ cardId });
  const [newName, setNewName] = useState("");
  const [newItemText, setNewItemText] = useState<Record<string, string>>({});

  const createMutation = trpc.v1.public.checklist.create.useMutation({ onSuccess: () => { refetch(); setNewName(""); } });
  const addItemMutation = trpc.v1.public.checklist.addItem.useMutation({ onSuccess: () => refetch() });
  const toggleMutation = trpc.v1.public.checklist.updateItem.useMutation({ onSuccess: () => refetch() });
  const removeItemMutation = trpc.v1.public.checklist.removeItem.useMutation({ onSuccess: () => refetch() });
  const deleteMutation = trpc.v1.public.checklist.delete.useMutation({ onSuccess: () => refetch() });

  const checklists = data ?? [];

  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase text-slate-400">Checklists</h3>

      {checklists.map((cl: any) => {
        const items = cl.items ?? [];
        const doneCount = items.filter((i: any) => i.completed).length;
        const progress = items.length > 0 ? Math.round((doneCount / items.length) * 100) : 0;

        return (
          <div key={cl.id} className="mb-4 rounded-lg border border-slate-700 bg-slate-900/50 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-200">{cl.name}</span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-500">{doneCount}/{items.length}</span>
                <button onClick={() => deleteMutation.mutate({ checklistId: cl.id })} className="text-slate-500 hover:text-red-400 text-xs">Delete</button>
              </div>
            </div>

            {/* Progress bar */}
            <div className="mt-2 h-1.5 w-full rounded-full bg-slate-700">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} />
            </div>

            {/* Items */}
            <ul className="mt-2 space-y-1">
              {items.map((item: any) => (
                <li key={item.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={item.completed}
                    onChange={() => toggleMutation.mutate({ checklistId: cl.id, itemId: item.id, completed: !item.completed })}
                    className="rounded border-slate-600"
                  />
                  <span className={`text-sm ${item.completed ? "text-slate-500 line-through" : "text-slate-300"}`}>{item.title}</span>
                  <button onClick={() => removeItemMutation.mutate({ checklistId: cl.id, itemId: item.id })} className="ml-auto text-slate-600 hover:text-red-400 text-xs">x</button>
                </li>
              ))}
            </ul>

            {/* Add item */}
            <form onSubmit={(e) => { e.preventDefault(); const t = newItemText[cl.id]?.trim(); if (t) { addItemMutation.mutate({ checklistId: cl.id, title: t }); setNewItemText(prev => ({ ...prev, [cl.id]: "" })); } }} className="mt-2 flex gap-1">
              <input value={newItemText[cl.id] ?? ""} onChange={(e) => setNewItemText(prev => ({ ...prev, [cl.id]: e.target.value }))} placeholder="Add item..." className="flex-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-white" />
              <button type="submit" className="rounded bg-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-600">+</button>
            </form>
          </div>
        );
      })}

      {/* Create new checklist */}
      <form onSubmit={(e) => { e.preventDefault(); if (newName.trim()) createMutation.mutate({ cardId, boardId, name: newName.trim() }); }} className="mt-2 flex gap-2">
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New checklist name..." className="flex-1 rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-white" />
        <button type="submit" disabled={!newName.trim()} className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">Add</button>
      </form>
    </div>
  );
}
