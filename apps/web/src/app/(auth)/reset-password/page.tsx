"use client";
// ─────────────────────────────────────────────────────────────────────────────
// Reset Password page.
//
// Reads `token` and `email` from the URL (placed there by the link in the
// password-reset email), collects the new password from the user, and POSTs
// to /api/auth/reset-password.
//
// Validation here mirrors the server-side rules so users get instant
// feedback. The server is the source of truth — anything that slips past the
// client check is rejected there too.
//
// ─── Suspense wrapper ───────────────────────────────────────────────────────
// `useSearchParams()` can't be prerendered without a <Suspense> boundary in
// Next 16. Inner component does the work, default export wraps it.
// ─────────────────────────────────────────────────────────────────────────────

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";

function ResetPasswordForm() {
  const params = useSearchParams();
  const router = useRouter();

  const token = params.get("token") ?? "";
  const email = params.get("email") ?? "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  // Guard: if the URL is missing required params, surface the failure
  // immediately rather than letting the user fill out a form that can't work.
  const linkValid = Boolean(token && email);

  useEffect(() => {
    if (!linkValid) {
      setError("لینک نامعتبر است. لطفاً درخواست بازنشانی جدیدی ارسال کنید.");
    }
  }, [linkValid]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!linkValid) return;
    if (password !== confirmPassword) {
      setError("رمز عبور و تکرار آن یکسان نیستند");
      return;
    }
    if (password.length < 8) {
      setError("رمز عبور باید حداقل ۸ کاراکتر باشد");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || "خطایی رخ داد. لینک ممکن است منقضی شده باشد.");
        return;
      }
      setSuccess(true);
      // Redirect to login after a short pause so the user reads the toast.
      setTimeout(() => router.push("/login"), 2000);
    } catch {
      setError("خطای شبکه. اتصال خود را بررسی کنید.");
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 p-4">
        <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-800 p-8 text-center">
          <h1 className="text-xl font-bold text-green-400 mb-4">✓ رمز عبور تغییر کرد</h1>
          <p className="text-slate-300 text-sm mb-4">
            رمز عبور شما با موفقیت بازنشانی شد. در حال انتقال به صفحه ورود...
          </p>
          <Link href="/login" className="text-blue-400 hover:text-blue-300 text-sm">
            ورود به حساب
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-800 p-8 shadow-2xl">
        <h1 className="text-2xl font-bold text-white text-center mb-6">تنظیم رمز عبور جدید</h1>
        {email && (
          <p className="text-sm text-slate-400 text-center mb-4">
            برای حساب: <span dir="ltr" className="font-mono text-slate-200">{email}</span>
          </p>
        )}
        {error && (
          <div role="alert" className="mb-4 rounded-lg bg-red-900/30 border border-red-800 p-3 text-sm text-red-300">
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="reset-password" className="block text-sm text-slate-300 mb-1">رمز عبور جدید</label>
            <input
              id="reset-password"
              name="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              disabled={!linkValid}
              className="w-full rounded-lg border border-slate-600 bg-slate-700 px-4 py-2.5 text-white focus:border-blue-500 focus:outline-none disabled:opacity-50"
            />
          </div>
          <div>
            <label htmlFor="reset-confirmPassword" className="block text-sm text-slate-300 mb-1">تکرار رمز عبور</label>
            <input
              id="reset-confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              disabled={!linkValid}
              className="w-full rounded-lg border border-slate-600 bg-slate-700 px-4 py-2.5 text-white focus:border-blue-500 focus:outline-none disabled:opacity-50"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !linkValid}
            className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {loading ? "در حال ذخیره..." : "ذخیره رمز جدید"}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-slate-400">
          <Link href="/login" className="text-blue-400 hover:text-blue-300">
            بازگشت به ورود
          </Link>
        </p>
      </div>
    </div>
  );
}

// Shell rendered at build time. Matches the form's outer chrome so there's
// no layout shift when the inner content hydrates on the client.
function ResetPasswordFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-800 p-8 shadow-2xl">
        <h1 className="text-2xl font-bold text-white text-center mb-6">تنظیم رمز عبور جدید</h1>
        <div className="h-40" />
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<ResetPasswordFallback />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
