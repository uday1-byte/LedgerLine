import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { AuthProvider, useAuth } from '../context/AuthContext';
import * as client from '../api/client';

function TestConsumer() {
  const { user, token, isAuthenticated, loading, role, login, logout, refreshUser } = useAuth();
  return (
    <div>
      <div data-testid="loading">{String(loading)}</div>
      <div data-testid="is-authenticated">{String(isAuthenticated)}</div>
      <div data-testid="username">{user ? user.username : 'anonymous'}</div>
      <div data-testid="role">{role || 'none'}</div>
      <div data-testid="token">{token ? 'present' : 'none'}</div>
      <button onClick={() => login('mock-jwt', { id: 'u1', username: 'alice', role: 'account_holder' })}>
        Trigger Login
      </button>
      <button onClick={logout}>Trigger Logout</button>
      <button onClick={refreshUser}>Trigger Refresh</button>
    </div>
  );
}

describe('AuthContext Component & Session Lifecycle', () => {
  beforeEach(() => {
    client.clearAuthToken();
    sessionStorage.clear();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('initializes with unauthenticated anonymous state when no token exists', async () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    expect(screen.getByTestId('loading').textContent).toBe('false');
    expect(screen.getByTestId('is-authenticated').textContent).toBe('false');
    expect(screen.getByTestId('username').textContent).toBe('anonymous');
    expect(screen.getByTestId('role').textContent).toBe('none');
    expect(screen.getByTestId('token').textContent).toBe('none');
  });

  it('bootstraps existing session from sessionStorage and validates with GET /api/auth/me', async () => {
    sessionStorage.setItem('ledgerline_session_token', 'stored-valid-token');

    const mockUser = {
      id: 'usr-123',
      username: 'bob_builder',
      email: 'bob@test.com',
      role: 'admin',
      is_active: true,
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ user: mockUser }),
    });

    await act(async () => {
      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      );
    });

    expect(screen.getByTestId('loading').textContent).toBe('false');
    expect(screen.getByTestId('is-authenticated').textContent).toBe('true');
    expect(screen.getByTestId('username').textContent).toBe('bob_builder');
    expect(screen.getByTestId('role').textContent).toBe('admin');
    expect(screen.getByTestId('token').textContent).toBe('present');
    expect(global.fetch).toHaveBeenCalledWith('/api/auth/me', expect.anything());
  });

  it('wipes session and logs out when stored token fails verification (401)', async () => {
    sessionStorage.setItem('ledgerline_session_token', 'invalid-token');

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ error: 'Unauthorized', message: 'Token invalid' }),
    });

    await act(async () => {
      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      );
    });

    expect(screen.getByTestId('loading').textContent).toBe('false');
    expect(screen.getByTestId('is-authenticated').textContent).toBe('false');
    expect(screen.getByTestId('username').textContent).toBe('anonymous');
    expect(sessionStorage.getItem('ledgerline_session_token')).toBeNull();
  });

  it('login() sets user state and logout() immediately purges credentials', async () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    // Initial state: not authenticated
    expect(screen.getByTestId('is-authenticated').textContent).toBe('false');

    // Trigger Login
    await act(async () => {
      screen.getByText('Trigger Login').click();
    });

    expect(screen.getByTestId('is-authenticated').textContent).toBe('true');
    expect(screen.getByTestId('username').textContent).toBe('alice');
    expect(screen.getByTestId('role').textContent).toBe('account_holder');
    expect(sessionStorage.getItem('ledgerline_session_token')).toBe('mock-jwt');

    // Trigger Logout
    await act(async () => {
      screen.getByText('Trigger Logout').click();
    });

    expect(screen.getByTestId('is-authenticated').textContent).toBe('false');
    expect(screen.getByTestId('username').textContent).toBe('anonymous');
    expect(screen.getByTestId('role').textContent).toBe('none');
    expect(sessionStorage.getItem('ledgerline_session_token')).toBeNull();
  });
});

