import type { BaseUser, LoggerAdapter } from '../../types.js';
import { ApiError } from '../../error.js';
import { ApiResponse } from '../../response.js';

export interface ActionResultHandlers<TResult> {
  onRateLimited: () => never;
  onSuccess: (result: TResult) => TResult;
  onError: (error: unknown, requestId: string) => never;
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
      throw ApiResponse.tooManyRequests();
    },

    onSuccess: (result) => result,

    onError: (error, requestId) => {
      if (ApiError.isApiError(error)) {
        throw error;
      }

      logger?.error(
        'Unhandled action error',
        error instanceof Error ? error : undefined,
        { requestId }
      );

      throw ApiResponse.internalError();
    },
  };
}
