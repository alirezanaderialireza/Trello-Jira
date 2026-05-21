"use client";
import { useState } from "react";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      // The endpoint always returns 200 on success (no enumeration leak),
      // so any non-OK response is a transport / rate-limit error worth surfacing.
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message || "خطایی رخ داد. لطفاً دوباره تلاش کنید.");
        return;
      }
      setSent(true);
    } catch {
      setError("خطای شبکه. اتصال خود را بررسی کنید.");
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-800 p-8 text-center">
          <h1 className="text-xl font-bold text-white mb-4">✓ ایمیل ارسال شد</h1>
          <p className="text-slate-300 text-sm">
            اگر ایمیلی با این آدرس ثبت شده باشد، لینک بازنشانی رمز عبور ارسال شده است.
            لینک تا یک ساعت معتبر است.
          </p>
          <Link href="/login" className="mt-4 inline-block text-blue-400 hover:text-blue-300 text-sm">
            بازگشت به ورود
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900">
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-800 p-8 shadow-2xl">
        <h1 className="text-2xl font-bold text-white text-center mb-6">بازنشانی رمز عبور</h1>
        <p className="text-sm text-slate-400 text-center mb-4">
          ایمیل خود را وارد کنید تا لینک بازنشانی ارسال شود.
        </p>
        {error && (
          <div className="mb-4 rounded-lg bg-red-900/30 border border-red-800 p-3 text-sm text-red-300">
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="ایمیل"
            className="w-full rounded-lg border border-slate-600 bg-slate-700 px-4 py-2.5 text-white focus:border-blue-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={loading || !email}
            className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {loading ? "در حال ارسال..." : "ارسال لینک بازنشانی"}
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
