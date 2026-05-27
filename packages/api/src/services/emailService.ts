// packages/api/src/services/emailService.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// Email Service — interface + Mock implementation (F3a.3)
//
// F3a.3 emits outbox events for email but does NOT wire real SMTP.
// The MockEmailService is used in dev/test to:
//   1. Log sends to console (default)
//   2. Capture sends in an array for test assertions
//
// F5 will implement a real EmailService (Resend/SES/SMTP) and wire it
// as the production implementation. The outbox worker (apps/outbox-worker)
// will consume `workspace.invitation.created` events and call this service.
// ─────────────────────────────────────────────────────────────────────────────

// ── Interface ────────────────────────────────────────────────────────────────

export interface EmailRecipient {
  readonly email: string;
  readonly displayName?: string;
}

export interface EmailMessage {
  readonly to: EmailRecipient;
  readonly subject: string;
  readonly bodyHtml: string;
  readonly bodyText: string;
  readonly replyTo?: string;
  readonly metadata?: Record<string, string>;
}

export interface EmailService {
  send(message: EmailMessage): Promise<void>;
}

// ── Mock Implementation ──────────────────────────────────────────────────────

export interface MockEmailServiceOptions {
  /** If true, no console.log output. Useful for test suites that assert captures. */
  readonly silent?: boolean;
}

export class MockEmailService implements EmailService {
  /** Captured sends — useful for test assertions. */
  public readonly captures: EmailMessage[] = [];

  private readonly silent: boolean;

  constructor(options?: MockEmailServiceOptions) {
    this.silent = options?.silent ?? false;
  }

  async send(message: EmailMessage): Promise<void> {
    this.captures.push(message);

    if (!this.silent) {
      console.log(
        `[MockEmailService] → ${message.to.email} | Subject: ${message.subject}`,
      );
    }
  }

  /** Reset captures (call between tests). */
  reset(): void {
    this.captures.length = 0;
  }
}
