// packages/domain/src/ports/index.ts

// ============================================================================
// 🚀 Enterprise Ports Layer (Final Hardened Edition)
// ----------------------------------------------------------------------------
// ویژگی‌ها:
// - کاملاً هماهنگ با Use Caseهای پیشرفته (مثل create-card)
// - پشتیبانی از Tenant Isolation در کوئری‌ها
// - مدیریت پیشرفته Transaction و Lock
// - Branded Types فقط از shared/ids.ts
// ============================================================================

import type { Card } from "../card/types";
import type { List } from "../list/types";
import type { Board } from "../board/types";
import type { BoardId, ListId, CardId, TenantId, UserId, MutationId } from "../shared/ids";

// ============================================================================
// 🧠 Shared Utility Types
// ============================================================================

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject { [key: string]: JsonValue; }

// 🌟 پیشرفته: Locking & Multi-Tenant
export interface FindOptions<TTx = unknown> {
  tx?: TTx;
  forUpdate?: boolean;
  tenantId?: string;
}

// ============================================================================
// 🛡️ Infrastructure Contracts
// ============================================================================

export interface Logger {
  info(payload: LogPayload): void;
  warn(payload: LogPayload): void;
  error(payload: LogPayload): void;
  debug?(payload: LogPayload): void;
}

export interface LogPayload {
  event: string;
  message?: string;
  classification?: "PUBLIC" | "INTERNAL" | "SENSITIVE";
  traceId?: string;
  correlationId?: string;
  causationId?: string;
  [key: string]: unknown;
}

export interface TransactionManager<TTx = unknown> {
  serializable<T>(callback: (tx: TTx) => Promise<T>): Promise<T>;
  isRetryable(error: unknown): boolean;
}

export interface AggregateLockManager<TTx = unknown> {
  lockAggregates(tx: TTx, aggregateIds: readonly string[]): Promise<void>;
}

// ============================================================================
// 🗄️ Repository Contracts
// ============================================================================

export interface CardRepository<TTx = unknown> {
  findById(id: string, options?: FindOptions<TTx>): Promise<Card | null>;
  getLastCardInList(params: { listId: ListId; tenantId: TenantId; tx?: TTx }): Promise<Card | null>;
  save(tx: TTx, params: { entity: Card; expectedRevision: number }): Promise<boolean>;
  create(card: Card, tx?: TTx): Promise<void>;
  // ✅ Fix: return boolean (true = deleted, false = not found / OCC conflict)
  //         and accept optional expectedRevision for OCC-safe soft-delete.
  delete(tx: TTx, id: CardId, expectedRevision?: number): Promise<boolean>;
  updatePosition?(tx: TTx, params: { id: CardId; listId: ListId; position: string; expectedRevision?: number }): Promise<boolean>;
  bulkUpdatePositions?(tx: TTx, updates: ReadonlyArray<{ id: CardId; position: string }>): Promise<void>;
}

export interface ListRepository<TTx = unknown> {
  findById(id: ListId, options?: FindOptions<TTx>): Promise<List | null>;
  getByBoardId(boardId: BoardId): Promise<List[]>;
  getLastListInBoard(tx: TTx, boardId: BoardId): Promise<List | null>;
  create(list: List, tx?: TTx): Promise<void>;
  save(tx: TTx, params: { entity: List; expectedRevision?: number }): Promise<boolean>;
  incrementRevision(tx: TTx, listId: ListId): Promise<number>;
  getBoardAclForUpdate(tx: TTx, boardId: BoardId): Promise<{ version: number; canMoveCards(userId: UserId): boolean }>;
}

export interface BoardRepository<TTx = unknown> {
  findById(id: BoardId, options?: FindOptions<TTx>): Promise<Board | null>;
  create(board: Board, tx?: TTx): Promise<void>;
  save(tx: TTx, board: Board): Promise<void>;
  incrementRevision(tx: TTx, boardId: BoardId): Promise<number>;
}

// ============================================================================
// ⚡ Enterprise Infrastructure Contracts
// ============================================================================

export interface OutboxEvent {
  eventId: string;
  aggregateId: string;
  aggregateType: string;
  type: string;
  occurredAt: Date;
  correlationId?: string;
  payload: JsonObject;
  eventVersion?: string;
  sequence?: number;
  causationId?: string;
}

export interface OutboxRepository<TTx = unknown> {
  append(tx: TTx, event: OutboxEvent): Promise<void>;
}

export interface AuditLog {
  actorId: UserId;
  tenantId: TenantId;
  action: string;
  entityId: string;
  entityType: string;
  correlationId: string;
  beforeState: JsonObject;
  afterState: JsonObject;
  createdAt?: Date;
}

export interface AuditRepository<TTx = unknown> {
  append(tx: TTx, log: AuditLog): Promise<void>;
}

export interface SequenceRepository<TTx = unknown> {
  nextBoardSequence(tx: TTx, boardId: BoardId): Promise<number>;
}

export interface IdempotencyRecord<T = unknown> {
  mutationId: MutationId;
  response: T;
  schemaVersion: string;
  createdAt: Date;
}

export interface IdempotencyRepository<TTx = unknown> {
  findByMutationId<T = unknown>(tx: TTx, mutationId: MutationId): Promise<IdempotencyRecord<T> | null>;
  save<T = unknown>(tx: TTx, data: IdempotencyRecord<T>): Promise<void>;
}

// ============================================================================
// 🌐 Optional Event Bus Port
// ============================================================================

export interface EventBus {
  publish(topic: string, payload: JsonObject): Promise<void>;
}

// ============================================================================
// 🧪 Testing Helpers
// ============================================================================

export type MockedTransaction = Record<string, never>;