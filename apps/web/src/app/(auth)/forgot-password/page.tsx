"use client";
import { useState } from "react";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    // TODO: call API to send reset email
    await new Promise((r) => setTimeout(r, 1000));
    setSent(true);
    setLoading(false);
  };

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-800 p-8 text-center">
          <h1 className="text-xl font-bold text-white mb-4">✓ ایمیل ارسال شد</h1>
          <p className="text-slate-300 text-sm">اگر ایمیلی با این آدرس ثبت شده باشد، لینک بازنشانی رمز عبور ارسال شده است.</p>
          <Link href="/login" className="mt-4 inline-block text-blue-400 hover:text-blue-300 text-sm">بازگشت به ورود</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900">
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-800 p-8 shadow-2xl">
        <h1 className="text-2xl font-bold text-white text-center mb-6">بازنشانی رمز عبور</h1>
        <p className="text-sm text-slate-400 text-center mb-4">ایمیل خود را وارد کنید تا لینک بازنشانی ارسال شود.</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="ایمیل" className="w-full rounded-lg border border-slate-600 bg-slate-700 px-4 py-2.5 text-white focus:border-blue-500 focus:outline-none" />
          <button type="submit" disabled={loading || !email} className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">
            {loading ? "در حال ارسال..." : "ارسال لینک بازنشانی"}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-slate-400">
          <Link href="/login" className="text-blue-400 hover:text-blue-300">بازگشت به ورود</Link>
        </p>
      </div>
    </div>
  );
}
