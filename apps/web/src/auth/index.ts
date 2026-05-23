// apps/web/src/auth/index.ts
//
// ─── Why the explicit `: NextAuthResult` annotation ──────────────────────────
// Without it, `tsc --noEmit` (which Next.js runs as part of its build) fails:
//
//   Type error: The inferred type of 'auth' cannot be named without a
//   reference to 'AppRouteHandlerFn' from '../../node_modules/next-auth/
//   lib/types'. This is likely not portable. A type annotation is necessary.
//
// The inferred return shape of `NextAuth(authConfig)` reaches into a
// non-public sub-path of `next-auth` (`next-auth/lib/types`) for
// `AppRouteHandlerFn`. With declaration emit / project references active
// (Next 15 does this implicitly when typechecking) TS refuses to write a
// declaration whose type names a module it can't import portably.
//
// Anchoring the destructure to the public `NextAuthResult` type bypasses
// the inference walk: TS now writes `auth: NextAuthResult["auth"]`
// instead of trying to spell out the deep handler type, and the build
// succeeds.
// ─────────────────────────────────────────────────────────────────────────────
import NextAuth, { type NextAuthResult } from "next-auth";
import { authConfig } from "./config";

export const { handlers, auth, signIn, signOut }: NextAuthResult =
  NextAuth(authConfig);
