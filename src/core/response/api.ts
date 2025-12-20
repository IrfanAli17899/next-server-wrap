import { ApiError } from '../error.js';
import type { ResponseTransformers } from '../types.js';
import { BaseResponse, type ErrorInfo } from './base.js';

// ============================================================================
// Default Transformers
// ============================================================================

export interface SuccessResponse<T = unknown> {
  success: true;
  data: T;
}

export interface ErrorResponse {
  success: false;
  message: string;
  code: string;
  errors?: Array<{ field: string; message: string }>;
}

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

// Global transformers
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

// ============================================================================
// ApiResponse Class - extends BaseResponse with HTTP Response/ApiError outputs
// ============================================================================

class ApiResponseClass extends BaseResponse<ApiError, Response> {
  private transformers?: ResponseTransformers;

  protected wrapError(info: ErrorInfo): ApiError {
    return new ApiError(info.message, info.status, info.code, info.errors);
  }

  protected wrapSuccess<T>(data: T, status: number = 200): Response {
    const transform = this.transformers?.success || globalTransformers.success;
    const body = transform(data, status);

    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ============================================================================
  // HTTP-specific methods (not in base)
  // ============================================================================

  noContent(): Response {
    return new Response(null, { status: 204 });
  }

  /**
   * Create a custom Response with full control over status, headers, etc.
   */
  response<T>(
    data: T,
    options: {
      status?: number;
      headers?: Record<string, string>;
      transformers?: ResponseTransformers;
    } = {}
  ): Response {
    const { status = 200, headers = {}, transformers } = options;
    const transform = transformers?.success || globalTransformers.success;
    const body = transform(data, status);

    return new Response(JSON.stringify(body), {
      status,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    });
  }

  // Override success to support transformers parameter (backwards compat)
  override success<T>(
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

  override created<T>(data: T, transformers?: ResponseTransformers): Response {
    return this.success(data, 201, transformers);
  }
}

// Export singleton instance
export const ApiResponse = new ApiResponseClass();

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
