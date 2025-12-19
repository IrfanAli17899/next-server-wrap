# next-server-wrap

A minimal, type-safe wrapper for Next.js API routes and Server Actions. You define your own adapters for auth, caching, and logging.

## Installation

```bash
npm install next-server-wrap
# or
pnpm add next-server-wrap
```

**Peer dependency:** `zod >= 3.0.0`

## Quick Start

```typescript
// lib/api.ts
import {
  createApiWrapper,
  createActionWrapper,
  defineAuthAdapter,
  defineCacheAdapter,
  defineLoggerAdapter,
  type AuthRequestContext,
} from 'next-server-wrap';

// Define your user type
interface AppUser {
  id: string;
  role: string;
  companyId?: string;
}

// Auth adapter
const authAdapter = defineAuthAdapter<AppUser>({
  async verify(ctx: AuthRequestContext) {
    // ctx.headers - Headers object
    // ctx.cookies - { [name]: value }
    const token = ctx.headers.get('authorization')?.split(' ')[1];
    if (!token) return null;
    return verifyAndDecodeToken(token);
  },
  hasRole(user, roles) {
    return roles.length === 0 || roles.includes(user.role);
  },
});

// Cache adapter (handles BOTH caching AND rate limiting)
const cacheAdapter = defineCacheAdapter({
  async get(key) { /* return cached value or null */ },
  async set(key, value, ttlMs) { /* store with TTL */ },
  async delete(key) { /* remove key */ },
  async increment(key, ttlMs) { /* atomic increment for rate limiting */ },
});

// Logger adapter
const loggerAdapter = defineLoggerAdapter<AppUser>({
  debug: (msg, meta) => console.debug(msg, meta),
  info: (msg, meta) => console.info(msg, meta),
  warn: (msg, meta) => console.warn(msg, meta),
  error: (msg, err, meta) => console.error(msg, err, meta),
  audit: (event) => console.info('[AUDIT]', event),
});

export const apiWrapper = createApiWrapper<AppUser>({
  adapters: {
    auth: authAdapter,
    cache: cacheAdapter,
    logger: loggerAdapter,
  },
  defaults: {
    timeout: 30000,
  },
});

export const actionWrapper = createActionWrapper<AppUser>({
  adapters: { auth: authAdapter, logger: loggerAdapter },
});
```

## Usage

### API Routes

```typescript
// app/api/template/[id]/route.ts
import { z } from 'zod';
import { apiWrapper } from '@/lib/api';
import { ApiResponse } from 'next-server-wrap';

export const GET = apiWrapper(
  async (ctx) => {
    const { id } = ctx.parsedParams;
    const template = await prisma.template.findUnique({
      where: { id, companyId: ctx.user.companyId },
    });

    if (!template) throw ApiResponse.notFound('Template not found');
    return ApiResponse.success(template);
  },
  {
    auth: [],
    validation: {
      params: z.object({ id: z.string().uuid() }),
    },
  }
);
```

### Server Actions

```typescript
// actions/template.ts
'use server';

import { z } from 'zod';
import { actionWrapper } from '@/lib/api';

const schema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
});

export const updateTemplate = actionWrapper(
  async (ctx) => {
    const { id, name } = ctx.parsedBody;
    return prisma.template.update({
      where: { id, userId: ctx.user.id },
      data: { name },
    });
  },
  {
    auth: [],
    validation: { body: schema },
    timeout: 5000,
  }
);
```

## Configuration Options

```typescript
export const handler = apiWrapper(fn, {
  // Authentication
  auth: ['admin', 'super'],     // Role-based: only these roles
  auth: [],                      // Any authenticated user
  // auth: undefined             // Public endpoint (default)

  // Validation (Zod schemas)
  validation: {
    params: z.object({ id: z.string().uuid() }),
    query: z.object({ page: z.coerce.number().default(1) }),
    body: z.object({ name: z.string() }),
  },

  // Rate limiting (uses cache.increment)
  rateLimit: { max: 100, windowMs: 60000 },
  rateLimit: false, // disable

  // Response caching (GET only)
  cache: {
    ttlMs: 60000,
    keyGenerator: (req) => `custom:${req.url}`,
    successOnly: true, // default
  },

  // Timeout
  timeout: 5000, // ms

  // Retry with exponential backoff
  retry: {
    attempts: 3,
    delayMs: 100,
    retryOn: [502, 503, 504],
    shouldRetry: (error, attempt) => true,
  },

  // Multi-tenant isolation
  tenantScoped: true,

  // Audit logging
  audit: true,

  // Custom middleware (escape hatch)
  middleware: [customMiddleware1, customMiddleware2],
});
```

## Adapters

The library ships only with adapter interfaces and `define*` helpers. You create your own implementations.

### Auth Adapter

```typescript
import { defineAuthAdapter, type AuthRequestContext } from 'next-server-wrap';

interface AuthAdapter<TUser> {
  verify(ctx: AuthRequestContext): Promise<TUser | null>;
  hasRole(user: TUser, roles: string[]): boolean;
}

interface AuthRequestContext {
  headers: Headers;
  cookies: Record<string, string>;
}
```

#### Example: JWT Auth

```typescript
import { defineAuthAdapter, type AuthRequestContext } from 'next-server-wrap';
import { verifyToken } from '@/lib/jwt';

export const authAdapter = defineAuthAdapter<AppUser>({
  async verify(ctx: AuthRequestContext) {
    const token = ctx.headers.get('authorization')?.split(' ')[1];
    if (!token) return null;

    try {
      const decoded = await verifyToken(token);
      return {
        id: decoded.sub,
        companyId: decoded.companyId,
        role: decoded.role,
      };
    } catch {
      return null;
    }
  },

  hasRole(user, roles) {
    if (roles.length === 0) return true;
    return roles.includes(user.role);
  },
});
```

#### Example: NextAuth

```typescript
import { defineAuthAdapter, type AuthRequestContext } from 'next-server-wrap';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export const authAdapter = defineAuthAdapter<AppUser>({
  async verify(ctx: AuthRequestContext) {
    const session = await getServerSession(authOptions);
    if (!session?.user) return null;

    return {
      id: session.user.id,
      companyId: session.user.companyId,
      role: session.user.role,
    };
  },

  hasRole(user, roles) {
    if (roles.length === 0) return true;
    return roles.includes(user.role);
  },
});
```

### Cache Adapter

Handles **both response caching AND rate limiting** via `increment()`:

```typescript
import { defineCacheAdapter } from 'next-server-wrap';

interface CacheAdapter {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
  increment(key: string, ttlMs: number): Promise<number>;
}
```

#### Example: In-Memory

```typescript
import { defineCacheAdapter } from 'next-server-wrap';

const store = new Map<string, { value: unknown; expires: number }>();

export const cacheAdapter = defineCacheAdapter({
  async get<T>(key: string): Promise<T | null> {
    const item = store.get(key);
    if (!item || item.expires < Date.now()) {
      store.delete(key);
      return null;
    }
    return item.value as T;
  },

  async set(key: string, value: unknown, ttlMs = 60000): Promise<void> {
    store.set(key, { value, expires: Date.now() + ttlMs });
  },

  async delete(key: string): Promise<void> {
    store.delete(key);
  },

  async increment(key: string, ttlMs: number): Promise<number> {
    const current = (store.get(key)?.value as number) || 0;
    const next = current + 1;
    store.set(key, { value: next, expires: Date.now() + ttlMs });
    return next;
  },
});
```

#### Example: Redis

```typescript
import { defineCacheAdapter } from 'next-server-wrap';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL!);

export const cacheAdapter = defineCacheAdapter({
  async get(key) {
    const value = await redis.get(key);
    return value ? JSON.parse(value) : null;
  },

  async set(key, value, ttlMs = 60000) {
    await redis.set(key, JSON.stringify(value), 'PX', ttlMs);
  },

  async delete(key) {
    await redis.del(key);
  },

  async increment(key, ttlMs) {
    const count = await redis.incr(key);
    if (count === 1) await redis.pexpire(key, ttlMs);
    return count;
  },
});
```

### Logger Adapter

```typescript
import { defineLoggerAdapter } from 'next-server-wrap';

interface LoggerAdapter<TUser> {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, error?: Error, meta?: Record<string, unknown>): void;
  audit(event: AuditEvent<TUser>): void;
}

interface AuditEvent<TUser> {
  requestId: string;
  user: TUser;
  action: string;
  resource: string;
  resourceId?: string;
  ip?: string;
  userAgent?: string;
  timestamp: Date;
  durationMs: number;
}
```

#### Example: Console Logger

```typescript
import { defineLoggerAdapter } from 'next-server-wrap';

export const loggerAdapter = defineLoggerAdapter<AppUser>({
  debug: (msg, meta) => console.debug(`[DEBUG] ${msg}`, meta),
  info: (msg, meta) => console.info(`[INFO] ${msg}`, meta),
  warn: (msg, meta) => console.warn(`[WARN] ${msg}`, meta),
  error: (msg, err, meta) => console.error(`[ERROR] ${msg}`, err, meta),
  audit: (event) => console.info(`[AUDIT] ${event.action}`, event),
});
```

#### Example: Pino Logger

```typescript
import { defineLoggerAdapter } from 'next-server-wrap';
import pino from 'pino';

const logger = pino({ level: 'info' });

export const loggerAdapter = defineLoggerAdapter<AppUser>({
  debug: (msg, meta) => logger.debug(meta, msg),
  info: (msg, meta) => logger.info(meta, msg),
  warn: (msg, meta) => logger.warn(meta, msg),
  error: (msg, err, meta) => logger.error({ ...meta, err }, msg),
  audit: (event) => logger.info({ type: 'audit', ...event }, 'Audit event'),
});
```

#### Example: Database Audit Logger

```typescript
import { defineLoggerAdapter } from 'next-server-wrap';
import prisma from '@/lib/prisma';

export const loggerAdapter = defineLoggerAdapter<AppUser>({
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: (msg, err) => console.error(msg, err),
  audit: async (event) => {
    await prisma.auditLog.create({
      data: {
        requestId: event.requestId,
        userId: event.user.id,
        action: event.action,
        resource: event.resource,
        resourceId: event.resourceId,
        ip: event.ip,
        userAgent: event.userAgent,
        durationMs: event.durationMs,
      },
    });
  },
});
```

## Response Helpers

```typescript
import { ApiResponse } from 'next-server-wrap';

// Success responses (return these)
ApiResponse.success(data)           // 200
ApiResponse.created(data)           // 201
ApiResponse.noContent()             // 204

// Error responses (throw these)
throw ApiResponse.badRequest('Invalid input')
throw ApiResponse.unauthorized('Login required')
throw ApiResponse.forbidden('Access denied')
throw ApiResponse.notFound('Resource not found')
throw ApiResponse.conflict('Already exists')
throw ApiResponse.validationError('Validation failed', errors)
throw ApiResponse.tooManyRequests('Rate limit exceeded')
throw ApiResponse.internalError('Something went wrong')
```

## Response Transformers

Customize response format globally:

```typescript
import { setGlobalTransformers } from 'next-server-wrap';

setGlobalTransformers({
  success: (data, status) => ({ ok: true, result: data }),
  error: (message, code, status, errors) => ({ ok: false, error: { message, code } }),
});
```

## Context Object

The handler receives a context object with parsed and validated data:

```typescript
interface ApiContext<TParams, TQuery, TBody, TUser> {
  req: Request;
  requestId: string;

  // Parsed & validated (types from Zod)
  parsedParams: TParams;
  parsedQuery: TQuery;
  parsedBody: TBody;

  // Auth
  user: TUser;

  // Metadata
  ip: string;
  userAgent: string;
  method: string;
  path: string;
}
```

## Response Headers

Every response includes:

- `X-Request-ID` - Unique request identifier
- `X-Cache: HIT|MISS` - Cache status (when caching enabled)
- `X-RateLimit-Limit` - Rate limit max (on 429)
- `X-RateLimit-Remaining` - Remaining requests (on 429)
- `X-RateLimit-Reset` - Reset timestamp (on 429)
- `Retry-After` - Seconds until reset (on 429)

## Default Rate Limits

When cache adapter is provided, defaults apply based on HTTP method:

| Method | Default Limit |
|--------|---------------|
| GET | 200/min |
| POST | 50/min |
| PUT | 50/min |
| PATCH | 50/min |
| DELETE | 20/min |

Set `rateLimit: false` to disable rate limiting.

## Library Structure

```
next-server-wrap/
  src/
    index.ts                    # Main exports
    core/
      middleware/
        timeout.ts              # Request timeout
        retry.ts                # Retry with backoff
        rate-limit.ts           # Rate limiting
        cache.ts                # Response caching
      utils/
        cookies.ts              # Cookie parsing
        auth-context.ts         # Auth context builder
      wrapper/
        api.ts                  # createApiWrapper
        action.ts               # createActionWrapper
        error-handler.ts        # Error handling
      context.ts                # Context builder
      response.ts               # ApiResponse class
      error.ts                  # ApiError class
      types.ts                  # TypeScript interfaces
    adapters/
      auth.ts                   # defineAuthAdapter
      cache.ts                  # defineCacheAdapter
      logger.ts                 # defineLoggerAdapter
```

## TypeScript Support

Full type inference for params, query, body, and context:

```typescript
const paramsSchema = z.object({ id: z.string().uuid() });
const querySchema = z.object({ include: z.string().optional() });
const bodySchema = z.object({ name: z.string() });

export const PATCH = apiWrapper(
  async (ctx) => {
    // All fully typed
    ctx.parsedParams.id;      // string
    ctx.parsedQuery.include;  // string | undefined
    ctx.parsedBody.name;      // string
    ctx.user.id;              // string

    return ApiResponse.success({ updated: true });
  },
  {
    auth: [],
    validation: {
      params: paramsSchema,
      query: querySchema,
      body: bodySchema,
    },
  }
);
```

## Error Handling

Errors are automatically caught and formatted:

```typescript
export const GET = apiWrapper(async (ctx) => {
  // Thrown ApiResponse errors are returned as-is
  if (!item) throw ApiResponse.notFound('Not found');

  // Zod validation errors are formatted as 422
  // Unknown errors become 500 Internal Server Error
  // No internal details leaked to client

  return ApiResponse.success(item);
}, { auth: [] });
```

## License

MIT
