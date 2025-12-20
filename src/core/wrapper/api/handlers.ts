import type { BaseUser, CacheAdapter, CacheConfig, LoggerAdapter, ResponseTransformers } from '../../types.js';
import { ApiResponse, createErrorResponse } from '../../response/index.js';
import { ApiError } from '../../error.js';
import {
  getCacheKey,
  getCachedResponse,
  setCachedResponse,
  shouldCacheResponse,
} from '../../middleware/cache.js';
import type { RateLimitResult } from '../pipeline.js';

export interface ApiResultHandlers<TUser extends BaseUser> {
  onRateLimited: (result: RateLimitResult, requestId: string) => Response;
  onSuccess: (response: Response, requestId: string) => Response;
  onError: (error: unknown, requestId: string) => Response;
}

export interface CreateApiHandlersConfig<TUser extends BaseUser> {
  transformers: ResponseTransformers;
  cache?: CacheAdapter;
  logger?: LoggerAdapter<TUser>;
}

export function createApiResultHandlers<TUser extends BaseUser>(
  config: CreateApiHandlersConfig<TUser>
): ApiResultHandlers<TUser> {
  const { transformers, logger } = config;

  return {
    onRateLimited: (result, requestId) => {
      const retryAfter = Math.ceil((result.resetAt! - Date.now()) / 1000);
      const error = ApiResponse.tooManyRequests();
      const response = createErrorResponse(error, transformers);

      response.headers.set('X-Request-ID', requestId);
      response.headers.set('X-RateLimit-Limit', String(result.limit));
      response.headers.set('X-RateLimit-Remaining', '0');
      response.headers.set('X-RateLimit-Reset', String(result.resetAt));
      response.headers.set('Retry-After', String(retryAfter));

      return response;
    },

    onSuccess: (response, requestId) => {
      response.headers.set('X-Request-ID', requestId);
      return response;
    },

    onError: (error, requestId) => {
      if (ApiError.isApiError(error)) {
        const response = createErrorResponse(error, transformers);
        response.headers.set('X-Request-ID', requestId);
        return response;
      }

      logger?.error(
        'Unhandled API error',
        error instanceof Error ? error : undefined,
        { requestId }
      );

      const response = createErrorResponse(ApiResponse.internalError(), transformers);
      response.headers.set('X-Request-ID', requestId);
      return response;
    },
  };
}

// Cache helpers
export async function checkCache(
  req: Request,
  cache: CacheConfig | undefined,
  cacheAdapter: CacheAdapter | undefined,
  requestId: string,
  logger?: LoggerAdapter
): Promise<Response | null> {
  if (!cache || !cacheAdapter || req.method !== 'GET') return null;

  const cacheKey = getCacheKey(req, cache);
  return getCachedResponse(cacheAdapter, cacheKey, requestId, logger);
}

export async function saveToCache(
  req: Request,
  response: Response,
  cache: CacheConfig | undefined,
  cacheAdapter: CacheAdapter | undefined,
  requestId: string,
  logger?: LoggerAdapter
): Promise<void> {
  if (!cache || !cacheAdapter || req.method !== 'GET') return;

  if (shouldCacheResponse(response, cache.successOnly !== false)) {
    const cacheKey = getCacheKey(req, cache);
    await setCachedResponse(cacheAdapter, cacheKey, response, cache.ttlMs, requestId, logger);
    response.headers.set('X-Cache', 'MISS');
  }
}
