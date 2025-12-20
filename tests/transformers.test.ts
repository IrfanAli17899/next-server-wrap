import { describe, it, expect, beforeEach } from 'vitest';
import {
  ApiResponse,
  setGlobalTransformers,
  resetGlobalTransformers,
  createErrorResponse,
} from '../src/core/response/index.js';

describe('Response Transformers', () => {
  beforeEach(() => {
    resetGlobalTransformers();
  });

  describe('default transformers', () => {
    it('should use default success format', async () => {
      const response = ApiResponse.success({ id: 1 });
      const body = await response.json();

      expect(body).toEqual({
        success: true,
        data: { id: 1 },
      });
    });

    it('should use default error format', async () => {
      const error = ApiResponse.notFound('Item not found');
      const response = createErrorResponse(error);
      const body = await response.json();

      expect(body).toEqual({
        success: false,
        message: 'Item not found',
        code: 'NOT_FOUND',
      });
    });
  });

  describe('custom transformers', () => {
    it('should use custom success transformer', async () => {
      setGlobalTransformers({
        success: (data, status) => ({
          result: data,
          ok: true,
          statusCode: status,
        }),
      });

      const response = ApiResponse.success({ name: 'test' }, 201);
      const body = await response.json();

      expect(body).toEqual({
        result: { name: 'test' },
        ok: true,
        statusCode: 201,
      });
    });

    it('should use custom error transformer', async () => {
      setGlobalTransformers({
        error: (message, code, status, errors) => ({
          error: {
            message,
            type: code,
            details: errors,
          },
          ok: false,
        }),
      });

      const error = ApiResponse.validationError('Invalid', [
        { field: 'email', message: 'Required' },
      ]);
      const response = createErrorResponse(error);
      const body = await response.json();

      expect(body).toEqual({
        error: {
          message: 'Invalid',
          type: 'VALIDATION_ERROR',
          details: [{ field: 'email', message: 'Required' }],
        },
        ok: false,
      });
    });

    it('should allow per-call transformer override', async () => {
      // Global transformer
      setGlobalTransformers({
        success: (data) => ({ global: true, data }),
      });

      // Per-call override
      const response = ApiResponse.success({ id: 1 }, 200, {
        success: (data) => ({ override: true, payload: data }),
      });
      const body = await response.json();

      expect(body).toEqual({
        override: true,
        payload: { id: 1 },
      });
    });

    it('should reset to defaults', async () => {
      setGlobalTransformers({
        success: () => ({ custom: true }),
      });

      resetGlobalTransformers();

      const response = ApiResponse.success({ id: 1 });
      const body = await response.json();

      expect(body).toEqual({
        success: true,
        data: { id: 1 },
      });
    });
  });
});
