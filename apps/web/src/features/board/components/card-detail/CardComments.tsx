"use client";

import { useState } from "react";
import { trpc } from "../../../../utils/trpc";

interface Props { cardId: string; boardId: string; }

export function CardComments({ cardId, boardId }: Props) {
  const { data, refetch } = trpc.v1.public.comment.getByCard.useQuery({ cardId });
  const [body, setBody] = useState("");

  const addMutation = trpc.v1.public.comment.create.useMutation({
    onSuccess: () => { refetch(); setBody(""); },
  });
  const deleteMutation = trpc.v1.public.comment.delete.useMutation({ onSuccess: () => refetch() });

  const comments = data?.comments ?? [];

  return (
    <div>
      {/* Comment input */}
      <form onSubmit={(e) => { e.preventDefault(); if (body.trim()) addMutation.mutate({ cardId, boardId, body: body.trim() }); }} className="mb-4">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write a comment..."
          rows={3}
          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
        />
        <div className="mt-2 flex justify-end">
          <button type="submit" disabled={!body.trim() || addMutation.isPending} className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">
            {addMutation.isPending ? "Sending..." : "Comment"}
          </button>
        </div>
      </form>

      {/* Comments list */}
      <div className="space-y-3">
        {comments.map((c: any) => (
          <div key={c.id} className="rounded-lg border border-slate-700/50 bg-slate-900/30 p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-600 text-[10px] font-bold text-slate-300">
                  {c.authorId?.slice(0, 2).toUpperCase()}
                </div>
                <span className="text-xs font-medium text-slate-300">{c.authorId}</span>
                <span className="text-[10px] text-slate-500">{new Date(c.createdAt).toLocaleString()}</span>
                {c.editedAt && <span className="text-[10px] text-slate-600">(edited)</span>}
              </div>
              <button onClick={() => deleteMutation.mutate({ commentId: c.id })} className="text-[10px] text-slate-600 hover:text-red-400">delete</button>
            </div>
            <p className="mt-1.5 text-sm text-slate-300 whitespace-pre-wrap">{c.body}</p>
          </div>
        ))}

        {comments.length === 0 && (
          <p className="text-center text-sm text-slate-500 py-4">No comments yet</p>
        )}
      </div>
    </div>
  );
}
