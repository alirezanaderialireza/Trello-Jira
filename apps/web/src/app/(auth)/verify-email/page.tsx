"use client";
// ─────────────────────────────────────────────────────────────────────────────
// Email verification landing page.
//
// Two flows:
//   1. With ?token=...   → call /api/auth/verify-email and show the result.
//   2. Without a token   → show "check your inbox" text + "resend" form
//                          (the page user lands on after signup).
//
// ─── Suspense wrapper ───────────────────────────────────────────────────────
// `useSearchParams()` can't be prerendered without a <Suspense> boundary in
// Next 16. Inner component does the work, default export wraps it.
// ─────────────────────────────────────────────────────────────────────────────

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

type VerifyStatus = "idle" | "loading" | "success" | "alreadyVerified" | "error";

function VerifyEmailInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [status, setStatus] = useState<VerifyStatus>(token ? "loading" : "idle");
  const [errorMessage, setErrorMessage] = useState<string>("");

  // Resend form state — only used when status === "idle" or "error".
  const [resendEmail, setResendEmail] = useState("");
  const [resendSent, setResendSent] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);

  // ── 1. Verify the token (when present) ────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/auth/verify-email?token=${encodeURIComponent(token)}`,
        );
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          setStatus(data.alreadyVerified ? "alreadyVerified" : "success");
        } else {
          const data = await res.json().catch(() => ({}));
          setErrorMessage(
            data.message || "لینک نامعتبر یا منقضی شده است.",
          );
          setStatus("error");
        }
      } catch {
        if (cancelled) return;
        setErrorMessage("خطای شبکه. اتصال خود را بررسی کنید.");
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // ── 2. Resend handler ────────────────────────────────────────────────────
  const handleResend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resendEmail) return;
    setResendLoading(true);
    try {
      await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: resendEmail }),
      });
      // Anti-enumeration: the endpoint always returns 200, so we always
      // confirm to the user. Whether an email was actually sent depends on
      // server-side state.
      setResendSent(true);
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-800 p-8 text-center">
        {/* ── verifying ── */}
        {status === "loading" && (
          <>
            <div className="h-8 w-8 mx-auto animate-spin rounded-full border-2 border-slate-600 border-t-blue-400 mb-4" />
            <p className="text-slate-300">در حال تأیید ایمیل...</p>
          </>
        )}

        {/* ── success ── */}
        {(status === "success" || status === "alreadyVerified") && (
          <>
            <h1 className="text-xl font-bold text-green-400 mb-4">✓ ایمیل تأیید شد</h1>
            <p className="text-slate-300 text-sm mb-4">
              {status === "alreadyVerified"
                ? "این ایمیل پیش از این تأیید شده است."
                : "حساب شما فعال شد. اکنون می‌توانید وارد شوید."}
            </p>
            <Link href="/login" className="text-blue-400 hover:text-blue-300 text-sm">
              ورود به حساب
            </Link>
          </>
        )}

        {/* ── error (with resend form) ── */}
        {status === "error" && !resendSent && (
          <>
            <h1 className="text-xl font-bold text-red-400 mb-4">✗ خطا</h1>
            <p role="alert" className="text-slate-300 text-sm mb-4">{errorMessage}</p>
            <form onSubmit={handleResend} className="space-y-3">
              <label htmlFor="verify-resend-email-error" className="sr-only">ایمیل برای ارسال لینک جدید</label>
              <input
                id="verify-resend-email-error"
                name="email"
                type="email"
                autoComplete="email"
                value={resendEmail}
                onChange={(e) => setResendEmail(e.target.value)}
                required
                placeholder="ایمیل برای ارسال لینک جدید"
                className="w-full rounded-lg border border-slate-600 bg-slate-700 px-4 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={resendLoading || !resendEmail}
                className="w-full rounded-lg bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {resendLoading ? "در حال ارسال..." : "ارسال لینک جدید"}
              </button>
            </form>
            <Link href="/login" className="mt-4 inline-block text-slate-400 hover:text-slate-200 text-sm">
              بازگشت به ورود
            </Link>
          </>
        )}

        {/* ── idle (no token, e.g. landed here after signup) ── */}
        {status === "idle" && !resendSent && (
          <>
            <h1 className="text-xl font-bold text-white mb-4">صندوق ایمیل خود را بررسی کنید</h1>
            <p className="text-slate-300 text-sm mb-4">
              لینک تأیید برای فعال‌سازی حساب ارسال شد. اگر آن را دریافت نکرده‌اید،
              لطفاً ایمیل خود را وارد کرده تا لینک مجدد ارسال شود.
            </p>
            <form onSubmit={handleResend} className="space-y-3">
              <label htmlFor="verify-resend-email-idle" className="sr-only">ایمیل</label>
              <input
                id="verify-resend-email-idle"
                name="email"
                type="email"
                autoComplete="email"
                value={resendEmail}
                onChange={(e) => setResendEmail(e.target.value)}
                required
                placeholder="ایمیل"
                className="w-full rounded-lg border border-slate-600 bg-slate-700 px-4 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={resendLoading || !resendEmail}
                className="w-full rounded-lg bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {resendLoading ? "در حال ارسال..." : "ارسال مجدد لینک"}
              </button>
            </form>
            <Link href="/login" className="mt-4 inline-block text-slate-400 hover:text-slate-200 text-sm">
              بازگشت به ورود
            </Link>
          </>
        )}

        {/* ── resend sent ── */}
        {resendSent && (
          <>
            <h1 className="text-xl font-bold text-white mb-4">✓ ایمیل ارسال شد</h1>
            <p className="text-slate-300 text-sm">
              اگر ایمیلی با این آدرس ثبت شده و هنوز تأیید نشده باشد، لینک تأیید
              ارسال شده است.
            </p>
            <Link href="/login" className="mt-4 inline-block text-blue-400 hover:text-blue-300 text-sm">
              بازگشت به ورود
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

// Shell rendered at build time. Matches the inner card so there's no
// layout shift when the content hydrates on the client.
function VerifyEmailFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-800 p-8 text-center">
        <div className="h-8 w-8 mx-auto animate-spin rounded-full border-2 border-slate-600 border-t-blue-400 mb-4" />
        <p className="text-slate-300">در حال بارگذاری...</p>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<VerifyEmailFallback />}>
      <VerifyEmailInner />
    </Suspense>
  );
}
