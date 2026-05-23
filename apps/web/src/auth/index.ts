// apps/web/src/auth/index.ts
//
// ─── Why each export gets its own annotation ─────────────────────────────────
// Next 15's typecheck runs with declaration emit / project references on
// and refuses to write a portable .d.ts for `auth` because its inferred
// type drags in `AppRouteHandlerFn` from `next-auth/lib/types` — a deep
// sub-path that is not part of next-auth's public exports map:
//
//   Type error: The inferred type of 'auth' cannot be named without a
//   reference to 'AppRouteHandlerFn' from 'next-auth/lib/types'. This
//   is likely not portable. A type annotation is necessary.
//
// A single annotation on the destructure (`const { auth }: NextAuthResult
// = ...`) does NOT propagate to the individual bindings — TypeScript
// still infers each binding's type from the source value and the
// declaration emitter still walks into the deep path. The portable fix
// is to give each export its own explicit type via the public indexed
// access types `NextAuthResult["auth"]`, `NextAuthResult["handlers"]`,
// etc. Indexed access is preserved verbatim in the emitted .d.ts and
// `NextAuthResult` is importable from the package root, so the
// declaration writer never needs to chase the private sub-path.
// ─────────────────────────────────────────────────────────────────────────────
import NextAuth, { type NextAuthResult } from "next-auth";
import { authConfig } from "./config";

const nextAuth = NextAuth(authConfig);

export const handlers: NextAuthResult["handlers"] = nextAuth.handlers;
export const auth: NextAuthResult["auth"] = nextAuth.auth;
export const signIn: NextAuthResult["signIn"] = nextAuth.signIn;
export const signOut: NextAuthResult["signOut"] = nextAuth.signOut;
