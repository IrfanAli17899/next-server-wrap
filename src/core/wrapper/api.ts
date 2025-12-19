import type { z } from 'zod';
import type {
  WrapperConfig,
  WrapperOptions,
  NextRouteHandler,
  NextRouteContext,
  ApiContext,
  BaseUser,
} from '../types.js';
import { ApiResponse } from '../response.js';
import { buildApiContext, generateRequestId } from '../context.js';
import { buildAuthContext } from '../utils/auth-context.js';
import { withTimeout } from '../middleware/timeout.js';
import { withRetry } from '../middleware/retry.js';
import {
  checkRateLimit,
  buildRateLimitKey,
  DEFAULT_RATE_LIMITS,
} from '../middleware/rate-limit.js';
import {
  getCacheKey,
  getCachedResponse,
  setCachedResponse,
  shouldCacheResponse,
} from '../middleware/cache.js';
import { handleError, getEffectiveTransformers } from './error-handler.js';
import { createErrorResponse } from '../response.js';

export function createApiWrapper<TUser extends BaseUser = BaseUser>(
  config: WrapperConfig<TUser>
) {
  const { adapters, defaults, transformers: instanceTransformers } = config;

  const ANONYMOUS_USER = { id: '' } as TUser;

  return function apiWrapper<
    TParams extends z.ZodTypeAny,
    TQuery extends z.ZodTypeAny,
    TBody extends z.ZodTypeAny,
  >(
    handler: (
      ctx: ApiContext<z.infer<TParams>, z.infer<TQuery>, z.infer<TBody>, TUser>
    ) => Promise<Response | unknown>,
    options: WrapperOptions<TParams, TQuery, TBody> = {}
  ): NextRouteHandler {
    return async (req: Request, routeCtx: NextRouteContext) => {
      const clonedReq = req.clone();
      const requestId = clonedReq.headers.get('x-request-id') || generateRequestId();
      const startTime = Date.now();

      try {
        const {
          auth,
          validation,
          rateLimit,
          tenantScoped,
          audit,
          middleware = [],
          timeout,
          cache,
          retry,
        } = options;

        const effectiveTransformers = getEffectiveTransformers(instanceTransformers);
        const effectiveTimeout = timeout || defaults?.timeout;

        // 1. Check Response Cache
        if (cache && adapters.cache && clonedReq.method === 'GET') {
          const cacheKey = getCacheKey(clonedReq, cache);
          const cached = await getCachedResponse(
            adapters.cache,
            cacheKey,
            requestId,
            adapters.logger
          );
          if (cached) return cached;
        }

        // 2. Authentication
        let user: TUser = ANONYMOUS_USER;

        if (auth !== undefined) {
          if (!adapters.auth) {
            throw new Error(
              'Auth adapter not configured but auth is required for this route'
            );
          }

          const authCtx = buildAuthContext(clonedReq);
          const authResult = await adapters.auth.verify(authCtx);

          if (!authResult) {
            throw ApiResponse.unauthorized();
          }

          if (auth.length > 0 && !adapters.auth.hasRole(authResult, auth)) {
            throw ApiResponse.forbidden();
          }

          user = authResult;
        }

        // 3. Rate Limiting
        if (rateLimit !== false && adapters.cache) {
          const rateLimitConfig =
            rateLimit ||
            defaults?.rateLimit?.[clonedReq.method] ||
            DEFAULT_RATE_LIMITS[clonedReq.method];

          if (rateLimitConfig) {
            const identifier = user.id
              ? String(user.id)
              : `ip:${clonedReq.headers.get('x-forwarded-for') || 'unknown'}`;
            const key = buildRateLimitKey(
              clonedReq.method,
              new URL(clonedReq.url).pathname,
              identifier
            );

            const result = await checkRateLimit(adapters.cache, key, rateLimitConfig);

            if (!result.allowed) {
              const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
              const error = ApiResponse.tooManyRequests();
              const response = createErrorResponse(error, effectiveTransformers);

              response.headers.set('X-Request-ID', requestId);
              response.headers.set('X-RateLimit-Limit', String(rateLimitConfig.max));
              response.headers.set('X-RateLimit-Remaining', '0');
              response.headers.set('X-RateLimit-Reset', String(result.resetAt));
              response.headers.set('Retry-After', String(retryAfter));

              return response;
            }
          }
        }

        // 4. Build Context
        const ctx = await buildApiContext(clonedReq, routeCtx, validation, user, requestId);

        // 5. Tenant Scoping
        if (tenantScoped) {
          if (!adapters.auth?.isTenantValid) {
            throw new Error('isTenantValid must be defined in auth adapter when tenantScoped is true');
          }
          if (!adapters.auth.isTenantValid(user)) {
            throw ApiResponse.forbidden('Tenant context required');
          }
        }

        // 6. Execute Handler
        const executeHandler = async (): Promise<Response> => {
          const runHandler = async (): Promise<Response> => {
            const result = await handler(ctx as ApiContext<z.infer<TParams>, z.infer<TQuery>, z.infer<TBody>, TUser>);

            if (result instanceof Response) {
              return result;
            }

            return ApiResponse.success(result, 200, effectiveTransformers);
          };

          const maybeRetry = retry
            ? () => withRetry(runHandler, retry, adapters.logger, requestId)
            : runHandler;

          if (effectiveTimeout) {
            return withTimeout(maybeRetry(), effectiveTimeout);
          }

          return maybeRetry();
        };

        let finalResponse: Response;

        if (middleware.length > 0) {
          let index = 0;
          const next = async (): Promise<Response> => {
            if (index < middleware.length) {
              const mw = middleware[index++];
              return mw(ctx as ApiContext<z.infer<TParams>, z.infer<TQuery>, z.infer<TBody>, TUser>, next);
            }
            return executeHandler();
          };

          finalResponse = await next();
        } else {
          finalResponse = await executeHandler();
        }

        finalResponse.headers.set('X-Request-ID', requestId);

        // 7. Cache Response
        if (cache && adapters.cache && clonedReq.method === 'GET') {
          if (shouldCacheResponse(finalResponse, cache.successOnly !== false)) {
            const cacheKey = getCacheKey(clonedReq, cache);
            await setCachedResponse(
              adapters.cache,
              cacheKey,
              finalResponse,
              cache.ttlMs,
              requestId,
              adapters.logger
            );
            finalResponse.headers.set('X-Cache', 'MISS');
          }
        }

        // 8. Audit Logging
        if (audit && adapters.logger && user.id) {
          const url = new URL(clonedReq.url);
          adapters.logger.audit({
            requestId,
            user,
            action: clonedReq.method,
            resource: url.pathname,
            resourceId: (ctx.parsedParams as Record<string, unknown>)?.id as string | undefined,
            ip: ctx.ip,
            userAgent: ctx.userAgent,
            timestamp: new Date(),
            durationMs: Date.now() - startTime,
          });
        }

        return finalResponse;
      } catch (error) {
        return handleError(error, adapters.logger, instanceTransformers, requestId);
      }
    };
  };
}
