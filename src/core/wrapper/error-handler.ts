import type { LoggerAdapter, BaseUser, ResponseTransformers, ErrorContext } from '../types.js';
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
  requestId?: string,
  errorCtx?: ErrorContext
): Response {
  const effective = getEffectiveTransformers(transformers);
  const durationMs = errorCtx?.startTime ? Date.now() - errorCtx.startTime : undefined;

  if (ApiError.isApiError(error)) {
    // Log 4xx as warn, 5xx as error
    if (error.status >= 500) {
      logger?.error(`${error.status} ${error.code}`, error, {
        message: error.message,
        code: error.code,
        errors: error.errors,
        requestId,
        path: errorCtx?.path,
        method: errorCtx?.method,
        durationMs,
      });
    } else {
      logger?.warn(`${error.status} ${error.code}`, {
        message: error.message,
        code: error.code,
        errors: error.errors,
        requestId,
        path: errorCtx?.path,
        method: errorCtx?.method,
        durationMs,
      });
    }

    // Audit log failed requests (if audit enabled and logger exists)
    if (errorCtx?.audit !== false && logger && errorCtx) {
      logger.audit({
        requestId: errorCtx.requestId,
        user: (errorCtx.user || { id: '' }) as BaseUser,
        action: errorCtx.method,
        resource: errorCtx.path,
        ip: errorCtx.ip,
        userAgent: errorCtx.userAgent,
        timestamp: new Date(),
        durationMs,
        status: error.status,
        success: false,
        errorCode: error.code,
      });
    }

    const response = createErrorResponse(error, effective);
    if (requestId) {
      response.headers.set('X-Request-ID', requestId);
    }
    return response;
  }

  // Unhandled error (always 500)
  if (error instanceof Error) {
    logger?.error('Unhandled error', error, {
      name: error.name,
      message: error.message,
      requestId,
      path: errorCtx?.path,
      method: errorCtx?.method,
      durationMs,
    });
  } else {
    logger?.error('Unhandled error', undefined, {
      error: String(error),
      requestId,
      path: errorCtx?.path,
      method: errorCtx?.method,
      durationMs,
    });
  }

  // Audit log unhandled errors
  if (errorCtx?.audit !== false && logger && errorCtx) {
    logger.audit({
      requestId: errorCtx.requestId,
      user: (errorCtx.user || { id: '' }) as BaseUser,
      action: errorCtx.method,
      resource: errorCtx.path,
      ip: errorCtx.ip,
      userAgent: errorCtx.userAgent,
      timestamp: new Date(),
      durationMs,
      status: 500,
      success: false,
      errorCode: 'INTERNAL_ERROR',
    });
  }

  const response = createErrorResponse(ApiResponse.internalError(), effective);
  if (requestId) {
    response.headers.set('X-Request-ID', requestId);
  }
  return response;
}
