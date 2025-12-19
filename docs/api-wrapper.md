# API Wrapper

A centralized wrapper for Next.js API routes that handles authentication, validation, error handling, rate limiting, caching, timeout, retry, and audit logging.

## Quick Start

```typescript
import { z } from 'zod';
import { apiWrapper } from '@/lib/api';
import { ApiResponse } from 'next-server-wrap';

const updateSchema = z.object({
  name: z.string().min(1),
  text: z.string().min(1),
});

export const PATCH = apiWrapper(
  async (ctx) => {
    const { id } = ctx.parsedParams;
    const { name, text } = ctx.parsedBody;

    const result = await prisma.template.update({
      where: { id, userId: ctx.user.id, companyId: ctx.user.companyId },
      data: { name, text },
    });

    return ApiResponse.success(result);
  },
  {
    auth: ['user'],
    validation: {
      params: z.object({ id: z.string().uuid() }),
      body: updateSchema,
    },
  }
);
```

## Options

| Option | Type | Description |
|--------|------|-------------|
| `auth` | `string[]` \| `undefined` | Role-based access control. `[]` = any authenticated user, `['admin']` = admin only, `undefined` = public |
| `validation.params` | `ZodSchema` | Validates dynamic route params (e.g., `[id]`) |
| `validation.query` | `ZodSchema` | Validates URL query parameters |
| `validation.body` | `ZodSchema` | Validates request body |
| `rateLimit` | `{ max, windowMs }` \| `false` | Per-endpoint rate limiting. `false` to disable |
| `cache` | `{ ttlMs, keyGenerator?, successOnly? }` | Response caching for GET requests |
| `timeout` | `number` | Request timeout in ms |
| `retry` | `{ attempts, delayMs?, retryOn?, shouldRetry? }` | Retry with exponential backoff |
| `tenantScoped` | `boolean` | Requires valid tenant via `auth.isTenantValid()` |
| `audit` | `boolean` | Logs security events (who did what) |
| `middleware` | `Function[]` | Custom middleware chain |

## Authentication

### Public Endpoint (no auth)
```typescript
export const GET = apiWrapper(handler, {
  // auth not specified = public
});
```

### Any Authenticated User
```typescript
export const GET = apiWrapper(handler, {
  auth: [], // empty array = any role
});
```

### Specific Roles
```typescript
export const DELETE = apiWrapper(handler, {
  auth: ['super', 'admin'], // only super admins or admins
});
```

### Accessing User Data
```typescript
export const GET = apiWrapper(async (ctx) => {
  const { id, companyId, role } = ctx.user;
  // ...
}, { auth: [] });
```

## Validation

### Params (Dynamic Routes)
For routes like `/api/template/[id]/route.ts`:

```typescript
export const GET = apiWrapper(handler, {
  validation: {
    params: z.object({
      id: z.string().uuid(),
    }),
  },
});

// Access in handler
const { id } = ctx.parsedParams;
```

### Query Parameters
For URLs like `/api/users?page=1&limit=10`:

```typescript
export const GET = apiWrapper(handler, {
  validation: {
    query: z.object({
      page: z.coerce.number().min(1).default(1),
      limit: z.coerce.number().min(1).max(100).default(20),
      search: z.string().max(100).optional(),
    }),
  },
});

// Access in handler
const { page, limit, search } = ctx.parsedQuery;
```

### Request Body
```typescript
const createSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email(),
  role: z.enum(['user', 'admin']),
});

export const POST = apiWrapper(handler, {
  validation: {
    body: createSchema,
  },
});

// Access in handler
const { name, email, role } = ctx.parsedBody;
```

## Rate Limiting

Rate limiting uses `cache.increment()` for atomic counting:

```typescript
export const POST = apiWrapper(handler, {
  rateLimit: {
    max: 100,        // max requests
    windowMs: 60000, // per minute
  },
});
```

Default limits by method:
- GET: 200/min
- POST/PUT/PATCH: 50/min
- DELETE: 20/min

Disable with `rateLimit: false`.

## Response Caching

Cache GET responses with TTL:

```typescript
export const GET = apiWrapper(handler, {
  cache: {
    ttlMs: 60000,                              // 1 minute
    keyGenerator: (req) => `custom:${req.url}`, // optional custom key
    successOnly: true,                          // only cache 2xx (default)
  },
});
```

Response headers:
- `X-Cache: HIT` - served from cache
- `X-Cache: MISS` - fresh response, now cached

## Timeout

```typescript
export const POST = apiWrapper(handler, {
  timeout: 5000, // 5 seconds
});
```

Returns 408 Request Timeout on expiry.

## Retry

Exponential backoff for transient failures:

```typescript
export const GET = apiWrapper(handler, {
  retry: {
    attempts: 3,                    // max attempts
    delayMs: 100,                   // initial delay (doubles each retry)
    retryOn: [502, 503, 504],       // status codes to retry (default)
    shouldRetry: (error, attempt) => true, // custom retry logic
  },
});
```

## Tenant Scoping (Multi-Tenant)

Requires valid tenant context via `isTenantValid` in your auth adapter:

```typescript
// In your auth adapter
const authAdapter = defineAuthAdapter<AppUser>({
  verify(ctx) { /* ... */ },
  hasRole(user, roles) { /* ... */ },

  // Define your tenant validation logic
  isTenantValid(user) {
    return !!user.companyId; // or organizationId, workspaceId, etc.
  },
});

// In your route
export const GET = apiWrapper(async (ctx) => {
  const items = await prisma.template.findMany({
    where: { companyId: ctx.user.companyId },
  });
  return ApiResponse.success(items);
}, {
  auth: [],
  tenantScoped: true, // throws 403 if isTenantValid returns false
});
```

## Audit Logging

```typescript
export const DELETE = apiWrapper(handler, {
  auth: ['admin'],
  audit: true, // logs: requestId, user, action, resource, resourceId, ip, userAgent, timestamp, durationMs
});
```

## Error Handling

### Throwing Errors
```typescript
export const GET = apiWrapper(async (ctx) => {
  const item = await prisma.template.findUnique({ where: { id } });

  if (!item) {
    throw ApiResponse.notFound('Template not found');
  }

  if (item.userId !== ctx.user.id) {
    throw ApiResponse.forbidden('Not your template');
  }

  return ApiResponse.success(item);
}, { auth: [] });
```

### Available Response Helpers
```typescript
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

## Context Object

```typescript
async (ctx) => {
  ctx.req;           // Request object
  ctx.requestId;     // Unique request ID (X-Request-ID header)

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

## Response Headers

Every response includes:
- `X-Request-ID` - Unique request identifier
- `X-Cache: HIT|MISS` - Cache status (when caching enabled)
- `X-RateLimit-Limit` - Rate limit max (on 429)
- `X-RateLimit-Remaining` - Remaining requests (on 429)
- `X-RateLimit-Reset` - Reset timestamp (on 429)
- `Retry-After` - Seconds until reset (on 429)

## Complete Example

```typescript
// app/api/template/[id]/route.ts
import { z } from 'zod';
import { apiWrapper } from '@/lib/api';
import { ApiResponse } from 'next-server-wrap';
import prisma from '@/lib/prisma';

const updateSchema = z.object({
  name: z.string().min(1).max(255),
  text: z.string().min(1),
});

const paramsSchema = z.object({
  id: z.string().uuid(),
});

export const GET = apiWrapper(
  async (ctx) => {
    const { id } = ctx.parsedParams;

    const template = await prisma.template.findUnique({
      where: { id, userId: ctx.user.id, companyId: ctx.user.companyId },
    });

    if (!template) {
      throw ApiResponse.notFound('Template not found');
    }

    return ApiResponse.success(template);
  },
  {
    auth: [],
    validation: { params: paramsSchema },
    cache: { ttlMs: 30000 }, // cache for 30s
  }
);

export const PATCH = apiWrapper(
  async (ctx) => {
    const { id } = ctx.parsedParams;
    const { name, text } = ctx.parsedBody;

    const template = await prisma.template.update({
      where: { id, userId: ctx.user.id, companyId: ctx.user.companyId },
      data: { name, text },
    });

    return ApiResponse.success(template);
  },
  {
    auth: [],
    validation: { params: paramsSchema, body: updateSchema },
    timeout: 5000,
  }
);

export const DELETE = apiWrapper(
  async (ctx) => {
    const { id } = ctx.parsedParams;

    await prisma.template.delete({
      where: { id, userId: ctx.user.id, companyId: ctx.user.companyId },
    });

    return ApiResponse.success({ deleted: true });
  },
  {
    auth: [],
    validation: { params: paramsSchema },
    audit: true,
  }
);
```

## Security Features

1. **Authentication** - Pluggable auth via adapter
2. **Authorization** - Role-based access control
3. **Validation** - Zod schemas for all inputs
4. **Rate Limiting** - Atomic counting via cache adapter
5. **Company Isolation** - Multi-tenant data separation
6. **Audit Logging** - Security event tracking
7. **Error Sanitization** - No internal details leaked to client
8. **Request ID Tracking** - Distributed tracing support
