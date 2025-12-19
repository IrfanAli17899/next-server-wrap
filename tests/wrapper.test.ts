import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { createApiWrapper, createActionWrapper } from '../src/core/wrapper/index.js';
import { ApiResponse } from '../src/core/response.js';
import type {
  AuthAdapter,
  LoggerAdapter,
  CacheAdapter,
  AuthRequestContext,
} from '../src/core/types.js';

// Mock adapters
const createMockAuthAdapter = (
  user: { id: string; role?: string } | null
): AuthAdapter => ({
  verify: vi.fn().mockResolvedValue(user),
  hasRole: vi.fn((u, roles) => roles.length === 0 || roles.includes(u.role)),
});

// Cache adapter (also used for rate limiting via increment)
const createMockCacheAdapter = (
  startRateLimitCount = 0
): CacheAdapter & { store: Map<string, unknown>; rateLimitCount: number } => {
  const store = new Map<string, unknown>();
  let rateLimitCount = startRateLimitCount;
  return {
    store,
    rateLimitCount,
    get: vi.fn().mockImplementation((key) => Promise.resolve(store.get(key) || null)),
    set: vi.fn().mockImplementation((key, value) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    delete: vi.fn().mockImplementation((key) => {
      store.delete(key);
      return Promise.resolve();
    }),
    increment: vi.fn().mockImplementation((key) => {
      // For rate limiting keys
      if (key.startsWith('ratelimit:')) {
        rateLimitCount++;
        return Promise.resolve(rateLimitCount);
      }
      // For other increments
      const current = (store.get(key) as number) || 0;
      store.set(key, current + 1);
      return Promise.resolve(current + 1);
    }),
  };
};

const createMockLogger = (): LoggerAdapter => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  audit: vi.fn(),
});

// Helper to create mock Request
const createRequest = (
  options: {
    method?: string;
    url?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {}
) => {
  const {
    method = 'GET',
    url = 'http://localhost/api/test',
    body,
    headers = {},
  } = options;

  return new Request(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
};

// Helper to create mock route context
const createRouteContext = (params: Record<string, string> = {}) => ({
  params: Promise.resolve(params),
});

describe('createApiWrapper', () => {
  describe('request ID', () => {
    it('should generate request ID and include in response', async () => {
      const apiWrapper = createApiWrapper({ adapters: {} });

      const handler = apiWrapper(async () => ApiResponse.success({ ok: true }), {});

      const response = await handler(createRequest(), createRouteContext());

      expect(response.headers.get('X-Request-ID')).toBeTruthy();
      expect(response.headers.get('X-Request-ID')).toMatch(
        /^[0-9a-f-]{36}$|^[a-z0-9]+-[a-z0-9]+$/
      );
    });

    it('should use provided request ID from header', async () => {
      const apiWrapper = createApiWrapper({ adapters: {} });

      const handler = apiWrapper(async () => ApiResponse.success({ ok: true }), {});

      const response = await handler(
        createRequest({ headers: { 'x-request-id': 'custom-request-123' } }),
        createRouteContext()
      );

      expect(response.headers.get('X-Request-ID')).toBe('custom-request-123');
    });

    it('should include request ID in context', async () => {
      const apiWrapper = createApiWrapper({ adapters: {} });
      let capturedRequestId: string | undefined;

      const handler = apiWrapper(
        async (ctx) => {
          capturedRequestId = ctx.requestId;
          return ApiResponse.success({ ok: true });
        },
        {}
      );

      await handler(createRequest(), createRouteContext());

      expect(capturedRequestId).toBeTruthy();
    });
  });

  describe('public endpoints (no auth)', () => {
    it('should allow access without auth', async () => {
      const apiWrapper = createApiWrapper({ adapters: {} });

      const handler = apiWrapper(
        async () => ApiResponse.success({ message: 'public' }),
        {}
      );

      const response = await handler(createRequest(), createRouteContext());
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.message).toBe('public');
    });
  });

  describe('authentication', () => {
    it('should reject unauthenticated request when auth required', async () => {
      const authAdapter = createMockAuthAdapter(null);
      const apiWrapper = createApiWrapper({ adapters: { auth: authAdapter } });

      const handler = apiWrapper(
        async () => ApiResponse.success({ data: 'secret' }),
        { auth: [] }
      );

      const response = await handler(createRequest(), createRouteContext());

      expect(response.status).toBe(401);
    });

    it('should allow authenticated request', async () => {
      const authAdapter = createMockAuthAdapter({ id: 'user-1' });
      const apiWrapper = createApiWrapper({ adapters: { auth: authAdapter } });

      const handler = apiWrapper(
        async (ctx) => ApiResponse.success({ id: ctx.user.id }),
        { auth: [] }
      );

      const response = await handler(createRequest(), createRouteContext());
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.id).toBe('user-1');
    });

    it('should reject user without required role', async () => {
      const authAdapter = createMockAuthAdapter({ id: 'user-1', role: 'user' });
      const apiWrapper = createApiWrapper({ adapters: { auth: authAdapter } });

      const handler = apiWrapper(
        async () => ApiResponse.success({ data: 'admin only' }),
        { auth: ['admin'] }
      );

      const response = await handler(createRequest(), createRouteContext());

      expect(response.status).toBe(403);
    });

    it('should allow user with required role', async () => {
      const authAdapter = createMockAuthAdapter({ id: 'admin-1', role: 'admin' });
      const apiWrapper = createApiWrapper({ adapters: { auth: authAdapter } });

      const handler = apiWrapper(
        async () => ApiResponse.success({ data: 'admin content' }),
        { auth: ['admin'] }
      );

      const response = await handler(createRequest(), createRouteContext());

      expect(response.status).toBe(200);
    });

    it('should pass headers and cookies to auth adapter', async () => {
      const authAdapter: AuthAdapter = {
        verify: vi.fn().mockImplementation((ctx: AuthRequestContext) => {
          if (ctx.cookies?.session === 'abc123') {
            return { id: 'user-from-cookie' };
          }
          const authHeader = ctx.headers.get('authorization');
          if (authHeader === 'Bearer token123') {
            return { id: 'user-from-header' };
          }
          return null;
        }),
        hasRole: () => true,
      };

      const apiWrapper = createApiWrapper({ adapters: { auth: authAdapter } });

      const handler = apiWrapper(
        async (ctx) => ApiResponse.success({ id: ctx.user.id }),
        { auth: [] }
      );

      // Test with cookie
      const cookieResponse = await handler(
        createRequest({ headers: { cookie: 'session=abc123' } }),
        createRouteContext()
      );
      const cookieBody = await cookieResponse.json();
      expect(cookieBody.data.id).toBe('user-from-cookie');

      // Test with header
      const headerResponse = await handler(
        createRequest({ headers: { authorization: 'Bearer token123' } }),
        createRouteContext()
      );
      const headerBody = await headerResponse.json();
      expect(headerBody.data.id).toBe('user-from-header');
    });
  });

  describe('validation', () => {
    it('should validate params', async () => {
      const apiWrapper = createApiWrapper({ adapters: {} });

      const handler = apiWrapper(
        async (ctx) => ApiResponse.success({ id: ctx.parsedParams.id }),
        {
          validation: {
            params: z.object({ id: z.string().uuid() }),
          },
        }
      );

      const response = await handler(
        createRequest(),
        createRouteContext({ id: 'not-a-uuid' })
      );

      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('should pass valid params', async () => {
      const apiWrapper = createApiWrapper({ adapters: {} });
      const validId = '550e8400-e29b-41d4-a716-446655440000';

      const handler = apiWrapper(
        async (ctx) => ApiResponse.success({ id: ctx.parsedParams.id }),
        {
          validation: {
            params: z.object({ id: z.string().uuid() }),
          },
        }
      );

      const response = await handler(
        createRequest(),
        createRouteContext({ id: validId })
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.id).toBe(validId);
    });

    it('should validate body', async () => {
      const apiWrapper = createApiWrapper({ adapters: {} });

      const handler = apiWrapper(async (ctx) => ApiResponse.success(ctx.parsedBody), {
        validation: {
          body: z.object({
            name: z.string().min(1),
            email: z.string().email(),
          }),
        },
      });

      const response = await handler(
        createRequest({
          method: 'POST',
          body: { name: '', email: 'invalid' },
        }),
        createRouteContext()
      );

      expect(response.status).toBe(422);
    });
  });

  describe('rate limiting (uses cache.increment)', () => {
    it('should reject when rate limit exceeded', async () => {
      // Start at 200, next increment will be 201 (over limit)
      const cache = createMockCacheAdapter(200);
      const apiWrapper = createApiWrapper({
        adapters: { cache },
      });

      const handler = apiWrapper(async () => ApiResponse.success({ ok: true }), {});

      const response = await handler(createRequest(), createRouteContext());

      expect(response.status).toBe(429);
      expect(response.headers.get('Retry-After')).toBeTruthy();
      expect(response.headers.get('X-Request-ID')).toBeTruthy();
    });

    it('should allow when under rate limit', async () => {
      const cache = createMockCacheAdapter(0);
      const apiWrapper = createApiWrapper({
        adapters: { cache },
      });

      const handler = apiWrapper(async () => ApiResponse.success({ ok: true }), {});

      const response = await handler(createRequest(), createRouteContext());

      expect(response.status).toBe(200);
      expect(cache.increment).toHaveBeenCalled();
    });

    it('should skip rate limiting when disabled', async () => {
      const cache = createMockCacheAdapter(1000);
      const apiWrapper = createApiWrapper({
        adapters: { cache },
      });

      const handler = apiWrapper(async () => ApiResponse.success({ ok: true }), {
        rateLimit: false,
      });

      const response = await handler(createRequest(), createRouteContext());

      expect(response.status).toBe(200);
      // increment should not be called for rate limiting (but might be for caching)
      expect(
        cache.increment.mock.calls.filter((c: string[]) => c[0].startsWith('ratelimit:'))
      ).toHaveLength(0);
    });

    it('should skip rate limiting when no cache adapter', async () => {
      const apiWrapper = createApiWrapper({
        adapters: {},
      });

      const handler = apiWrapper(async () => ApiResponse.success({ ok: true }), {});

      const response = await handler(createRequest(), createRouteContext());

      expect(response.status).toBe(200);
    });
  });

  describe('timeout', () => {
    it('should timeout slow handlers', async () => {
      const apiWrapper = createApiWrapper({ adapters: {} });

      const handler = apiWrapper(
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 200));
          return ApiResponse.success({ ok: true });
        },
        { timeout: 50 }
      );

      const response = await handler(createRequest(), createRouteContext());

      expect(response.status).toBe(408);
      const body = await response.json();
      expect(body.code).toBe('TIMEOUT');
    });

    it('should complete fast handlers', async () => {
      const apiWrapper = createApiWrapper({ adapters: {} });

      const handler = apiWrapper(
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return ApiResponse.success({ ok: true });
        },
        { timeout: 1000 }
      );

      const response = await handler(createRequest(), createRouteContext());

      expect(response.status).toBe(200);
    });

    it('should use default timeout from config', async () => {
      const apiWrapper = createApiWrapper({
        adapters: {},
        defaults: { timeout: 50 },
      });

      const handler = apiWrapper(
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 200));
          return ApiResponse.success({ ok: true });
        },
        {}
      );

      const response = await handler(createRequest(), createRouteContext());

      expect(response.status).toBe(408);
    });
  });

  describe('response caching', () => {
    it('should cache GET responses', async () => {
      const cache = createMockCacheAdapter();
      const apiWrapper = createApiWrapper({ adapters: { cache } });

      let callCount = 0;
      const handler = apiWrapper(
        async () => {
          callCount++;
          return ApiResponse.success({ count: callCount });
        },
        { cache: { ttlMs: 60000 } }
      );

      // First request - cache miss
      const response1 = await handler(createRequest(), createRouteContext());
      expect(response1.status).toBe(200);
      expect(response1.headers.get('X-Cache')).toBe('MISS');

      // Second request - cache hit
      const response2 = await handler(createRequest(), createRouteContext());
      expect(response2.status).toBe(200);
      expect(response2.headers.get('X-Cache')).toBe('HIT');

      // Handler only called once
      expect(callCount).toBe(1);
    });

    it('should not cache non-GET requests', async () => {
      const cache = createMockCacheAdapter();
      const apiWrapper = createApiWrapper({ adapters: { cache } });

      const handler = apiWrapper(async () => ApiResponse.success({ ok: true }), {
        cache: { ttlMs: 60000 },
      });

      const response = await handler(
        createRequest({ method: 'POST', body: {} }),
        createRouteContext()
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('X-Cache')).toBeNull();
      expect(cache.set).not.toHaveBeenCalled();
    });

    it('should use custom cache key generator', async () => {
      const cache = createMockCacheAdapter();
      const apiWrapper = createApiWrapper({ adapters: { cache } });

      const handler = apiWrapper(async () => ApiResponse.success({ ok: true }), {
        cache: {
          ttlMs: 60000,
          keyGenerator: (req) => `custom:${new URL(req.url).pathname}`,
        },
      });

      await handler(createRequest(), createRouteContext());

      expect(cache.set).toHaveBeenCalledWith(
        'custom:/api/test',
        expect.any(Object),
        60000
      );
    });
  });

  describe('retry', () => {
    it('should retry on configured status codes', async () => {
      const logger = createMockLogger();
      const apiWrapper = createApiWrapper({ adapters: { logger } });

      let attempts = 0;
      const handler = apiWrapper(
        async () => {
          attempts++;
          if (attempts < 3) {
            throw ApiResponse.error('Service unavailable', 503);
          }
          return ApiResponse.success({ ok: true });
        },
        { retry: { attempts: 3, delayMs: 10 } }
      );

      const response = await handler(createRequest(), createRouteContext());

      expect(response.status).toBe(200);
      expect(attempts).toBe(3);
      expect(logger.warn).toHaveBeenCalledTimes(2); // 2 retry warnings
    });

    it('should fail after max retries', async () => {
      const apiWrapper = createApiWrapper({ adapters: {} });

      const handler = apiWrapper(
        async () => {
          throw ApiResponse.error('Service unavailable', 503);
        },
        { retry: { attempts: 2, delayMs: 10 } }
      );

      const response = await handler(createRequest(), createRouteContext());

      expect(response.status).toBe(503);
    });

    it('should not retry non-retryable errors', async () => {
      const apiWrapper = createApiWrapper({ adapters: {} });

      let attempts = 0;
      const handler = apiWrapper(
        async () => {
          attempts++;
          throw ApiResponse.badRequest('Invalid input');
        },
        { retry: { attempts: 3, delayMs: 10 } }
      );

      const response = await handler(createRequest(), createRouteContext());

      expect(response.status).toBe(400);
      expect(attempts).toBe(1); // No retries for 400
    });
  });

  describe('error handling', () => {
    it('should catch thrown ApiResponse errors', async () => {
      const apiWrapper = createApiWrapper({ adapters: {} });

      const handler = apiWrapper(
        async () => {
          throw ApiResponse.notFound('Item not found');
        },
        {}
      );

      const response = await handler(createRequest(), createRouteContext());

      expect(response.status).toBe(404);
      expect(response.headers.get('X-Request-ID')).toBeTruthy();
      const body = await response.json();
      expect(body.message).toBe('Item not found');
    });

    it('should sanitize unexpected errors', async () => {
      const logger = createMockLogger();
      const apiWrapper = createApiWrapper({ adapters: { logger } });

      const handler = apiWrapper(
        async () => {
          throw new Error('Database connection failed');
        },
        {}
      );

      const response = await handler(createRequest(), createRouteContext());

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.message).toBe('Internal server error');
      expect(body.message).not.toContain('Database');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('audit logging', () => {
    it('should log audit event with request ID and duration', async () => {
      const authAdapter = createMockAuthAdapter({ id: 'user-1' });
      const logger = createMockLogger();
      const apiWrapper = createApiWrapper({
        adapters: { auth: authAdapter, logger },
      });

      const handler = apiWrapper(async () => ApiResponse.success({ ok: true }), {
        auth: [],
        audit: true,
      });

      await handler(createRequest(), createRouteContext());

      expect(logger.audit).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: expect.any(String),
          user: expect.objectContaining({ id: 'user-1' }),
          action: 'GET',
          durationMs: expect.any(Number),
        })
      );
    });
  });

  describe('per-instance transformers', () => {
    it('should use instance transformers over global', async () => {
      const apiWrapper = createApiWrapper({
        adapters: {},
        transformers: {
          success: (data, status) => ({ custom: true, payload: data, code: status }),
        },
      });

      const handler = apiWrapper(async () => ({ foo: 'bar' }), {});

      const response = await handler(createRequest(), createRouteContext());
      const body = await response.json();

      expect(body).toEqual({ custom: true, payload: { foo: 'bar' }, code: 200 });
    });
  });
});

describe('createActionWrapper', () => {
  it('should validate input and execute handler', async () => {
    const actionWrapper = createActionWrapper({ adapters: {} });

    const action = actionWrapper(
      async (ctx) => ({ doubled: ctx.parsedBody.value * 2 }),
      {
        validation: {
          body: z.object({ value: z.number() }),
        },
      }
    );

    const result = await action({ value: 5 });

    expect(result.doubled).toBe(10);
  });

  it('should include requestId in context', async () => {
    const actionWrapper = createActionWrapper({ adapters: {} });
    let capturedRequestId: string | undefined;

    const action = actionWrapper(
      async (ctx) => {
        capturedRequestId = ctx.requestId;
        return { ok: true };
      },
      {}
    );

    await action({});

    expect(capturedRequestId).toBeTruthy();
  });

  it('should throw on validation error', async () => {
    const actionWrapper = createActionWrapper({ adapters: {} });

    const action = actionWrapper(async (ctx) => ctx.parsedBody, {
      validation: {
        body: z.object({ value: z.number() }),
      },
    });

    await expect(action({ value: 'not a number' })).rejects.toThrow();
  });

  it('should require getAuthContext when auth is used', async () => {
    const authAdapter = createMockAuthAdapter({ id: 'user-1' });
    const actionWrapper = createActionWrapper({
      adapters: { auth: authAdapter },
    });

    const action = actionWrapper(async (ctx) => ({ userId: ctx.user.id }), {
      auth: [],
    });

    await expect(action({})).rejects.toThrow(
      'getAuthContext must be provided to use auth in server actions'
    );
  });

  it('should use getAuthContext for server action auth', async () => {
    const authAdapter: AuthAdapter = {
      verify: vi.fn().mockImplementation((ctx: AuthRequestContext) => {
        if (ctx.cookies?.token === 'valid') {
          return { id: 'user-from-action' };
        }
        return null;
      }),
      hasRole: () => true,
    };

    const actionWrapper = createActionWrapper({
      adapters: { auth: authAdapter },
      getAuthContext: () => ({
        headers: new Headers(),
        cookies: { token: 'valid' },
      }),
    });

    const action = actionWrapper(async (ctx) => ({ userId: ctx.user.id }), {
      auth: [],
    });

    const result = await action({});
    expect(result.userId).toBe('user-from-action');
  });

  it('should timeout slow actions', async () => {
    const actionWrapper = createActionWrapper({ adapters: {} });

    const action = actionWrapper(
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return { ok: true };
      },
      { timeout: 50 }
    );

    await expect(action({})).rejects.toMatchObject({
      status: 408,
      code: 'TIMEOUT',
    });
  });

  it('should retry failed actions', async () => {
    const actionWrapper = createActionWrapper({ adapters: {} });

    let attempts = 0;
    const action = actionWrapper(
      async () => {
        attempts++;
        if (attempts < 2) {
          throw ApiResponse.error('Temporary failure', 503);
        }
        return { ok: true };
      },
      { retry: { attempts: 3, delayMs: 10 } }
    );

    const result = await action({});

    expect(result.ok).toBe(true);
    expect(attempts).toBe(2);
  });
});
