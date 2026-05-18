// packages/domain/src/shared/ids.ts

// ============================================================================
// Branded Primitive Types
// ============================================================================

// 🏢 Tenant & User
export type TenantId = string & { readonly __brand: "TenantId" };
export type UserId = string & { readonly __brand: "UserId" };

// 📋 Boards, Lists & Cards
export type BoardId = string & { readonly __brand: "BoardId" };
export type ListId = string & { readonly __brand: "ListId" };
export type CardId = string & { readonly __brand: "CardId" };

// 🔄 Idempotency & Tracing
export type MutationId = string & { readonly __brand: "MutationId" };
export type CorrelationId = string & { readonly __brand: "CorrelationId" };
export type TraceId = string & { readonly __brand: "TraceId" };
export type SpanId = string & { readonly __brand: "SpanId" };

// 📊 Versioning & Sequencing
export type Revision = number & { readonly __brand: "Revision" };
export type Sequence = number & { readonly __brand: "Sequence" };