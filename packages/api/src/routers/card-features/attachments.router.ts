// packages/api/src/routers/card-features/attachments.router.ts
//
// Phase 1.2 (F1.2.8) — Card Attachments router.
//
// API surface (mounted at v1.public.attachment.*):
//   requestUpload  — returns presigned PUT URL for direct browser → R2/MinIO upload
//   confirmUpload  — saves the attachment row + emits outbox event after upload
//   addLink        — saves an external URL attachment directly (no upload)
//   remove         — soft-deletes attachment + fires storage cleanup
//   list           — lists live attachments for a card
//
// Upload flow (D2):
//   1. Client calls requestUpload → gets { uploadUrl, objectKey, attachmentId }
//   2. Client PUTs file directly to uploadUrl (no server buffer)
//   3. Client calls confirmUpload → DB row created + outbox event
//
// All mutations: boardProtectedProcedure + withIdempotency + topology guard.
// Persian error messages via toTRPCError.

import crypto from "node:crypto";
import path   from "node:path";
import { z }  from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, isNull } from "drizzle-orm";

import { router, boardProtectedProcedure } from "../../trpc";
import { DrizzleAttachmentsRepository, cards } from "@repo/db";
import type { IStorageService } from "@repo/infrastructure";

// Lazy-import StorageService so Turbopack/webpack only pulls @aws-sdk/* into
// the attachment code paths. The SDK is a declared dependency of
// @repo/infrastructure and is marked external in next.config.mjs.
let _storage: IStorageService | null = null;
async function getStorage(): Promise<IStorageService> {
  if (_storage) return _storage;
  const { createStorageService } = await import("@repo/infrastructure");
  _storage = createStorageService();
  return _storage;
}

import {
  addFileAttachment,
  addLinkAttachment,
  removeAttachment,
  AttachmentNotFoundError,
  AttachmentCardMismatchError,
  AttachmentUploaderOnlyError,
  AttachmentLimitError,
  AttachmentFileSizeError,
  CardNotFoundError,
  type AttachmentId,
  type CardId,
  type BoardId,
  type TenantId,
  type MutationId,
  type JsonObject,
  type OutboxEvent,
} from "@repo/domain";

// ============================================================================
// Constants
// ============================================================================

const MAX_ATTACHMENTS     = 10;
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB (D4)

// ============================================================================
// Schemas
// ============================================================================

const IdSchema             = z.string().uuid();
const IdempotencyKeySchema = z.string().uuid();
const CorrelationId        = z.string().min(1).max(128).optional();

// ============================================================================
// Helpers
// ============================================================================

function toTRPCError(err: unknown): TRPCError {
  if (err instanceof AttachmentNotFoundError)
    return new TRPCError({ code: "NOT_FOUND",    message: "پیوست یافت نشد." });
  if (err instanceof AttachmentCardMismatchError)
    return new TRPCError({ code: "BAD_REQUEST",  message: "پیوست به این کارت تعلق ندارد." });
  if (err instanceof AttachmentUploaderOnlyError)
    return new TRPCError({ code: "FORBIDDEN",    message: "فقط آپلودکننده یا مدیر برد می‌تواند پیوست را حذف کند." });
  if (err instanceof AttachmentLimitError)
    return new TRPCError({ code: "BAD_REQUEST",  message: `تعداد پیوست‌های کارت از حد مجاز (${err.max.toLocaleString("fa-IR")}) بیشتر است.` });
  if (err instanceof AttachmentFileSizeError)
    return new TRPCError({ code: "BAD_REQUEST",  message: `حجم فایل از حد مجاز (${err.maxMb.toLocaleString("fa-IR")} مگابایت) بیشتر است.` });
  if (err instanceof CardNotFoundError)
    return new TRPCError({ code: "NOT_FOUND",    message: "کارت یافت نشد." });
  if (err instanceof TRPCError) return err;
  throw err;
}

function toOutboxEvent(ev: {
  id: string; type: string; version: number; schemaVersion?: number;
  occurredAt: string; aggregateId: string; aggregateType: string;
  payload: Readonly<Record<string, unknown>>;
  correlationId?: string; causationId?: string; sequence?: number;
}): OutboxEvent {
  return {
    eventId:       ev.id,
    type:          ev.type,
    aggregateId:   ev.aggregateId,
    aggregateType: ev.aggregateType,
    eventVersion:  `v${ev.schemaVersion ?? ev.version}`,
    occurredAt:    new Date(ev.occurredAt),
    payload:       ev.payload as JsonObject,
    correlationId: ev.correlationId,
    causationId:   ev.causationId,
    sequence:      ev.sequence,
  };
}

const IDEMPOTENCY_SCHEMA_VERSION = "attachments.v2";

async function withIdempotency<T>(
  tx: any,
  idempotencyRepo: { findByMutationId: (tx: any, id: any) => Promise<any>; save: (tx: any, rec: any) => Promise<void> },
  mutationId: string,
  work: () => Promise<T>,
): Promise<T> {
  const existing = await idempotencyRepo.findByMutationId(tx, mutationId as MutationId);
  if (existing) return existing.response as T;
  const response = await work();
  await idempotencyRepo.save(tx, { mutationId: mutationId as MutationId, response: response as unknown, schemaVersion: IDEMPOTENCY_SCHEMA_VERSION, createdAt: new Date() });
  return response;
}

/** Derive file extension from fileName, including the leading dot. */
function extOf(fileName: string): string {
  const ext = path.extname(fileName);
  return ext.length > 0 ? ext : "";
}

function mapToDto(entity: {
  id: string; type: string; url: string; objectKey?: string | null;
  mimeType?: string | null; fileName: string; sizeBytes?: number | null;
  title?: string | null; uploadedBy: string; createdAt: Date;
}) {
  return {
    id:         entity.id,
    type:       entity.type,
    url:        entity.url,
    objectKey:  entity.objectKey ?? null,
    mimeType:   entity.mimeType  ?? null,
    fileName:   entity.fileName,
    sizeBytes:  entity.sizeBytes ?? 0,
    title:      entity.title     ?? null,
    uploadedBy: entity.uploadedBy,
    createdAt:  entity.createdAt.toISOString(),
  };
}

// ============================================================================
// Router
// ============================================================================

export const attachmentsRouter = router({

  // ── requestUpload ─────────────────────────────────────────────────────────

  requestUpload: boardProtectedProcedure
    .input(z.object({
      boardId:        IdSchema,
      cardId:         IdSchema,
      fileName:       z.string().min(1).max(255),
      fileSize:       z.number().int().positive(),
      mimeType:       z.string().min(1).max(128),
      idempotencyKey: IdempotencyKeySchema,
      correlationId:  CorrelationId,
    }).strict())
    .mutation(async ({ input, ctx }) => {
      try {
        return await withIdempotency(ctx.infra.db, ctx.repos.idempotency, input.idempotencyKey, async () => {
          // Validate file size.
          if (input.fileSize > MAX_FILE_SIZE_BYTES) {
            throw new AttachmentFileSizeError(25);
          }

          // Topology guard.
          const cardRow = await ctx.infra.db.query.cards.findFirst({
            where: and(eq(cards.id, input.cardId), eq(cards.tenantId, ctx.session.tenantId), isNull(cards.deletedAt)),
            columns: { id: true, boardId: true },
          });
          if (!cardRow) throw new CardNotFoundError();
          if (cardRow.boardId !== input.boardId) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "کارت به این برد تعلق ندارد." });
          }

          // Count check.
          const repo = new DrizzleAttachmentsRepository(ctx.infra.db);
          const count = await repo.countByCardId(input.cardId as CardId, { tx: ctx.infra.db, tenantId: ctx.session.tenantId });
          if (count >= MAX_ATTACHMENTS) throw new AttachmentLimitError(MAX_ATTACHMENTS);

          const attachmentId = crypto.randomUUID();
          const objectKey    = `${ctx.session.tenantId}/${input.cardId}/${attachmentId}${extOf(input.fileName)}`;

          const storage   = await getStorage();
          const uploadUrl = await storage.createPresignedPut({
            objectKey,
            mimeType:     input.mimeType,
            maxSizeBytes: MAX_FILE_SIZE_BYTES,
          });

          return { uploadUrl, objectKey, attachmentId };
        });
      } catch (err) {
        throw toTRPCError(err);
      }
    }),

  // ── confirmUpload ─────────────────────────────────────────────────────────

  confirmUpload: boardProtectedProcedure
    .input(z.object({
      boardId:        IdSchema,
      cardId:         IdSchema,
      attachmentId:   IdSchema,
      objectKey:      z.string().min(1),
      fileName:       z.string().min(1).max(255),
      mimeType:       z.string().min(1).max(128),
      fileSize:       z.number().int().nonnegative(),
      idempotencyKey: IdempotencyKeySchema,
      correlationId:  CorrelationId,
    }).strict())
    .mutation(async ({ input, ctx }) => {
      try {
        return await withIdempotency(ctx.infra.db, ctx.repos.idempotency, input.idempotencyKey, async () => {
          // Topology guard.
          const cardRow = await ctx.infra.db.query.cards.findFirst({
            where: and(eq(cards.id, input.cardId), eq(cards.tenantId, ctx.session.tenantId), isNull(cards.deletedAt)),
            columns: { id: true, boardId: true },
          });
          if (!cardRow) throw new CardNotFoundError();
          if (cardRow.boardId !== input.boardId) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "کارت به این برد تعلق ندارد." });
          }

          const repo    = new DrizzleAttachmentsRepository(ctx.infra.db);
          const count   = await repo.countByCardId(input.cardId as CardId, { tx: ctx.infra.db, tenantId: ctx.session.tenantId });
          if (count >= MAX_ATTACHMENTS) throw new AttachmentLimitError(MAX_ATTACHMENTS);

          const storage   = await getStorage();
          const publicUrl = storage.buildPublicUrl(input.objectKey);
          const eventId   = crypto.randomUUID();
          const now       = new Date();

          const { entity, event } = addFileAttachment({
            attachmentId: input.attachmentId as AttachmentId,
            tenantId:     ctx.session.tenantId as TenantId,
            cardId:       input.cardId  as CardId,
            boardId:      input.boardId as BoardId,
            url:          publicUrl,
            objectKey:    input.objectKey,
            mimeType:     input.mimeType,
            fileName:     input.fileName,
            sizeBytes:    input.fileSize,
            uploadedBy:   ctx.session.user.id,
            now,
            eventId,
            correlationId: input.correlationId,
          });

          await repo.create(ctx.infra.db, entity);
          await ctx.repos.outbox.append(ctx.infra.db, toOutboxEvent(event));

          return mapToDto(entity);
        });
      } catch (err) {
        throw toTRPCError(err);
      }
    }),

  // ── addLink ───────────────────────────────────────────────────────────────

  addLink: boardProtectedProcedure
    .input(z.object({
      boardId:        IdSchema,
      cardId:         IdSchema,
      url:            z.string().url(),
      title:          z.string().max(255).optional(),
      idempotencyKey: IdempotencyKeySchema,
      correlationId:  CorrelationId,
    }).strict())
    .mutation(async ({ input, ctx }) => {
      try {
        return await withIdempotency(ctx.infra.db, ctx.repos.idempotency, input.idempotencyKey, async () => {
          const cardRow = await ctx.infra.db.query.cards.findFirst({
            where: and(eq(cards.id, input.cardId), eq(cards.tenantId, ctx.session.tenantId), isNull(cards.deletedAt)),
            columns: { id: true, boardId: true },
          });
          if (!cardRow) throw new CardNotFoundError();
          if (cardRow.boardId !== input.boardId) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "کارت به این برد تعلق ندارد." });
          }

          const repo  = new DrizzleAttachmentsRepository(ctx.infra.db);
          const count = await repo.countByCardId(input.cardId as CardId, { tx: ctx.infra.db, tenantId: ctx.session.tenantId });
          if (count >= MAX_ATTACHMENTS) throw new AttachmentLimitError(MAX_ATTACHMENTS);

          const eventId = crypto.randomUUID();
          const now     = new Date();

          const { entity, event } = addLinkAttachment({
            attachmentId: crypto.randomUUID() as AttachmentId,
            tenantId:     ctx.session.tenantId as TenantId,
            cardId:       input.cardId  as CardId,
            boardId:      input.boardId as BoardId,
            url:          input.url,
            title:        input.title ?? null,
            uploadedBy:   ctx.session.user.id,
            now,
            eventId,
            correlationId: input.correlationId,
          });

          await repo.create(ctx.infra.db, entity);
          await ctx.repos.outbox.append(ctx.infra.db, toOutboxEvent(event));

          return mapToDto(entity);
        });
      } catch (err) {
        throw toTRPCError(err);
      }
    }),

  // ── remove ────────────────────────────────────────────────────────────────

  remove: boardProtectedProcedure
    .input(z.object({
      boardId:        IdSchema,
      cardId:         IdSchema,
      attachmentId:   IdSchema,
      idempotencyKey: IdempotencyKeySchema,
      correlationId:  CorrelationId,
    }).strict())
    .mutation(async ({ input, ctx }) => {
      try {
        return await withIdempotency(ctx.infra.db, ctx.repos.idempotency, input.idempotencyKey, async () => {
          const repo    = new DrizzleAttachmentsRepository(ctx.infra.db);
          const current = await repo.findById(input.attachmentId as AttachmentId, { tx: ctx.infra.db, tenantId: ctx.session.tenantId });
          if (!current) throw new AttachmentNotFoundError();
          if (current.boardId !== input.boardId || current.cardId !== input.cardId) {
            throw new AttachmentCardMismatchError();
          }

          // Auth: uploader OR board admin/owner.
          const role     = (ctx as any).boardMembership?.role as string | undefined;
          const isOwner  = current.uploadedBy === ctx.session.user.id;
          const isAdmin  = role === "ADMIN" || role === "OWNER";
          if (!isOwner && !isAdmin) throw new AttachmentUploaderOnlyError();

          const eventId = crypto.randomUUID();
          const now     = new Date();

          const { event } = removeAttachment({
            current,
            actorId:       ctx.session.user.id,
            now,
            eventId,
            correlationId: input.correlationId,
          });

          await repo.softDelete(ctx.infra.db, current.id);
          await ctx.repos.outbox.append(ctx.infra.db, toOutboxEvent(event));

          // Fire-and-forget storage cleanup for file attachments.
          if (current.type === "file" && current.objectKey) {
            getStorage().then((s) =>
              s.deleteObject(current.objectKey!).catch((err: unknown) => {
                console.warn("[attachments.remove] storage cleanup failed", current.objectKey, err);
              })
            );
          }

          return { success: true as const };
        });
      } catch (err) {
        throw toTRPCError(err);
      }
    }),

  // ── list ──────────────────────────────────────────────────────────────────

  list: boardProtectedProcedure
    .input(z.object({ boardId: IdSchema, cardId: IdSchema }).strict())
    .query(async ({ input, ctx }) => {
      const repo        = new DrizzleAttachmentsRepository(ctx.infra.db);
      const attachments = await repo.findByCardId(input.cardId as CardId, { tx: ctx.infra.db, tenantId: ctx.session.tenantId });
      return { attachments: attachments.map(mapToDto) };
    }),
});
