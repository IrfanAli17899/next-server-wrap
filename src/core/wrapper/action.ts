import type { z } from 'zod';
import type {
  WrapperConfig,
  WrapperOptions,
  ActionContext,
  BaseUser,
  AuthRequestContext,
} from '../types.js';
import { ApiError } from '../error.js';
import { ApiResponse } from '../response.js';
import { buildActionContext, generateRequestId } from '../context.js';
import { withTimeout } from '../middleware/timeout.js';
import { withRetry } from '../middleware/retry.js';

export type ActionAuthContextProvider = () => Promise<AuthRequestContext> | AuthRequestContext;

export function createActionWrapper<TUser extends BaseUser = BaseUser>(
  config: WrapperConfig<TUser> & {
    getAuthContext?: ActionAuthContextProvider;
  }
) {
  const { adapters, getAuthContext } = config;

  const ANONYMOUS_USER = { id: '' } as TUser;

  return function actionWrapper<TBody extends z.ZodTypeAny, TResult = unknown>(
    handler: (ctx: ActionContext<z.infer<TBody>, TUser>) => Promise<TResult>,
    options: Pick<
      WrapperOptions<z.ZodTypeAny, z.ZodTypeAny, TBody>,
      'auth' | 'validation' | 'timeout' | 'retry'
    > = {}
  ) {
    return async (input: unknown): Promise<TResult> => {
      const { auth, validation, timeout, retry } = options;
      const requestId = generateRequestId();

      let user: TUser = ANONYMOUS_USER;

      if (auth !== undefined) {
        if (!adapters.auth) {
          throw new Error(
            'Auth adapter not configured but auth is required for this action'
          );
        }

        if (!getAuthContext) {
          throw new Error(
            'getAuthContext must be provided to use auth in server actions'
          );
        }

        const authCtx = await getAuthContext();
        const authResult = await adapters.auth.verify(authCtx);

        if (!authResult) {
          throw ApiResponse.unauthorized();
        }

        if (auth.length > 0 && !adapters.auth.hasRole(authResult, auth)) {
          throw ApiResponse.forbidden();
        }

        user = authResult;
      }

      const ctx = await buildActionContext(input, validation?.body, user, requestId);

      const runHandler = async (): Promise<TResult> => {
        return handler(ctx as ActionContext<z.infer<TBody>, TUser>);
      };

      try {
        const maybeRetry = retry
          ? () => withRetry(runHandler, retry, adapters.logger, requestId)
          : runHandler;

        if (timeout) {
          return await withTimeout(maybeRetry(), timeout);
        }

        return await maybeRetry();
      } catch (error) {
        if (ApiError.isApiError(error)) {
          throw error;
        }

        adapters.logger?.error(
          'Unhandled action error',
          error instanceof Error ? error : undefined,
          { requestId }
        );

        throw ApiResponse.internalError();
      }
    };
  };
}
