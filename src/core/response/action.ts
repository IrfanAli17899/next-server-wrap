import type { ValidationErrorDetail } from '../error.js';
import { BaseResponse, type ErrorInfo } from './base.js';
import { getGlobalTransformers } from './api.js';
import { ApiResponse } from './api.js';

// ============================================================================
// Action Result Types
// ============================================================================

export interface ActionSuccessResult<T = unknown> {
  success: true;
  data: T;
}

export interface ActionErrorData {
  message: string;
  code: string;
  status: number;
  errors?: ValidationErrorDetail[];
}

export interface ActionErrorResult {
  success: false;
  error: ActionErrorData;
}

export type ActionResult<T> = ActionSuccessResult<T> | ActionErrorResult;

// ============================================================================
// ActionResponse Class - extends BaseResponse with plain object outputs
// Uses same transformers as ApiResponse
// ============================================================================

class ActionResponseClass extends BaseResponse<ActionErrorResult, ActionSuccessResult<unknown>> {
  protected wrapError(info: ErrorInfo): ActionErrorResult {
    const transformers = getGlobalTransformers();
    const transformed = transformers.error(info.message, info.code, info.status, info.errors);

    // Wrap in error envelope structure - only include errors if present
    return {
      success: false,
      error: {
        message: info.message,
        code: info.code,
        status: info.status,
        ...(info.errors && info.errors.length > 0 ? { errors: info.errors } : {}),
        // Include any extra fields from transformer
        ...(typeof transformed === 'object' && transformed !== null ? transformed : {}),
      },
    } as ActionErrorResult;
  }

  protected wrapSuccess<T>(data: T, status: number = 200): ActionSuccessResult<T> {
    const transformers = getGlobalTransformers();
    const transformed = transformers.success(data, status);

    // Wrap in success envelope structure
    return {
      success: true,
      data,
      // Include any extra fields from transformer
      ...(typeof transformed === 'object' && transformed !== null ? transformed : {}),
    } as ActionSuccessResult<T>;
  }

  // Type-safe success override
  override success<T>(data: T): ActionSuccessResult<T> {
    return this.wrapSuccess(data);
  }

  override created<T>(data: T): ActionSuccessResult<T> {
    return this.wrapSuccess(data, 201);
  }

  // ============================================================================
  // Helper to check result type
  // ============================================================================

  isSuccess<T>(result: ActionResult<T>): result is ActionSuccessResult<T> {
    return result.success === true;
  }

  isError<T>(result: ActionResult<T>): result is ActionErrorResult {
    return result.success === false;
  }
}

// ============================================================================
// ActionResponse - Dual mode for developer use in action handlers
// - success/created methods return envelope objects
// - error methods throw ApiError (for consistency with ApiResponse)
// ============================================================================

class ActionResponseForDevelopers {
  // Success methods return envelopes with proper type inference
  success<T>(data: T): ActionSuccessResult<T> {
    const transformers = getGlobalTransformers();
    const transformed = transformers.success(data, 200);

    return {
      success: true,
      data,
      ...(typeof transformed === 'object' && transformed !== null ? transformed : {}),
    } as ActionSuccessResult<T>;
  }

  created<T>(data: T): ActionSuccessResult<T> {
    const transformers = getGlobalTransformers();
    const transformed = transformers.success(data, 201);

    return {
      success: true,
      data,
      ...(typeof transformed === 'object' && transformed !== null ? transformed : {}),
    } as ActionSuccessResult<T>;
  }

  // Error methods throw ApiError (for consistency with ApiResponse)
  error(message: string, status: number = 400, code: string = 'BAD_REQUEST', errors?: ValidationErrorDetail[]): never {
    throw ApiResponse.error(message, status, code, errors);
  }

  badRequest(message: string = 'Bad request'): never {
    throw ApiResponse.badRequest(message);
  }

  unauthorized(message: string = 'Authentication required'): never {
    throw ApiResponse.unauthorized(message);
  }

  forbidden(message: string = 'Access denied'): never {
    throw ApiResponse.forbidden(message);
  }

  notFound(message: string = 'Resource not found'): never {
    throw ApiResponse.notFound(message);
  }

  conflict(message: string = 'Resource already exists'): never {
    throw ApiResponse.conflict(message);
  }

  validationError(message: string = 'Validation failed', errors?: ValidationErrorDetail[]): never {
    throw ApiResponse.validationError(message, errors);
  }

  tooManyRequests(message: string = 'Rate limit exceeded'): never {
    throw ApiResponse.tooManyRequests(message);
  }

  internalError(message: string = 'Internal server error'): never {
    throw ApiResponse.internalError(message);
  }

  badGateway(message: string = 'Bad gateway'): never {
    throw ApiResponse.badGateway(message);
  }

  serviceUnavailable(message: string = 'Service temporarily unavailable'): never {
    throw ApiResponse.serviceUnavailable(message);
  }

  gatewayTimeout(message: string = 'Gateway timeout'): never {
    throw ApiResponse.gatewayTimeout(message);
  }
}

// Internal wrapper instance for building envelopes (used by wrapper)
const ActionResponseInternal: ActionResponseClass = new ActionResponseClass();

// Export for developer use in action handlers
export const ActionResponse = new ActionResponseForDevelopers();

// Export the internal wrapper for use in action wrapper
export { ActionResponseInternal };

// Also export the type for advanced usage
export type { ActionResponseClass };

// ============================================================================
// Helper to convert ApiError to ActionErrorResult
// ============================================================================

export function apiErrorToActionResult(error: {
  message: string;
  status: number;
  code: string;
  errors?: ValidationErrorDetail[];
}): ActionErrorResult {
  return ActionResponseInternal.error(error.message, error.status, error.code, error.errors);
}
