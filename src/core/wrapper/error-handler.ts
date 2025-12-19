import type { LoggerAdapter, BaseUser, ResponseTransformers } from '../types.js';
import { ApiError } from '../error.js';
import { ApiResponse, createErrorResponse, getGlobalTransformers } from '../response.js';

export function getEffectiveTransformers(
  instanceTransformers?: ResponseTransformers
): ResponseTransformers {
  const global = getGlobalTransformers();
  return {
    success: instanceTransformers?.success || global.success,
    error: instanceTransformers?.error || global.error,
  };
}

export function handleError(
  error: unknown,
  logger?: LoggerAdapter<BaseUser>,
  transformers?: ResponseTransformers,
  requestId?: string
): Response {
  const effective = getEffectiveTransformers(transformers);

  if (ApiError.isApiError(error)) {
    const response = createErrorResponse(error, effective);
    if (requestId) {
      response.headers.set('X-Request-ID', requestId);
    }
    return response;
  }

  if (error instanceof Error) {
    logger?.error('Unhandled error', error, {
      name: error.name,
      message: error.message,
      requestId,
    });
  } else {
    logger?.error('Unhandled error', undefined, { error: String(error), requestId });
  }

  const response = createErrorResponse(ApiResponse.internalError(), effective);
  if (requestId) {
    response.headers.set('X-Request-ID', requestId);
  }
  return response;
}
