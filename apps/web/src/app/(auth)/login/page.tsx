"use client";
// ─────────────────────────────────────────────────────────────────────────────
// Login page.
//
// Reads `callbackUrl` from the URL via `useSearchParams()` so the user is
// returned to wherever they were trying to reach before the redirect.
//
// ─── Why the default export is a Suspense wrapper ───────────────────────────
// Next.js refuses to statically prerender a client component that calls
// `useSearchParams()` at the top level:
//
//   ⨯ useSearchParams() should be wrapped in a suspense boundary at
//     page "/login"
//
// `export const dynamic = "force-dynamic"` is *ignored* on a client
// component in Next 16 + Turbopack — only segment-level files (layout.tsx /
// route.ts) honour it. The idiomatic fix is to move the hook into an inner
// component and wrap it in <Suspense>. Next then prerenders the fallback
// at build time and resolves the params on the client.
// ─────────────────────────────────────────────────────────────────────────────
import { signIn } from "next-auth/react";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/workspaces";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await signIn("credentials", { email, password, redirect: false, callbackUrl });
    setLoading(false);
    if (res?.error) { setError("ایمیل یا رمز عبور اشتباه است"); return; }
    router.push(callbackUrl);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900">
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-800 p-8 shadow-2xl">
        <h1 className="text-2xl font-bold text-white text-center mb-6">ورود به Trello OS</h1>
        {error && <div id="login-error" role="alert" className="mb-4 rounded-lg bg-red-900/30 border border-red-800 p-3 text-sm text-red-300">{error}</div>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="login-email" className="block text-sm text-slate-300 mb-1">ایمیل</label>
            <input id="login-email" name="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required aria-describedby={error ? "login-error" : undefined} className="w-full rounded-lg border border-slate-600 bg-slate-700 px-4 py-2.5 text-white focus:border-blue-500 focus:outline-none" />
          </div>
          <div>
            <label htmlFor="login-password" className="block text-sm text-slate-300 mb-1">رمز عبور</label>
            <input id="login-password" name="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required aria-describedby={error ? "login-error" : undefined} className="w-full rounded-lg border border-slate-600 bg-slate-700 px-4 py-2.5 text-white focus:border-blue-500 focus:outline-none" />
          </div>
          <button type="submit" disabled={loading} className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">
            {loading ? "در حال ورود..." : "ورود"}
          </button>
        </form>
        <div className="mt-4 text-center text-sm text-slate-300">
          <Link href="/signup" className="text-blue-400 hover:text-blue-300">ثبت‌نام</Link>
          <span className="mx-2">•</span>
          <Link href="/forgot-password" className="text-slate-300 hover:text-white">فراموشی رمز</Link>
          <span className="mx-2">•</span>
          <Link href="/verify-email" className="text-slate-300 hover:text-white">تأیید ایمیل</Link>
        </div>
      </div>
    </div>
  );
}

// Shell rendered at build time. Matches the form's outer chrome so there's
// no layout shift when the inner content hydrates on the client.
function LoginFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900">
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-800 p-8 shadow-2xl">
        <h1 className="text-2xl font-bold text-white text-center mb-6">ورود به Trello OS</h1>
        <div className="h-40" />
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginForm />
    </Suspense>
  );
}
