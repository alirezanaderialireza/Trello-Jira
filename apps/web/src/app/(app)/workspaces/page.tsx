"use client";
import { trpc } from "../../../utils/trpc";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

export default function WorkspacesPage() {
  const { data, isLoading, refetch } = trpc.v1.public.workspace.list.useQuery();
  const [name, setName] = useState("");
  const createMutation = trpc.v1.public.workspace.create.useMutation({
    onSuccess: () => { refetch(); setName(""); toast.success("فضای کاری ساخته شد."); },
    onError: (e: any) => toast.error(e.message),
  });

  const workspacesList = data ?? [];

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">فضاهای کاری</h1>

        {isLoading && <p className="text-slate-300">در حال بارگذاری...</p>}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {workspacesList.map((ws: any) => (
            <Link key={ws.id} href={`/workspaces/${ws.slug}`} className="rounded-lg border border-slate-700 bg-slate-800 p-4 hover:border-slate-500 transition-colors">
              <h3 className="font-semibold text-white truncate">{ws.name}</h3>
              <p className="text-xs text-slate-400 mt-1">/{ws.slug}</p>
              <span className="mt-2 inline-block rounded bg-slate-700 px-2 py-0.5 text-[10px] uppercase text-slate-300">{ws.role}</span>
            </Link>
          ))}
        </div>

        {/* Create workspace */}
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
          <h2 className="text-sm font-semibold text-slate-300 mb-3">ساخت فضای کاری جدید</h2>
          <form onSubmit={(e: any) => { e.preventDefault(); if (name.trim()) createMutation.mutate({ name: name.trim() }); }} className="flex gap-2">
            <input value={name} onChange={(e: any) => setName(e.target.value)} placeholder="نام فضای کاری..." className="flex-1 rounded-lg border border-slate-600 bg-slate-700 px-4 py-2 text-sm text-white focus:border-blue-500 focus:outline-none" />
            <button type="submit" disabled={!name.trim() || createMutation.isPending} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">ساخت</button>
          </form>
        </div>
      </div>
    </div>
  );
}
