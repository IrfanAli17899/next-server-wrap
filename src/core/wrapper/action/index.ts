import type { z } from 'zod';
import type {
  WrapperConfig,
  WrapperOptions,
  ActionContext,
  BaseUser,
  AuthRequestContext,
  ActionCacheConfig,
} from '../../types.js';
import type { ActionResult } from '../../response/index.js';
import { generateRequestId, runPipeline } from '../pipeline.js';
import { createActionResultHandlers } from './handlers.js';

export type ActionAuthContextProvider = () => Promise<AuthRequestContext> | AuthRequestContext;

export interface ActionOptions<TBody extends z.ZodTypeAny> extends Pick<
  WrapperOptions<z.ZodTypeAny, z.ZodTypeAny, TBody>,
  'auth' | 'validation' | 'timeout' | 'retry' | 'tenantScoped' | 'rateLimit' | 'audit'
> {
  cache?: ActionCacheConfig<z.infer<TBody>>;
}

export function createActionWrapper<TUser extends BaseUser = BaseUser>(
  config: WrapperConfig<TUser> & {
    getAuthContext?: ActionAuthContextProvider;
  }
) {
  const { adapters, defaults, getAuthContext } = config;

  // Create result handlers once at wrapper creation
  const resultHandlers = createActionResultHandlers<unknown, TUser>({
    logger: adapters.logger,
  });

  return function actionWrapper<TBody extends z.ZodTypeAny, TResult = unknown>(
    handler: (ctx: ActionContext<z.infer<TBody>, TUser>) => Promise<TResult>,
    options: ActionOptions<TBody> = {}
  ) {
    return async (input: unknown): Promise<ActionResult<TResult>> => {
      const requestId = generateRequestId();
      const actionName = handler.name || 'anonymous';
      const { cache } = options;

      // Check cache before running pipeline
      if (cache && adapters.cache) {
        const cacheKey = cache.keyGenerator
          ? `action:${actionName}:${cache.keyGenerator(input as z.infer<TBody>)}`
          : `action:${actionName}:${JSON.stringify(input)}`;

        const cached = await adapters.cache.get<ActionResult<TResult>>(cacheKey);
        if (cached !== null) {
          adapters.logger?.debug('Action cache hit', { requestId, cacheKey });
          return cached;
        }

        // Run pipeline and cache result
        const result = await runPipelineInternal();

        // Only cache successful results
        if (result.success) {
          await adapters.cache.set(cacheKey, result, cache.ttlMs);
          adapters.logger?.debug('Action cache set', { requestId, cacheKey, ttlMs: cache.ttlMs });
        }

        return result;
      }

      return runPipelineInternal();

      async function runPipelineInternal(): Promise<ActionResult<TResult>> {
        return runPipeline<ActionContext<z.infer<TBody>, TUser>, ActionResult<TResult>, TUser>({
          requestId,
          method: 'ACTION',
          path: actionName,

          // Injected dependencies
          getAuthContext: () => {
            if (!getAuthContext) {
              throw new Error('getAuthContext must be provided to use auth/tenantScoped in server actions');
            }
            return getAuthContext();
          },

          getIdentifier: (user) => user.id ? String(user.id) : 'anonymous',

          getRawInput: async () => ({ body: input }),

          buildContext: (user, validatedInput) => ({
            requestId,
            parsedBody: validatedInput.body as z.infer<TBody>,
            user,
          }),

          executeHandler: async (ctx) => {
            const rawResult = await handler(ctx);

            // Check if result is already wrapped (developer used ActionResponse.success())
            if (
              rawResult &&
              typeof rawResult === 'object' &&
              'success' in rawResult &&
              rawResult.success === true &&
              'data' in rawResult
            ) {
              return rawResult as ActionResult<TResult>;
            }

            // Otherwise wrap it
            return resultHandlers.onSuccess(rawResult) as ActionResult<TResult>;
          },

          // Result handlers (created once at wrapper level)
          onRateLimited: () => resultHandlers.onRateLimited() as ActionResult<TResult>,
          onSuccess: (result) => result as ActionResult<TResult>,
          onError: (error) => resultHandlers.onError(error, requestId) as ActionResult<TResult>,

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
      }
    };
  };
}
