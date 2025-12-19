import type { z } from 'zod';
import type {
  ApiContext,
  ActionContext,
  BaseUser,
  ValidationConfig,
  NextRouteContext,
} from './types.js';
import { ApiError } from './error.js';
import { ApiResponse } from './response.js';

// Generate unique request ID
export function generateRequestId(): string {
  // Use crypto.randomUUID if available, otherwise fallback
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older environments
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

function getClientIp(req: Request): string {
  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }

  const realIp = req.headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }

  return 'unknown';
}

function getUserAgent(req: Request): string {
  return req.headers.get('user-agent') || 'unknown';
}

function getPath(req: Request): string {
  try {
    return new URL(req.url).pathname;
  } catch {
    return 'unknown';
  }
}

async function parseBody(req: Request): Promise<unknown> {
  const contentType = req.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    try {
      return await req.json();
    } catch {
      throw ApiResponse.badRequest('Invalid JSON body');
    }
  }

  if (contentType.includes('application/x-www-form-urlencoded')) {
    try {
      const text = await req.text();
      const params = new URLSearchParams(text);
      return Object.fromEntries(params.entries());
    } catch {
      throw ApiResponse.badRequest('Invalid form body');
    }
  }

  if (contentType.includes('multipart/form-data')) {
    try {
      const formData = await req.formData();
      const obj: Record<string, unknown> = {};
      formData.forEach((value, key) => {
        obj[key] = value;
      });
      return obj;
    } catch {
      throw ApiResponse.badRequest('Invalid multipart body');
    }
  }

  return {};
}

function parseQuery(req: Request): Record<string, string> {
  try {
    const url = new URL(req.url);
    return Object.fromEntries(url.searchParams.entries());
  } catch {
    return {};
  }
}

function formatZodErrors(
  error: { issues: Array<{ path: PropertyKey[]; message: string }> }
): { field: string; message: string }[] {
  return error.issues.map((issue) => ({
    field: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

async function validateSchema<T extends z.ZodTypeAny>(
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

export async function buildApiContext<
  TParams extends z.ZodTypeAny = z.ZodTypeAny,
  TQuery extends z.ZodTypeAny = z.ZodTypeAny,
  TBody extends z.ZodTypeAny = z.ZodTypeAny,
  TUser extends BaseUser = BaseUser,
>(
  req: Request,
  routeCtx: NextRouteContext,
  validation: ValidationConfig<TParams, TQuery, TBody> | undefined,
  user: TUser,
  requestId: string
): Promise<ApiContext<z.infer<TParams>, z.infer<TQuery>, z.infer<TBody>, TUser>> {
  // Parse raw values
  const rawParams = await routeCtx.params;
  const rawQuery = parseQuery(req);
  const rawBody =
    req.method !== 'GET' && req.method !== 'HEAD'
      ? await parseBody(req)
      : undefined;

  // Validate if schemas provided
  const parsedParams = validation?.params
    ? await validateSchema(validation.params, rawParams, 'params')
    : rawParams;

  const parsedQuery = validation?.query
    ? await validateSchema(validation.query, rawQuery, 'query')
    : rawQuery;

  const parsedBody = validation?.body
    ? await validateSchema(validation.body, rawBody, 'body')
    : rawBody;

  return {
    req,
    requestId,
    parsedParams,
    parsedQuery,
    parsedBody,
    user,
    ip: getClientIp(req),
    userAgent: getUserAgent(req),
    method: req.method,
    path: getPath(req),
  } as ApiContext<z.infer<TParams>, z.infer<TQuery>, z.infer<TBody>, TUser>;
}

export async function buildActionContext<
  TBody extends z.ZodTypeAny = z.ZodTypeAny,
  TUser extends BaseUser = BaseUser,
>(
  input: unknown,
  bodySchema: TBody | undefined,
  user: TUser,
  requestId: string
): Promise<ActionContext<z.infer<TBody>, TUser>> {
  const parsedBody = bodySchema
    ? await validateSchema(bodySchema, input, 'body')
    : input;

  return {
    requestId,
    parsedBody,
    user,
  } as ActionContext<z.infer<TBody>, TUser>;
}
