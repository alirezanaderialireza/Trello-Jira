"use client";
import { signIn } from "next-auth/react";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

// ─────────────────────────────────────────────────────────────────────────────
// Disable static generation. This page reads `callbackUrl` from the URL via
// `useSearchParams()`, which Next.js refuses to statically prerender unless
// the consuming component is wrapped in <Suspense>. Auth pages should never
// be statically cached anyway — they branch on per-request URL params and on
// session cookies. `force-dynamic` makes Next render at request time, which
// is the correct semantics here and sidesteps the prerender pass.
// ─────────────────────────────────────────────────────────────────────────────
export const dynamic = "force-dynamic";

export default function LoginPage() {
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
        {error && <div className="mb-4 rounded-lg bg-red-900/30 border border-red-800 p-3 text-sm text-red-300">{error}</div>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">ایمیل</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full rounded-lg border border-slate-600 bg-slate-700 px-4 py-2.5 text-white focus:border-blue-500 focus:outline-none" />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">رمز عبور</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required className="w-full rounded-lg border border-slate-600 bg-slate-700 px-4 py-2.5 text-white focus:border-blue-500 focus:outline-none" />
          </div>
          <button type="submit" disabled={loading} className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">
            {loading ? "در حال ورود..." : "ورود"}
          </button>
        </form>
        <div className="mt-4 text-center text-sm text-slate-400">
          <Link href="/signup" className="text-blue-400 hover:text-blue-300">ثبت‌نام</Link>
          <span className="mx-2">•</span>
          <Link href="/forgot-password" className="text-slate-500 hover:text-slate-300">فراموشی رمز</Link>
          <span className="mx-2">•</span>
          <Link href="/verify-email" className="text-slate-500 hover:text-slate-300">تأیید ایمیل</Link>
        </div>
      </div>
    </div>
  );
}
