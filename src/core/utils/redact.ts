import { SENSITIVE_FIELDS } from '../types.js';

const REDACTED = '[REDACTED]';

/**
 * Redacts sensitive fields from an object (recursive)
 * Use this before logging request bodies or other potentially sensitive data
 */
export function redact<T>(obj: T, additionalFields: string[] = []): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => redact(item, additionalFields)) as T;
  }

  const sensitiveSet = new Set([
    ...SENSITIVE_FIELDS,
    ...additionalFields.map((f) => f.toLowerCase()),
  ]);

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();

    // Check if key matches sensitive field
    if (sensitiveSet.has(lowerKey)) {
      result[key] = REDACTED;
      continue;
    }

    // Check if key contains sensitive substring
    const isSensitive = [...sensitiveSet].some(
      (field) => lowerKey.includes(field) || field.includes(lowerKey)
    );

    if (isSensitive) {
      result[key] = REDACTED;
      continue;
    }

    // Recursively redact nested objects
    if (typeof value === 'object' && value !== null) {
      result[key] = redact(value, additionalFields);
    } else {
      result[key] = value;
    }
  }

  return result as T;
}

/**
 * Redacts sensitive headers (Authorization, Cookie, etc.)
 */
export function redactHeaders(headers: Headers | Record<string, string>): Record<string, string> {
  const sensitiveHeaders = new Set([
    'authorization',
    'cookie',
    'set-cookie',
    'x-api-key',
    'x-auth-token',
    'x-access-token',
  ]);

  const result: Record<string, string> = {};

  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      result[key] = sensitiveHeaders.has(key.toLowerCase()) ? REDACTED : value;
    });
  } else {
    for (const [key, value] of Object.entries(headers)) {
      result[key] = sensitiveHeaders.has(key.toLowerCase()) ? REDACTED : value;
    }
  }

  return result;
}
