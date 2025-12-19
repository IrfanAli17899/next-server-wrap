import type { z } from 'zod';
import type {
  WrapperConfig,
  WrapperOptions,
  ActionContext,
  BaseUser,
  AuthRequestContext,
} from '../../types.js';
import { generateRequestId, runPipeline } from '../pipeline.js';
import { createActionResultHandlers } from './handlers.js';

export type ActionAuthContextProvider = () => Promise<AuthRequestContext> | AuthRequestContext;

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
    options: Pick<
      WrapperOptions<z.ZodTypeAny, z.ZodTypeAny, TBody>,
      'auth' | 'validation' | 'timeout' | 'retry' | 'tenantScoped' | 'rateLimit' | 'audit'
    > = {}
  ) {
    return async (input: unknown): Promise<TResult> => {
      const requestId = generateRequestId();
      const actionName = handler.name || 'anonymous';

      return runPipeline<ActionContext<z.infer<TBody>, TUser>, TResult, TUser>({
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

        executeHandler: (ctx) => handler(ctx),

        // Result handlers (created once at wrapper level)
        onRateLimited: () => resultHandlers.onRateLimited(),
        onSuccess: (result) => resultHandlers.onSuccess(result) as TResult,
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
