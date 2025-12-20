import type { ValidationErrorDetail } from '../error.js';

// ============================================================================
// Shared Error Info (used by both ApiResponse and ActionResponse)
// ============================================================================

export interface ErrorInfo {
  message: string;
  status: number;
  code: string;
  errors?: ValidationErrorDetail[];
}

// ============================================================================
// Abstract Base Response Class
// ============================================================================

export abstract class BaseResponse<TError, TSuccess> {
  // Abstract methods - each subclass defines how to wrap results
  protected abstract wrapError(info: ErrorInfo): TError;
  protected abstract wrapSuccess<T>(data: T, status?: number): TSuccess;

  // ============================================================================
  // Success Methods
  // ============================================================================

  success<T>(data: T, status: number = 200): TSuccess {
    return this.wrapSuccess(data, status);
  }

  created<T>(data: T): TSuccess {
    return this.wrapSuccess(data, 201);
  }

  // ============================================================================
  // Error Methods - all use wrapError internally
  // ============================================================================

  error(message: string, status: number = 400, code: string = 'BAD_REQUEST', errors?: ValidationErrorDetail[]): TError {
    return this.wrapError({ message, status, code, errors });
  }

  badRequest(message: string = 'Bad request'): TError {
    return this.wrapError({ message, status: 400, code: 'BAD_REQUEST' });
  }

  unauthorized(message: string = 'Authentication required'): TError {
    return this.wrapError({ message, status: 401, code: 'UNAUTHORIZED' });
  }

  forbidden(message: string = 'Access denied'): TError {
    return this.wrapError({ message, status: 403, code: 'FORBIDDEN' });
  }

  notFound(message: string = 'Resource not found'): TError {
    return this.wrapError({ message, status: 404, code: 'NOT_FOUND' });
  }

  conflict(message: string = 'Resource already exists'): TError {
    return this.wrapError({ message, status: 409, code: 'CONFLICT' });
  }

  validationError(message: string = 'Validation failed', errors?: ValidationErrorDetail[]): TError {
    return this.wrapError({ message, status: 422, code: 'VALIDATION_ERROR', errors });
  }

  tooManyRequests(message: string = 'Rate limit exceeded'): TError {
    return this.wrapError({ message, status: 429, code: 'TOO_MANY_REQUESTS' });
  }

  internalError(message: string = 'Internal server error'): TError {
    return this.wrapError({ message, status: 500, code: 'INTERNAL_ERROR' });
  }

  badGateway(message: string = 'Bad gateway'): TError {
    return this.wrapError({ message, status: 502, code: 'BAD_GATEWAY' });
  }

  serviceUnavailable(message: string = 'Service temporarily unavailable'): TError {
    return this.wrapError({ message, status: 503, code: 'SERVICE_UNAVAILABLE' });
  }

  gatewayTimeout(message: string = 'Gateway timeout'): TError {
    return this.wrapError({ message, status: 504, code: 'GATEWAY_TIMEOUT' });
  }
}
