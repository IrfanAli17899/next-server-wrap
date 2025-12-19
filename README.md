# next-server-wrap

A minimal, type-safe wrapper for Next.js API routes and Server Actions. Handles auth, validation, rate limiting, caching, timeout, retry, and error handling with zero boilerplate.

## Features

- **Authentication & Authorization** - Role-based access control
- **Validation** - Zod schema validation for params, query, body
- **Rate Limiting** - Atomic, Redis-ready via cache adapter
- **Response Caching** - TTL-based with custom key generators
- **Timeout** - Configurable request timeouts
- **Retry** - Exponential backoff for transient failures
- **Request ID Tracking** - Distributed tracing support
- **Audit Logging** - Track who did what
- **Response Transformers** - Customize response format

## Install

```bash
npm install next-server-wrap
# or
pnpm add next-server-wrap
```

**Peer dependency:** `zod >= 3.0.0`

## Quick Start

### 1. Create your wrapper instance

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
    // ctx.headers - request headers
    // ctx.cookies - parsed cookies object
    const token = ctx.headers.get('authorization')?.split(' ')[1];
    if (!token) return null;
    return { id: '123', role: 'admin' };
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

### 2. Use in API routes

```typescript
// app/api/users/[id]/route.ts
import { z } from 'zod';
import { apiWrapper } from '@/lib/api';
import { ApiResponse } from 'next-server-wrap';

const paramsSchema = z.object({ id: z.string().uuid() });

export const GET = apiWrapper(
  async (ctx) => {
    const { id } = ctx.parsedParams;
    const user = await db.user.findUnique({ where: { id } });

    if (!user) throw ApiResponse.notFound('User not found');

    return ApiResponse.success(user);
  },
  {
    auth: [],  // any authenticated user
    validation: { params: paramsSchema },
  }
);
```

### 3. Use in Server Actions

```typescript
'use server';
import { z } from 'zod';
import { actionWrapper } from '@/lib/api';

const schema = z.object({ id: z.string(), name: z.string() });

export const updateUser = actionWrapper(
  async (ctx) => {
    return db.user.update({
      where: { id: ctx.parsedBody.id },
      data: { name: ctx.parsedBody.name },
    });
  },
  { auth: [], validation: { body: schema }, timeout: 5000 }
);
```

---

## Configuration Options

```typescript
apiWrapper(handler, {
  // Authentication
  auth: ['admin', 'super'],  // only these roles
  auth: [],                   // any authenticated user
  // auth: undefined          // public (default)

  // Validation (Zod schemas)
  validation: {
    params: z.object({ id: z.string().uuid() }),
    query: z.object({ page: z.coerce.number() }),
    body: z.object({ name: z.string() }),
  },

  // Rate limiting (uses cache.increment)
  rateLimit: { max: 100, windowMs: 60000 },
  rateLimit: false,  // disable

  // Response caching
  cache: {
    ttlMs: 60000,
    keyGenerator: (req) => `custom:${req.url}`,
    successOnly: true,  // only cache 2xx (default)
  },

  // Timeout
  timeout: 5000,  // ms

  // Retry with exponential backoff
  retry: {
    attempts: 3,
    delayMs: 100,
    retryOn: [502, 503, 504],
    shouldRetry: (error, attempt) => true,
  },

  // Multi-tenant
  companyScoped: true,

  // Audit logging
  audit: true,

  // Custom middleware
  middleware: [myMiddleware],
});
```

---

## Context Object

```typescript
async (ctx) => {
  ctx.req;           // Request object
  ctx.requestId;     // Unique request ID (also in X-Request-ID header)

  // Parsed & validated (types from Zod)
  ctx.parsedParams;
  ctx.parsedQuery;
  ctx.parsedBody;

  // Auth
  ctx.user;          // Your user type

  // Metadata
  ctx.ip;
  ctx.userAgent;
  ctx.method;
  ctx.path;
}
```

---

## Response Helpers

```typescript
import { ApiResponse } from 'next-server-wrap';

// Success (return these)
ApiResponse.success(data)           // 200
ApiResponse.created(data)           // 201
ApiResponse.noContent()             // 204

// Errors (throw these)
throw ApiResponse.badRequest('msg')        // 400
throw ApiResponse.unauthorized('msg')      // 401
throw ApiResponse.forbidden('msg')         // 403
throw ApiResponse.notFound('msg')          // 404
throw ApiResponse.conflict('msg')          // 409
throw ApiResponse.validationError('msg', errors) // 422
throw ApiResponse.tooManyRequests('msg')   // 429
throw ApiResponse.internalError('msg')     // 500
```

---

## Adapters

### Cache Adapter

Handles **both response caching AND rate limiting** via `increment()`:

```typescript
import { defineCacheAdapter } from 'next-server-wrap';

// In-memory example
const store = new Map<string, { value: unknown; expires: number }>();

const cacheAdapter = defineCacheAdapter({
  async get<T>(key: string): Promise<T | null> {
    const item = store.get(key);
    if (!item || item.expires < Date.now()) return null;
    return item.value as T;
  },

  async set(key: string, value: unknown, ttlMs = 60000): Promise<void> {
    store.set(key, { value, expires: Date.now() + ttlMs });
  },

  async delete(key: string): Promise<void> {
    store.delete(key);
  },

  async increment(key: string, ttlMs: number): Promise<number> {
    // Atomic increment - used for rate limiting
    const current = (store.get(key)?.value as number) || 0;
    const next = current + 1;
    store.set(key, { value: next, expires: Date.now() + ttlMs });
    return next;
  },
});
```

**Redis example:**

```typescript
import Redis from 'ioredis';
const redis = new Redis(process.env.REDIS_URL);

const cacheAdapter = defineCacheAdapter({
  async get(key) {
    const val = await redis.get(key);
    return val ? JSON.parse(val) : null;
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

### Auth Adapter

```typescript
import { defineAuthAdapter, type AuthRequestContext } from 'next-server-wrap';

const authAdapter = defineAuthAdapter<MyUser>({
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
```

### Logger Adapter

```typescript
import { defineLoggerAdapter } from 'next-server-wrap';

const loggerAdapter = defineLoggerAdapter<MyUser>({
  debug: (msg, meta) => console.debug(msg, meta),
  info: (msg, meta) => console.info(msg, meta),
  warn: (msg, meta) => console.warn(msg, meta),
  error: (msg, err, meta) => console.error(msg, err, meta),
  audit: (event) => {
    // event: { requestId, user, action, resource, resourceId, ip, userAgent, timestamp, durationMs }
    db.auditLog.create({ data: event });
  },
});
```

---

## Response Headers

Every response includes:

- `X-Request-ID` - Unique request identifier
- `X-Cache: HIT|MISS` - Cache status (when caching enabled)
- `X-RateLimit-Limit` - Rate limit max
- `X-RateLimit-Remaining` - Remaining requests
- `X-RateLimit-Reset` - Reset timestamp
- `Retry-After` - Seconds until reset (on 429)

---

## Default Rate Limits

When cache adapter is provided:

| Method | Limit |
|--------|-------|
| GET    | 200/min |
| POST   | 50/min |
| PUT    | 50/min |
| PATCH  | 50/min |
| DELETE | 20/min |

Disable with `rateLimit: false`.

---

## Response Transformers

```typescript
import { setGlobalTransformers } from 'next-server-wrap';

setGlobalTransformers({
  success: (data, status) => ({ ok: true, result: data }),
  error: (message, code, status, errors) => ({ ok: false, error: { message, code } }),
});
```

---

## License

MIT
