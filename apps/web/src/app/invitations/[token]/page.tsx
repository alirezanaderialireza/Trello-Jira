// apps/web/src/app/invitations/[token]/page.tsx
//
// Public page that shows an invitation summary and lets the recipient
// accept it. Three audiences land here:
//
//   1. Logged-out user clicking the email link        → see invitation
//      details, then "ورود/ثبت‌نام برای پذیرش" CTA pointing at
//      /login?callbackUrl=/invitations/[token].
//   2. Logged-in user with the matching email         → see the
//      invitation details + "پذیرش دعوت" button (Server Action).
//      On success, redirect to /workspaces/[slug].
//   3. Logged-in user with a DIFFERENT email          → button is
//      shown anyway (we cannot reliably compare against the masked
//      email server-side), and the EMAIL_MISMATCH error path in
//      the action surfaces a "خروج و ورود با ایمیل درست" CTA.
//
// The page is force-dynamic because:
//   • The invitation row state (revoked / accepted) changes via
//     other actions and we always want the freshest view.
//   • The session may be present or absent — Next would otherwise
//     try to prerender, which fails for getWebSession() that calls
//     auth() under the hood.

import { notFound } from "next/navigation";

import { getWebSession } from "@/auth/getServerSession";
import { appRouter, createContext } from "@repo/api";
import { AcceptInvitationCard } from "@/features/invitation/AcceptInvitationCard";

import { acceptInvitationAction } from "./_actions/acceptInvitation";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function InvitationPage({ params }: PageProps) {
  const { token } = await params;

  // getByToken is a `publicProcedure` so a missing session is fine.
  // The Drizzle session adapter happily round-trips a null session
  // through createContext (it's typed as nullable on the public
  // surface). We cast at the boundary because the @repo/api Session
  // type is structurally the same as the next-auth shape we get
  // back from getWebSession.
  const session = await getWebSession();
  const ctx = await createContext({ session: (session ?? null) as any });
  const caller = appRouter.createCaller(ctx);

  let invitation;
  try {
    invitation = await caller.v1.public.workspace.invitations.getByToken({
      token,
    });
  } catch {
    // Procedure throws NOT_FOUND for missing / unknown tokens. Render
    // Next's not-found.tsx (or default 404 page) so attackers
    // probing tokens don't get a useful response shape.
    notFound();
  }

  return (
    <AcceptInvitationCard
      token={token}
      invitation={invitation}
      isLoggedIn={Boolean(session)}
      currentUserEmail={session?.user?.email ?? null}
      currentUserDisplayName={session?.user?.name ?? null}
      onAccept={acceptInvitationAction}
    />
  );
}
