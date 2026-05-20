"use client";
import { trpc } from "../../../utils/trpc";
import { useParams } from "next/navigation";
import Link from "next/link";

export default function WorkspaceDetailPage() {
  const params = useParams();
  const slug = params.slug as string;
  const { data: workspace, isLoading } = trpc.v1.public.workspace.getBySlug.useQuery({ slug });

  if (isLoading) return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-400">Loading workspace...</div>;
  if (!workspace) return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-red-400">Workspace not found</div>;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">{workspace.name}</h1>
            <p className="text-sm text-slate-500">/{workspace.slug} • {workspace.role}</p>
          </div>
          <Link href="/workspaces" className="text-sm text-slate-400 hover:text-white">← All Workspaces</Link>
        </div>

        <div className="rounded-lg border border-slate-700 bg-slate-800 p-6">
          <p className="text-slate-300">Boards in this workspace will appear here.</p>
          <p className="text-xs text-slate-500 mt-2">Navigate to a board to start collaborating.</p>
        </div>
      </div>
    </div>
  );
}
