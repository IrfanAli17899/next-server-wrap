import { ApiError, type ValidationErrorDetail } from './error.js';
import type { ResponseTransformers } from './types.js';

export interface SuccessResponse<T = unknown> {
  success: true;
  data: T;
}

export interface ErrorResponse {
  success: false;
  message: string;
  code: string;
  errors?: ValidationErrorDetail[];
}

// Default transformers - standard { success, data } / { success, message, code } format
const defaultTransformers: Required<ResponseTransformers> = {
  success: <T>(data: T, _status: number) => ({
    success: true,
    data,
  }),
  error: (message, code, _status, errors) => {
    const response: ErrorResponse = {
      success: false,
      message,
      code,
    };
    if (errors && errors.length > 0) {
      response.errors = errors;
    }
    return response;
  },
};

// Global transformers - can be set via setTransformers()
let globalTransformers: Required<ResponseTransformers> = defaultTransformers;

export function setGlobalTransformers(transformers: ResponseTransformers): void {
  globalTransformers = {
    success: transformers.success || defaultTransformers.success,
    error: transformers.error || defaultTransformers.error,
  };
}

export function getGlobalTransformers(): Required<ResponseTransformers> {
  return globalTransformers;
}

export function resetGlobalTransformers(): void {
  globalTransformers = defaultTransformers;
}

export class ApiResponse {
  // ============================================================================
  // Success Responses
  // ============================================================================

  static success<T>(
    data: T,
    status: number = 200,
    transformers?: ResponseTransformers
  ): Response {
    const transform = transformers?.success || globalTransformers.success;
    const body = transform(data, status);

    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  static created<T>(data: T, transformers?: ResponseTransformers): Response {
    return ApiResponse.success(data, 201, transformers);
  }

  static noContent(): Response {
    return new Response(null, { status: 204 });
  }

  // ============================================================================
  // Error Responses (throwable)
  // ============================================================================

  static error(
    message: string,
    status: number = 400,
    code?: string
  ): ApiError {
    return new ApiError(message, status, code || 'BAD_REQUEST');
  }

  static badRequest(message: string = 'Bad request'): ApiError {
    return new ApiError(message, 400, 'BAD_REQUEST');
  }

  static unauthorized(message: string = 'Authentication required'): ApiError {
    return new ApiError(message, 401, 'UNAUTHORIZED');
  }

  static forbidden(message: string = 'Access denied'): ApiError {
    return new ApiError(message, 403, 'FORBIDDEN');
  }

  static notFound(message: string = 'Resource not found'): ApiError {
    return new ApiError(message, 404, 'NOT_FOUND');
  }

  static conflict(message: string = 'Resource already exists'): ApiError {
    return new ApiError(message, 409, 'CONFLICT');
  }

  static validationError(
    message: string = 'Validation failed',
    errors?: ValidationErrorDetail[]
  ): ApiError {
    return new ApiError(message, 422, 'VALIDATION_ERROR', errors);
  }

  static tooManyRequests(message: string = 'Rate limit exceeded'): ApiError {
    return new ApiError(message, 429, 'TOO_MANY_REQUESTS');
  }

  static internalError(message: string = 'Internal server error'): ApiError {
    return new ApiError(message, 500, 'INTERNAL_ERROR');
  }
}

// ============================================================================
// Helper to create error response with transformers
// ============================================================================

export function createErrorResponse(
  error: ApiError,
  transformers?: ResponseTransformers
): Response {
  const transform = transformers?.error || globalTransformers.error;
  const body = transform(error.message, error.code, error.status, error.errors);

  return new Response(JSON.stringify(body), {
    status: error.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
