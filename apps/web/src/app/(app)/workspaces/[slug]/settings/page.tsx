// apps/web/src/app/(app)/workspaces/[slug]/settings/page.tsx
//
// Bare /workspaces/[slug]/settings entry point. Always redirects to
// the General tab so the URL has a single canonical landing form.
// Bookmarks of /settings (without a tab segment) keep working
// indefinitely because this page just re-issues the redirect.

import { redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function SettingsIndexPage({ params }: PageProps) {
  const { slug } = await params;
  redirect(`/workspaces/${slug}/settings/general`);
}
