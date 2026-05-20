// Per-user rate limiting for tRPC mutations via Redis.
import { TRPCError } from "@trpc/server";
import type { Context } from "../trpc";

export interface RateLimitConfig { max: number; windowMs: number; prefix: string; }

const DEFAULT: RateLimitConfig = { max: 30, windowMs: 10_000, prefix: "rl:mutation" };

export function createRateLimitCheck(config: Partial<RateLimitConfig> = {}) {
  const { max, windowMs, prefix } = { ...DEFAULT, ...config };

  async function checkRateLimit(ctx: Context): Promise<void> {
    if (!ctx.session?.user?.id) return;
    const key = `${prefix}:${ctx.session.tenantId}:${ctx.session.user.id}`;
    try {
      const allowed = await ctx.infra.rateLimiter.consume({ key, windowMs, max });
      if (!allowed) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: `Rate limit: max ${max} per ${windowMs/1000}s.` });
    } catch (err) { if (err instanceof TRPCError) throw err; }
  }

  return { checkRateLimit };
}

export const { checkRateLimit: checkMutationRateLimit } = createRateLimitCheck();
export const { checkRateLimit: checkBoardCreateRateLimit } = createRateLimitCheck({ max: 5, windowMs: 60_000, prefix: "rl:board:create" });
export const { checkRateLimit: checkDragDropRateLimit } = createRateLimitCheck({ max: 60, windowMs: 10_000, prefix: "rl:dragdrop" });
