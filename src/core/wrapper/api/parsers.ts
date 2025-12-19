import { ApiResponse } from '../../response.js';

export function getClientIp(req: Request): string {
  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) return forwardedFor.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'unknown';
}

export function getUserAgent(req: Request): string {
  return req.headers.get('user-agent') || 'unknown';
}

export function parseQuery(req: Request): Record<string, string> {
  try {
    return Object.fromEntries(new URL(req.url).searchParams.entries());
  } catch {
    return {};
  }
}

export async function parseBody(req: Request): Promise<unknown> {
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
      return Object.fromEntries(new URLSearchParams(text).entries());
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
