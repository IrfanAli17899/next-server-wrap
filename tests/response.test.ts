import { describe, it, expect } from 'vitest';
import { ApiResponse } from '../src/core/response.js';
import { ApiError } from '../src/core/error.js';

describe('ApiResponse', () => {
  describe('success responses', () => {
    it('should create success response with data', async () => {
      const data = { id: '123', name: 'Test' };
      const response = ApiResponse.success(data);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ success: true, data });
    });

    it('should create success response with custom status', async () => {
      const response = ApiResponse.success({ created: true }, 201);

      expect(response.status).toBe(201);
    });

    it('should create created response (201)', async () => {
      const data = { id: 'new-id' };
      const response = ApiResponse.created(data);

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.success).toBe(true);
    });

    it('should create noContent response (204)', () => {
      const response = ApiResponse.noContent();

      expect(response.status).toBe(204);
      expect(response.body).toBeNull();
    });
  });

  describe('error responses', () => {
    it('should create badRequest error (400)', () => {
      const error = ApiResponse.badRequest('Invalid input');

      expect(error).toBeInstanceOf(ApiError);
      expect(error.status).toBe(400);
      expect(error.code).toBe('BAD_REQUEST');
      expect(error.message).toBe('Invalid input');
    });

    it('should create unauthorized error (401)', () => {
      const error = ApiResponse.unauthorized();

      expect(error.status).toBe(401);
      expect(error.code).toBe('UNAUTHORIZED');
    });

    it('should create forbidden error (403)', () => {
      const error = ApiResponse.forbidden('Access denied');

      expect(error.status).toBe(403);
      expect(error.code).toBe('FORBIDDEN');
    });

    it('should create notFound error (404)', () => {
      const error = ApiResponse.notFound('User not found');

      expect(error.status).toBe(404);
      expect(error.code).toBe('NOT_FOUND');
    });

    it('should create conflict error (409)', () => {
      const error = ApiResponse.conflict();

      expect(error.status).toBe(409);
      expect(error.code).toBe('CONFLICT');
    });

    it('should create validationError (422)', () => {
      const errors = [{ field: 'email', message: 'Invalid email' }];
      const error = ApiResponse.validationError('Validation failed', errors);

      expect(error.status).toBe(422);
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.errors).toEqual(errors);
    });

    it('should create tooManyRequests error (429)', () => {
      const error = ApiResponse.tooManyRequests();

      expect(error.status).toBe(429);
      expect(error.code).toBe('TOO_MANY_REQUESTS');
    });

    it('should create internalError (500)', () => {
      const error = ApiResponse.internalError();

      expect(error.status).toBe(500);
      expect(error.code).toBe('INTERNAL_ERROR');
    });

    it('should create custom error', () => {
      const error = ApiResponse.error('Custom error', 418, 'IM_A_TEAPOT');

      expect(error.status).toBe(418);
      expect(error.code).toBe('IM_A_TEAPOT');
    });
  });
});
