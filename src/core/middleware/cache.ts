import type { CacheAdapter, CacheConfig, LoggerAdapter, BaseUser } from '../types.js';

export function generateCacheKey(req: Request): string {
  const url = new URL(req.url);
  return `cache:${req.method}:${url.pathname}${url.search}`;
}

export function getCacheKey(req: Request, config: CacheConfig): string {
  return config.keyGenerator ? config.keyGenerator(req) : generateCacheKey(req);
}

export interface CachedResponse {
  body: string;
  status: number;
  headers: Record<string, string>;
}

export async function getCachedResponse(
  cache: CacheAdapter,
  cacheKey: string,
  requestId: string,
  logger?: LoggerAdapter<BaseUser>
): Promise<Response | null> {
  const cached = await cache.get<CachedResponse>(cacheKey);

  if (cached) {
    logger?.debug('Cache hit', { requestId, cacheKey });
    return new Response(cached.body, {
      status: cached.status,
      headers: {
        ...cached.headers,
        'X-Request-ID': requestId,
        'X-Cache': 'HIT',
      },
    });
  }

  return null;
}

export async function setCachedResponse(
  cache: CacheAdapter,
  cacheKey: string,
  response: Response,
  ttlMs: number,
  requestId: string,
  logger?: LoggerAdapter<BaseUser>
): Promise<void> {
  const clonedResponse = response.clone();
  const body = await clonedResponse.text();
  const headers: Record<string, string> = {};
  clonedResponse.headers.forEach((value, key) => {
    headers[key] = value;
  });

  await cache.set(
    cacheKey,
    { body, status: clonedResponse.status, headers },
    ttlMs
  );

  logger?.debug('Cache set', { requestId, cacheKey, ttlMs });
}

export function shouldCacheResponse(
  response: Response,
  successOnly: boolean
): boolean {
  if (successOnly) {
    return response.status >= 200 && response.status < 300;
  }
  return true;
}
