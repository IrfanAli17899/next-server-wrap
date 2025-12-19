import type { CacheAdapter, RateLimitConfig } from '../types.js';

export const DEFAULT_RATE_LIMITS: Record<string, RateLimitConfig> = {
  GET: { max: 200, windowMs: 60000 },
  POST: { max: 50, windowMs: 60000 },
  PUT: { max: 50, windowMs: 60000 },
  PATCH: { max: 50, windowMs: 60000 },
  DELETE: { max: 20, windowMs: 60000 },
};

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  resetAt: number;
}

export async function checkRateLimit(
  cache: CacheAdapter | undefined,
  key: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  if (!cache) {
    return { allowed: true, count: 0, resetAt: Date.now() + config.windowMs };
  }

  const count = await cache.increment(key, config.windowMs);
  const resetAt = Date.now() + config.windowMs;

  return {
    allowed: count <= config.max,
    count,
    resetAt,
  };
}

export function buildRateLimitKey(
  method: string,
  pathname: string,
  identifier: string
): string {
  return `ratelimit:${method}:${pathname}:${identifier}`;
}
