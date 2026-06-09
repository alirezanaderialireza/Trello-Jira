"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { trpc } from "../../../utils/trpc";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirmPassword) { setError("رمز عبور و تکرار آن یکسان نیستند"); return; }
    if (password.length < 8) { setError("رمز عبور باید حداقل ۸ کاراکتر باشد"); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, displayName, password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || "خطا در ثبت‌نام"); setLoading(false); return; }
      setSuccess(true);
    } catch { setError("خطای شبکه"); }
    setLoading(false);
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-800 p-8 text-center">
          <h1 className="text-xl font-bold text-white mb-4">✓ ثبت‌نام موفق</h1>
          <p className="text-slate-300 text-sm mb-2">
            ایمیل تأیید برای <span dir="ltr" className="font-mono text-slate-200">{email}</span> ارسال شد.
          </p>
          <p className="text-slate-400 text-xs mb-4">
            برای فعال‌سازی حساب، لینک داخل ایمیل را باز کنید.
          </p>
          <div className="flex flex-col gap-2">
            <Link href="/verify-email" className="text-blue-400 hover:text-blue-300 text-sm">
              ارسال مجدد لینک تأیید
            </Link>
            <Link href="/login" className="text-slate-500 hover:text-slate-300 text-sm">
              بازگشت به صفحه ورود
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900">
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-800 p-8 shadow-2xl">
        <h1 className="text-2xl font-bold text-white text-center mb-6">ثبت‌نام در Trello OS</h1>
        {error && <div id="signup-error" role="alert" className="mb-4 rounded-lg bg-red-900/30 border border-red-800 p-3 text-sm text-red-300">{error}</div>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="signup-displayName" className="block text-sm text-slate-300 mb-1">نام نمایشی</label>
            <input id="signup-displayName" type="text" name="displayName" autoComplete="name" placeholder="نام نمایشی" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={100} className="w-full rounded-lg border border-slate-600 bg-slate-700 px-4 py-2.5 text-white focus:border-blue-500 focus:outline-none" />
          </div>
          <div>
            <label htmlFor="signup-email" className="block text-sm text-slate-300 mb-1">ایمیل</label>
            <input id="signup-email" type="email" name="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full rounded-lg border border-slate-600 bg-slate-700 px-4 py-2.5 text-white focus:border-blue-500 focus:outline-none" />
          </div>
          <div>
            <label htmlFor="signup-password" className="block text-sm text-slate-300 mb-1">رمز عبور</label>
            <input id="signup-password" type="password" name="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} className="w-full rounded-lg border border-slate-600 bg-slate-700 px-4 py-2.5 text-white focus:border-blue-500 focus:outline-none" />
          </div>
          <div>
            <label htmlFor="signup-confirmPassword" className="block text-sm text-slate-300 mb-1">تکرار رمز عبور</label>
            <input id="signup-confirmPassword" type="password" name="confirmPassword" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required className="w-full rounded-lg border border-slate-600 bg-slate-700 px-4 py-2.5 text-white focus:border-blue-500 focus:outline-none" />
          </div>
          <button type="submit" disabled={loading} className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">
            {loading ? "در حال ثبت‌نام..." : "ثبت‌نام"}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-slate-400">
          قبلاً ثبت‌نام کرده‌اید؟ <Link href="/login" className="text-blue-400 hover:text-blue-300">ورود</Link>
        </p>
      </div>
    </div>
  );
}
