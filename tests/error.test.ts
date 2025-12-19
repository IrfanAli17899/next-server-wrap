import { describe, it, expect } from 'vitest';
import { ApiError } from '../src/core/error.js';

describe('ApiError', () => {
  it('should create error with default values', () => {
    const error = new ApiError('Something went wrong');

    expect(error.message).toBe('Something went wrong');
    expect(error.status).toBe(400);
    expect(error.code).toBe('BAD_REQUEST');
    expect(error.errors).toBeUndefined();
  });

  it('should create error with custom values', () => {
    const error = new ApiError('Not found', 404, 'NOT_FOUND');

    expect(error.status).toBe(404);
    expect(error.code).toBe('NOT_FOUND');
  });

  it('should include validation errors', () => {
    const validationErrors = [
      { field: 'email', message: 'Invalid email' },
      { field: 'name', message: 'Required' },
    ];
    const error = new ApiError('Validation failed', 422, 'VALIDATION_ERROR', validationErrors);

    expect(error.errors).toEqual(validationErrors);
  });

  describe('toJSON', () => {
    it('should return correct JSON structure', () => {
      const error = new ApiError('Bad request', 400, 'BAD_REQUEST');
      const json = error.toJSON();

      expect(json).toEqual({
        success: false,
        message: 'Bad request',
        code: 'BAD_REQUEST',
      });
    });

    it('should include errors in JSON when present', () => {
      const errors = [{ field: 'id', message: 'Invalid UUID' }];
      const error = new ApiError('Validation failed', 422, 'VALIDATION_ERROR', errors);
      const json = error.toJSON();

      expect(json.errors).toEqual(errors);
    });
  });

  describe('toResponse', () => {
    it('should create Response with correct status', async () => {
      const error = new ApiError('Forbidden', 403, 'FORBIDDEN');
      const response = error.toResponse();

      expect(response.status).toBe(403);
      expect(response.headers.get('Content-Type')).toBe('application/json');
    });

    it('should create Response with correct body', async () => {
      const error = new ApiError('Not found', 404, 'NOT_FOUND');
      const response = error.toResponse();
      const body = await response.json();

      expect(body).toEqual({
        success: false,
        message: 'Not found',
        code: 'NOT_FOUND',
      });
    });
  });

  describe('isApiError', () => {
    it('should return true for ApiError instances', () => {
      const error = new ApiError('Test');
      expect(ApiError.isApiError(error)).toBe(true);
    });

    it('should return false for regular Error', () => {
      const error = new Error('Test');
      expect(ApiError.isApiError(error)).toBe(false);
    });

    it('should return false for non-errors', () => {
      expect(ApiError.isApiError('string')).toBe(false);
      expect(ApiError.isApiError(null)).toBe(false);
      expect(ApiError.isApiError(undefined)).toBe(false);
    });
  });
});
