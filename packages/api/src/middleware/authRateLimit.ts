// packages/api/src/middleware/authRateLimit.ts
// Rate limiting for auth endpoints — prevents brute force and spam.

// In-memory sliding window (MVP — swap to Redis in production)
const windows = new Map<string, { count: number; resetAt: number }>();

interface RateLimitOpts {
  max: number;
  windowMs: number;
  keyPrefix: string;
}

export function checkAuthRateLimit(
  ip: string,
  opts: RateLimitOpts,
): { allowed: boolean; remaining: number; resetAt: number } {
  const key = `${opts.keyPrefix}:${ip}`;
  const now = Date.now();

  let entry = windows.get(key);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + opts.windowMs };
    windows.set(key, entry);
  }

  entry.count++;
  const allowed = entry.count <= opts.max;
  return { allowed, remaining: Math.max(0, opts.max - entry.count), resetAt: entry.resetAt };
}

// Pre-configured limiters
export const SIGNIN_LIMIT: RateLimitOpts = { max: 5, windowMs: 15 * 60 * 1000, keyPrefix: "rl:signin" };
export const SIGNUP_LIMIT: RateLimitOpts = { max: 3, windowMs: 60 * 60 * 1000, keyPrefix: "rl:signup" };
export const MAGIC_LINK_LIMIT: RateLimitOpts = { max: 3, windowMs: 60 * 60 * 1000, keyPrefix: "rl:magic" };

/**
 * Returns a 429 Response if rate limited, or null if allowed.
 */
export function rateLimitResponse(ip: string, opts: RateLimitOpts): Response | null {
  const { allowed, resetAt } = checkAuthRateLimit(ip, opts);
  if (!allowed) {
    return new Response(
      JSON.stringify({ message: "Too many requests. Please try again later.", retryAfterMs: resetAt - Date.now() }),
      { status: 429, headers: { "Content-Type": "application/json", "Retry-After": String(Math.ceil((resetAt - Date.now()) / 1000)) } },
    );
  }
  return null;
}
