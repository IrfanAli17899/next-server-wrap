import type { z } from 'zod';
import type {
  AuthAdapter,
  AuthRequestContext,
  BaseUser,
  CacheAdapter,
  LoggerAdapter,
  RateLimitConfig,
  RetryConfig,
  ValidationConfig,
} from '../types.js';
import { ApiError } from '../error.js';
import { ApiResponse } from '../response.js';
import {
  checkRateLimit,
  buildRateLimitKey,
  DEFAULT_RATE_LIMITS,
} from '../middleware/rate-limit.js';
import { withTimeout } from '../middleware/timeout.js';
import { withRetry } from '../middleware/retry.js';

// ============================================================================
// Constants
// ============================================================================

export const ANONYMOUS_USER = { id: '' };

// ============================================================================
// Request ID
// ============================================================================

export function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

// ============================================================================
// Validation Helpers
// ============================================================================

function formatZodErrors(
  error: { issues: Array<{ path: PropertyKey[]; message: string }> }
): { field: string; message: string }[] {
  return error.issues.map((issue) => ({
    field: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

export async function validateSchema<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown,
  fieldName: string
): Promise<z.infer<T>> {
  const result = await schema.safeParseAsync(data);

  if (!result.success) {
    throw new ApiError(
      `Validation failed for ${fieldName}`,
      422,
      'VALIDATION_ERROR',
      formatZodErrors(result.error)
    );
  }

  return result.data;
}

// ============================================================================
// Pipeline Types
// ============================================================================

export interface PipelineAdapters<TUser extends BaseUser> {
  auth?: AuthAdapter<TUser>;
  cache?: CacheAdapter;
  logger?: LoggerAdapter<TUser>;
}

export interface PipelineOptions {
  auth?: string[];
  tenantScoped?: boolean;
  rateLimit?: RateLimitConfig | false;
  timeout?: number;
  retry?: RetryConfig;
  audit?: boolean;
  validation?: ValidationConfig<z.ZodTypeAny, z.ZodTypeAny, z.ZodTypeAny>;
}

export interface PipelineDefaults {
  timeout?: number;
  rateLimit?: Record<string, RateLimitConfig>;
}

export interface PipelineInput<TContext, TResult, TUser extends BaseUser> {
  // Identity
  requestId: string;
  method: string;
  path: string;

  // Injected dependencies (different per wrapper type)
  getAuthContext: () => AuthRequestContext | Promise<AuthRequestContext>;
  getIdentifier: (user: TUser) => string;
  getRawInput: () => Promise<{ params?: unknown; query?: unknown; body?: unknown }>;
  buildContext: (user: TUser, validatedInput: { params?: unknown; query?: unknown; body?: unknown }) => TContext;
  executeHandler: (ctx: TContext) => Promise<TResult>;

  // Result handling
  onRateLimited: (result: RateLimitResult) => TResult | Promise<TResult>;
  onSuccess: (result: TResult, meta: PipelineSuccessMeta<TUser>) => TResult | Promise<TResult>;
  onError: (error: unknown, meta: PipelineErrorMeta<TUser>) => TResult | Promise<TResult>;

  // Config
  options: PipelineOptions;
  adapters: PipelineAdapters<TUser>;
  defaults?: PipelineDefaults;
}

export interface PipelineSuccessMeta<TUser extends BaseUser> {
  requestId: string;
  user: TUser;
  durationMs: number;
  method: string;
  path: string;
}

export interface PipelineErrorMeta<TUser extends BaseUser> {
  requestId: string;
  user: TUser;
  durationMs: number;
  method: string;
  path: string;
}

export interface RateLimitResult {
  allowed: boolean;
  limit?: number;
  resetAt?: number;
}

// ============================================================================
// Unified Pipeline
// ============================================================================

export async function runPipeline<TContext, TResult, TUser extends BaseUser>(
  input: PipelineInput<TContext, TResult, TUser>
): Promise<TResult> {
  const {
    requestId,
    method,
    path,
    getAuthContext,
    getIdentifier,
    getRawInput,
    buildContext,
    executeHandler,
    onRateLimited,
    onSuccess,
    onError,
    options,
    adapters,
    defaults,
  } = input;

  const { auth, tenantScoped, rateLimit, timeout, retry, audit = true, validation } = options;
  const startTime = Date.now();
  let user = ANONYMOUS_USER as TUser;

  try {
    // 1. Log start
    adapters.logger?.info(`${method} ${path}`, {
      requestId,
      method,
      path,
    });

    // 2. Authentication
    if (auth !== undefined) {
      if (!adapters.auth) {
        throw new Error(`Auth adapter not configured but auth is required`);
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

    // 3. Tenant Scoping
    if (tenantScoped) {
      if (!adapters.auth?.isTenantValid) {
        throw new Error('isTenantValid must be defined in auth adapter when tenantScoped is true');
      }

      const authCtx = await getAuthContext();
      const isValid = await adapters.auth.isTenantValid(user, authCtx);
      if (!isValid) {
        throw ApiResponse.forbidden('Tenant context required');
      }
    }

    // 4. Rate Limiting
    if (rateLimit !== false && adapters.cache) {
      const identifier = getIdentifier(user);
      const rateLimitConfig = rateLimit || defaults?.rateLimit?.[method] || DEFAULT_RATE_LIMITS[method];

      if (rateLimitConfig) {
        const key = buildRateLimitKey(method, path, identifier);
        const result = await checkRateLimit(adapters.cache, key, rateLimitConfig);

        if (!result.allowed) {
          return await onRateLimited({
            allowed: false,
            limit: rateLimitConfig.max,
            resetAt: result.resetAt,
          });
        }
      }
    }

    // 5. Get & Validate Input
    const rawInput = await getRawInput();

    const validatedInput = {
      params: validation?.params
        ? await validateSchema(validation.params, rawInput.params, 'params')
        : rawInput.params,
      query: validation?.query
        ? await validateSchema(validation.query, rawInput.query, 'query')
        : rawInput.query,
      body: validation?.body
        ? await validateSchema(validation.body, rawInput.body, 'body')
        : rawInput.body,
    };

    // 6. Build Context
    const ctx = buildContext(user, validatedInput);

    // 7. Execute Handler (with retry + timeout)
    const effectiveTimeout = timeout || defaults?.timeout;

    const runHandler = () => executeHandler(ctx);

    const maybeRetry = retry
      ? () => withRetry(runHandler, retry, adapters.logger, requestId)
      : runHandler;

    const result = effectiveTimeout
      ? await withTimeout(maybeRetry(), effectiveTimeout)
      : await maybeRetry();

    const durationMs = Date.now() - startTime;

    // 8. Log completion
    adapters.logger?.info(`${method} ${path} completed`, {
      requestId,
      durationMs,
    });

    // 9. Audit
    if (audit && adapters.logger) {
      adapters.logger.audit({
        requestId,
        user,
        action: method,
        resource: path,
        durationMs,
        status: 200,
        success: true,
        timestamp: new Date(),
      });
    }

    return await onSuccess(result, { requestId, user, durationMs, method, path });
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const status = ApiError.isApiError(error) ? error.status : 500;

    // Log error
    adapters.logger?.info(`${method} ${path} ${status}`, {
      requestId,
      status,
      durationMs,
    });

    // Audit failure
    if (audit && adapters.logger) {
      adapters.logger.audit({
        requestId,
        user,
        action: method,
        resource: path,
        durationMs,
        status,
        success: false,
        errorCode: ApiError.isApiError(error) ? error.code : 'INTERNAL_ERROR',
        timestamp: new Date(),
      });
    }

    return await onError(error, { requestId, user, durationMs, method, path });
  }
}

// ============================================================================
// Re-exports for backwards compat during transition
// ============================================================================

export { DEFAULT_RATE_LIMITS } from '../middleware/rate-limit.js';
