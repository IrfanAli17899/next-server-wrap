import type { RetryConfig, LoggerAdapter, BaseUser } from '../types.js';
import { ApiError } from '../error.js';

const DEFAULT_RETRY_STATUS_CODES = [502, 503, 504];

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig,
  logger?: LoggerAdapter<BaseUser>,
  requestId?: string
): Promise<T> {
  const {
    attempts,
    delayMs = 100,
    retryOn = DEFAULT_RETRY_STATUS_CODES,
    shouldRetry,
  } = config;

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      let shouldRetryThis = false;

      if (shouldRetry) {
        shouldRetryThis = shouldRetry(error, attempt);
      } else if (ApiError.isApiError(error)) {
        shouldRetryThis = retryOn.includes(error.status);
      }

      if (!shouldRetryThis || attempt === attempts) {
        throw error;
      }

      const delay = delayMs * Math.pow(2, attempt - 1);
      logger?.warn(`Retry attempt ${attempt}/${attempts} after ${delay}ms`, { requestId });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
