export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION_ERROR'
  | 'TOO_MANY_REQUESTS'
  | 'INTERNAL_ERROR'
  | string;

export interface ValidationErrorDetail {
  field: string;
  message: string;
}

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: ErrorCode;
  public readonly errors?: ValidationErrorDetail[];

  constructor(
    message: string,
    status: number = 400,
    code: ErrorCode = 'BAD_REQUEST',
    errors?: ValidationErrorDetail[]
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.errors = errors;

    // Maintains proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ApiError);
    }
  }

  toJSON(): Record<string, unknown> {
    const json: Record<string, unknown> = {
      success: false,
      message: this.message,
      code: this.code,
    };

    if (this.errors && this.errors.length > 0) {
      json.errors = this.errors;
    }

    return json;
  }

  toResponse(): Response {
    return new Response(JSON.stringify(this.toJSON()), {
      status: this.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  static isApiError(error: unknown): error is ApiError {
    return error instanceof ApiError;
  }
}
