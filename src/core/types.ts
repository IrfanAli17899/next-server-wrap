import type { z } from 'zod';

// ============================================================================
// Base User Type (users extend this or provide their own)
// ============================================================================

export interface BaseUser {
  id: string | number;
  [key: string]: unknown;
}

// ============================================================================
// Rate Limit Types
// ============================================================================

export interface RateLimitConfig {
  max: number;
  windowMs: number;
}

// ============================================================================
// Cache Types
// ============================================================================

export interface CacheConfig {
  /** Cache TTL in milliseconds */
  ttlMs: number;
  /** Custom cache key generator. Defaults to method + path + query */
  keyGenerator?: (req: Request) => string;
  /** Only cache successful responses (2xx). Defaults to true */
  successOnly?: boolean;
}

// ============================================================================
// Retry Types
// ============================================================================

export interface RetryConfig {
  /** Max retry attempts */
  attempts: number;
  /** Base delay in ms between retries (uses exponential backoff) */
  delayMs?: number;
  /** Only retry on these status codes. Defaults to [502, 503, 504] */
  retryOn?: number[];
  /** Custom retry condition */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

// ============================================================================
// Audit Types
// ============================================================================

export interface AuditEvent<TUser extends BaseUser = BaseUser> {
  requestId: string;
  user: TUser;
  action: string;
  resource: string;
  resourceId?: string;
  ip?: string;
  userAgent?: string;
  timestamp: Date;
  durationMs?: number;
  status?: number;
  success?: boolean;
  errorCode?: string;
  meta?: Record<string, unknown>;
}

// ============================================================================
// Error Context (for audit logging failures)
// ============================================================================

export interface ErrorContext {
  requestId: string;
  method: string;
  path: string;
  ip: string;
  userAgent: string;
  startTime: number;
  user?: BaseUser;
  audit?: boolean;
}

// ============================================================================
// Sensitive Fields for Redaction
// ============================================================================

export const SENSITIVE_FIELDS = [
  'password',
  'token',
  'secret',
  'apiKey',
  'api_key',
  'authorization',
  'cookie',
  'creditCard',
  'credit_card',
  'ssn',
  'cvv',
] as const;

// ============================================================================
// Validation Types
// ============================================================================

export interface ValidationConfig<
  TParams extends z.ZodTypeAny = z.ZodTypeAny,
  TQuery extends z.ZodTypeAny = z.ZodTypeAny,
  TBody extends z.ZodTypeAny = z.ZodTypeAny,
> {
  params?: TParams;
  query?: TQuery;
  body?: TBody;
}

// ============================================================================
// Response Transformer Types
// ============================================================================

export interface SuccessResponseData<T = unknown> {
  data: T;
  status: number;
}

export interface ErrorResponseData {
  message: string;
  code: string;
  status: number;
  errors?: Array<{ field: string; message: string }>;
}

export interface ResponseTransformers {
  success?: <T>(data: T, status: number) => unknown;
  error?: (
    message: string,
    code: string,
    status: number,
    errors?: Array<{ field: string; message: string }>
  ) => unknown;
}

// ============================================================================
// Wrapper Options
// ============================================================================

export interface WrapperOptions<
  TParams extends z.ZodTypeAny = z.ZodTypeAny,
  TQuery extends z.ZodTypeAny = z.ZodTypeAny,
  TBody extends z.ZodTypeAny = z.ZodTypeAny,
> {
  auth?: string[];
  validation?: ValidationConfig<TParams, TQuery, TBody>;
  rateLimit?: RateLimitConfig | false;
  tenantScoped?: boolean;
  audit?: boolean;
  middleware?: MiddlewareFunction<BaseUser>[];
  /** Timeout in milliseconds. Handler will be aborted if exceeded */
  timeout?: number;
  /** Response caching config */
  cache?: CacheConfig;
  /** Retry config for failed requests */
  retry?: RetryConfig;
}

// ============================================================================
// Context Types
// ============================================================================

export interface ApiContext<
  TParams = unknown,
  TQuery = unknown,
  TBody = unknown,
  TUser extends BaseUser = BaseUser,
> {
  req: Request;
  requestId: string;
  parsedParams: TParams;
  parsedQuery: TQuery;
  parsedBody: TBody;
  user: TUser;
  ip: string;
  userAgent: string;
  method: string;
  path: string;
}

export interface ActionContext<
  TBody = unknown,
  TUser extends BaseUser = BaseUser,
> {
  requestId: string;
  parsedBody: TBody;
  user: TUser;
}

// ============================================================================
// Handler Types
// ============================================================================

export type ApiHandler<
  TParams = unknown,
  TQuery = unknown,
  TBody = unknown,
  TUser extends BaseUser = BaseUser,
  TResult = unknown,
> = (ctx: ApiContext<TParams, TQuery, TBody, TUser>) => Promise<TResult>;

export type ActionHandler<
  TBody = unknown,
  TUser extends BaseUser = BaseUser,
  TResult = unknown,
> = (ctx: ActionContext<TBody, TUser>) => Promise<TResult>;

// ============================================================================
// Middleware Types
// ============================================================================

export type MiddlewareFunction<TUser extends BaseUser = BaseUser> = (
  ctx: ApiContext<unknown, unknown, unknown, TUser>,
  next: () => Promise<Response>
) => Promise<Response>;

// ============================================================================
// Adapter Types
// ============================================================================

export interface AuthRequestContext {
  headers: Headers;
  cookies?: Record<string, string>;
}

export interface AuthAdapter<TUser extends BaseUser = BaseUser> {
  /** Verify auth from request context (headers, cookies) */
  verify(ctx: AuthRequestContext): Promise<TUser | null>;
  /** Check if user has required roles */
  hasRole(user: TUser, roles: string[]): boolean;
  /**
   * Check if user has valid tenant context. Called when tenantScoped: true.
   * @param user - The authenticated user
   * @param ctx - Request context with headers/cookies (use to get tenant ID from header/cookie)
   */
  isTenantValid?(user: TUser, ctx: AuthRequestContext): boolean | Promise<boolean>;
}

export interface CacheAdapter {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
  /** Atomic increment - returns new value. Creates key with value 1 if doesn't exist */
  increment(key: string, ttlMs: number): Promise<number>;
}


export interface LoggerAdapter<TUser extends BaseUser = BaseUser> {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, error?: Error, meta?: Record<string, unknown>): void;
  audit(event: AuditEvent<TUser>): void;
}

// ============================================================================
// Wrapper Config
// ============================================================================

export interface WrapperConfig<TUser extends BaseUser = BaseUser> {
  adapters: {
    auth?: AuthAdapter<TUser>;
    cache?: CacheAdapter;
    logger?: LoggerAdapter<TUser>;
  };
  defaults?: {
    rateLimit?: Record<string, RateLimitConfig>;
    /** Default timeout in ms for all handlers */
    timeout?: number;
  };
  transformers?: ResponseTransformers;
}

// ============================================================================
// Next.js Types
// ============================================================================

export interface NextRouteContext {
  params: Promise<Record<string, string>>;
}

export type NextRouteHandler = (
  req: Request,
  ctx: NextRouteContext
) => Promise<Response>;
