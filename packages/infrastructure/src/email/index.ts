// packages/infrastructure/src/email/index.ts
// Email sending — console in dev, Resend in production.

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface EmailSender {
  send(payload: EmailPayload): Promise<{ success: boolean; messageId?: string }>;
}

// ── Console sender (dev) ─────────────────────────────────────────────────────

export class ConsoleEmailSender implements EmailSender {
  async send(payload: EmailPayload) {
    console.log(`\n📧 [DEV EMAIL]\n  To: ${payload.to}\n  Subject: ${payload.subject}\n  Body: ${payload.text || payload.html.slice(0, 200)}...\n`);
    return { success: true, messageId: `dev-${Date.now()}` };
  }
}

// ── Resend sender (prod) ─────────────────────────────────────────────────────

export class ResendEmailSender implements EmailSender {
  private apiKey: string;
  private from: string;

  constructor(apiKey?: string, from?: string) {
    this.apiKey = apiKey || process.env.RESEND_API_KEY || "";
    this.from = from || process.env.EMAIL_FROM || "noreply@trello-os.app";
  }

  async send(payload: EmailPayload) {
    if (!this.apiKey) {
      console.warn("[Email] RESEND_API_KEY not set — falling back to console");
      return new ConsoleEmailSender().send(payload);
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: this.from, to: payload.to, subject: payload.subject, html: payload.html, text: payload.text }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[Email] Resend API error:", err);
      return { success: false };
    }

    const data = await res.json();
    return { success: true, messageId: data.id };
  }
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createEmailSender(): EmailSender {
  if (process.env.NODE_ENV === "production" && process.env.RESEND_API_KEY) {
    return new ResendEmailSender();
  }
  return new ConsoleEmailSender();
}

// ── Email templates ──────────────────────────────────────────────────────────

export function magicLinkEmailHtml(url: string, displayName: string): string {
  return `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
      <h2 style="color:#1e293b;">سلام ${displayName}!</h2>
      <p style="color:#475569;">برای ورود به Trello OS روی لینک زیر کلیک کنید:</p>
      <a href="${url}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold;">ورود به حساب</a>
      <p style="color:#94a3b8;font-size:12px;margin-top:24px;">این لینک تا ۱۰ دقیقه معتبر است.</p>
    </div>
  `;
}

export function passwordResetEmailHtml(url: string, displayName: string): string {
  return `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
      <h2 style="color:#1e293b;">بازنشانی رمز عبور</h2>
      <p style="color:#475569;">${displayName} عزیز، برای تغییر رمز عبور روی لینک زیر کلیک کنید:</p>
      <a href="${url}" style="display:inline-block;padding:12px 24px;background:#dc2626;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold;">تغییر رمز عبور</a>
      <p style="color:#94a3b8;font-size:12px;margin-top:24px;">اگر شما این درخواست را ارسال نکرده‌اید، این ایمیل را نادیده بگیرید.</p>
    </div>
  `;
}

export function emailVerificationHtml(url: string, displayName: string): string {
  return `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
      <h2 style="color:#1e293b;">به Trello OS خوش آمدید!</h2>
      <p style="color:#475569;">${displayName} عزیز، برای فعال‌سازی حساب خود روی لینک زیر کلیک کنید:</p>
      <a href="${url}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold;">تأیید ایمیل</a>
      <p style="color:#94a3b8;font-size:12px;margin-top:24px;">این لینک تا ۲۴ ساعت معتبر است. اگر این حساب را شما نساخته‌اید، این ایمیل را نادیده بگیرید.</p>
    </div>
  `;
}
