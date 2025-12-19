import type { z } from 'zod';
import type {
  WrapperConfig,
  WrapperOptions,
  NextRouteHandler,
  NextRouteContext,
  ApiContext,
  BaseUser,
  ResponseTransformers,
} from '../../types.js';
import { ApiResponse } from '../../response.js';
import { buildAuthContext } from '../../utils/auth-context.js';
import { getEffectiveTransformers } from '../error-handler.js';
import { generateRequestId, runPipeline } from '../pipeline.js';
import { getClientIp, getUserAgent, parseQuery, parseBody } from './parsers.js';
import { createApiResultHandlers, checkCache, saveToCache } from './handlers.js';

export function createApiWrapper<TUser extends BaseUser = BaseUser>(
  config: WrapperConfig<TUser>
) {
  const { adapters, defaults, transformers: instanceTransformers } = config;
  const effectiveTransformers = getEffectiveTransformers(instanceTransformers);

  // Create result handlers once at wrapper creation
  const resultHandlers = createApiResultHandlers<TUser>({
    transformers: effectiveTransformers,
    cache: adapters.cache,
    logger: adapters.logger,
  });

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
    const { cache, middleware = [] } = options;

    return async (req: Request, routeCtx: NextRouteContext) => {
      const clonedReq = req.clone();
      const requestId = clonedReq.headers.get('x-request-id') || generateRequestId();
      const url = new URL(clonedReq.url);

      // Pre-pipeline: Check response cache
      const cached = await checkCache(clonedReq, cache, adapters.cache, requestId, adapters.logger);
      if (cached) return cached;

      return runPipeline<ApiContext<z.infer<TParams>, z.infer<TQuery>, z.infer<TBody>, TUser>, Response, TUser>({
        requestId,
        method: clonedReq.method,
        path: url.pathname,

        // Injected dependencies
        getAuthContext: () => buildAuthContext(clonedReq),

        getIdentifier: (user) =>
          user.id ? String(user.id) : `ip:${clonedReq.headers.get('x-forwarded-for') || 'unknown'}`,

        getRawInput: async () => ({
          params: await routeCtx.params,
          query: parseQuery(clonedReq),
          body: clonedReq.method !== 'GET' && clonedReq.method !== 'HEAD'
            ? await parseBody(clonedReq)
            : undefined,
        }),

        buildContext: (user, validatedInput) => ({
          req: clonedReq,
          requestId,
          parsedParams: validatedInput.params as z.infer<TParams>,
          parsedQuery: validatedInput.query as z.infer<TQuery>,
          parsedBody: validatedInput.body as z.infer<TBody>,
          user,
          ip: getClientIp(clonedReq),
          userAgent: getUserAgent(clonedReq),
          method: clonedReq.method,
          path: url.pathname,
        }),

        executeHandler: async (ctx) => {
          const runHandler = async (): Promise<Response> => {
            const result = await handler(ctx);
            if (result instanceof Response) return result;
            return ApiResponse.success(result, 200, effectiveTransformers);
          };

          // Run middleware chain
          if (middleware.length > 0) {
            let index = 0;
            const next = async (): Promise<Response> => {
              if (index < middleware.length) {
                const mw = middleware[index++];
                return mw(ctx, next);
              }
              return runHandler();
            };
            return next();
          }

          return runHandler();
        },

        // Result handlers (created once at wrapper level)
        onRateLimited: (result) => resultHandlers.onRateLimited(result, requestId),

        onSuccess: async (response) => {
          const finalResponse = resultHandlers.onSuccess(response, requestId);
          await saveToCache(clonedReq, finalResponse, cache, adapters.cache, requestId, adapters.logger);
          return finalResponse;
        },

        onError: (error) => resultHandlers.onError(error, requestId),

        // Config
        options: {
          auth: options.auth,
          tenantScoped: options.tenantScoped,
          rateLimit: options.rateLimit,
          timeout: options.timeout,
          retry: options.retry,
          audit: options.audit,
          validation: options.validation,
        },
        adapters,
        defaults,
      });
    };
  };
}
