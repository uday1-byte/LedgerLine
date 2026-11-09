import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  api,
  apiRequest,
  setAuthToken,
  getAuthToken,
  clearAuthToken,
  registerUnauthorizedHandler,
  ApiError,
} from '../api/client';

describe('Centralized API Client', () => {
  beforeEach(() => {
    clearAuthToken();
    sessionStorage.clear();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe('Token Management Security', () => {
    it('stores token in memory and sessionStorage, NEVER in localStorage', () => {
      setAuthToken('test-jwt-token-123');

      expect(getAuthToken()).toBe('test-jwt-token-123');
      expect(sessionStorage.getItem('ledgerline_session_token')).toBe('test-jwt-token-123');
      // Critical security constraint: NEVER use localStorage
      expect(localStorage.getItem('ledgerline_session_token')).toBeNull();
      expect(localStorage.length).toBe(0);
    });

    it('clears token from memory and sessionStorage on clearAuthToken()', () => {
      setAuthToken('token-to-clear');
      clearAuthToken();

      expect(getAuthToken()).toBeNull();
      expect(sessionStorage.getItem('ledgerline_session_token')).toBeNull();
    });
  });

  describe('apiRequest execution and headers', () => {
    it('automatically injects Authorization: Bearer header when token is present', async () => {
      setAuthToken('valid-bearer-token');

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ status: 'ok' }),
      });
      global.fetch = mockFetch;

      const result = await api.get('/api/health');

      expect(result).toEqual({ status: 'ok' });
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('/api/health');
      expect(options.headers['Authorization']).toBe('Bearer valid-bearer-token');
      expect(options.headers['Accept']).toBe('application/json');
    });

    it('omits Authorization header when unauthenticated', async () => {
      clearAuthToken();

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ status: 'ok' }),
      });
      global.fetch = mockFetch;

      await api.get('/api/health');

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['Authorization']).toBeUndefined();
    });

    it('serializes JSON body and sets Content-Type for POST requests', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ message: 'success' }),
      });
      global.fetch = mockFetch;

      const payload = { email: 'user@test.com', password: 'SecretPassword123' };
      await api.post('/api/auth/login', payload);

      const [, options] = mockFetch.mock.calls[0];
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.body).toBe(JSON.stringify(payload));
    });

    it('intercepts HTTP 401, clears token, and invokes registered unauthorized callback', async () => {
      setAuthToken('expired-jwt');
      const unauthorizedSpy = vi.fn();
      registerUnauthorizedHandler(unauthorizedSpy);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ error: 'Unauthorized', message: 'Token expired' }),
      });
      global.fetch = mockFetch;

      await expect(api.get('/api/auth/me')).rejects.toThrow(ApiError);

      expect(unauthorizedSpy).toHaveBeenCalledTimes(1);
      expect(getAuthToken()).toBeNull();
      expect(sessionStorage.getItem('ledgerline_session_token')).toBeNull();
    });

    it('throws structured ApiError with response payload details on 400/403/404/422', async () => {
      const errorBody = {
        error: 'InsufficientFundsError',
        message: 'Sender has insufficient funds for this withdrawal',
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => errorBody,
      });
      global.fetch = mockFetch;

      let caughtErr = null;
      try {
        await api.post('/api/transfers/withdraw', { amountPaise: '50000' });
      } catch (err) {
        caughtErr = err;
      }

      expect(caughtErr).toBeInstanceOf(ApiError);
      expect(caughtErr.status).toBe(422);
      expect(caughtErr.errorType).toBe('InsufficientFundsError');
      expect(caughtErr.message).toBe('Sender has insufficient funds for this withdrawal');
      expect(caughtErr.data).toEqual(errorBody);
    });

    it('handles network failure cleanly without leaking sensitive details', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Failed to fetch'));

      let caughtErr = null;
      try {
        await api.get('/api/accounts');
      } catch (err) {
        caughtErr = err;
      }

      expect(caughtErr).toBeInstanceOf(ApiError);
      expect(caughtErr.status).toBe(0);
      expect(caughtErr.message).toMatch(/Network connection failed/i);
    });
  });
});

