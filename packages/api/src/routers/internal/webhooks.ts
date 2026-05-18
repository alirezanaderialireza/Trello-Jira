// packages/api/src/routers/internal/webhooks.ts

import crypto from "node:crypto";
import { performance } from "node:perf_hooks";

import { z } from "zod";
import { TRPCError } from "@trpc/server";

// ✅ ارور ۱: مسیر اشتباه بود — internal/webhooks.ts دو سطح از trpc.ts فاصله دارد
import { router, publicProcedure } from "../../trpc";

// ============================================================================
// Constants
// ============================================================================

const MAX_WEBHOOK_AGE_MS = 5 * 60 * 1000;

// ============================================================================
// Validation Schemas
// ============================================================================

const StripeWebhookInputSchema = z.object({
  payload: z.string().min(1),
  signature: z.string().min(1),
  eventId: z.string().min(1).max(255).optional(),
});

// ============================================================================
// Types
// ============================================================================

interface ParsedStripeSignature {
  timestamp: number;
  signatures: string[];
}

// ============================================================================
// Helpers
// ============================================================================

function parseStripeSignature(signatureHeader: string): ParsedStripeSignature {
  const parts = signatureHeader.split(",");
  const parsed: ParsedStripeSignature = { timestamp: 0, signatures: [] };

  for (const part of parts) {
    const [key, value] = part.split("=");
    if (!key || !value) continue;
    if (key === "t") parsed.timestamp = Number(value);
    if (key === "v1") parsed.signatures.push(value);
  }

  return parsed;
}

function createStripeSignature(
  payload: string,
  timestamp: number,
  secret: string,
): string {
  const signedPayload = `${timestamp}.${payload}`;
  return crypto.createHmac("sha256", secret).update(signedPayload, "utf8").digest("hex");
}

function timingSafeCompare(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return crypto.timingSafeEqual(bufferA, bufferB);
}

function verifyStripeSignature(params: {
  payload: string;
  signatureHeader: string;
  secret: string;
}):
  | { valid: true }
  | { valid: false; reason: "MISSING_TIMESTAMP" | "SIGNATURE_EXPIRED" | "INVALID_SIGNATURE" } {
  const parsed = parseStripeSignature(params.signatureHeader);

  if (!parsed.timestamp) {
    return { valid: false, reason: "MISSING_TIMESTAMP" };
  }

  const ageMs = Date.now() - parsed.timestamp * 1000;
  if (ageMs > MAX_WEBHOOK_AGE_MS) {
    return { valid: false, reason: "SIGNATURE_EXPIRED" };
  }

  const expectedSignature = createStripeSignature(
    params.payload,
    parsed.timestamp,
    params.secret,
  );

  const matched = parsed.signatures.some((signature) =>
    timingSafeCompare(signature, expectedSignature),
  );

  if (!matched) {
    return { valid: false, reason: "INVALID_SIGNATURE" };
  }

  return { valid: true };
}

// ============================================================================
// Webhook Router
// ============================================================================

export const webhookRouter = router({
  // ✅ ارور ۲+۳: با fix مسیر import، ctx و input نوع صحیح از Context می‌گیرند
  stripeEvent: publicProcedure
    .input(StripeWebhookInputSchema)
    .mutation(async ({ input, ctx }) => {
      const startedAt = performance.now();

      const trace = {
        traceId: ctx.metadata?.traceId,
        correlationId: ctx.metadata?.requestId,
        operation: "stripe_webhook_receive",
      };

      try {
        // ----------------------------------------------------------------
        // 1. Signature Verification
        // ----------------------------------------------------------------
        const stripeSecret = process.env.STRIPE_WEBHOOK_SECRET;

        if (!stripeSecret) {
          ctx.infra.logger.error({
            event: "stripe_webhook_missing_secret",
            classification: "INTERNAL",
            ...trace,
          });

          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Webhook verification unavailable.",
          });
        }

        const verification = verifyStripeSignature({
          payload: input.payload,
          signatureHeader: input.signature,
          secret: stripeSecret,
        });

        if (!verification.valid) {
          ctx.infra.logger.warn({
            event: "stripe_webhook_signature_invalid",
            classification: "SENSITIVE",
            reason: verification.reason,
            ...trace,
          });

          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Invalid webhook signature.",
          });
        }

        // ----------------------------------------------------------------
        // 2. Idempotency
        // ----------------------------------------------------------------
        const webhookId =
          input.eventId ??
          crypto.createHash("sha256").update(input.payload).digest("hex");

        const infra = ctx.infra as typeof ctx.infra & {
          webhookStore?: {
            hasProcessed: (id: string) => Promise<boolean>;
            markProcessed: (id: string, meta: Record<string, string>) => Promise<void>;
          };
          jobQueue?: {
            enqueue: (params: {
              queue: string;
              dedupeKey: string;
              payload: unknown;
              priority: string;
            }) => Promise<void>;
          };
        };

        if (infra.webhookStore?.hasProcessed) {
          const alreadyProcessed = await infra.webhookStore.hasProcessed(webhookId);

          if (alreadyProcessed) {
            ctx.infra.logger.info({
              event: "stripe_webhook_duplicate_ignored",
              classification: "INTERNAL",
              webhookId,
              ...trace,
            });

            return { received: true, duplicated: true };
          }
        }

        // ----------------------------------------------------------------
        // 3. Parse Payload
        // ----------------------------------------------------------------
        let parsedPayload: unknown;

        try {
          parsedPayload = JSON.parse(input.payload);
        } catch {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Malformed webhook payload.",
          });
        }

        const eventType =
          typeof parsedPayload === "object" &&
          parsedPayload !== null &&
          "type" in parsedPayload
            ? String((parsedPayload as { type: unknown }).type)
            : "UNKNOWN";

        // ----------------------------------------------------------------
        // 4. Queue
        // ----------------------------------------------------------------
        const queuePayload = {
          webhookId,
          source: "stripe",
          type: eventType,
          receivedAt: new Date().toISOString(),
          payload: parsedPayload,
        };

        if (infra.jobQueue?.enqueue) {
          await infra.jobQueue.enqueue({
            queue: "stripe-webhooks",
            dedupeKey: webhookId,
            payload: queuePayload,
            priority: "HIGH",
          });
        }

        // ----------------------------------------------------------------
        // 5. Mark Processed
        // ----------------------------------------------------------------
        if (infra.webhookStore?.markProcessed) {
          await infra.webhookStore.markProcessed(webhookId, {
            source: "stripe",
            type: eventType,
            processedAt: new Date().toISOString(),
          });
        }

        // ----------------------------------------------------------------
        // 6. Observability
        // ----------------------------------------------------------------
        ctx.infra.logger.info({
          event: "stripe_webhook_received",
          classification: "PUBLIC",
          webhookId,
          source: "stripe",
          stripeEventType: eventType,
          durationMs: Math.round(performance.now() - startedAt),
          ...trace,
        });

        return {
          received: true,
          duplicated: false,
          acceptedAt: new Date().toISOString(),
        };
      } catch (error: unknown) {
        const safeError = error as { code?: string; name?: string } | null;

        ctx.infra.logger.error({
          event: "stripe_webhook_failed",
          classification: "INTERNAL",
          safeErrorCode: safeError?.code ?? safeError?.name ?? "UNKNOWN_WEBHOOK_ERROR",
          durationMs: Math.round(performance.now() - startedAt),
          ...trace,
        });

        if (error instanceof TRPCError) throw error;

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Webhook processing failed.",
        });
      }
    }),
});