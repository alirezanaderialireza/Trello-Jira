// apps/web/middleware.ts
// Edge-compatible route protection. No native crypto — only session check.
export { auth as middleware } from "@/auth";

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/auth|api/health|api/trpc|login|signup|forgot-password|reset-password|verify-email).*)"],
};
