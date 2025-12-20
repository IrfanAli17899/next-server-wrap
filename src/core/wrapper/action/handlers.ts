import type { BaseUser, LoggerAdapter } from '../../types.js';
import { ApiError } from '../../error.js';
import {
  ActionResponseInternal,
  type ActionResult,
  type ActionErrorResult,
} from '../../response/index.js';

export interface ActionResultHandlers<TResult> {
  onRateLimited: () => ActionErrorResult;
  onSuccess: (result: TResult) => ActionResult<TResult>;
  onError: (error: unknown, requestId: string) => ActionErrorResult;
}

export interface CreateActionHandlersConfig<TUser extends BaseUser> {
  logger?: LoggerAdapter<TUser>;
}

export function createActionResultHandlers<TResult, TUser extends BaseUser>(
  config: CreateActionHandlersConfig<TUser>
): ActionResultHandlers<TResult> {
  const { logger } = config;

  return {
    onRateLimited: () => {
      return ActionResponseInternal.tooManyRequests();
    },

    onSuccess: (result) => ActionResponseInternal.success(result),

    onError: (error, requestId) => {
      if (ApiError.isApiError(error)) {
        return ActionResponseInternal.error(error.message, error.status, error.code, error.errors);
      }

      logger?.error(
        'Unhandled action error',
        error instanceof Error ? error : undefined,
        { requestId }
      );

      return ActionResponseInternal.internalError();
    },
  };
}
