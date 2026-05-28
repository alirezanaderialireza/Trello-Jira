// apps/web/src/app/invitations/[token]/layout.tsx
//
// Minimal page chrome for the public invitation accept flow.
//
// Logged-out users may land here from a deep link in their email,
// so we deliberately do NOT use the (app) AppShell — that would
// require a session and bounce them to /login. The card itself
// decides what CTA to render based on auth state (see
// AcceptInvitationCard); this layout just provides a centered
// wrapper and a neutral light background that reads well under
// both Persian and Latin text.
//
// The root layout (apps/web/src/app/layout.tsx) already sets
// <html lang="fa" dir="rtl">, so we don't repeat that here.

export default function InvitationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-8">
      {children}
    </div>
  );
}
