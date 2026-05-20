"use client";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";

export default function VerifyEmailPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");

  useEffect(() => {
    if (!token) { setStatus("error"); return; }

    // TODO: call API to verify token
    const verify = async () => {
      try {
        const res = await fetch(`/api/auth/verify-email?token=${token}`);
        if (res.ok) setStatus("success");
        else setStatus("error");
      } catch { setStatus("error"); }
    };
    verify();
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900">
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-800 p-8 text-center">
        {status === "loading" && (
          <>
            <div className="h-8 w-8 mx-auto animate-spin rounded-full border-2 border-slate-600 border-t-blue-400 mb-4" />
            <p className="text-slate-300">در حال تأیید ایمیل...</p>
          </>
        )}
        {status === "success" && (
          <>
            <h1 className="text-xl font-bold text-green-400 mb-4">✓ ایمیل تأیید شد</h1>
            <p className="text-slate-300 text-sm mb-4">حساب شما فعال شد. اکنون می‌توانید وارد شوید.</p>
            <Link href="/login" className="text-blue-400 hover:text-blue-300 text-sm">ورود به حساب</Link>
          </>
        )}
        {status === "error" && (
          <>
            <h1 className="text-xl font-bold text-red-400 mb-4">✗ خطا</h1>
            <p className="text-slate-300 text-sm mb-4">لینک تأیید نامعتبر یا منقضی شده است.</p>
            <Link href="/login" className="text-blue-400 hover:text-blue-300 text-sm">بازگشت</Link>
          </>
        )}
      </div>
    </div>
  );
}
