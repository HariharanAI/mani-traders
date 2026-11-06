/**
 * Simple fixed-window in-memory rate limiter. Good for a single app instance;
 * for multiple instances put a shared store (Redis) behind the same interface.
 */
type Bucket = { count: number; resetAt: number };
const g = globalThis as unknown as { __mtRate?: Map<string, Bucket> };
const buckets: Map<string, Bucket> = (g.__mtRate ??= new Map());

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  if (buckets.size > 10_000) for (const [k, b] of buckets) if (b.resetAt < now) buckets.delete(k);
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: 0 };
  }
  b.count += 1;
  if (b.count > limit) return { ok: false, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
  return { ok: true, retryAfterSec: 0 };
}

export function resetRateLimit(key: string) {
  buckets.delete(key);
}
